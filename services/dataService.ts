import { FilterState, KPIData, PaginatedResult, Transaction } from '../types';
import { BackendService } from './backendService';
import { FirebaseService } from './firebaseService';
import { MOCK_TRANSACTIONS, DATA_SOURCE } from '../constants';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import { db } from './firebaseConfig';

// In-memory cache
let CACHED_TRANSACTIONS: Transaction[] = [];
let isDataLoaded = false;
let isMockMode = false;
let lastUpdatedAt: Date | null = null;

// Controle de Concorrência (Evita requisições simultâneas/loops)
let currentLoadPromise: Promise<void> | null = null;

// Timer para Auto-Refresh
let autoRefreshTimer: ReturnType<typeof setInterval> | null = null;
let autoRefreshListeners: Array<() => void> = [];

// Constante de Refresh (2 minutos para evitar excesso de requisições)
const AUTO_REFRESH_INTERVAL_MS = 2 * 60 * 1000;

// Firebase real-time listener
let firebaseUnsubscribe: (() => void) | null = null;

// Helper: converte Firestore Timestamp ou string de data em string YYYY-MM-DD
function normalizeFirestoreDate(val: any): string {
  if (!val) return '';
  // Firestore Timestamp: { seconds, nanoseconds }
  if (typeof val === 'object' && val !== null && 'seconds' in val) {
    const d = new Date(val.seconds * 1000);
    if (isNaN(d.getTime())) return '';
    return d.toISOString().substring(0, 10);
  }
  if (typeof val === 'string') {
    if (val === '1970-01-01' || val === '[object Object]') return '';
    // Já é ISO YYYY-MM-DD ou YYYY-MM-DDTHH...
    const isoMatch = val.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) {
      const y = parseInt(isoMatch[1], 10);
      if (y < 1900 || y > 2100) return '';
      return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
    }
    // BR format DD/MM/YYYY
    const brMatch = val.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})/);
    if (brMatch) {
      let year = brMatch[3];
      if (year.length === 2) year = '20' + year;
      const y = parseInt(year, 10);
      if (y < 1900 || y > 2100) return '';
      return `${year}-${brMatch[2].padStart(2, '0')}-${brMatch[1].padStart(2, '0')}`;
    }
    return '';
  }
  return '';
}

// Normalização de texto auxiliar
const normalizeText = (text: string) => {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
};

// Mapa de correção de nomes de movimentação/descrição
// Chave: nome errado (como está no Firebase/Planilha)
// Valor: nome correto (como deve aparecer no sistema)
const DESCRIPTION_NORMALIZATION_MAP: Record<string, string> = {
  // Dare (antiga Desafio) — Google Translate traduz "Dare" → "Desafio"
  'desafio': 'Dare',
  'dare': 'Dare',
  'desafio sp': 'Dare',
  'dare sp': 'Dare',
  'ousar': 'Dare',          // outra tradução de "dare"
  'atrever': 'Dare',        // outra tradução de "dare"

  // Net Eunice — Google Translate traduz "Net" → "Rede"/"Tecelã de rede"/"Tela"
  'tecela de rede eunice': 'Net Eunice',     // "Tecelã" sem acentos = "tecela"
  'tecelã de rede eunice': 'Net Eunice',     // variante acentuada
  'tacela de rede eunice': 'Net Eunice',     // variante com "a"
  'tacelã de rede eunice': 'Net Eunice',     // variante acentuada com "a"
  'tecelan de rede eunice': 'Net Eunice',
  'tacelan de rede eunice': 'Net Eunice',
  'tecela eunice': 'Net Eunice',
  'tecelã eunice': 'Net Eunice',
  'tacelã eunice': 'Net Eunice',
  'tacela eunice': 'Net Eunice',
  'tacelan eunice': 'Net Eunice',
  'tecelan eunice': 'Net Eunice',
  'rede eunice': 'Net Eunice',
  'net eunice': 'Net Eunice',
  'tecelã de rede': 'Net Eunice',
  'tecela de rede': 'Net Eunice',
  'tacelã de rede': 'Net Eunice',
  'tacela de rede': 'Net Eunice',
  'tela eunice': 'Net Eunice',
  'tela de rede eunice': 'Net Eunice',

  // Net Itapeti — Google Translate traduz "Net" → "Líquido"/"Rede"
  'liquido itapeti': 'Net Itapeti',
  'líquido itapeti': 'Net Itapeti',
  'liquida itapeti': 'Net Itapeti',
  'net itapeti liquido': 'Net Itapeti',
  'net itapeti': 'Net Itapeti',
  'itapeti liquido': 'Net Itapeti',
  'itapeti líquido': 'Net Itapeti',
  'net itapeti liq': 'Net Itapeti',
  'itapeti liq': 'Net Itapeti',
  'rede itapeti': 'Net Itapeti',
  'tela itapeti': 'Net Itapeti',

  // Imposto a pagar cliente
  'imposto a pagar cliente': 'Imposto a Pagar Cliente',
  'imposto pagar cliente': 'Imposto a Pagar Cliente',
  'imposto cliente': 'Imposto a Pagar Cliente',
  'imp a pagar cliente': 'Imposto a Pagar Cliente',
  'imposto a pagar': 'Imposto a Pagar Cliente',
  'taxa a pagar cliente': 'Imposto a Pagar Cliente',
};

