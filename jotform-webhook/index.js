const express = require('express');
const { google } = require('googleapis');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const SPREADSHEET_ID = '17mHd8eqKoj7Cl6E2MCkr0PczFj-lKv_vmFRCY5hypwg';
const SHEET_NAME = 'Contas a Pagar';
const PROJECT_ID = process.env.GCP_PROJECT_ID || 'gen-lang-client-0888019226';
const FIRESTORE_API_KEY = process.env.FIRESTORE_API_KEY || '';

function findField(body, candidates) {
  const lowerBody = {};
  for (const key of Object.keys(body)) {
    lowerBody[key.toLowerCase().replace(/[^a-z0-9]/g, '')] = body[key];
  }
  for (const c of candidates) {
    const normalized = c.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (lowerBody[normalized] !== undefined) return lowerBody[normalized];
  }
  return null;
}

function parseDate(str) {
  if (!str) return null;
  const parts = str.includes('/') ? str.split('/').reverse() : str.split('-');
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

async function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const authClient = await auth.getClient();
  return google.sheets({ version: 'v4', auth: authClient });
}

async function findRowByMovimentacao(sheets, movimentacao, dataVenc) {
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A:K`,
  });
  const rows = resp.data.values || [];
  const matchingRows = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const cellMov = (row[4] || '').toString().trim().toLowerCase();
    const searchMov = movimentacao.toString().trim().toLowerCase();
    if (cellMov === searchMov) {
      if (dataVenc && row[2]) {
        const rowDate = parseDate(row[2]);
        const vencDate = parseDate(dataVenc);
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
  const range = `${SHEET_NAME}!J${rowIndex}:L${rowIndex}`;
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[status, valorPago || '', dataPgto || '']] },
  });
  console.log(`Sheets atualizado: linha ${rowIndex}`);
}

async function updateFirestore(sheetRow, status, valorPago, dataPgto) {
  const docId = `trx-${sheetRow}`;
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/transactions/${docId}?key=${FIRESTORE_API_KEY}&updateMask.fieldPaths=pago&updateMask.fieldPaths=valorPago&updateMask.fieldPaths=dataPagamento`;
  const body = {
    fields: {
      pago: { stringValue: status },
      valorPago: { stringValue: valorPago ? String(valorPago) : '' },
      dataPagamento: { stringValue: dataPgto || '' },
    },
  };
  const resp = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Firestore PATCH falhou (${docId}): ${err}`);
  }
  console.log(`Firestore atualizado: ${docId}`);
}

app.post('/debug', (req, res) => {
  console.log('DEBUG PAYLOAD:', JSON.stringify(req.body, null, 2));
  res.json({ received: req.body });
});

app.post('/', async (req, res) => {
  console.log('Webhook recebido:', JSON.stringify(req.body));
  try {
    const body = req.body;
    const docPago = findField(body, ['docpago','doc_pago','docPago','q6_docPago','q7_docPago','q5_docPago']);
    const movimentacao = findField(body, ['movimentacao','movimentacao','q3_movimentacao','q2_movimentacao','q4_movimentacao','lancamentodedespesas']);
    const valorRef = findField(body, ['valorRef','valor_ref','valorRefValorOriginal','q8_valorRef','valorOriginal']);
    const dataAPagar = findField(body, ['dataAPagar','data_a_pagar','dataapaagar','dataPagar','q5_dataA']);
    const dataLancamento = findField(body, ['dataLancamento','data_lancamento','q4_dataLancamento']);

    console.log('Campos:', { docPago, movimentacao, valorRef, dataAPagar });

    if (!docPago || docPago.toString().toUpperCase().trim() !== 'SIM') {
      console.log('Ignorado: Doc.Pago =', docPago);
      return res.status(200).json({ status: 'ignored', docPago });
    }
    if (!movimentacao) {
      console.error('Movimentacao ausente. Campos recebidos:', Object.keys(body));
      return res.status(400).json({ error: 'Campo Movimentacao ausente', fields: Object.keys(body) });
    }

    const sheets = await getSheetsClient();
    const match = await findRowByMovimentacao(sheets, movimentacao, dataAPagar);

    if (!match) {
      console.error('Nao encontrado:', movimentacao);
      return res.status(404).json({ error: 'Movimentacao nao encontrada', movimentacao });
    }

    const dataPgto = dataAPagar || dataLancamento || new Date().toLocaleDateString('pt-BR');

    await Promise.all([
      updateSheets(match.rowIndex, 'Pago', valorRef, dataPgto),
      updateFirestore(match.sheetRow, 'Pago', valorRef, dataPgto),
    ]);

    return res.status(200).json({ status: 'success', movimentacao, rowIndex: match.rowIndex, docId: `trx-${match.sheetRow}` });
  } catch (err) {
    console.error('Erro:', err);
    return res.status(500).json({ error: err.message });
  }
});

app.get('/', (req, res) => res.json({ status: 'jotform-webhook online' }));

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Webhook rodando na porta ${PORT}`));
