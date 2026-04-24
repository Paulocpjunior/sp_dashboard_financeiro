const express = require('express');
const { google } = require('googleapis');
const multer = require('multer');

const app = express();
const upload = multer();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PROJECT_ID = process.env.GCP_PROJECT_ID || 'gen-lang-client-0888019226';
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

// ── Date helpers ──────────────────────────────────────────────────────────────

function parseJotformDate(val) {
  if (!val) return null;
  if (typeof val === 'object' && val.day) {
    const { day, month, year } = val;
    if (!day || !month || !year) return null;
    return `${String(day).padStart(2,'0')}/${String(month).padStart(2,'0')}/${year}`;
  }
  return val;
}

function toBrDate(str) {
  if (!str) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  const parts = str.split('/');
  if (parts.length === 3) return `${parts[2]}-${parts[1]}-${parts[0]}`;
  return str;
}

function parseValor(v) {
  if (!v) return 0;
  return parseFloat(String(v).replace(/[R$\s]/g,'').replace(/\./g,'').replace(',','.')) || 0;
}

// ── Dynamic field scanner (para IDs desconhecidos) ────────────────────────────
// Varre o raw do JotForm procurando por padrões no nome do campo

function findRawField(raw, ...patterns) {
  for (const key of Object.keys(raw)) {
    const lower = key.toLowerCase();
    if (patterns.some(p => lower.includes(p.toLowerCase()))) {
      const val = raw[key];
      if (val !== null && val !== undefined && val !== '') return val;
    }
  }
  return null;
}

// ── Firestore helpers ─────────────────────────────────────────────────────────

async function getFirestoreToken() {
  const auth = new google.auth.GoogleAuth({ scopes: ['https://www.googleapis.com/auth/datastore'] });
  const token = await (await auth.getClient()).getAccessToken();
  return token.token;
}

async function firestoreSet(docId, fields) {
  const token = await getFirestoreToken();
  const url = `${FIRESTORE_BASE}/transactions/${docId}`;
  const resp = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ fields }),
  });
  if (!resp.ok) throw new Error(`Firestore SET falhou (${docId}): ${await resp.text()}`);
  console.log(`Firestore SET: ${docId}`);
  return docId;
}

async function firestorePatch(docId, fields) {
  const token = await getFirestoreToken();
  const mask = Object.keys(fields).map(f => `updateMask.fieldPaths=${f}`).join('&');
  const url = `${FIRESTORE_BASE}/transactions/${docId}?${mask}`;
  const resp = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ fields }),
  });
  if (!resp.ok) throw new Error(`Firestore PATCH falhou (${docId}): ${await resp.text()}`);
  console.log(`Firestore PATCH: ${docId}`);
  return docId;
}

async function queryFirestore(filters) {
  const token = await getFirestoreToken();
  const url = `${FIRESTORE_BASE}:runQuery`;
  const body = {
    structuredQuery: {
      from: [{ collectionId: 'transactions' }],
      where: {
        compositeFilter: {
          op: 'AND',
          filters: filters.map(([field, value]) => ({
            fieldFilter: {
              field: { fieldPath: field },
              op: 'EQUAL',
              value: { stringValue: value }
            }
          }))
        }
      },
      limit: 10
    }
  };
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const data = await resp.json();
  return data.filter(d => d.document);
}

async function firestoreDelete(docId) {
  const token = await getFirestoreToken();
  const url = `${FIRESTORE_BASE}/${docId}`;
  const resp = await fetch(url, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok && resp.status !== 404) {
    const txt = await resp.text();
    throw new Error(`Delete falhou (${resp.status}): ${txt}`);
  }
  console.log(`Firestore DELETE: ${docId}`);
  return true;
}

// ── NOVO: busca por submissionId ──────────────────────────────────────────────

