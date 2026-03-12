const express = require('express');
const { google } = require('googleapis');
const multer = require('multer');

const app = express();
const upload = multer();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const SPREADSHEET_ID = '17mHd8eqKoj7Cl6E2MCkr0PczFj-lKv_vmFRCY5hypwg';
const SHEET_NAME = 'Formulário de Controle de Caixa';
const PROJECT_ID = process.env.GCP_PROJECT_ID || 'gen-lang-client-0888019226';

function parseJotformDate(val) {
  if (!val) return null;
  if (typeof val === 'object' && val.day) {
    const { day, month, year } = val;
    if (!day || !month || !year) return null;
    return `${String(day).padStart(2,'0')}/${String(month).padStart(2,'0')}/${year}`;
  }
  return val;
}

function parseDateToObj(str) {
  if (!str) return null;
  const parts = str.includes('/') ? str.split('/') : str.split('-').reverse();
  return new Date(parts[2], parts[1] - 1, parts[0]);
}

async function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth: await auth.getClient() });
}

async function findRowByMovimentacao(sheets, movimentacao, dataVenc) {
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${SHEET_NAME}'!A:K`,
  });
  const rows = resp.data.values || [];
  const matchingRows = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const cellMov = (row[4] || '').toString().trim().toLowerCase();
    const searchMov = movimentacao.toString().trim().toLowerCase();
    if (cellMov === searchMov) {
      if (dataVenc && row[2]) {
        const rowDate = parseDateToObj(row[2]);
        const vencDate = parseDateToObj(dataVenc);
        if (rowDate && vencDate && rowDate.toDateString() === vencDate.toDateString()) {
          return { rowIndex: i + 1, sheetRow: i };
        }
      }
      matchingRows.push({ rowIndex: i + 1, sheetRow: i });
    }
  }
  return matchingRows.length > 0 ? matchingRows[0] : null;
}

async function updateSheets(rowIndex, status, valorPago, dataPgto) {
  const sheets = await getSheetsClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${SHEET_NAME}'!J${rowIndex}:L${rowIndex}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[status, valorPago || '', dataPgto || '']] },
  });
  console.log(`Sheets atualizado: linha ${rowIndex}`);
}

async function updateFirestore(sheetRow, status, valorPago, dataPgto) {
  const docId = `trx-${sheetRow}`;
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/transactions/${docId}?updateMask.fieldPaths=pago&updateMask.fieldPaths=valorPago&updateMask.fieldPaths=dataPagamento`;
  const auth = new google.auth.GoogleAuth({ scopes: ['https://www.googleapis.com/auth/datastore'] });
  const token = await (await auth.getClient()).getAccessToken();
  const resp = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token.token}` },
    body: JSON.stringify({
      fields: {
        pago: { stringValue: status },
        valorPago: { stringValue: valorPago ? String(valorPago) : '' },
        dataPagamento: { stringValue: dataPgto || '' },
      },
    }),
  });
  if (!resp.ok) throw new Error(`Firestore PATCH falhou (${docId}): ${await resp.text()}`);
  console.log(`Firestore atualizado: ${docId}`);
}

app.post('/', upload.any(), async (req, res) => {
  try {
    // JotForm envia dados reais dentro de rawRequest como string JSON
    const topBody = req.body || {};
    let raw = {};
    if (topBody.rawRequest) {
      try { raw = JSON.parse(topBody.rawRequest); } catch(e) { raw = {}; }
    }

    const docPago = (raw.q291_docpago || '').toString().toUpperCase().trim();
    const movimentacao = (raw.q44_movimentacao44 || '').toString().trim();
    const valorRef = raw.q56_valorRefvalor56 || raw.q57_valorPago || '';
    const dataAPagar = parseJotformDate(raw.q313_dataA);
    const dataBaixa = parseJotformDate(raw.q129_dataBaixa);

    console.log('Campos extraídos:', { docPago, movimentacao, valorRef, dataAPagar });

    if (docPago !== 'SIM') {
      console.log('Ignorado: Doc.Pago =', docPago);
      return res.status(200).json({ status: 'ignored', docPago });
    }
    if (!movimentacao) {
      console.error('Movimentacao ausente');
      return res.status(400).json({ error: 'Movimentacao ausente' });
    }

    const sheets = await getSheetsClient();
    const match = await findRowByMovimentacao(sheets, movimentacao, dataAPagar);
    if (!match) {
      console.error('Nao encontrado:', movimentacao);
      return res.status(404).json({ error: 'Movimentacao nao encontrada', movimentacao });
    }

    const dataPgto = dataBaixa || dataAPagar || new Date().toLocaleDateString('pt-BR');

    await Promise.all([
      updateSheets(match.rowIndex, 'Pago', valorRef, dataPgto),
      updateFirestore(match.sheetRow, 'Pago', valorRef, dataPgto),
    ]);

    console.log(`SUCESSO: ${movimentacao} → linha ${match.rowIndex}`);
    return res.status(200).json({ status: 'success', movimentacao, rowIndex: match.rowIndex });

  } catch (err) {
    console.error('Erro:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

app.get('/', (req, res) => res.json({ status: 'jotform-webhook online' }));

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Webhook rodando na porta ${PORT}`));
