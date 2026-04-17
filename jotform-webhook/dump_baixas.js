
const {google} = require('googleapis');
const fs = require('fs');
const SHEET_ID = '17mHd8eqKoj7Cl6E2MCkr0PczFj-lKv_vmFRCY5hypwg';
const START = 40001;
const END = 42000;
const auth = new google.auth.GoogleAuth({scopes:['https://www.googleapis.com/auth/spreadsheets.readonly']});
auth.getClient().then(async c => {
  const sheets = google.sheets({version:'v4', auth:c});
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'Formulário de Controle de Caixa!A' + START + ':Z' + END
  });
  const rows = res.data.values || [];
  const baixas = [];
  rows.forEach((row, i) => {
    const docPago = (row[9] || '').trim();
    if (docPago === 'SIM') {
      baixas.push({
        trxId: 'trx-' + (START + i - 2),
        cliente: row[24] || '?',
        dataBaixa: row[10] || '?',
        valor: row[13] || row[11] || '?'
      });
    }
  });
  console.log('Total baixas SIM:', baixas.length);
  fs.writeFileSync('/tmp/baixas.json', JSON.stringify(baixas));
  console.log('Salvo em /tmp/baixas.json');
});
