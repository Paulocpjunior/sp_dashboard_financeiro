/**
 * backfill-client-number.mjs
 * 
 * Lê a coluna Y (N.Cliente) da Planilha e atualiza os documentos
 * correspondentes na coleção "transactions" do Firestore.
 * 
 * Estratégia de match: usa o campo "id" do documento Firestore.
 * O campo id no Firestore foi gerado como "trx-{index}" (ex: trx-0, trx-1...).
 * A linha da planilha (após o header) tem o mesmo índice, então:
 *   Firestore doc.id "trx-42" → linha de índice 42 na planilha.
 * 
 * Pré-requisitos:
 *   npm install firebase-admin node-fetch
 * 
 * Uso:
 *   export GOOGLE_APPLICATION_CREDENTIALS="/caminho/serviceAccount.json"
 *   export APPS_SCRIPT_URL="https://script.google.com/macros/s/.../exec"
 *   node backfill-client-number.mjs
 * 
 * Ou defina as constantes abaixo diretamente.
 */

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fetch from 'node-fetch';

// ─── Configuração ─────────────────────────────────────────────────────────────
const PROJECT_ID      = 'gen-lang-client-0888019226';
const SPREADSHEET_ID  = '17mHd8eqKoj7Cl6E2MCkr0PczFj-lKv_vmFRCY5hypwg';
const GID             = '1276925607';
const N_CLIENTE_COL   = 24; // índice 0-based da coluna Y

// Apps Script URL (leitura CSV público da planilha — alternativa sem auth)
const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL ||
  'https://script.google.com/macros/s/AKfycby1hCtCHpomiGpyLujr0SNdfL4AYXg0rUG_N0-s8e4B5hwOxjKa7rGsR1D2/exec';

const BATCH_SIZE = 400; // Firestore suporta até 500 ops por batch

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function fetchSheetRows() {
  // Tenta buscar via CSV público (requer planilha compartilhada em "ver por link")
  const csvUrl = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=csv&gid=${GID}`;
  console.log('📥 Buscando planilha via CSV...');
  
  const res = await fetch(csvUrl);
  if (!res.ok) throw new Error(`Falha ao buscar planilha: ${res.status} ${res.statusText}`);
  
  const text = await res.text();
  const rows = text.split('\n').map(line => {
    // Parse CSV respeitando aspas
    const cols = [];
    let cur = '';
    let inQuote = false;
    for (const ch of line) {
      if (ch === '"') { inQuote = !inQuote; continue; }
      if (ch === ',' && !inQuote) { cols.push(cur.trim()); cur = ''; continue; }
      cur += ch;
    }
    cols.push(cur.trim());
    return cols;
  });
  
  console.log(`✅ ${rows.length} linhas lidas (incluindo header).`);
  return rows;
}

function findHeaderRow(rows) {
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const lower = rows[i].map(c => (c || '').toLowerCase());
    if (lower.some(c => c.includes('tipo') || c.includes('lança') || c.includes('lanca'))) {
      return i;
    }
  }
  return 0;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  initializeApp({
    credential: cert(process.env.GOOGLE_APPLICATION_CREDENTIALS || (() => {
      throw new Error('Defina GOOGLE_APPLICATION_CREDENTIALS');
    })()),
    projectId: PROJECT_ID,
  });

  const db = getFirestore();
  console.log(`\n🔥 Firestore conectado — ${PROJECT_ID}\n`);

  // 1. Buscar planilha
  const rows = await fetchSheetRows();
  const headerIdx = findHeaderRow(rows);
  const dataRows = rows.slice(headerIdx + 1); // pula o header
  console.log(`📊 ${dataRows.length} linhas de dados (após header na linha ${headerIdx}).\n`);

  // 2. Construir mapa: índice → clientNumber
  const indexToClientNumber = new Map();
  dataRows.forEach((cols, idx) => {
    const raw = (cols[N_CLIENTE_COL] || '').trim();
    const num = parseInt(raw, 10);
    if (!isNaN(num) && num > 0) {
      indexToClientNumber.set(idx, num);
    }
  });
  console.log(`🔢 ${indexToClientNumber.size} linhas com N.Cliente preenchido.\n`);

  // 3. Buscar todos os docs do Firestore
  console.log('📦 Carregando transações do Firestore (pode demorar para 42K docs)...');
  const snap = await db.collection('transactions').get();
  console.log(`   ${snap.size} documentos encontrados.\n`);

  // 4. Processar em batches
  let updated = 0;
  let noMatch = 0;
  let batchOps = db.batch();
  let batchCount = 0;
  let batchTotal = 0;

  for (const doc of snap.docs) {
    const docId = doc.data().id || doc.id; // ex: "trx-42"
    const match = docId.match(/^trx-(\d+)$/);
    if (!match) { noMatch++; continue; }

    const idx = parseInt(match[1], 10);
    const clientNumber = indexToClientNumber.get(idx);
    
    if (clientNumber === undefined) continue; // sem N.Cliente para esta linha

    batchOps.update(doc.ref, { clientNumber });
    batchCount++;
    updated++;

    if (batchCount >= BATCH_SIZE) {
      await batchOps.commit();
      batchTotal += batchCount;
      console.log(`   ✅ Batch commitado: ${batchTotal} documentos atualizados...`);
      batchOps = db.batch();
      batchCount = 0;
    }
  }

  // Commit do batch final
  if (batchCount > 0) {
    await batchOps.commit();
    batchTotal += batchCount;
  }

  console.log(`\n✔ Migração concluída!`);
  console.log(`   Documentos atualizados: ${updated}`);
  console.log(`   Sem ID "trx-N" (pulados): ${noMatch}`);
  console.log(`   Sem N.Cliente na planilha: ${snap.size - updated - noMatch}\n`);
}

main().catch(err => {
  console.error('❌ Erro:', err.message);
  process.exit(1);
});
