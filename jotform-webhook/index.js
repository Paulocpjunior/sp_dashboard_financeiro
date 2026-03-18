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
const JOTFORM_API_KEY = '3022b146b9a70f8d6f6c3d2292739522';
const JOTFORM_FORM_ID = '210020525580845';

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
    const cellMov = (row[5] || '').toString().trim().toLowerCase();
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
    range: `'${SHEET_NAME}'!J${rowIndex}:N${rowIndex}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[status, dataPgto || '', '', '', valorPago || '']] },
  });
  console.log(`Sheets atualizado: linha ${rowIndex}`);
}

async function updateFirestore(sheetRow, status, valorPago, dataPgto, submissionId) {
  const docId = `trx-${sheetRow}`;
  const auth = new google.auth.GoogleAuth({ scopes: ['https://www.googleapis.com/auth/datastore'] });
  const token = await (await auth.getClient()).getAccessToken();

  // Campos base sempre atualizados
  const fields = {
    pago:           { stringValue: status },
    valorPago:      { stringValue: valorPago ? String(valorPago) : '' },
    dataPagamento:  { stringValue: dataPgto || '' },
  };

  // Salvar submissionId se disponível
  if (submissionId) {
    fields.submissionId = { stringValue: String(submissionId) };
  }

  const updateMask = Object.keys(fields).map(f => `updateMask.fieldPaths=${f}`).join('&');
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/transactions/${docId}?${updateMask}`;

  const resp = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token.token}` },
    body: JSON.stringify({ fields }),
  });

  if (!resp.ok) throw new Error(`Firestore PATCH falhou (${docId}): ${await resp.text()}`);
  console.log(`Firestore atualizado: ${docId} | submissionId: ${submissionId || 'N/A'}`);
}

app.post('/', upload.any(), async (req, res) => {
  try {
    const topBody = req.body || {};
    let raw = {};
    if (topBody.rawRequest) {
      try { raw = JSON.parse(topBody.rawRequest); } catch(e) { raw = {}; }
    }

    // ★ Capturar submissionID — JotForm envia no rawRequest ou no body direto
    const submissionId = raw.submissionID || topBody.submissionID || raw.submission_id || topBody.submission_id || null;

    const docPago      = (raw.q291_docpago || '').toString().toUpperCase().trim();
    const movimentacao = (raw.q44_movimentacao44 || '').toString().trim();
    const valorRef     = raw.q56_valorRefvalor56 || raw.q57_valorPago || '';
    const dataAPagar   = parseJotformDate(raw.q313_dataA);
    const dataBaixa    = parseJotformDate(raw.q129_dataBaixa);

    console.log('Campos extraídos:', { docPago, movimentacao, valorRef, dataAPagar, submissionId });

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
      updateFirestore(match.sheetRow, 'Pago', valorRef, dataPgto, submissionId),
    ]);

    console.log(`SUCESSO: ${movimentacao} → linha ${match.rowIndex} | submission: ${submissionId}`);
    return res.status(200).json({ status: 'success', movimentacao, rowIndex: match.rowIndex, submissionId });

  } catch (err) {
    console.error('Erro:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

app.get('/', (req, res) => res.json({ status: 'jotform-webhook online', version: '2.0' }));

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Webhook rodando na porta ${PORT}`));
