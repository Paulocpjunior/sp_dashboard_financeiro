const {google} = require('googleapis');
(async () => {
  const a = new google.auth.GoogleAuth({scopes:['https://www.googleapis.com/auth/spreadsheets.readonly']});
  const s = google.sheets({version:'v4', auth: await a.getClient()});
  const SID = '17mHd8eqKoj7Cl6E2MCkr0PczFj-lKv_vmFRCY5hypwg';
  const SHEET = 'Formulário de Controle de Caixa';
  // Test: trx-N => row N+1 (1=header, trx-0 = row 2)
  const probes = [43358, 43317, 43316, 43409, 43410, 7081, 7083, 43141, 43130, 42929, 4129];
  for (const n of probes) {
    const row = n + 1;
    const range = SHEET + '!A' + row + ':AR' + row;
    const r = await s.spreadsheets.values.get({spreadsheetId: SID, range});
    const v = (r.data.values && r.data.values[0]) || [];
    console.log('trx-' + n + ' (row ' + row + '):');
    console.log('  tipo[3]      =', v[3] || '');
    console.log('  movim[5]     =', v[5] || '');
    console.log('  dataPagar[7] =', v[7] || '');
    console.log('  docPago[9]   =', v[9] || '');
    console.log('  dataBaixa[10]=', v[10] || '');
    console.log('  valOrig[11]  =', v[11] || '');
    console.log('  valPago[13]  =', v[13] || '');
    console.log('  obsPagar[17] =', (v[17] || '').slice(0,40));
    console.log('  dataVenR[22] =', v[22] || '');
    console.log('  nCliente[24] =', v[24] || '');
    console.log('  empresa[26]  =', (v[26] || '').slice(0,30));
    console.log('  valRecb[31]  =', v[31] || '');
    console.log('  obsReceb[36] =', (v[36] || '').slice(0,40));
    console.log('  SUBMISSION[42]=', v[42] || '');
    console.log('');
  }
})().catch(e => console.error('ERR:', e.message));