async function queryBySubmissionId(submissionId, fallback) {
  const token = await getFirestoreToken();
  const url = `${FIRESTORE_BASE}:runQuery`;

  // 1) Match direto por submissionId / submissionID
  for (const fieldName of ['submissionId', 'submissionID']) {
    const body = {
      structuredQuery: {
        from: [{ collectionId: 'transactions' }],
        where: { fieldFilter: {
          field: { fieldPath: fieldName },
          op: 'EQUAL',
          value: { stringValue: String(submissionId) }
        }},
        limit: 10
      }
    };
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const data = await resp.json();
    const found = (data || []).filter(d => d.document);
    if (found.length > 0) {
      console.log(`Match por ${fieldName}=${submissionId} → ${found.length} doc(s)`);
      return found;
    }
  }

  // 2) Fallback Receber v5.6: (clientNumber + cpfCnpj + dueDate)
  // Exige os 3 campos para impressao digital unica.
  // Bloqueia match por nome (matriz/filial com nome igual causavam corrupcao).
  if (fallback && fallback.kind === 'receber' && fallback.clientNumber && fallback.cpfCnpj && fallback.dueDate) {
    console.log(`Fallback Receber v5.6: cli=${fallback.clientNumber} cnpj=${fallback.cpfCnpj} venc=${fallback.dueDate}`);
    const buildBody = (cnVal) => ({
      structuredQuery: {
        from: [{ collectionId: 'transactions' }],
        where: { compositeFilter: {
          op: 'AND',
          filters: [
            { fieldFilter: { field: { fieldPath: 'clientNumber' }, op: 'EQUAL', value: cnVal } },
            { fieldFilter: { field: { fieldPath: 'cpfCnpj' }, op: 'EQUAL', value: { stringValue: String(fallback.cpfCnpj) } } },
            { fieldFilter: { field: { fieldPath: 'dueDate' }, op: 'EQUAL', value: { stringValue: String(fallback.dueDate) } } }
          ]
        }},
        limit: 10
      }
    });
    for (const cnVal of [{ integerValue: String(fallback.clientNumber) }, { stringValue: String(fallback.clientNumber) }]) {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(buildBody(cnVal)),
      });
      const data = await resp.json();
      const found = (data || []).filter(d => d.document);
      if (found.length > 0) { console.log(`Fallback Receber v5.6 match → ${found.length} doc(s)`); return found; }
    }
    console.log(`Fallback Receber v5.6: sem match - criara novo doc`);
  } else if (fallback && fallback.kind === 'receber') {
    console.log(`Fallback Receber v5.6 NAO APLICADO - faltam campos: cli=${!!fallback.clientNumber} cnpj=${!!fallback.cpfCnpj} venc=${!!fallback.dueDate}`);
  }

  // 3) Fallback Pagar: (description + dueDate + valuePaid)
  if (fallback && fallback.kind === 'pagar' && fallback.description && fallback.dueDate && fallback.valuePaid != null) {
    console.log(`Fallback Pagar: desc='${fallback.description}' venc=${fallback.dueDate} valor=${fallback.valuePaid}`);
    const body = {
      structuredQuery: {
        from: [{ collectionId: 'transactions' }],
        where: { compositeFilter: {
          op: 'AND',
          filters: [
            { fieldFilter: { field: { fieldPath: 'description' }, op: 'EQUAL', value: { stringValue: String(fallback.description) } } },
            { fieldFilter: { field: { fieldPath: 'dueDate' }, op: 'EQUAL', value: { stringValue: String(fallback.dueDate) } } }
          ]
        }},
        limit: 50
      }
    };
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const data = await resp.json();
    const all = (data || []).filter(d => d.document);
    // Filtragem client-side por valuePaid (evita índice composto)
    const target = Number(fallback.valuePaid);
    const matches = all.filter(d => {
      const fields = d.document.fields || {};
      // v5.7: NUNCA sobrescrever docs ja Pagos — so atualiza Pendentes
      const st = fields.status && fields.status.stringValue;
      if (st !== 'Pendente') return false;
      // v5.7: rejeitar docs com _dedupe=true (orfaos ja tratados)
      const ded = fields._dedupe && fields._dedupe.booleanValue;
      if (ded === true) return false;
      const vp = fields.valuePaid;
      if (!vp) return false;
      const v = vp.doubleValue != null ? Number(vp.doubleValue)
              : vp.integerValue != null ? Number(vp.integerValue)
              : vp.stringValue != null ? Number(String(vp.stringValue).replace(',', '.'))
              : NaN;
      return Number.isFinite(v) && Math.abs(v - target) < 0.005;
    });
    // v5.7: match unico = seguro. Ambiguo (2+) = criar novo doc (seguro).
    if (matches.length === 1) { console.log(`Fallback Pagar match UNICO → doc ${matches[0].document.name.split('/').pop()}`); return matches; }
    if (matches.length > 1) { console.log(`Fallback Pagar AMBIGUO: ${matches.length} matches — criara novo doc`); return null; }
  }

  return null;
}

