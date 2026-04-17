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
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { resolve(null); } });
    });
    req.on('error', () => resolve(null));
  });
}
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function main() {
  const auth = new google.auth.GoogleAuth({scopes:['https://www.googleapis.com/auth/spreadsheets.readonly']});
  const client = await auth.getClient();
  const sheets = google.sheets({version:'v4', auth: client});
  const START_ROW = 40001;
  const END_ROW = 42000;
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `Formulário de Controle de Caixa!A${START_ROW}:Z${END_ROW}`
  });
  const rows = res.data.values || [];
  console.log(`Linhas lidas: ${rows.length} (linhas ${START_ROW}-${END_ROW})`);
  const baixas = rows
    .map((r, i) => ({ row: r, sheetLine: START_ROW + i }))
    .filter(({row}) => (row[9] || '').trim() === 'SIM');
  console.log(`Doc.Pago=SIM nessa faixa: ${baixas.length}`);
  const missing = [];
  for (const {row, sheetLine} of baixas) {
    const trxId = `trx-${sheetLine - 2}`;
    const cliente = row[24] || '?';
    const dataBaixa = row[10] || '?';
    const valor = row[13] || row[11] || '?';
    const doc = await firestoreGet(trxId);
    if (!doc || !doc.fields) {
      missing.push({ trxId, cliente, dataBaixa, valor });
      console.log(`FALTANDO: ${trxId} | N.Cliente=${cliente} | dataBaixa=${dataBaixa} | valor=${valor}`);
    }
    await sleep(40);
  }
  console.log(`\n=== RESUMO ===`);
  console.log(`Baixas: ${baixas.length} | Faltando: ${missing.length}`);
}
main().catch(console.error);
