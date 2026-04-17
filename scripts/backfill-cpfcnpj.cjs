const { google } = require('googleapis');
const { Firestore } = require('@google-cloud/firestore');

const SPREADSHEET_ID = '17mHd8eqKoj7Cl6E2MCkr0PczFj-lKv_vmFRCY5hypwg';
const SHEET_GID = '1276925607';
const PROJECT_ID = 'gen-lang-client-0888019226';
const BATCH_SIZE = 400;

async function main() {
  const auth = new google.auth.GoogleAuth({ scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  const sheets = google.sheets({ version: 'v4', auth });
  const db = new Firestore({ projectId: PROJECT_ID });

  console.log('Lendo planilha...');
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: "'Formulário de Controle de Caixa'",
  });

  const rows = res.data.values || [];
  const header = rows[0].map(h => String(h).toLowerCase().trim());
  const cpfIdx = header.findIndex(h => h.includes('cpf') || h.includes('cnpj'));
  const nClienteIdx = header.findIndex(h => h.includes('n.cliente') || h.includes('n. cliente'));

  console.log(`Coluna CPF/CNPJ: índice ${cpfIdx} | N.Cliente: índice ${nClienteIdx}`);
  console.log(`Total de linhas: ${rows.length - 1}`);

  let updated = 0, skipped = 0;
  const dataRows = rows.slice(1);

  for (let i = 0; i < dataRows.length; i += BATCH_SIZE) {
    const batch = db.batch();
    const chunk = dataRows.slice(i, i + BATCH_SIZE);

    chunk.forEach((row, offset) => {
      const rowIndex = i + offset + 1;
      const cpfCnpj = cpfIdx >= 0 ? String(row[cpfIdx] || '').trim() : '';
      const nCliente = nClienteIdx >= 0 ? parseInt(row[nClienteIdx]) || null : null;

      if (!cpfCnpj && !nCliente) { skipped++; return; }

      const ref = db.collection('transactions').doc(`trx-${rowIndex}`);
      const data = {};
      if (cpfCnpj) data.cpfCnpj = cpfCnpj;
      if (nCliente) data.clientNumber = nCliente;
      batch.update(ref, data);
      updated++;
    });

    await batch.commit();
    console.log(`Batch ${Math.floor(i/BATCH_SIZE)+1} — ${updated} atualizados, ${skipped} sem CPF/CNPJ`);
  }

  console.log(`\n✅ Concluído: ${updated} documentos atualizados no Firestore.`);
}

main().catch(console.error);