function toFields(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) continue;
    else if (typeof v === 'number') fields[k] = Number.isInteger(v) ? { integerValue: v } : { doubleValue: v };
    else if (typeof v === 'boolean') fields[k] = { booleanValue: v };
    else fields[k] = { stringValue: String(v) };
  }
  return fields;
}

// v5.3: gera trx-N sequencial via counter atomico em meta/lastTrxN
async function generateDocId() {
  const token = await getFirestoreToken();
  const counterUrl = 'https://firestore.googleapis.com/v1/projects/' + PROJECT_ID + '/databases/(default)/documents:commit';
  const docPath = 'projects/' + PROJECT_ID + '/databases/(default)/documents/meta/lastTrxN';
  const body = {
    writes: [{
      transform: {
        document: docPath,
        fieldTransforms: [{ fieldPath: 'value', increment: { integerValue: '1' } }]
      }
    }]
  };
  try {
    const resp = await fetch(counterUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify(body),
    });
    const data = await resp.json();
    if (data.writeResults && data.writeResults[0] && data.writeResults[0].transformResults) {
      const newVal = data.writeResults[0].transformResults[0].integerValue;
      const id = 'trx-' + newVal;
      console.log('generateDocId: ' + id);
      return id;
    }
    console.log('generateDocId: counter response unexpected, fallback. resp=' + JSON.stringify(data).slice(0,200));
  } catch (e) {
    console.log('generateDocId: counter ERR ' + e.message + ', fallback');
  }
  const fallback = 'trx-jf-' + Date.now();
  console.log('generateDocId FALLBACK: ' + fallback);
  return fallback;
}

// ── Extrai todos os campos relevantes do raw JotForm ─────────────────────────
// Centraliza o parsing para reutilizar no UPDATE e no CREATE

function extractContasReceber(raw) {
  const nomeEmpresa  = (raw.q169_nomeEmpresa || '').toString().trim();
  const docPago      = (raw.q314_docpago314  || '').toString().toUpperCase().trim();
  const valorRecebido = raw.q252_valorRecebido || raw.q279_totalCobranca279 || '';
  const dataVenc     = parseJotformDate(raw.q262_dataVencimentoreceber);
  const dataReceb    = parseJotformDate(raw.q263_dataRecebimento);

  // Dynamic scan para campos sem ID fixo conhecido
  const honorariosRaw = findRawField(raw, 'honorar', 'honora');
  const extrasRaw     = findRawField(raw, 'valorextra', 'extras', 'valorExtra');
  const nClienteRaw   = findRawField(raw, 'ncliente', 'nclient', 'codigoempresa', 'codigocliente', 'clientenum');
  const cnpjRaw       = findRawField(raw, 'cnpj', 'cpfcnpj', 'cpf_cnpj', 'cpf');
  const metodoRaw     = findRawField(raw, 'metodopag', 'metodoenv', 'recebivelmetodo', 'recebivel');
  const obsRaw        = findRawField(raw, 'observac', 'obs_');
  const cobrancaExtra = findRawField(raw, 'cobrancaextra', 'cobextra', 'cobrancas');

  console.log('[CR] Dynamic scan:', {
    honorariosRaw, extrasRaw, nClienteRaw, cnpjRaw, metodoRaw
  });

  return {
    nomeEmpresa,
    docPago,
    valorRecebido,
    dataVenc,
    dataReceb,
    honorarios: parseValor(honorariosRaw),
    extras:     parseValor(extrasRaw),
    nCliente:   nClienteRaw ? String(nClienteRaw).trim() : '',
    cnpj:       cnpjRaw     ? String(cnpjRaw).trim()    : '',
    metodo:     metodoRaw   ? String(metodoRaw).trim()  : '',
    obs:        obsRaw      ? String(obsRaw).trim()     : '',
    cobrancaExtra: cobrancaExtra ? String(cobrancaExtra).trim() : '',
    valorNum:   parseValor(valorRecebido),
    dueDateISO: toBrDate(dataVenc),
    dataPgto:   dataReceb || dataVenc || new Date().toLocaleDateString('pt-BR'),
  };
}

