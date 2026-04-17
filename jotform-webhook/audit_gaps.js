const {google} = require('googleapis');
const https = require('https');
const {execSync} = require('child_process');

const SHEET_ID = '17mHd8eqKoj7Cl6E2MCkr0PczFj-lKv_vmFRCY5hypwg';
const PROJECT = 'gen-lang-client-0888019226';
const TOKEN = execSync('gcloud auth print-access-token').toString().trim();

function firestoreGet(docId) {
  return new Promise((resolve) => {
    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/transactions/${docId}`;
    const req = https.get(url, {headers: {'Authorization': `Bearer ${TOKEN}`}}, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
  });
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const auth = new google.auth.GoogleAuth({scopes:['https://www.googleapis.com/auth/spreadsheets.readonly']});
  const client = await auth.getClient();
  const sheets = google.sheets({version:'v4', auth: client});

  // Lê últimas 1500 linhas (cobre 2026 completo)
  // Linhas da sheet: header=1, dados começam na linha 2
  // Início da leitura: linha 42001 → trx-41999
  const START_ROW = 42001;
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `Formulário de Controle de Caixa!A${START_ROW}:Z43300`
  });
  const rows = res.data.values || [];
  console.log(`Linhas lidas da planilha: ${rows.length}`);

  // Filtrar Doc.Pago=SIM
  const baixas = rows
    .map((r, i) => ({ row: r, sheetLine: START_ROW + i }))
    .filter(({row}) => row[9] === 'SIM');

  console.log(`Linhas com Doc.Pago=SIM: ${baixas.length}`);

  const missing = [];
  const found = [];

  for (const {row, sheetLine} of baixas) {
    const trxId = `trx-${sheetLine - 2}`;
    const cliente = row[24] || '?';
    const dataBaixa = row[10] || '?';
    const valor = row[13] || row[11] || '?';

    const doc = await firestoreGet(trxId);
    const existe = doc && doc.fields;
    const status = existe ? doc.fields.status?.stringValue : null;
    const paymentDate = existe ? doc.fields.paymentDate?.stringValue : null;

    if (!existe) {
      missing.push({ trxId, cliente, dataBaixa, valor, sheetLine });
      console.log(`FALTANDO: ${trxId} | N.Cliente=${cliente} | dataBaixa=${dataBaixa} | valor=${valor}`);
    } else if (!paymentDate) {
      console.log(`SEM paymentDate: ${trxId} | N.Cliente=${cliente} | status=${status}`);
    }

    await sleep(50); // evitar rate limit
  }

  console.log(`\n=== RESUMO ===`);
  console.log(`Total baixas na planilha: ${baixas.length}`);
  console.log(`Docs FALTANDO no Firestore: ${missing.length}`);
  missing.forEach(m => console.log(`  ${m.trxId} | cliente=${m.cliente} | baixa=${m.dataBaixa} | valor=${m.valor}`));
}

main().catch(console.error);