// Keywords de fallback para quando o match exato/prefix não pega
const KEYWORD_FALLBACK_MAP: [string[], string][] = [
  [['eunice', 'rede'], 'Net Eunice'],     // qualquer combo de "eunice" + "rede" ou "tecelã"
  [['eunice', 'tecela'], 'Net Eunice'],
  [['eunice', 'tacela'], 'Net Eunice'],
  [['eunice', 'tela'], 'Net Eunice'],
  [['itapeti', 'liquido'], 'Net Itapeti'],
  [['itapeti', 'rede'], 'Net Itapeti'],
  [['itapeti', 'tela'], 'Net Itapeti'],
];

const normalizeDescription = (desc: string): string => {
  try {
    if (!desc || typeof desc !== 'string') return desc || '';
    const key = desc.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    
    // 1. Exact match or prefix match against the map
    for (const [wrong, correct] of Object.entries(DESCRIPTION_NORMALIZATION_MAP)) {
      const wrongNorm = wrong.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      if (key === wrongNorm) return correct;
      if (key.startsWith(wrongNorm)) return correct;
    }
    
    // 2. Keyword-based fallback: se o texto contém TODAS as keywords do grupo, normaliza
    for (const [keywords, correct] of KEYWORD_FALLBACK_MAP) {
      if (keywords.every(kw => key.includes(kw))) return correct;
    }
    
    return desc;
  } catch (e) {
    return desc || '';
  }
};