function extractContasPagar(raw) {
  const movimentacao = (raw.q44_movimentacao44 || '').toString().trim();
  const docPago      = (raw.q291_docpago       || '').toString().toUpperCase().trim();
  const valorRef     = raw.q56_valorRefvalor56  || raw.q57_valorPago || '';
  const dataAPagar   = parseJotformDate(raw.q313_dataA);
  const dataBaixa    = parseJotformDate(raw.q129_dataBaixa);

  const obsRaw    = findRawField(raw, 'observac', 'obs_');
  const metodoRaw = findRawField(raw, 'metodopag', 'metodoenv');

  return {
    movimentacao,
    docPago,
    valorRef,
    dataAPagar,
    dataBaixa,
    obs:       obsRaw    ? String(obsRaw).trim()    : '',
    metodo:    metodoRaw ? String(metodoRaw).trim() : '',
    valorNum:  parseValor(valorRef),
    dueDateISO: toBrDate(dataAPagar),
    dataPgto:  dataBaixa || dataAPagar || new Date().toLocaleDateString('pt-BR'),
  };
}

// ── Monta fields completos para UPDATE no Firestore ───────────────────────────

function buildContasReceberFields(cr, submissionId) {
  const isPago = cr.docPago === 'SIM';
  const obj = {
    source:        'jotform',
    movement:      'Entrada',
    type:          'Entrada de Caixa / Contas a Receber',
    status:        isPago ? 'Pago' : 'Pendente',
    pago:          isPago ? 'Pago' : 'Não',
    client:        cr.nomeEmpresa,
    description:   cr.nomeEmpresa,
    dueDate:       cr.dueDateISO,
    date:          cr.dueDateISO,
    paymentDate:   isPago ? toBrDate(cr.dataPgto) : '',
    dataPagamento: isPago ? cr.dataPgto : '',
    valorOriginal: cr.valorNum,
    valueReceived: isPago ? cr.valorNum : 0,
    valorPago:     isPago ? String(cr.valorRecebido || '') : '',
    updatedAt:     new Date().toISOString(),
  };

  // Campos extras — só grava se tiver valor
  if (cr.honorarios > 0)  obj.honorarios  = cr.honorarios;
  if (cr.extras > 0)      obj.extras      = cr.extras;
  if (cr.nCliente)        obj.clientNumber = cr.nCliente;
  if (cr.nCliente)        obj.nCliente     = cr.nCliente;
  if (cr.cnpj)            obj.cpfCnpj      = cr.cnpj;
  if (cr.metodo)          obj.metodoPagamento = cr.metodo;
  if (cr.obs)             obj.observacao   = cr.obs;
  if (cr.cobrancaExtra)   obj.cobrancaExtra = cr.cobrancaExtra;
  if (submissionId)       obj.submissionId  = String(submissionId);

  return toFields(obj);
}

