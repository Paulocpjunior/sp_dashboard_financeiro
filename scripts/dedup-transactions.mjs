/**
 * Deduplicação via listDocuments() — busca só referências, sem dados.
 * Duplicatas = docs com ID não-padrão (não "trx-NÚMERO"), gerados pelo MigrationPanel antigo.
 */
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const PROJECT_ID = 'gen-lang-client-0888019226';
if (!getApps().length) initializeApp({ projectId: PROJECT_ID });
const db = getFirestore();

console.log('📋 Listando referências (sem dados)...');
const refs = await db.collection('transactions').listDocuments();
console.log(`   ${refs.length} docs encontrados\n`);

// Separa IDs legítimos (trx-NÚMERO) dos aleatórios
const TRX_RE = /^trx-\d+$/;
const toDelete = refs.filter(r => !TRX_RE.test(r.id));
const legit = refs.length - toDelete.length;

console.log(`✅ IDs legítimos (trx-NÚMERO): ${legit}`);
console.log(`🗑️  IDs aleatórios (duplicatas): ${toDelete.length}\n`);

if (toDelete.length === 0) {
  console.log('Nenhum duplicado encontrado!');
  process.exit(0);
}

// Deletar em batches de 400
const BATCH_SIZE = 400;
let deleted = 0;
for (let i = 0; i < toDelete.length; i += BATCH_SIZE) {
  const chunk = toDelete.slice(i, i + BATCH_SIZE);
  const batch = db.batch();
  chunk.forEach(ref => batch.delete(ref));
  await batch.commit();
  deleted += chunk.length;
  process.stdout.write(`\r  Deletados: ${deleted}/${toDelete.length}`);
}

console.log(`\n\n✔ Concluído! ${deleted} duplicatas removidas.`);
console.log(`   Coleção agora com ${legit} transações únicas.`);
