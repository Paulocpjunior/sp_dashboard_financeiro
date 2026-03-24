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

function toBrDate(str) {
  if (!str) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  const parts = str.split('/');
  if (parts.length === 3) return `${parts[2]}-${parts[1]}-${parts[0]}`;
  return str;
}

async function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({ scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  return google.sheets({ version: 'v4', auth: await auth.getClient() });
}

async function readFullSheet(sheets) {
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${SHEET_NAME}'!A:R`,
  });
  return resp.data.values || [];
}

function findRowInData(rows, movimentacao, dataVenc, searchFromBottom) {
  const searchMov = (movimentacao || '').toString().trim().toLowerCase();
  const matchingRows = [];
  const indices = searchFromBottom
    ? Array.from({ length: rows.length - 1 }, (_, i) => rows.length - 1 - i)
    : Array.from({ length: rows.length - 1 }, (_, i) => i + 1);

  for (const i of indices) {
    const row = rows[i];
    if (!row) continue;
    const cellMov = (row[5] || '').toString().trim().toLowerCase();
    if (cellMov === searchMov) {
      if (dataVenc && row[2]) {
        const rowDate = parseDateToObj(row[2]);
        const vencDate = parseDateToObj(dataVenc);
        if (rowDate && vencDate && rowDate.toDateString() === vencDate.toDateString()) {
          return { rowIndex: i + 1, sheetRow: i, rowData: row };
        }
      }
      matchingRows.push({ rowIndex: i + 1, sheetRow: i, rowData: row });
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

async function getFirestoreToken() {
  const auth = new google.auth.GoogleAuth({ scopes: ['https://www.googleapis.com/auth/datastore'] });
  const token = await (await auth.getClient()).getAccessToken();
  return token.token;
}

async function updateFirestore(sheetRow, status, valorPago, dataPgto, submissionId) {
  const docId = `trx-${sheetRow}`;
  const token = await getFirestoreToken();
  const fields = {
    pago:          { stringValue: status },
    status:        { stringValue: status },
    valorPago:     { stringValue: valorPago ? String(valorPago) : '' },
    dataPagamento: { stringValue: dataPgto || '' },
    paymentDate:   { stringValue: toBrDate(dataPgto) },
  };
  if (submissionId) fields.submissionId = { stringValue: String(submissionId) };
  const updateMask = Object.keys(fields).map(f => `updateMask.fieldPaths=${f}`).join('&');
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/transactions/${docId}?${updateMask}`;
  const resp = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ fields }),
  });
  if (!resp.ok) throw new Error(`Firestore PATCH falhou (${docId}): ${await resp.text()}`);
  console.log(`Firestore PATCH: ${docId}`);
}

async function createFirestoreDocument(sheetRow, rowData, movimentacao, valorRef, dataAPagar, submissionId) {
  const docId = `trx-${sheetRow}`;
  const token = await getFirestoreToken();

  const rawDate      = String(rowData[0]  || '');
  const rawDueDate   = String(rowData[2]  || '');
  const bankAccount  = String(rowData[3]  || '');
  const tipo         = String(rowData[4]  || '');
  const description  = String(rowData[5]  || movimentacao);
  const client       = String(rowData[6]  || '');
  const paidBy       = String(rowData[7]  || '');
  const movement     = String(rowData[8]  || 'Saída');
  const rawValorOrig = String(rowData[9]  || valorRef || '0');

  const dateISO    = toBrDate(rawDate.split('T')[0]) || toBrDate(dataAPagar) || new Date().toISOString().split('T')[0];
  const dueDateISO = toBrDate(rawDueDate) || toBrDate(dataAPagar) || dateISO;

  const valorNum = parseFloat(
    rawValorOrig.replace(/[R$\s]/g, '').replace('.', '').replace(',', '.') || '0'
  ) || 0;

  const fields = {
    id:           { stringValue: docId },
    date:         { stringValue: dateISO },
    dueDate:      { stringValue: dueDateISO },
    bankAccount:  { stringValue: bankAccount },
    type:         { stringValue: tipo },
    description:  { stringValue: description },
    status:       { stringValue: 'Pendente' },
    pago:         { stringValue: 'Não' },
    client:       { stringValue: client },
    paidBy:       { stringValue: paidBy },
    movement:     { stringValue: movement || 'Saída' },
    valuePaid:    { doubleValue: valorNum },
    valueReceived:{ doubleValue: 0 },
    paymentDate:  { stringValue: '' },
    dataPagamento:{ stringValue: '' },
    valorPago:    { stringValue: '' },
    rowIndex:     { integerValue: sheetRow },
    source:       { stringValue: 'jotform' },
  };

  if (submissionId) fields.submissionId = { stringValue: String(submissionId) };

  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/transactions/${docId}`;
  const resp = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ fields }),
  });
  if (!resp.ok) throw new Error(`Firestore SET falhou (${docId}): ${await resp.text()}`);
  console.log(`Firestore CRIADO: ${docId} | ${description} | venc: ${dueDateISO}`);
}