function buildContasPagarFields(cp, submissionId) {
  const isPago = cp.docPago === 'SIM';
  const obj = {
    source:        'jotform',
    movement:      'Saída',
    type:          'Saída de Caixa / Contas a Pagar',
    status:        isPago ? 'Pago' : 'Pendente',
    pago:          isPago ? 'Pago' : 'Não',
    description:   cp.movimentacao,
    client:        cp.movimentacao,
    dueDate:       cp.dueDateISO,
    date:          cp.dueDateISO,
    paymentDate:   isPago ? toBrDate(cp.dataPgto) : '',
    dataPagamento: isPago ? cp.dataPgto : '',
    valorOriginal: cp.valorNum,
    valuePaid:     cp.valorNum,
    valueReceived: 0,
    valorPago:     isPago ? String(cp.valorRef || '') : '',
    updatedAt:     new Date().toISOString(),
  };

  if (cp.obs)    obj.observacaoAPagar = cp.obs;
  if (cp.metodo) obj.metodoPagamento = cp.metodo;
  if (submissionId) obj.submissionId = String(submissionId);

  return toFields(obj);
}

// ── Main webhook ──────────────────────────────────────────────────────────────

app.post('/', upload.any(), async (req, res) => {
  try {
    const topBody = req.body || {};
    let raw = {};
    if (topBody.rawRequest) {
      try { raw = JSON.parse(topBody.rawRequest); } catch(e) { raw = {}; }
    }

    // LOG COMPLETO — identifica IDs de campos desconhecidos nos logs do Cloud Run
    console.log('=== RAW PAYLOAD KEYS ===', Object.keys(raw).join(', '));
    console.log('=== RAW PAYLOAD ===', JSON.stringify(raw, null, 2));

    const submissionId = raw.submissionID || topBody.submissionID ||
                         raw.submission_id || topBody.submission_id || null;

    const isContasReceber = !!raw.q314_docpago314 || !!raw.q169_nomeEmpresa ||
      !!(raw.q262_dataVencimentoreceber && raw.q262_dataVencimentoreceber.day);

    console.log('Formulário:', isContasReceber ? 'Contas a Receber' : 'Contas a Pagar');
    console.log('submissionId:', submissionId);

    // ══════════════════════════════════════════════════════════════════════════
    // CAMINHO 1: EDIÇÃO — submissionId já existe no Firestore → UPDATE completo
    // ══════════════════════════════════════════════════════════════════════════
    if (submissionId) {
      // v5.2: fallback DESABILITADO para Contas a Pagar (causou sobrescrita de docs alheios
      // porque clientNumber em Pagar = categoria de movimentação, não cliente único).
      // Receber mantém fallback porque q169_nomeEmpresa tem cardinalidade alta.
      let fallbackLookup;
      // v5.6c EMERGENCIAL: fallback Receber DESABILITADO - bug no fluxo "criar novo" sobrescreve doc existente
      // Qualquer edicao sem submissionId vira novo doc (duplicata visivel, removivel depois)
      if (false && isContasReceber) {
        fallbackLookup = null;
      }
      // v5.7: fallback Pagar REABILITADO com protecao status=Pendente
      // So atualiza docs Pendentes (nunca sobrescreve Pagos).
      // Se match ambiguo (0 ou 2+), cria novo doc (comportamento seguro).
      if (!isContasReceber) {
        const cp = extractContasPagar(raw);
        fallbackLookup = {
          kind: 'pagar',
          description: cp.movimentacao,
          dueDate: cp.dueDateISO,
          valuePaid: cp.valorNum,
        };
      }
      const existingArr = await queryBySubmissionId(submissionId, fallbackLookup);

      if (existingArr && existingArr.length > 0) {
        // Ordenar por createTime ascendente — o mais antigo é o canônico
        existingArr.sort((a, b) => (a.document.createTime || '').localeCompare(b.document.createTime || ''));
        const primary = existingArr[0];
        const duplicates = existingArr.slice(1);
        const docId = primary.document.name.split('/').pop();
        if (duplicates.length > 0) {
          console.log(`DUPLICATAS detectadas (${duplicates.length}) para submissionId ${submissionId} — mantendo ${docId}, deletando: ${duplicates.map(d=>d.document.name.split('/').pop()).join(', ')}`);
          for (const dup of duplicates) {
            const dupId = dup.document.name.split('/').pop();
            try { await firestoreDelete(dupId); }
            catch (e) { console.error(`Falha ao deletar duplicata ${dupId}:`, e.message); }
          }
        }
        console.log(`EDIÇÃO DETECTADA — submissionId ${submissionId} → doc ${docId}`);

        let updateFields;
        if (isContasReceber) {
          const cr = extractContasReceber(raw);
          console.log('[CR] Parsed:', cr);
          updateFields = buildContasReceberFields(cr, submissionId);
        } else {
          const cp = extractContasPagar(raw);
          console.log('[CP] Parsed:', cp);
          updateFields = buildContasPagarFields(cp, submissionId);
        }

        await firestorePatch(docId, updateFields);
        console.log(`UPDATE OK: ${docId} (submissionId: ${submissionId})`);
        return res.status(200).json({
          status: 'entry_updated',
          docId,
          submissionId,
          form: isContasReceber ? 'contas_receber' : 'contas_pagar'
        });
      }
      // submissionId presente mas NÃO encontrado no Firestore → segue fluxo normal
      console.log(`submissionId ${submissionId} não encontrado no Firestore — tratando como novo`);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // CAMINHO 2 e 3: lógica original (baixa ou novo lançamento)
    // ══════════════════════════════════════════════════════════════════════════

    const docPago = isContasReceber
      ? (raw.q314_docpago314 || '').toString().toUpperCase().trim()
      : (raw.q291_docpago    || '').toString().toUpperCase().trim();

    const movimentacao = isContasReceber
      ? (raw.q169_nomeEmpresa || '').toString().trim()
      : (raw.q44_movimentacao44 || '').toString().trim();

    const valorRef = isContasReceber
      ? (raw.q252_valorRecebido || raw.q279_totalCobranca279 || '')
      : (raw.q56_valorRefvalor56 || raw.q57_valorPago || '');

    const dataAPagar = isContasReceber
      ? parseJotformDate(raw.q262_dataVencimentoreceber)
      : parseJotformDate(raw.q313_dataA);

    const dataBaixa = isContasReceber
      ? parseJotformDate(raw.q263_dataRecebimento)
      : parseJotformDate(raw.q129_dataBaixa);

    if (!movimentacao) {
      console.error('Movimentacao ausente — DUMP:', JSON.stringify(raw, null, 2));
      return res.status(400).json({ error: 'Movimentacao ausente' });
    }

    const dataPgto   = dataBaixa || dataAPagar || new Date().toLocaleDateString('pt-BR');
    const dueDateISO = toBrDate(dataAPagar);
    const valorNum   = parseValor(valorRef);

    // ── CAMINHO 2: BAIXA (Doc.Pago = SIM) ────────────────────────────────────
    if (docPago === 'SIM') {
      const movement    = isContasReceber ? 'Entrada' : 'Saída';
      const clientField = isContasReceber ? 'client' : 'description';

      // v6.0: SO baixa Pendentes. Nunca sobrescreve docs Pagos.
      const matchDocs = await queryFirestore([
        [clientField, movimentacao],
        ['dueDate',   dueDateISO],
        ['movement',  movement],
        ['status',    'Pendente'],
      ]);

      if (matchDocs.length === 0) {
        // v5.9: ao inves de 404, cai para CAMINHO 3 e cria doc novo ja como Pago.
        // Isso preserva lancamentos "compra e pagamento no mesmo dia" sem Pendente previo.
        console.warn(`CAMINHO 2: nenhum Pendente para baixar (${movimentacao} ${dueDateISO} ${movement}) — criando doc novo como Pago via CAMINHO 3`);
      } else {

      const trxIds = [];
      for (const d of matchDocs) {
        const docId = d.document.name.split('/').pop();

        const patchFields = isContasReceber
          ? {
              pago:          { stringValue: 'Pago' },
              status:        { stringValue: 'Pago' },
              valueReceived: { doubleValue: valorNum },
              valorPago:     { stringValue: String(valorRef || '') },
              dataPagamento: { stringValue: dataPgto },
              paymentDate:   { stringValue: toBrDate(dataPgto) },
              updatedAt:     { stringValue: new Date().toISOString() },
            }
          : {
              pago:          { stringValue: 'Pago' },
              status:        { stringValue: 'Pago' },
              valorPago:     { stringValue: String(valorRef || '') },
              dataPagamento: { stringValue: dataPgto },
              paymentDate:   { stringValue: toBrDate(dataPgto) },
              updatedAt:     { stringValue: new Date().toISOString() },
            };

        if (submissionId) patchFields.submissionId = { stringValue: String(submissionId) };

        await firestorePatch(docId, patchFields);
        trxIds.push(docId);
      }

      console.log('BAIXA OK:', movimentacao, '->', trxIds.join(', '));
      return res.status(200).json({ status: 'payment_updated', movimentacao, trxIds, submissionId });
      } // fecha else do v5.9 (matchDocs.length > 0)
    }

    // ── CAMINHO 3: NOVO LANÇAMENTO ────────────────────────────────────────────
    const docId   = await generateDocId();
    const dateISO = dueDateISO || new Date().toISOString().split('T')[0];

    let docData;
    if (isContasReceber) {
      const cr = extractContasReceber(raw);
      docData = {
        id:            docId,
        source:        'jotform',
        movement:      'Entrada',
        type:          'Entrada de Caixa / Contas a Receber',
        status:        'Pendente',
        pago:          'Não',
        client:        movimentacao,
        description:   movimentacao,
        date:          dateISO,
        dueDate:       dueDateISO || dateISO,
        paymentDate:   '',
        dataPagamento: '',
        valorOriginal: valorNum,
        valuePaid:     0,
        valueReceived: 0,
        valorPago:     '',
        bankAccount:   '',
        updatedAt:     new Date().toISOString(),
      };
      // Campos extras capturados
      if (cr.honorarios > 0) docData.honorarios   = cr.honorarios;
      if (cr.extras > 0)     docData.extras        = cr.extras;
      if (cr.nCliente)       docData.clientNumber  = cr.nCliente;
      if (cr.nCliente)       docData.nCliente      = cr.nCliente;
      if (cr.cnpj)           docData.cpfCnpj       = cr.cnpj;
      if (cr.metodo)         docData.metodoPagamento = cr.metodo;
      if (cr.obs)            docData.observacao    = cr.obs;
      if (cr.cobrancaExtra)  docData.cobrancaExtra = cr.cobrancaExtra;
    } else {
      // v5.9: respeita docPago para casos "compra e pagamento no mesmo dia"
      const cp = extractContasPagar(raw);
      const isPagoCP = docPago === 'SIM';
      docData = {
        id:            docId,
        source:        'jotform',
        movement:      'Saída',
        type:          'Saída de Caixa / Contas a Pagar',
        status:        isPagoCP ? 'Pago' : 'Pendente',
        pago:          isPagoCP ? 'Pago' : 'Não',
        description:   movimentacao,
        client:        movimentacao,
        date:          dateISO,
        dueDate:       dueDateISO || dateISO,
        paymentDate:   isPagoCP ? toBrDate(dataPgto) : '',
        dataPagamento: isPagoCP ? dataPgto : '',
        valorOriginal: valorNum,
        valuePaid:     valorNum,
        valueReceived: 0,
        valorPago:     isPagoCP ? String(valorRef || '') : '',
        bankAccount:   '',
        updatedAt:     new Date().toISOString(),
      };
      if (cp.obs)    docData.observacaoAPagar = cp.obs;
      if (cp.metodo) docData.metodoPagamento  = cp.metodo;
    }

    if (submissionId) docData.submissionId = String(submissionId);

    await firestoreSet(docId, toFields(docData));

    console.log(`LANÇAMENTO OK (${isContasReceber ? 'RECEBER' : 'PAGAR'}): ${movimentacao} → ${docId}`);
    return res.status(200).json({ status: 'entry_created', movimentacao, docId, submissionId });

  } catch (err) {
    console.error('Erro geral:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

app.get('/', (req, res) => res.json({ status: 'jotform-webhook online', version: '5.10-fix-generateDocId' }));

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Webhook rodando na porta ${PORT}`));