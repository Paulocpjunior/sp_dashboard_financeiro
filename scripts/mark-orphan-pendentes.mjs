/**
 * Forense one-shot: marca _dedupe=true em docs Pendentes que tem par Pago
 * com mesmo description+dueDate+valuePaid (±0,01).
 *
 * Por que: o cleanup automatico do webhook v6.2 (jotform-webhook/index.js:540-580)
 * so roda pos-PATCH JotForm. Docs Pendentes legados nunca receberam PATCH desde
 * v6.2, entao o _dedupe nunca foi gravado e o filtro do frontend
 * (services/dataService.ts:213) nao tem o que esconder.
 *
 * Este script faz a mesma varredura, mas em batch sobre a colecao inteira.
 * NAO deleta nada — apenas grava _dedupe=true (soft hide via frontend).
 *
 * Uso:
 *   node scripts/mark-orphan-pendentes.mjs            # dry-run (so reporta)
 *   node scripts/mark-orphan-pendentes.mjs --apply    # grava _dedupe=true
 */
import { GoogleAuth } from 'google-auth-library';

const PROJECT  = 'gen-lang-client-0888019226';
const BASE     = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/transactions`;
const APPLY    = process.argv.includes('--apply');
const PAGO_SET = new Set(['Pago', 'Paga', 'Baixada', 'Quitado', 'Liquidado']);

const auth   = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/datastore'] });
const client = await auth.getClient();
const token  = (await client.getAccessToken()).token;
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

console.log(APPLY ? 'MODO: --apply (vai gravar _dedupe=true)' : 'MODO: dry-run (use --apply para gravar)\n');
console.log('Listando colecao transactions via REST...');

// Ler todos os docs (movement, status, description, dueDate, valuePaid, _dedupe, submissionId, source)
let pageToken = '';
const docs = [];
do {
  const url = `${BASE}?pageSize=300${pageToken ? `&pageToken=${pageToken}` : ''}`;
  const res = await fetch(url, { headers });
  if (!res.ok) { console.error('Erro:', await res.text()); process.exit(1); }
  const body = await res.json();
  for (const d of (body.documents || [])) {
    const f = d.fields || {};
    const id = d.name.split('/').pop();
    docs.push({
      id,
      name: d.name,
      description: f.description?.stringValue,
      dueDate:     f.dueDate?.stringValue,
      status:      f.status?.stringValue,
      movement:    f.movement?.stringValue,
      valuePaid:   f.valuePaid?.doubleValue ?? f.valuePaid?.integerValue ?? null,
      dedupe:      f._dedupe?.booleanValue === true,
    });
  }
  pageToken = body.nextPageToken || '';
  process.stdout.write(`\r  lidos: ${docs.length}`);
} while (pageToken);
console.log(`\n  total: ${docs.length}\n`);

// Indexar Pagos por chave description|dueDate
const pagoIndex = new Map();
for (const d of docs) {
  if (d.movement !== 'Saída') continue;
  if (!PAGO_SET.has(d.status)) continue;
  if (!d.description || !d.dueDate) continue;
  const key = `${d.description}|${d.dueDate}`;
  if (!pagoIndex.has(key)) pagoIndex.set(key, []);
  pagoIndex.get(key).push(d);
}
console.log(`Pagos indexados: ${[...pagoIndex.values()].reduce((a, b) => a + b.length, 0)} (${pagoIndex.size} chaves unicas)\n`);

// Pra cada Pendente sem _dedupe, achar par Pago com valuePaid match
const candidatos = [];
for (const d of docs) {
  if (d.movement !== 'Saída') continue;
  if (d.status !== 'Pendente') continue;
  if (d.dedupe) continue;
  if (!d.description || !d.dueDate) continue;
  const key = `${d.description}|${d.dueDate}`;
  const pagos = pagoIndex.get(key) || [];
  if (pagos.length === 0) continue;
  // valuePaid do Pago precisa bater com valuePaid do Pendente OU com valor original.
  // Como Pendente tem valuePaid=0, comparamos contra valuePaid do Pago e contra
  // o valor "esperado" — o Pendente tipicamente tem o mesmo valor no campo
  // valueReceived/valueOriginal/value (varia por integracao). Usamos um
  // criterio conservador: se ha EXATAMENTE 1 Pago com mesma desc+venc, pareia.
  // Se ha 2+, exige match adicional por valor (pula se Pendente nao tem valor util).
  const pendenteValueRef = d.valuePaid && d.valuePaid !== 0 ? d.valuePaid : null;
  let par = null;
  if (pagos.length === 1) {
    par = pagos[0];
  } else if (pendenteValueRef != null) {
    par = pagos.find(p => Math.abs((p.valuePaid ?? NaN) - pendenteValueRef) < 0.01) || null;
  }
  if (par) candidatos.push({ pendente: d, pago: par });
}

console.log(`Pendentes orfaos detectados: ${candidatos.length}\n`);
if (candidatos.length === 0) { console.log('Nada a fazer.'); process.exit(0); }

// Print preview (top 20)
console.log('Preview (ate 20):');
console.log('  PENDENTE_ID                     PAGO_ID                          DESC                              VENC         VALOR_PAGO');
for (const c of candidatos.slice(0, 20)) {
  const desc = (c.pendente.description || '').slice(0, 30).padEnd(30);
  console.log(`  ${c.pendente.id.padEnd(30)}  ${c.pago.id.padEnd(30)}  ${desc}  ${c.pendente.dueDate}  ${c.pago.valuePaid ?? ''}`);
}
if (candidatos.length > 20) console.log(`  ... +${candidatos.length - 20} outros`);

if (!APPLY) {
  console.log('\nDry-run. Rode com --apply para gravar _dedupe=true nos pendentes acima.');
  process.exit(0);
}

// Aplicar via PATCH (updateMask=_dedupe)
console.log('\nAplicando _dedupe=true...');
let ok = 0, fail = 0;
for (const c of candidatos) {
  const url = `https://firestore.googleapis.com/v1/${c.pendente.name}?updateMask.fieldPaths=_dedupe&updateMask.fieldPaths=_dedupe_pair_id&updateMask.fieldPaths=_dedupe_reason`;
  const body = {
    fields: {
      _dedupe:         { booleanValue: true },
      _dedupe_pair_id: { stringValue:  c.pago.id },
      _dedupe_reason:  { stringValue:  'forensic-pair-found' },
    }
  };
  const res = await fetch(url, { method: 'PATCH', headers, body: JSON.stringify(body) });
  if (res.ok) { ok++; }
  else        { fail++; console.error(`  falha em ${c.pendente.id}: ${await res.text()}`); }
  process.stdout.write(`\r  aplicados: ${ok}/${candidatos.length} (falhas: ${fail})`);
}
console.log(`\n\nConcluido: ${ok} marcados, ${fail} falhas.`);
console.log('Hard reload (Ctrl+Shift+R) no dashboard pra ver os Pendentes orfaos sumirem.');