app.post('/', upload.any(), async (req, res) => {
  try {
    const topBody = req.body || {};
    let raw = {};
    if (topBody.rawRequest) {
      try { raw = JSON.parse(topBody.rawRequest); } catch(e) { raw = {}; }
    }

    const submissionId = raw.submissionID || topBody.submissionID || raw.submission_id || topBody.submission_id || null;
    const docPago      = (raw.q291_docpago || '').toString().toUpperCase().trim();
    const movimentacao = (raw.q44_movimentacao44 || '').toString().trim();
    const valorRef     = raw.q56_valorRefvalor56 || raw.q57_valorPago || '';
    const dataAPagar   = parseJotformDate(raw.q313_dataA);
    const dataBaixa    = parseJotformDate(raw.q129_dataBaixa);

    console.log('Campos extraídos:', { docPago, movimentacao, valorRef, dataAPagar, submissionId });

    if (!movimentacao) {
      console.error('Movimentacao ausente — payload inválido');
      return res.status(400).json({ error: 'Movimentacao ausente' });
    }

    const sheets = await getSheetsClient();
    const allRows = await readFullSheet(sheets);

    // CASO 1: Baixa de pagamento (Doc.Pago = SIM)
    if (docPago === 'SIM') {
      const match = findRowInData(allRows, movimentacao, dataAPagar, false);
      if (!match) {
        console.error('Não encontrado para baixa:', movimentacao);
        return res.status(404).json({ error: 'Movimentacao nao encontrada', movimentacao });
      }
      const dataPgto = dataBaixa || dataAPagar || new Date().toLocaleDateString('pt-BR');
      await Promise.all([
        updateSheets(match.rowIndex, 'Pago', valorRef, dataPgto),
        updateFirestore(match.sheetRow, 'Pago', valorRef, dataPgto, submissionId),
      ]);
      console.log(`BAIXA OK: ${movimentacao} → linha ${match.rowIndex}`);
      return res.status(200).json({ status: 'payment_updated', movimentacao, rowIndex: match.rowIndex, submissionId });
    }

    // CASO 2: Novo lançamento (Doc.Pago = NÃO / vazio)
    // Busca de baixo pra cima — JotForm acabou de inserir a linha
    const match = findRowInData(allRows, movimentacao, dataAPagar, true);
    if (!match) {
      console.warn('Linha não encontrada ainda, criando com dados mínimos do JotForm:', movimentacao);
      const syntheticSheetRow = allRows.length;
      await createFirestoreDocument(
        syntheticSheetRow,
        ['', '', dataAPagar || '', '', '', movimentacao, '', '', 'Saída', valorRef || '0'],
        movimentacao, valorRef, dataAPagar, submissionId
      );
      return res.status(200).json({ status: 'entry_created_minimal', movimentacao, sheetRow: syntheticSheetRow });
    }

    await createFirestoreDocument(match.sheetRow, match.rowData, movimentacao, valorRef, dataAPagar, submissionId);
    console.log(`LANÇAMENTO OK: ${movimentacao} → linha ${match.rowIndex} | trx-${match.sheetRow}`);
    return res.status(200).json({ status: 'entry_created', movimentacao, rowIndex: match.rowIndex, sheetRow: match.sheetRow, submissionId });

  } catch (err) {
    console.error('Erro:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

app.get('/', (req, res) => res.json({ status: 'jotform-webhook online', version: '3.0' }));

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Webhook rodando na porta ${PORT}`));
