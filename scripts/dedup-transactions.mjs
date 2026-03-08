/**
 * Deduplicação via REST API (HTTP) — sem gRPC, sem timeout.
 * Lista docs em páginas de 300, identifica IDs não-trx, deleta em batch.
 */
import { GoogleAuth } from 'google-auth-library';

const PROJECT = 'gen-lang-client-0888019226';
const BASE    = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/transactions`;

const auth   = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/datastore'] });
const client = await auth.getClient();
const token  = (await client.getAccessToken()).token;
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

const TRX_RE = /^trx-\d+$/;

// 1. Listar todos os IDs via REST (paginado, 300 por página)
console.log('📋 Listando IDs via REST API...');
let pageToken = '';
let total = 0;
const toDelete = [];

do {
  const url = `${BASE}?pageSize=300&mask.fieldPaths=__name__${pageToken ? `&pageToken=${pageToken}` : ''}`;
  const res = await fetch(url, { headers });
  if (!res.ok) { console.error('Erro:', await res.text()); process.exit(1); }
  const body = await res.json();

  for (const doc of (body.documents || [])) {
    const id = doc.name.split('/').pop();
    total++;
    if (!TRX_RE.test(id)) toDelete.push(doc.name);
  }

  pageToken = body.nextPageToken || '';
  process.stdout.write(`\r  Lidos: ${total} | Duplicatas: ${toDelete.length}`);
} while (pageToken);

console.log(`\n\n✅ Legítimos (trx-N): ${total - toDelete.length}`);
console.log(`🗑️  Para deletar:      ${toDelete.length}\n`);

if (toDelete.length === 0) { console.log('Nenhum duplicado!'); process.exit(0); }

// 2. Deletar via batchWrite (máx 20 por chamada na REST API v1)
const CHUNK = 20;
let deleted = 0;
for (let i = 0; i < toDelete.length; i += CHUNK) {
  const writes = toDelete.slice(i, i + CHUNK).map(name => ({ delete: name }));
  const res = await fetch(
    `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents:batchWrite`,
    { method: 'POST', headers, body: JSON.stringify({ writes }) }
  );
  if (!res.ok) { console.error('\nErro ao deletar:', await res.text()); process.exit(1); }
  deleted += writes.length;
  process.stdout.write(`\r  Deletados: ${deleted}/${toDelete.length}`);
}

console.log(`\n\n✔ Concluído! ${deleted} duplicatas removidas.`);
console.log(`  Coleção agora com ${total - deleted} documentos únicos.`);
