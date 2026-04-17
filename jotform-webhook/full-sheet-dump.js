const {google} = require('googleapis');
const fs = require('fs');
const SID = '17mHd8eqKoj7Cl6E2MCkr0PczFj-lKv_vmFRCY5hypwg';
const SHEET = 'Formulário de Controle de Caixa';
const OUT = '/home/p_c_pereira/audit-snapshot-20260411/fase1b/full-audit/sheet-all.json';
const CKPT = OUT + '.ckpt';
(async () => {
  const a = new google.auth.GoogleAuth({scopes:['https://www.googleapis.com/auth/spreadsheets.readonly']});
  const s = google.sheets({version:'v4', auth: await a.getClient()});
  const meta = await s.spreadsheets.get({spreadsheetId: SID});
  const sh = meta.data.sheets.find(x => x.properties.title === SHEET);
  const total = sh.properties.gridProperties.rowCount;
  console.log('total rows:', total);
  let rows = {};
  let start = 2;
  if (fs.existsSync(CKPT)) { const d = JSON.parse(fs.readFileSync(CKPT)); rows = d.rows; start = d.start; console.log('resume from', start); }
  const STEP = 1000;
  for (let r = start; r <= total; r += STEP) {
    const end = Math.min(r + STEP - 1, total);
    const range = SHEET + '!A' + r + ':AR' + end;
    const resp = await s.spreadsheets.values.get({spreadsheetId: SID, range});
    const vals = resp.data.values || [];
    vals.forEach((row, i) => {
      const trxId = 'trx-' + (r + i - 1);
      rows[trxId] = row;
    });
    fs.writeFileSync(CKPT, JSON.stringify({rows, start: end + 1}));
    console.log('  rows', r, '-', end, ' total cached:', Object.keys(rows).length);
  }
  fs.writeFileSync(OUT, JSON.stringify(rows));
  fs.unlinkSync(CKPT);
  console.log('DONE. saved', Object.keys(rows).length, 'rows to', OUT);
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