export const DataService = {
  
  get isDataLoaded() {
    return isDataLoaded;
  },

  get isMockMode() {
    return isMockMode;
  },

  /**
   * Carrega os dados.
   * BLINDADO: Se já estiver carregando, retorna a promessa em andamento.
   * Se já estiver carregado e não for refresh forçado, retorna imediatamente.
   */
  loadData: async (forceRefresh = false): Promise<void> => {
    // 1. Loop Breaker: Se já carregou e não é refresh forçado, retorna.
    if (isDataLoaded && !forceRefresh) {
        return;
    }

    // 2. Concurrency Lock: Se já existe uma requisição em andamento, espera por ela.
    if (currentLoadPromise) {
        console.log("[DataService] Requisição já em andamento. Aguardando...");
        return currentLoadPromise;
    }

    // 3. Mock Mode Check
    if (isMockMode) {
        if (CACHED_TRANSACTIONS.length === 0) {
            CACHED_TRANSACTIONS = MOCK_TRANSACTIONS;
        }
        isDataLoaded = true;
        lastUpdatedAt = new Date();
        return;
    }

    // 4. Inicia nova requisição e guarda a promessa
    currentLoadPromise = (async () => {
        try {
            console.log("[DataService] Iniciando fetch de transações...");
            // DATA_SOURCE sempre 'firebase' (Sheets desativado). Ramo Sheets removido.
            const data = await FirebaseService.fetchTransactions();
            
            if (!data || !Array.isArray(data)) {
                throw new Error("Formato de dados inválido recebido do backend.");
            }

            // Apply exclusions + description normalization
            let excludedIds: string[] = [];
            try { excludedIds = JSON.parse(localStorage.getItem('excluded_transactions') || '[]'); } catch(e) { /* Safari private mode */ }
            data.forEach(t => {
              try {
                if (excludedIds.includes(t.id)) {
                  t.isExcluded = true;
                }
                // ★ Normalizar status: "Sim", "Recebido", "Quitado", "OK", "Liquidado" → "Pago"
                if (t.status != null) {
                  const sLower = String(t.status).toLowerCase().trim();
                  if (['sim', 'recebido', 'quitado', 'ok', 'liquidado', 's'].includes(sLower)) {
                    t.status = 'Pago';
                  } else if (sLower === 'pago') {
                    t.status = 'Pago';
                  } else if (['pendente', 'nao', 'não', 'n', 'aberto', 'em aberto', ''].includes(sLower)) {
                    t.status = 'Pendente';
                  } else if (['agendado', 'programado'].includes(sLower)) {
                    t.status = 'Agendado';
                  }
                } else {
                  t.status = 'Pendente';
                }
                // Sanitize: Pendente entries should NOT have paymentDate
                if (t.status === 'Pendente' && t.paymentDate) {
                  t.paymentDate = '';
                }
                // ★ FIX: Normalizar campos de data (Firestore Timestamp → string YYYY-MM-DD)
                t.date        = normalizeFirestoreDate(t.date)        || t.date;
                t.dueDate     = normalizeFirestoreDate(t.dueDate)     || t.dueDate;
                t.paymentDate = normalizeFirestoreDate(t.paymentDate) || t.paymentDate || '';
                // ★ FIX: Normalizar clientNumber (Apps Script pode gravar como nCliente)
                if (!t.clientNumber && (t as any).nCliente) {
                  t.clientNumber = parseInt(String((t as any).nCliente)) || undefined;
                }
                // ★ FIX: Normalizar campo movement (Saida→Saída, entrada→Entrada)
                if (t.movement) {
                  const mLower = String(t.movement).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
                  if (mLower === 'entrada' || mLower === 'receita' || mLower === 'credito') {
                    t.movement = 'Entrada';
                  } else if (mLower === 'saida' || mLower === 'despesa' || mLower === 'debito') {
                    t.movement = 'Saída';
                  }
                }
                // Normalizar nomes de movimentação/descrição incorretos
                if (t.description && typeof t.description === 'string') {
                  t.description = normalizeDescription(t.description);
                }
                // Também normalizar o campo client quando for uma saída (favorecido)
                if (t.client && typeof t.client === 'string') {
                  const clientNorm = normalizeDescription(t.client);
                  if (clientNorm !== t.client) {
                    t.client = clientNorm;
                  }
                }
                // Normalizar observacaoAPagar (pode ter nomes traduzidos também)
                if (t.observacaoAPagar && typeof t.observacaoAPagar === 'string') {
                  t.observacaoAPagar = normalizeDescription(t.observacaoAPagar);
                }
              } catch (normErr) {
                console.warn('[DataService] Erro ao normalizar transação:', t.id, normErr);
              }
            });

            CACHED_TRANSACTIONS = data;
            isDataLoaded = true;
            lastUpdatedAt = new Date();
            console.log(`[DataService] Sucesso. ${data.length} registros carregados.`);
        } catch (error) {
            console.error("[DataService] Erro fatal no carregamento:", error);
            isDataLoaded = false;
            // Repassa o erro para a UI tratar (ex: mostrar mensagem de erro),
            // mas garante que o estado de "carregando" seja limpo no finally.
            throw error;
        } finally {
            // Libera o lock para permitir novas tentativas futuras (ex: clique no botão "Tentar Novamente")
            currentLoadPromise = null;
        }
    })();

    return currentLoadPromise;
  },

  /**
   * Ativa modo de demonstração com dados locais.
   */
  loadMockData: (): void => {
    console.warn("[DataService] Ativando Modo Mock");
    const excludedIds = JSON.parse(localStorage.getItem('excluded_transactions') || '[]');
    MOCK_TRANSACTIONS.forEach(t => {
      if (excludedIds.includes(t.id)) {
        t.isExcluded = true;
      }
    });
    CACHED_TRANSACTIONS = MOCK_TRANSACTIONS;
    isDataLoaded = true;
    isMockMode = true;
    lastUpdatedAt = new Date();
    DataService.notifyListeners();
  },

  toggleExclusion: (id: string): void => {
    const excludedIds = JSON.parse(localStorage.getItem('excluded_transactions') || '[]');
    const index = excludedIds.indexOf(id);
    if (index > -1) {
      excludedIds.splice(index, 1);
    } else {
      excludedIds.push(id);
    }
    localStorage.setItem('excluded_transactions', JSON.stringify(excludedIds));
    
    const transaction = CACHED_TRANSACTIONS.find(t => t.id === id);
    if (transaction) {
      transaction.isExcluded = !transaction.isExcluded;
    }
    
    DataService.notifyListeners();
  },

  /**
   * Marca uma transação como paga (Dar Baixa) — atualiza Firebase e o cache local.
   */
  markAsPaid: async (id: string): Promise<void> => {
    const today = new Date().toISOString().slice(0, 10);
    const updates: Partial<Transaction> = {
      status: 'Pago',
      paymentDate: today,
    };

    // Atualiza no Firebase
    await FirebaseService.updateTransaction(id, updates);

    // Atualiza o cache local imediatamente para refletir na UI
    const transaction = CACHED_TRANSACTIONS.find(t => t.id === id);
    if (transaction) {
      transaction.status = 'Pago';
      transaction.paymentDate = today;
    }

    DataService.notifyListeners();
  },

  /**
   * Força uma atualização dos dados.
   */
  refreshCache: async (): Promise<void> => {
    if (isMockMode) return;
    try {
        await DataService.loadData(true);
        DataService.notifyListeners();
    } catch (e) {
        console.error("[DataService] Falha ao recarregar cache:", e);
    }
  },

  getLastUpdatedAt: (): Date | null => lastUpdatedAt,

  // --- Auto Refresh Logic ---

  startAutoRefresh: (intervalMs = AUTO_REFRESH_INTERVAL_MS): void => {
    DataService.stopAutoRefresh();
    if (isMockMode) return;

    autoRefreshTimer = setInterval(async () => {
        console.log('[DataService] Auto-refresh executando...');
        try {
            await DataService.refreshCache();
        } catch (e) {
            console.error('[DataService] Erro silencioso no auto-refresh:', e);
        }
    }, intervalMs);
  },

  stopAutoRefresh: (): void => {
    if (autoRefreshTimer) {
        clearInterval(autoRefreshTimer);
        autoRefreshTimer = null;
    }
  },

  /**
   * Inicia listener em tempo real do Firebase (onSnapshot).
   * Qualquer alteração no Firestore atualiza o cache automaticamente e notifica a UI.
   */
  subscribeToFirebaseChanges: (): (() => void) => {
    if (isMockMode || DATA_SOURCE !== 'firebase') return () => {};

    // Evita múltiplos listeners simultâneos
    if (firebaseUnsubscribe) {
      firebaseUnsubscribe();
      firebaseUnsubscribe = null;
    }

    console.log('[DataService] 🔴 Iniciando listener em tempo real do Firebase (onSnapshot)...');

    const q = query(collection(db, 'transactions'), orderBy('date', 'desc'));
    let isFirstSnapshot = true;

    firebaseUnsubscribe = onSnapshot(q, (snapshot) => {
      // Ignora o primeiro snapshot (dados já carregados pelo loadData)
      if (isFirstSnapshot) {
        isFirstSnapshot = false;
        console.log(`[DataService] onSnapshot: snapshot inicial ignorado (${snapshot.size} docs)`);
        return;
      }

      if (!isDataLoaded) return;

      const changes = snapshot.docChanges();
      console.log(`[DataService] 🔴 Firebase onSnapshot: ${changes.length} alterações detectadas`);

      if (changes.length === 0) return;

      // Aplica as alterações diretamente no cache
      let excludedIds: string[] = [];
      try { excludedIds = JSON.parse(localStorage.getItem('excluded_transactions') || '[]'); } catch(e) { /* */ }

      for (const change of changes) {
        const docData = { id: change.doc.id, ...change.doc.data() } as Transaction;

        // Normalizar status
        try {
          if (docData.status != null) {
            const sLower = String(docData.status).toLowerCase().trim();
            if (['sim', 'recebido', 'quitado', 'ok', 'liquidado', 's'].includes(sLower)) {
              docData.status = 'Pago';
            } else if (sLower === 'pago') {
              docData.status = 'Pago';
            } else if (['pendente', 'nao', 'não', 'n', 'aberto', 'em aberto', ''].includes(sLower)) {
              docData.status = 'Pendente';
            } else if (['agendado', 'programado'].includes(sLower)) {
              docData.status = 'Agendado';
            }
          } else {
            docData.status = 'Pendente';
          }
          if (docData.status === 'Pendente' && docData.paymentDate) {
            docData.paymentDate = '';
          }
          // ★ FIX: Normalizar campos de data (Firestore Timestamp → string YYYY-MM-DD)
          docData.date        = normalizeFirestoreDate(docData.date)        || docData.date;
          docData.dueDate     = normalizeFirestoreDate(docData.dueDate)     || docData.dueDate;
          docData.paymentDate = normalizeFirestoreDate(docData.paymentDate) || docData.paymentDate || '';
          // ★ FIX: Normalizar clientNumber
          if (!docData.clientNumber && (docData as any).nCliente) {
            docData.clientNumber = parseInt(String((docData as any).nCliente)) || undefined;
          }
          if (docData.movement) {
            const mLower = String(docData.movement).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
            if (mLower === 'entrada' || mLower === 'receita' || mLower === 'credito') {
              docData.movement = 'Entrada';
            } else if (mLower === 'saida' || mLower === 'despesa' || mLower === 'debito') {
              docData.movement = 'Saída';
            }
          }
          if (docData.description && typeof docData.description === 'string') {
            docData.description = normalizeDescription(docData.description);
          }
          if (docData.client && typeof docData.client === 'string') {
            docData.client = normalizeDescription(docData.client);
          }
          if (excludedIds.includes(docData.id)) {
            docData.isExcluded = true;
          }
        } catch (normErr) {
          console.warn('[DataService] Erro ao normalizar onSnapshot:', docData.id, normErr);
        }

        if (change.type === 'added') {
          // Novo documento — adiciona se não existe
          const exists = CACHED_TRANSACTIONS.findIndex(t => t.id === docData.id);
          if (exists === -1) {
            CACHED_TRANSACTIONS.unshift(docData);
          } else {
            CACHED_TRANSACTIONS[exists] = docData;
          }
        } else if (change.type === 'modified') {
          const idx = CACHED_TRANSACTIONS.findIndex(t => t.id === docData.id);
          if (idx !== -1) {
            CACHED_TRANSACTIONS[idx] = docData;
          } else {
            CACHED_TRANSACTIONS.unshift(docData);
          }
        } else if (change.type === 'removed') {
          CACHED_TRANSACTIONS = CACHED_TRANSACTIONS.filter(t => t.id !== docData.id);
        }
      }

      lastUpdatedAt = new Date();
      console.log(`[DataService] 🔴 Cache atualizado em tempo real. Total: ${CACHED_TRANSACTIONS.length}`);
      DataService.notifyListeners();
    }, (error) => {
      console.error('[DataService] Erro no onSnapshot:', error);
    });

    return () => {
      if (firebaseUnsubscribe) {
        firebaseUnsubscribe();
        firebaseUnsubscribe = null;
        console.log('[DataService] Firebase listener desconectado.');
      }
    };
  },

  stopFirebaseListener: (): void => {
    if (firebaseUnsubscribe) {
      firebaseUnsubscribe();
      firebaseUnsubscribe = null;
      console.log('[DataService] Firebase listener parado.');
    }
  },

  onRefresh: (callback: () => void): (() => void) => {
    autoRefreshListeners.push(callback);
    return () => {
      autoRefreshListeners = autoRefreshListeners.filter(fn => fn !== callback);
    };
  },

  notifyListeners: () => {
      autoRefreshListeners.forEach(fn => fn());
  },

  // --- Data Access & Filtering ---

  getUniqueValues: (field: keyof Transaction): string[] => {
    if (!isDataLoaded) return [];
    const normalizeStatusVal = (s: string): string => {
      const v = s.toLowerCase().trim();
      if (["recebido","quitado","sim","ok","liquidado","pago","paga","recebida","baixado","baixada","quitada","liquidada"].includes(v)) return 'Pago';
      if (v === "agendado") return 'Agendado';
      if (["pendente","nao","não","aberto"].includes(v)) return 'Pendente';
      return s.trim();
    };
    const normalizeMovementVal = (s: string): string => {
      const mLower = s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
      if (['entrada','receita','credito','sim','recebimento wix / cartao'].includes(mLower)) return 'Entrada';
      if (['saida','despesa','debito','nao','não','n'].includes(mLower)) return 'Saída';
      return s.trim();
    };

    const INVALID_TYPES = ['1- Paulo- Retirada', '1- Paulo-Retirada', '2- SP - Retirada', '2- SP-Retirada', '1- Paulo - Retirada'];
    const rawValues = CACHED_TRANSACTIONS.map(t => String(t[field] || '').trim()).filter(Boolean);
    let normalized = rawValues;
    if (field === 'status') normalized = rawValues.map(normalizeStatusVal);
    if (field === 'movement') normalized = rawValues.map(normalizeMovementVal);
    if (field === 'type') normalized = rawValues.filter(v => !INVALID_TYPES.includes(v));
    const values = new Set(normalized);
    return Array.from(values).sort();
  },

  getWixStats: (): { total: number; pending: number; paid: number; totalValue: number; pendingValue: number } => {
    if (!isDataLoaded) return { total: 0, pending: 0, paid: 0, totalValue: 0, pendingValue: 0 };
    const wixTrx = CACHED_TRANSACTIONS.filter(t => t.source === 'wix');
    const wixPending = wixTrx.filter(t => {
      const s = (t.status || '').toLowerCase();
      return !['pago','recebido','sim','ok','liquidado','quitado'].includes(s);
    });
    const wixPaid = wixTrx.filter(t => {
      const s = (t.status || '').toLowerCase();
      return ['pago','recebido','sim','ok','liquidado','quitado'].includes(s);
    });
    return {
      total: wixTrx.length,
      pending: wixPending.length,
      paid: wixPaid.length,
      totalValue: wixTrx.reduce((s, t) => s + (t.valorOriginal || 0), 0),
      pendingValue: wixPending.reduce((s, t) => s + (t.valorOriginal || 0), 0),
    };
  },

  getGlobalStats: (): KPIData => {
    if (!isDataLoaded) return { totalPaid: 0, totalReceived: 0, balance: 0 };
    
    let pendingReceivables = 0;
    let pendingPayables = 0;
    let actualBalance = 0;

    CACHED_TRANSACTIONS.forEach(t => {
        const statusLower = (t.status || '').toLowerCase();
        const isPaid = statusLower === 'pago' || statusLower === 'recebido' || statusLower === 'sim' || statusLower === 'ok';
        const isPending = !isPaid;

        if (isPaid) {
            // Saldo Realizado = Recebido - Pago
            actualBalance += (t.valueReceived - t.valuePaid);
        }

        if (isPending) {
            // Entradas Pendentes
            if (t.movement === 'Entrada' || (t.valueReceived > 0 && t.valuePaid === 0)) {
                // Se tiver TotalCobrança, usa. Senão valueReceived.
                const val = (t.totalCobranca && t.totalCobranca > 0) ? t.totalCobranca : t.valueReceived;
                pendingReceivables += val;
            }
            // Saídas Pendentes
            if (t.movement === 'Saída' || (t.valuePaid > 0 && t.valueReceived === 0)) {
                pendingPayables += t.valuePaid;
            }
        }
    });

    return {
        totalReceived: pendingReceivables, // A Receber
        totalPaid: pendingPayables,       // A Pagar
        balance: actualBalance            // Saldo em Caixa
    };
  },

  getTransactions: (
    filters: Partial<FilterState>,
    page: number = 1,
    pageSize: number = 20
  ): { result: PaginatedResult<Transaction>; kpi: KPIData } => {
    
    let filtered = CACHED_TRANSACTIONS;

    // Filter out excluded transactions first
    filtered = filtered.filter(item => !item.isExcluded);

    // Apply Filters only if data exists
    if (filtered.length > 0) {
        filtered = filtered.filter((item) => {
          let matches = true;

          if (filters.id && !item.id.toLowerCase().includes(filters.id.toLowerCase())) matches = false;
          
          // Date Filtering
          if (filters.startDate && item.date < filters.startDate) matches = false;
          if (filters.endDate && item.date > filters.endDate) matches = false;

          // Due Date (Vencimento)
          if (filters.dueDateStart && item.dueDate < filters.dueDateStart) matches = false;
          if (filters.dueDateEnd && item.dueDate > filters.dueDateEnd) matches = false;

          // Payment Date
          if (filters.paymentDateStart && (!item.paymentDate || item.paymentDate < filters.paymentDateStart)) matches = false;
          if (filters.paymentDateEnd && (!item.paymentDate || item.paymentDate > filters.paymentDateEnd)) matches = false;

          // Receipt Date
          if (filters.receiptDateStart && (!item.paymentDate || item.paymentDate < filters.receiptDateStart)) matches = false;
          if (filters.receiptDateEnd && (!item.paymentDate || item.paymentDate > filters.receiptDateEnd)) matches = false;
          
          if (filters.bankAccount && item.bankAccount !== filters.bankAccount) matches = false;
          if (filters.type && item.type !== filters.type) matches = false;
          if (filters.status) {
            // Normaliza aliases: Recebido/Quitado/Sim/OK → Pago
            const normalizeItemStatus = (s: string): string => {
              const v = (s || '').toLowerCase().trim();
              if (['recebido','quitado','sim','ok','liquidado','pago','paga','recebida','baixado','baixada','quitada','liquidada'].includes(v)) return 'Pago';
              if (v === 'agendado') return 'Agendado';
              return 'Pendente';
            };
            if (normalizeItemStatus(item.status) !== filters.status) matches = false;
          }
          if (filters.movement && item.movement !== filters.movement) matches = false;
          if (filters.paidBy && item.paidBy !== filters.paidBy) matches = false;
          
          if (filters.client && !item.client.toLowerCase().includes(filters.client.toLowerCase())) matches = false;

          // Filtro por fonte (wix / planilha)
          if (filters.source === 'wix' && item.source !== 'wix') matches = false;
          if (filters.source === 'planilha' && item.source === 'wix') matches = false;

          if (filters.search) {
            const searchLower = filters.search.toLowerCase();
            const rowString = Object.values(item).join(' ').toLowerCase();
            if (!rowString.includes(searchLower)) matches = false;
          }

          return matches;
        });
    }

    // Determine Logic Context (Payables vs Receivables vs General)
    const normalizedType = normalizeText(filters.type || '');
    const isContasAPagar = normalizedType.includes('saida') || normalizedType.includes('pagar') || filters.movement === 'Saída';
    const isContasAReceber = normalizedType.includes('entrada') || normalizedType.includes('receber') || filters.movement === 'Entrada';

    let kpi: KPIData;

    if (isContasAPagar) {
      // KPI Contexto Saída: Total Pago vs Total Pendente
      const totalGeral = filtered.reduce((acc, curr) => acc + (Number(curr.valuePaid) || 0), 0);
      const totalPago = filtered.filter(i => i.status === 'Pago' || (i.status as string) === 'Recebido').reduce((acc, curr) => acc + (Number(curr.valuePaid) || 0), 0);
      const totalPendente = totalGeral - totalPago;

      kpi = { totalPaid: totalPago, totalReceived: totalGeral, balance: totalPendente }; 
    } else if (isContasAReceber) {
      // KPI Contexto Entrada: Total Recebido vs Total Pendente
      const totalGeralReceber = filtered.reduce((acc, curr) => acc + (Number(curr.totalCobranca) || Number(curr.valueReceived) || 0), 0);
      const totalRecebido = filtered.filter(i => i.status === 'Pago' || (i.status as string) === 'Recebido').reduce((acc, curr) => acc + (Number(curr.valueReceived) || 0), 0);
      const saldoReceber = totalGeralReceber - totalRecebido;

      kpi = { totalReceived: totalGeralReceber, totalPaid: totalRecebido, balance: saldoReceber };
    } else {
      // KPI Geral (Entradas vs Saídas)
      kpi = filtered.reduce(
        (acc, curr) => {
            const vp = Number(curr.valuePaid) || 0;
            const vr = Number(curr.valueReceived) || 0;
            return {
                totalPaid: acc.totalPaid + vp,
                totalReceived: acc.totalReceived + vr,
                balance: acc.balance + (vr - vp),
            };
        },
        { totalPaid: 0, totalReceived: 0, balance: 0 }
      );
    }

    const total = filtered.length;
    const totalPages = Math.ceil(total / pageSize);
    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    
    return {
      result: {
        data: filtered.slice(start, end),
        total,
        page,
        pageSize,
        totalPages,
      },
      kpi,
    };
  },

  exportToCSV: (filters: Partial<FilterState>): void => {
    const { result } = DataService.getTransactions(filters, 1, 999999);
    const headers = [
      'ID', 'Data', 'Vencimento', 'Pagamento', 'Conta', 'Tipo', 'Status', 
      'Cliente', 'CPF / CNPJ', 'Movimento', 'Valor Pago', 'Valor Recebido',
      'Honorários', 'Extras', 'Total Cobrança', 'Observação - A Pagar'
    ];

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(';')]
        .concat(result.data.map(row => {
              const extraVal = row.valorExtra ?? row.extras ?? 0;
              const totalCob = row.totalCobranca ?? row.valorOriginal ?? ((row.honorarios || 0) + extraVal);
              return [
                row.id, row.date, row.dueDate, row.paymentDate || '', row.bankAccount, row.type, row.status,
                `"${row.client}"`, `"${row.cpfCnpj || ''}"`, row.movement,
                row.valuePaid.toFixed(2).replace('.', ','),
                row.valueReceived.toFixed(2).replace('.', ','),
                (row.honorarios || 0).toFixed(2).replace('.', ','),
                extraVal.toFixed(2).replace('.', ','),
                totalCob.toFixed(2).replace('.', ','),
                `"${(row.observacaoAPagar || '').replace(/"/g, '""')}"`
              ].join(';');
            }
        )).join('\n');

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `export_${new Date().toISOString()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  },
};
