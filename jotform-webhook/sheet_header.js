const {google} = require('googleapis');
const auth = new google.auth.GoogleAuth({scopes:['https://www.googleapis.com/auth/spreadsheets.readonly']});
auth.getClient().then(async c => {
  const s = google.sheets({version:'v4', auth:c});
  
  // Header
  const h = await s.spreadsheets.values.get({
    spreadsheetId: '17mHd8eqKoj7Cl6E2MCkr0PczFj-lKv_vmFRCY5hypwg',
    range: 'Formulário de Controle de Caixa!A1:Z1'
  });
  console.log('HEADER:', JSON.stringify(h.data.values[0]));

  // Amostra linhas finais
  const r = await s.spreadsheets.values.get({
    spreadsheetId: '17mHd8eqKoj7Cl6E2MCkr0PczFj-lKv_vmFRCY5hypwg',
    range: 'Formulário de Controle de Caixa!A43100:Z43300'
  });
  const rows = r.data.values || [];
  console.log('Total linhas lidas:', rows.length);
  rows.slice(0,5).forEach((row,i) => console.log('L'+(i+1)+':', JSON.stringify(row)));
});
