/**
 * Script de deduplicação do Firestore.
 * Identifica duplicatas por (date + client + type + movement + valuePaid + totalCobranca + dueDate)
 * Mantém o doc com ID mais antigo (trx-INDEX preferido), deleta os extras.
 */
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const PROJECT_ID = 'gen-lang-client-0888019226';
if (!getApps().length) initializeApp({ projectId: PROJECT_ID });
const db = getFirestore();

console.log('📥 Carregando todas as transações...');
const snapshot = await db.collection('transactions').get();
console.log(`   ${snapshot.size} docs encontrados\n`);

// Monta chave de deduplicação
const makeKey = (d) => [
  d.date || '',
  (d.client || '').trim().toLowerCase(),
  (d.type || '').trim().toLowerCase(),
  (d.movement || '').trim().toLowerCase(),
  String(d.valuePaid || 0),
  String(d.valueReceived || 0),
  String(d.totalCobranca || 0),
  d.dueDate || '',
].join('|');

const groups = new Map();
for (const doc of snapshot.docs) {
  const key = makeKey(doc.data());
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(doc);
}

// Identifica docs a deletar (mantém o de ID mais "trx-..." ou o mais antigo)
const toDelete = [];
let dupGroups = 0;
for (const [key, docs] of groups) {
  if (docs.length <= 1) continue;
  dupGroups++;

  // Prefere manter o com ID no formato trx-XXXXX (migração original)
  docs.sort((a, b) => {
    const aIsTrx = a.id.startsWith('trx-') ? 0 : 1;
    const bIsTrx = b.id.startsWith('trx-') ? 0 : 1;
    if (aIsTrx !== bIsTrx) return aIsTrx - bIsTrx;
    return a.id.localeCompare(b.id);
  });

  // Mantém o primeiro, deleta o resto
  for (let i = 1; i < docs.length; i++) toDelete.push(docs[i]);
}

console.log(`📊 Grupos duplicados: ${dupGroups}`);
console.log(`🗑️  Docs a deletar: ${toDelete.length}\n`);

if (toDelete.length === 0) {
  console.log('✅ Nenhum duplicado encontrado!');
  process.exit(0);
}

// Deletar em batches de 400
const BATCH_SIZE = 400;
let deleted = 0;
for (let i = 0; i < toDelete.length; i += BATCH_SIZE) {
  const chunk = toDelete.slice(i, i + BATCH_SIZE);
  const batch = db.batch();
  chunk.forEach(doc => batch.delete(doc.ref));
  await batch.commit();
  deleted += chunk.length;
  process.stdout.write(`\r  Deletados: ${deleted}/${toDelete.length}`);
}

console.log(`\n\n✔ Deduplicação concluída! ${deleted} duplicatas removidas.`);
console.log(`   Restam aprox. ${snapshot.size - deleted} transações únicas.`);
