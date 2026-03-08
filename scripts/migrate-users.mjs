/**
 * migrate-users.mjs
 * 
 * Migra usuários jessica, raquel e paulo da aba "Usuarios_Sistema"
 * da Planilha (GID 1276925607) para Firestore coleção "users".
 * 
 * Pré-requisitos:
 *   npm install firebase-admin
 * 
 * Uso:
 *   node migrate-users.mjs
 * 
 * Credenciais:
 *   Defina a variável de ambiente GOOGLE_APPLICATION_CREDENTIALS apontando
 *   para o arquivo de service account JSON do projeto gen-lang-client-0888019226.
 *   Ex: export GOOGLE_APPLICATION_CREDENTIALS="/caminho/serviceAccount.json"
 */

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { createHash } from 'crypto';

// ─── Configuração ─────────────────────────────────────────────────────────────
const PROJECT_ID = 'gen-lang-client-0888019226';
const SPREADSHEET_ID = '17mHd8eqKoj7Cl6E2MCkr0PczFj-lKv_vmFRCY5hypwg';
const GID = '1276925607';

// ─── Usuários manuais (lidos da aba Usuarios_Sistema)
// Ajuste os campos abaixo conforme os dados reais da planilha.
// O campo "password" será convertido para SHA-256 antes de gravar.
const USERS = [
  {
    username: 'jessica',
    name:     'Jessica',
    email:    '', // preencha se houver
    role:     'operacional',
    active:   true,
    password: 'jessica123', // troque pela senha real
  },
  {
    username: 'raquel',
    name:     'Raquel',
    email:    '',
    role:     'operacional',
    active:   true,
    password: 'raquel123',
  },
  {
    username: 'paulo',
    name:     'Paulo',
    email:    '',
    role:     'admin',
    active:   true,
    password: 'paulo123',
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  // Inicializa Firebase Admin (usa GOOGLE_APPLICATION_CREDENTIALS automaticamente)
  initializeApp({
    credential: cert(process.env.GOOGLE_APPLICATION_CREDENTIALS
      ? undefined  // usa variável de ambiente
      : (() => { throw new Error('Defina GOOGLE_APPLICATION_CREDENTIALS'); })()
    ),
    projectId: PROJECT_ID,
  });

  const db = getFirestore();
  const usersCol = db.collection('users');

  console.log(`\n🔥 Conectado ao Firestore — projeto: ${PROJECT_ID}`);
  console.log(`📋 Iniciando migração de ${USERS.length} usuários...\n`);

  let created = 0;
  let skipped = 0;

  for (const u of USERS) {
    // Verifica se username já existe
    const snap = await usersCol.where('username', '==', u.username).limit(1).get();

    if (!snap.empty) {
      console.log(`⚠️  Usuário "${u.username}" já existe — pulando.`);
      skipped++;
      continue;
    }

    const docData = {
      username:     u.username,
      name:         u.name,
      email:        u.email || '',
      role:         u.role,
      active:       u.active,
      passwordHash: sha256(u.password),
      createdAt:    new Date().toISOString(),
    };

    const ref = await usersCol.add(docData);
    console.log(`✅  Usuário "${u.username}" criado — doc ID: ${ref.id}`);
    created++;
  }

  console.log(`\n✔ Concluído: ${created} criado(s), ${skipped} pulado(s).\n`);
}

main().catch(err => {
  console.error('❌ Erro:', err.message);
  process.exit(1);
});
