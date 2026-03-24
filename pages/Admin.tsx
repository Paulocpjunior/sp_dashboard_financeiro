
import React, { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { User, Shield, CheckCircle, XCircle, Loader2, Database, Save, RotateCcw, AlertTriangle, UserPlus, Clock, Mail, Phone, X, Eye, EyeOff, RefreshCw, Key, Lock, Unlock, FileEdit, Search, PlusCircle, Trash2 } from 'lucide-react';
import { BackendService } from '../services/backendService';
import { DataService } from '../services/dataService';
import { User as UserType, Transaction } from '../types';
import { MOCK_USERS, APPS_SCRIPT_URL } from '../constants';
import { collection, getDocs, writeBatch, doc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../services/firebaseConfig';


interface PendingUser {
  id: string;
  rowIndex: number;
  timestamp: string;
  name: string;
  email: string;
  phone: string;
  username: string;
  status: string;
  role: string;
}

// Helper: SHA-256 hash
const sha256 = async (message: string): Promise<string> => {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
};


const JOTFORM_API_KEY = '3022b146b9a70f8d6f6c3d2292739522';
const JOTFORM_FORM_ID = '210020525580845';

// Atualiza submission no JotForm via API
async function updateJotformSubmission(submissionId: string, updates: Record<string, string>): Promise<boolean> {
  try {
    const formData = new FormData();
    Object.entries(updates).forEach(([key, value]) => {
      formData.append(key, value);
    });
    const resp = await fetch(
      `https://api.jotform.com/submission/${submissionId}?apiKey=${JOTFORM_API_KEY}`,
      { method: 'POST', body: formData }
    );
    const data = await resp.json();
    console.log('[JotForm API] Resposta:', data);
    return resp.ok && data.responseCode === 200;
  } catch(e) {
    console.error('[JotForm API] Erro:', e);
    return false;
  }
}

const Admin: React.FC = () => {
  const [users, setUsers] = useState<UserType[]>([]);
  const [pendingUsers, setPendingUsers] = useState<PendingUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingPending, setLoadingPending] = useState(false);
  
  // Database Config State
  const [spreadsheetId, setSpreadsheetId] = useState('');
  const [isSavingDb, setIsSavingDb] = useState(false);
  const [dbMessage, setDbMessage] = useState<{type: 'success' | 'error', text: string} | null>(null);

  // Sincronização Planilha → Firebase
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState(0);
  const [syncTotal, setSyncTotal] = useState(0);
  const [syncMessage, setSyncMessage] = useState<{type: 'success' | 'error' | 'info', text: string} | null>(null);

  // Remover Duplicatas
  const [isDeduplying, setIsDeduplying] = useState(false);
  const [dedupMessage, setDedupMessage] = useState<{type: 'success' | 'error' | 'info', text: string} | null>(null);

  // Modal de Novo Usuário
  const [showNewUserModal, setShowNewUserModal] = useState(false);
  const [newUserForm, setNewUserForm] = useState({
    name: '',
    email: '',
    phone: '',
    username: '',
    password: '',
    confirmPassword: '',
    role: 'operacional'
  });
  const [showPassword, setShowPassword] = useState(false);
  const [isCreatingUser, setIsCreatingUser] = useState(false);
  const [createUserMessage, setCreateUserMessage] = useState<{type: 'success' | 'error', text: string} | null>(null);

  // Modal de Alteração de Senha (Admin)
  const [showChangePassModal, setShowChangePassModal] = useState(false);
  const [selectedUserForPass, setSelectedUserForPass] = useState<UserType | null>(null);
  const [newAdminPassword, setNewAdminPassword] = useState('');
  const [isSavingPass, setIsSavingPass] = useState(false);

  // ===== MÓDULO EDITOR DE LANÇAMENTOS =====
  const [txSearch, setTxSearch] = useState('');
  const [txResults, setTxResults] = useState<Transaction[]>([]);
  const [txSearching, setTxSearching] = useState(false);
  const [txSearched, setTxSearched] = useState(false);
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);
  const [showTxModal, setShowTxModal] = useState(false);
  const [txForm, setTxForm] = useState<Partial<Transaction>>({});
  const [txSaving, setTxSaving] = useState(false);
  const [txMessage, setTxMessage] = useState<{type: 'success'|'error', text: string}|null>(null);
  const [showNewTxModal, setShowNewTxModal] = useState(false);
  const [newTxForm, setNewTxForm] = useState<Partial<Transaction>>({
    date: '', dueDate: '', description: '', client: '', status: 'Pendente',
    movement: 'Saída', type: '', bankAccount: '', valueReceived: 0, valuePaid: 0, paidBy: ''
  });
  const [newTxSaving, setNewTxSaving] = useState(false);
  const [newTxMessage, setNewTxMessage] = useState<{type: 'success'|'error', text: string}|null>(null);

  const handleTxSearch = async () => {
    if (!txSearch.trim()) return;
    setTxSearching(true);
    setTxSearched(false);
    setTxResults([]);
    try {
      const all = DataService.getCachedData();
      const q = txSearch.toLowerCase();
      const found = all.filter(t =>
        t.description?.toLowerCase().includes(q) ||
        t.client?.toLowerCase().includes(q) ||
        t.id?.toLowerCase().includes(q)
      ).slice(0, 20);
      setTxResults(found);
      setTxSearched(true);
    } catch(e) {
      setTxResults([]);
      setTxSearched(true);
    } finally {
      setTxSearching(false);
    }
  };

  const openEditTx = (tx: Transaction) => {
    setSelectedTx(tx);
    setTxForm({...tx});
    setTxMessage(null);
    setShowTxModal(true);
  };

  const handleSaveTx = async () => {
    if (!selectedTx) return;
    setTxSaving(true);
    setTxMessage(null);
    try {
      const docRef = doc(db, 'transactions', selectedTx.id);
      const updates: any = {
        description: txForm.description || selectedTx.description,
        client: txForm.client || selectedTx.client,
        status: txForm.status || selectedTx.status,
        movement: txForm.movement || selectedTx.movement,
        type: txForm.type || selectedTx.type,
        bankAccount: txForm.bankAccount || selectedTx.bankAccount,
        dueDate: txForm.dueDate || selectedTx.dueDate,
        date: txForm.date || selectedTx.date,
        paymentDate: txForm.paymentDate || selectedTx.paymentDate || null,
        valueReceived: Number(txForm.valueReceived) || 0,
        valuePaid: Number(txForm.valuePaid) || 0,
        paidBy: txForm.paidBy || selectedTx.paidBy || '',
        observacaoAPagar: txForm.observacaoAPagar || '',
      };

      // 1. Salvar no Firestore
      await updateDoc(docRef, updates);

      // 2. Se tem submissionId, atualizar no JotForm também
      const submissionId = (selectedTx as any).submissionId || txForm.submissionId;
      let jotformMsg = '';
      if (submissionId) {
        // Mapear campos do dashboard para campos do JotForm
        const jotformUpdates: Record<string, string> = {};
        if (txForm.status)       jotformUpdates['submission[q291_docpago]']         = txForm.status === 'Pago' ? 'Sim' : 'Não';
        if (txForm.paymentDate)  jotformUpdates['submission[q129_dataBaixa]']        = txForm.paymentDate;
        if (txForm.valuePaid)    jotformUpdates['submission[q56_valorRefvalor56]']   = String(txForm.valuePaid);
        if (txForm.observacaoAPagar !== undefined) jotformUpdates['submission[q17_observacao]'] = txForm.observacaoAPagar || '';

        if (Object.keys(jotformUpdates).length > 0) {
          const jotformOk = await updateJotformSubmission(submissionId, jotformUpdates);
          jotformMsg = jotformOk ? ' ✓ JotForm sincronizado.' : ' ⚠ JotForm não sincronizado (sem submissionId ou erro na API).';
        }
      } else {
        jotformMsg = ' ⚠ Sem submissionId — JotForm não sincronizado para este registro.';
      }

      setTxMessage({ type: 'success', text: 'Lançamento atualizado com sucesso!' + jotformMsg });
      await DataService.refreshCache();
      const updated = {...selectedTx, ...updates} as Transaction;
      setTxResults(prev => prev.map(t => t.id === selectedTx.id ? updated : t));
    } catch(e: any) {
      setTxMessage({ type: 'error', text: 'Erro ao salvar: ' + (e.message || 'Verifique a conexão.') });
    } finally {
      setTxSaving(false);
    }
  };

  const handleDeleteTx = async () => {
    if (!selectedTx) return;
    if (!confirm('Tem certeza que deseja EXCLUIR este lançamento? Esta ação não pode ser desfeita.')) return;
    setTxSaving(true);
    try {
      const docRef = doc(db, 'transactions', selectedTx.id);
      await updateDoc(docRef, { isExcluded: true });
      setTxMessage({ type: 'success', text: 'Lançamento excluído (marcado como inativo).' });
      setTxResults(prev => prev.filter(t => t.id !== selectedTx.id));
      setTimeout(() => setShowTxModal(false), 1500);
      await DataService.refreshCache();
    } catch(e: any) {
      setTxMessage({ type: 'error', text: 'Erro ao excluir: ' + (e.message || '') });
    } finally {
      setTxSaving(false);
    }
  };

  const handleCreateTx = async () => {
    if (!newTxForm.description || !newTxForm.date || !newTxForm.dueDate) {
      setNewTxMessage({ type: 'error', text: 'Preencha pelo menos: Descrição, Data e Vencimento.' });
      return;
    }
    setNewTxSaving(true);
    setNewTxMessage(null);
    try {
      const newDoc = {
        ...newTxForm,
        valueReceived: Number(newTxForm.valueReceived) || 0,
        valuePaid: Number(newTxForm.valuePaid) || 0,
        createdAt: new Date().toISOString(),
        createdBy: 'admin_manual',
        isExcluded: false,
      };
      await addDoc(collection(db, 'transactions'), newDoc);
      setNewTxMessage({ type: 'success', text: 'Lançamento criado com sucesso!' });
      setNewTxForm({ date: '', dueDate: '', description: '', client: '', status: 'Pendente', movement: 'Saída', type: '', bankAccount: '', valueReceived: 0, valuePaid: 0, paidBy: '' });
      await DataService.refreshCache();
    } catch(e: any) {
      setNewTxMessage({ type: 'error', text: 'Erro ao criar: ' + (e.message || '') });
    } finally {
      setNewTxSaving(false);
    }
  };




  const loadPendingUsers = async () => {
    setLoadingPending(true);
    
    // Se estiver em modo Mock, não tenta conectar
    if (DataService.isMockMode) {
        setPendingUsers([]); // Em modo mock, sem pendentes (ou poderia mockar)
        setLoadingPending(false);
        return;
    }

    try {
      const response = await fetch(APPS_SCRIPT_URL + '?action=pendentes');
      if (response.ok) {
        const data = await response.json();
        if (data.success && data.usuarios) {
          setPendingUsers(data.usuarios);
        }
      }
    } catch (error) {
      console.error('Erro ao carregar pendentes:', error);
    } finally {
      setLoadingPending(false);
    }
  };

  // Carregar todos os usuários do Firestore
  const loadAllUsers = async () => {
    // Se estiver em modo Mock, usa MOCK_USERS diretamente
    if (DataService.isMockMode) {
        setUsers(MOCK_USERS);
        return;
    }

    try {
      // ★ Busca direto do Firestore (fonte de verdade)
      const usersRef = collection(db, 'users');
      const snapshot = await getDocs(usersRef);
      const firestoreUsers: UserType[] = snapshot.docs.map(docSnap => {
        const data = docSnap.data();
        return {
          id: docSnap.id,
          username: (data.username || data.name || '').toLowerCase().trim(),
          name: data.name || data.username || '',
          role: (data.role || 'operacional').toLowerCase().trim() as any,
          active: data.active !== false,
          email: data.email || '',
          passwordHash: data.passwordHash || data.password_hash || '',
          lastAccess: data.lastAccess || '',
        };
      });
      setUsers(firestoreUsers);
    } catch (error) {
      console.warn('Falha ao carregar usuários do Firestore. Tentando fallback...', error);
      try {
        // Fallback: tenta Apps Script
        const response = await fetch(APPS_SCRIPT_URL + '?action=usuarios');
        if (response.ok) {
          const data = await response.json();
          if (data.success && data.usuarios) {
            const allUsers = data.usuarios.filter((u: any) => u.status === 'Aprovado' || u.active !== undefined);
            setUsers(allUsers);
            return;
          }
        }
        throw new Error("Apps Script fallback também falhou");
      } catch (fallbackError) {
        console.warn('Fallback para MOCK_USERS', fallbackError);
        setUsers(MOCK_USERS);
      }
    }
  };

  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        // Carregar usuários ativos
        await loadAllUsers();
        
        // Carregar usuários pendentes
        await loadPendingUsers();
        
        // Load current Spreadsheet ID
        setSpreadsheetId(BackendService.getSpreadsheetId());
      } catch (error) {
        console.error("Failed to load data in Admin", error);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, []);

  // ... (Rest of Admin.tsx logic for modals and updates remains the same)
  const handleSaveDatabaseId = async () => {
    if (!spreadsheetId.trim()) {
        setDbMessage({ type: 'error', text: 'O ID da planilha não pode estar vazio.' });
        return;
    }

    setIsSavingDb(true);
    setDbMessage(null);
    
    try {
        BackendService.updateSpreadsheetId(spreadsheetId);
        setSpreadsheetId(BackendService.getSpreadsheetId());
        // Se estiver em modo mock, isso não vai funcionar, mas ok.
        await DataService.refreshCache();
        setDbMessage({ type: 'success', text: 'Conexão estabelecida e salva com sucesso!' });
    } catch (error: any) {
        setDbMessage({ type: 'error', text: 'ID salvo, mas a conexão falhou: ' + (error.message || 'Verifique as permissões da planilha.') });
    } finally {
        setIsSavingDb(false);
    }
  };

  const handleRestoreDefault = () => {
      if (confirm('Tem certeza? Isso irá restaurar o ID original da planilha de demonstração.')) {
          BackendService.resetSpreadsheetId();
          setSpreadsheetId(BackendService.getSpreadsheetId());
          setDbMessage({ type: 'success', text: 'Configuração restaurada para o padrão.' });
          DataService.refreshCache().catch(() => {});
      }
  };

  // ===== SINCRONIZAÇÃO PLANILHA → FIREBASE =====
  const handleSyncFirebase = async () => {
    if (!confirm('Isso irá sincronizar os dados da planilha para o Firebase, atualizando status e pagamentos baixados.\n\nContinuar?')) return;

    setIsSyncing(true);
    setSyncProgress(0);
    setSyncTotal(0);
    setSyncMessage({ type: 'info', text: 'Lendo dados da planilha...' });

    try {
      // 1. Ler todas as transações da planilha
      const sheetTxs = await BackendService.fetchTransactions();
      const total = sheetTxs.length;
      setSyncTotal(total);
      setSyncMessage({ type: 'info', text: `${total} registros lidos. Sincronizando com Firebase...` });

      // 2. Processar em lotes de 500 (limite do Firestore batch)
      const BATCH_SIZE = 500;
      let processed = 0;

      for (let i = 0; i < sheetTxs.length; i += BATCH_SIZE) {
        const chunk = sheetTxs.slice(i, i + BATCH_SIZE);
        const batch = writeBatch(db);

        for (const tx of chunk) {
          const docRef = doc(db, 'transactions', tx.id);
          // setDoc com merge: true — cria se não existir, atualiza se já existir
          batch.set(docRef, {
            status: tx.status,
            paymentDate: tx.paymentDate ?? null,
            valuePaid: tx.valuePaid,
            valueReceived: tx.valueReceived ?? 0,
            date: tx.date,
            dueDate: tx.dueDate,
            bankAccount: tx.bankAccount,
            type: tx.type,
            description: tx.description,
            client: tx.client,
            paidBy: tx.paidBy,
            movement: tx.movement,
            honorarios: tx.honorarios ?? 0,
            valorExtra: tx.valorExtra ?? 0,
            totalCobranca: tx.totalCobranca ?? 0,
            cpfCnpj: tx.cpfCnpj ?? '',
            observacaoAPagar: tx.observacaoAPagar ?? '',
            clientNumber: tx.clientNumber ?? null,
          }, { merge: true });
        }

        await batch.commit();
        processed += chunk.length;
        setSyncProgress(processed);
        setSyncMessage({ type: 'info', text: `Sincronizando... ${processed} / ${total}` });
      }

      setSyncMessage({ type: 'success', text: `✅ Sincronização concluída! ${total} registros atualizados no Firebase.` });
      // Força recarga do cache do DataService
      await DataService.refreshCache();

    } catch (error: any) {
      console.error('[Sync] Erro:', error);
      setSyncMessage({ type: 'error', text: 'Erro na sincronização: ' + (error.message || 'Tente novamente.') });
    } finally {
      setIsSyncing(false);
    }
  };

  // ===== REMOVER DUPLICATAS =====
  const handleDedup = async () => {
    if (!confirm('Isso irá analisar o Firestore e remover lançamentos duplicados (mesmo cliente + vencimento + valor).\n\nContinuar?')) return;

    setIsDeduplying(true);
    setDedupMessage({ type: 'info', text: 'Analisando duplicatas no Firestore...' });

    try {
      const snapshot = await getDocs(collection(db, 'transactions'));
      const all = snapshot.docs.map(d => ({ id: d.id, ...d.data() })) as any[];

      // Agrupa por chave: client + dueDate + valor
      const seen = new Map<string, string>(); // chave → id do primeiro encontrado
      const toDelete: string[] = [];

      // Ordena por ID numérico para sempre manter o trx de menor número (mais antigo da planilha)
      const sorted = [...all].sort((a, b) => {
        const na = parseInt((a.id || '').replace('trx-', '')) || 0;
        const nb = parseInt((b.id || '').replace('trx-', '')) || 0;
        return na - nb;
      });

      for (const tx of sorted) {
        const client = String(tx.client || tx.description || '').toLowerCase().trim();
        const dueDate = String(tx.dueDate || '').trim();
        const valor = String(tx.valuePaid || tx.valueReceived || tx.totalCobranca || '0');
        const movement = String(tx.movement || '').toLowerCase().trim();
        const key = `${movement}|${client}|${dueDate}|${valor}`;

        if (!client && !dueDate) continue; // ignora linhas completamente vazias

        if (seen.has(key)) {
          toDelete.push(tx.id); // este é o duplicado — remove
        } else {
          seen.set(key, tx.id);
        }
      }

      if (toDelete.length === 0) {
        setDedupMessage({ type: 'success', text: '✅ Nenhuma duplicata encontrada! O Firestore está limpo.' });
        setIsDeduplying(false);
        return;
      }

      setDedupMessage({ type: 'info', text: `Encontradas ${toDelete.length} duplicatas. Removendo...` });

      // Deleta em lotes de 500
      const CHUNK = 500;
      let deleted = 0;
      for (let i = 0; i < toDelete.length; i += CHUNK) {
        const batch = writeBatch(db);
        toDelete.slice(i, i + CHUNK).forEach(id => {
          batch.delete(doc(db, 'transactions', id));
        });
        await batch.commit();
        deleted += Math.min(CHUNK, toDelete.length - i);
      }

      setDedupMessage({ type: 'success', text: `✅ ${deleted} duplicata(s) removida(s) com sucesso! O dashboard foi atualizado.` });
      await DataService.refreshCache();

    } catch (error: any) {
      console.error('[Dedup] Erro:', error);
      setDedupMessage({ type: 'error', text: 'Erro ao remover duplicatas: ' + (error.message || 'Tente novamente.') });
    } finally {
      setIsDeduplying(false);
    }
  };

  // 1. Bloquear / Desbloquear Usuário
  const handleToggleStatus = async (user: UserType) => {
    const newStatus = !user.active;
    const actionName = newStatus ? 'Desbloquear' : 'Bloquear';
    
    if (!confirm(`Tem certeza que deseja ${actionName.toUpperCase()} o usuário "${user.name || user.username}"?`)) return;

    // Atualização Otimista
    setUsers(prev => prev.map(u => u.id === user.id ? { ...u, active: newStatus } : u));

    try {
      // ★ Atualiza direto no Firestore
      const userRef = doc(db, 'users', user.id);
      await updateDoc(userRef, { active: newStatus });
      alert(`Usuário ${newStatus ? 'desbloqueado' : 'bloqueado'} com sucesso!`);
    } catch (error) {
      console.error('Erro ao atualizar status no Firestore:', error);
      alert('Erro ao atualizar status.');
      // Reverter
      setUsers(prev => prev.map(u => u.id === user.id ? { ...u, active: !newStatus } : u));
    }
  };

  // 2. Abrir Modal de Alteração de Senha
  const handleOpenChangePass = (user: UserType) => {
    setSelectedUserForPass(user);
    setNewAdminPassword('');
    setShowChangePassModal(true);
  };

  // 3. Salvar Nova Senha
  const handleSavePassword = async () => {
    if (!selectedUserForPass) return;
    if (newAdminPassword.length < 6) {
      alert('A senha deve ter no mínimo 6 caracteres.');
      return;
    }

    setIsSavingPass(true);
    try {
      // ★ Atualiza senha direto no Firestore
      const passwordHash = await sha256(newAdminPassword);
      const userRef = doc(db, 'users', selectedUserForPass.id);
      await updateDoc(userRef, { passwordHash });
      alert('Senha alterada com sucesso!');
      setShowChangePassModal(false);
      setNewAdminPassword('');
      setSelectedUserForPass(null);
    } catch (error) {
      console.error('Erro ao alterar senha no Firestore:', error);
      alert('Erro ao alterar senha. Tente novamente.');
    } finally {
      setIsSavingPass(false);
    }
  };

  // Criar novo usuário
  const handleCreateUser = async () => {
    setCreateUserMessage(null);

    // Validações
    if (!newUserForm.name || !newUserForm.username || !newUserForm.password) {
      setCreateUserMessage({ type: 'error', text: 'Preencha Nome, Username e Senha.' });
      return;
    }

    if (newUserForm.password !== newUserForm.confirmPassword) {
      setCreateUserMessage({ type: 'error', text: 'As senhas não coincidem.' });
      return;
    }

    if (newUserForm.password.length < 6) {
      setCreateUserMessage({ type: 'error', text: 'A senha deve ter no mínimo 6 caracteres.' });
      return;
    }

    setIsCreatingUser(true);

    try {
      const username = newUserForm.username.toLowerCase().replace(/\s/g, '');
      
      // Verificar se username já existe no Firestore
      const usersRef = collection(db, 'users');
      const snapshot = await getDocs(usersRef);
      const existing = snapshot.docs.find(d => {
        const data = d.data();
        return (data.username || '').toLowerCase().trim() === username;
      });
      if (existing) {
        setCreateUserMessage({ type: 'error', text: 'Username já existe. Escolha outro.' });
        setIsCreatingUser(false);
        return;
      }

      // ★ Criar direto no Firestore
      const passwordHash = await sha256(newUserForm.password);
      const newUserDoc = {
        name: newUserForm.name,
        email: newUserForm.email || '',
        phone: newUserForm.phone || '',
        username: username,
        passwordHash: passwordHash,
        role: newUserForm.role || 'operacional',
        active: true,
        createdAt: new Date().toISOString(),
      };

      const newDocRef = doc(collection(db, 'users'));
      await setDoc(newDocRef, newUserDoc);

      setCreateUserMessage({ type: 'success', text: `Usuário "${newUserForm.name}" criado com sucesso!` });
      setTimeout(() => {
        setShowNewUserModal(false);
        setNewUserForm({
          name: '',
          email: '',
          phone: '',
          username: '',
          password: '',
          confirmPassword: '',
          role: 'operacional'
        });
        setCreateUserMessage(null);
        loadAllUsers(); // Recarrega lista
      }, 1500);
    } catch (error: any) {
      console.error('Erro ao criar usuário no Firestore:', error);
      setCreateUserMessage({ type: 'error', text: 'Erro ao criar usuário. Tente novamente.' });
    } finally {
      setIsCreatingUser(false);
    }
  };

  // Aprovar usuário pendente
  const handleApproveUser = async (user: PendingUser) => {
    if (!confirm(`Aprovar o usuário "${user.name}"?`)) return;

    const payload = {
      action: 'approve',
      username: user.username,
      email: user.email,
      name: user.name,
    };

    try {
      const response = await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        redirect: 'follow',
      });

      const result = await response.json();
      
      if (result.success) {
        alert('Usuário aprovado com sucesso!');
        loadPendingUsers();
        loadAllUsers();
      } else {
        alert('Erro: ' + result.message);
      }
    } catch (error) {
      // Fallback com no-cors
      try {
        await fetch(APPS_SCRIPT_URL, {
          method: 'POST',
          mode: 'no-cors',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        
        alert('Usuário aprovado com sucesso!');
        loadPendingUsers();
        loadAllUsers();
      } catch (noCorsError) {
        alert('Erro ao aprovar usuário. Tente novamente.');
      }
    }
  };

  // Rejeitar usuário pendente
  const handleRejectUser = async (user: PendingUser) => {
    const reason = prompt(`Motivo da rejeição para "${user.name}" (opcional):`);
    if (reason === null) return;

    const payload = {
      action: 'reject',
      username: user.username,
      email: user.email,
      name: user.name,
      reason: reason,
    };

    try {
      const response = await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        redirect: 'follow',
      });

      const result = await response.json();
      
      if (result.success) {
        alert('Usuário rejeitado.');
        loadPendingUsers();
      } else {
        alert('Erro: ' + result.message);
      }
    } catch (error) {
      // Fallback com no-cors
      try {
        await fetch(APPS_SCRIPT_URL, {
          method: 'POST',
          mode: 'no-cors',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        
        alert('Usuário rejeitado.');
        loadPendingUsers();
      } catch (noCorsError) {
        alert('Erro ao rejeitar usuário. Tente novamente.');
      }
    }
  };

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        <div className="bg-royal-800 dark:bg-slate-800 p-6 rounded-xl shadow-md border border-royal-700 dark:border-slate-700">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
               <div className="p-2 bg-white/10 rounded-lg">
                  <Shield className="h-6 w-6 text-white" />
               </div>
               <div>
                  <h1 className="text-2xl font-bold text-white">Administração do Sistema</h1>
                  <p className="text-royal-100/80 dark:text-slate-400 text-sm mt-1">Gerencie usuários, permissões e conexões.</p>
               </div>
            </div>
            <button
              onClick={() => setShowNewUserModal(true)}
              className="flex items-center gap-2 px-4 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors font-medium shadow-sm"
            >
              <UserPlus className="h-4 w-4" />
              <span>Novo Usuário</span>
            </button>
          </div>
        </div>

        {/* Usuários Pendentes */}
        <div className="bg-amber-50 dark:bg-amber-900/20 rounded-xl shadow-sm border border-amber-200 dark:border-amber-800 overflow-hidden animate-in slide-in-from-top-2">
          <div className="px-6 py-4 border-b border-amber-200 dark:border-amber-800 flex justify-between items-center bg-amber-100/50 dark:bg-amber-900/30">
            <div className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              <h3 className="font-bold text-amber-800 dark:text-amber-200">Cadastros Pendentes de Aprovação</h3>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs px-2 py-1 bg-amber-200 dark:bg-amber-800 text-amber-700 dark:text-amber-200 rounded-full font-medium">
                {pendingUsers.length} pendente{pendingUsers.length !== 1 ? 's' : ''}
              </span>
              <button
                onClick={loadPendingUsers}
                disabled={loadingPending}
                className="p-1.5 hover:bg-amber-200 dark:hover:bg-amber-800 rounded-lg transition-colors"
                title="Atualizar lista"
              >
                <RefreshCw className={`h-4 w-4 text-amber-600 dark:text-amber-400 ${loadingPending ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>
          
          {loadingPending ? (
            <div className="p-8 flex justify-center">
              <Loader2 className="h-6 w-6 text-amber-600 animate-spin" />
            </div>
          ) : pendingUsers.length === 0 ? (
            <div className="p-8 text-center text-amber-600 dark:text-amber-400">
              <CheckCircle className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>Nenhum cadastro pendente</p>
            </div>
          ) : (
            <div className="divide-y divide-amber-200 dark:divide-amber-800">
              {pendingUsers.map((user) => (
                <div key={user.id} className="px-6 py-4 flex items-center justify-between hover:bg-amber-100/50 dark:hover:bg-amber-900/20 transition-colors">
                  <div className="flex items-center gap-4">
                    <div className="h-10 w-10 rounded-full bg-amber-200 dark:bg-amber-800 flex items-center justify-center text-amber-700 dark:text-amber-300">
                      <User className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="font-medium text-slate-800 dark:text-white">{user.name}</p>
                      <div className="flex items-center gap-3 text-sm text-slate-500 dark:text-slate-400">
                        {user.email && (
                          <span className="flex items-center gap-1">
                            <Mail className="h-3 w-3" />
                            {user.email}
                          </span>
                        )}
                        {user.phone && (
                          <span className="flex items-center gap-1">
                            <Phone className="h-3 w-3" />
                            {user.phone}
                          </span>
                        )}
                        <span className="text-xs bg-slate-200 dark:bg-slate-700 px-2 py-0.5 rounded">
                          @{user.username}
                        </span>
                        <span className="text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded">
                          {user.role}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleApproveUser(user)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium transition-colors"
                    >
                      <CheckCircle className="h-4 w-4" />
                      Aprovar
                    </button>
                    <button
                      onClick={() => handleRejectUser(user)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors"
                    >
                      <XCircle className="h-4 w-4" />
                      Rejeitar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>


        {/* Database Configuration Card */}
        <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 p-6 animate-in slide-in-from-bottom-2">
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                    <div className="p-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg text-blue-600 dark:text-blue-400">
                        <Database className="h-5 w-5" />
                    </div>
                    <div>
                        <h2 className="text-lg font-bold text-slate-800 dark:text-white">Fonte de Dados</h2>
                        <p className="text-xs text-slate-500 dark:text-slate-400">Conexão com Firebase</p>
                    </div>
                </div>
            </div>
            
            <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-lg border border-slate-200 dark:border-slate-700 mb-6">
                <p className="text-sm text-slate-600 dark:text-slate-300 flex gap-2 items-start">
                    <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                    <span>
                        Configure o <strong>Spreadsheet ID</strong> da planilha pública que alimenta o dashboard. 
                        A planilha deve ter o compartilhamento definido como <em>"Qualquer pessoa com o link pode ver"</em>.
                    </span>
                </p>
            </div>

            <div className="flex flex-col gap-4">
                <div>
                    <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 uppercase tracking-wider">Spreadsheet ID / Link Completo</label>
                    <div className="flex flex-col sm:flex-row gap-2">
                        <input 
                            type="text" 
                            value={spreadsheetId}
                            onChange={(e) => setSpreadsheetId(e.target.value)}
                            className="flex-1 form-input rounded-lg border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm focus:ring-blue-500 focus:border-blue-500 font-mono"
                            placeholder="Cole o link completo ou o ID da planilha..."
                        />
                        <button 
                            onClick={handleSaveDatabaseId}
                            disabled={isSavingDb}
                            className="px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 text-sm font-medium flex items-center justify-center gap-2 shadow-sm min-w-[140px]"
                        >
                            {isSavingDb ? (
                                <>
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    <span>Testando...</span>
                                </>
                            ) : (
                                <>
                                    <Save className="h-4 w-4" />
                                    <span>Salvar ID</span>
                                </>
                            )}
                        </button>
                        <button 
                            onClick={handleRestoreDefault}
                            title="Restaurar ID Padrão"
                            className="px-3 py-2.5 bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors border border-slate-200 dark:border-slate-600"
                        >
                            <RotateCcw className="h-4 w-4" />
                        </button>
                    </div>
                </div>
            </div>

            {dbMessage && (
                <div className={`mt-4 p-3 rounded-lg text-sm flex items-center gap-2 animate-in fade-in slide-in-from-top-1 ${
                    dbMessage.type === 'success' ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300 border border-green-200 dark:border-green-800' : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300 border border-red-200 dark:border-red-800'
                }`}>
                    {dbMessage.type === 'success' ? <CheckCircle className="h-4 w-4 shrink-0" /> : <XCircle className="h-4 w-4 shrink-0" />}
                    <span className="font-medium">{dbMessage.text}</span>
                </div>
            )}
        </div>

        {/* Sincronização Planilha → Firebase */}
        <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 p-6 animate-in slide-in-from-bottom-2">
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                    <div className="p-2 bg-amber-50 dark:bg-amber-900/20 rounded-lg text-amber-600 dark:text-amber-400">
                        <RefreshCw className="h-5 w-5" />
                    </div>
                    <div>
                        <h2 className="text-lg font-bold text-slate-800 dark:text-white">Sincronizar Planilha → Firebase</h2>
                        <p className="text-xs text-slate-500 dark:text-slate-400">Atualiza status de pagamentos baixados no Contas a Pagar</p>
                    </div>
                </div>
            </div>

            <div className="bg-amber-50 dark:bg-amber-900/10 p-4 rounded-lg border border-amber-200 dark:border-amber-800 mb-5">
                <p className="text-sm text-amber-800 dark:text-amber-300 flex gap-2 items-start">
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                    <span>
                        Use quando o <strong>Contas a Pagar</strong> não refletir os pagamentos baixados via JotForm.
                        Lê todos os dados da planilha e atualiza o Firebase (status, data de pagamento, valores).
                    </span>
                </p>
            </div>

            {isSyncing && syncTotal > 0 && (
                <div className="mb-4">
                    <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400 mb-1">
                        <span>Progresso</span>
                        <span>{syncProgress} / {syncTotal}</span>
                    </div>
                    <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2">
                        <div
                            className="bg-amber-500 h-2 rounded-full transition-all duration-300"
                            style={{ width: `${syncTotal > 0 ? (syncProgress / syncTotal) * 100 : 0}%` }}
                        />
                    </div>
                </div>
            )}

            <button
                onClick={handleSyncFirebase}
                disabled={isSyncing}
                className="w-full sm:w-auto px-6 py-2.5 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors disabled:opacity-50 text-sm font-medium flex items-center justify-center gap-2 shadow-sm"
            >
                {isSyncing ? (
                    <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span>Sincronizando...</span>
                    </>
                ) : (
                    <>
                        <RefreshCw className="h-4 w-4" />
                        <span>Sincronizar Agora</span>
                    </>
                )}
            </button>

            {syncMessage && (
                <div className={`mt-4 p-3 rounded-lg text-sm flex items-center gap-2 animate-in fade-in slide-in-from-top-1 ${
                    syncMessage.type === 'success' ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300 border border-green-200 dark:border-green-800' :
                    syncMessage.type === 'error' ? 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300 border border-red-200 dark:border-red-800' :
                    'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300 border border-blue-200 dark:border-blue-800'
                }`}>
                    {syncMessage.type === 'success' ? <CheckCircle className="h-4 w-4 shrink-0" /> :
                     syncMessage.type === 'error' ? <XCircle className="h-4 w-4 shrink-0" /> :
                     <Loader2 className="h-4 w-4 shrink-0 animate-spin" />}
                    <span className="font-medium">{syncMessage.text}</span>
                </div>
            )}
        </div>

        {/* Remover Duplicatas */}
        <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 p-6 mb-6">
            <div className="flex items-center gap-3 mb-4">
                <div className="p-2 bg-red-100 dark:bg-red-900/30 rounded-lg">
                    <Trash2 className="h-5 w-5 text-red-600 dark:text-red-400" />
                </div>
                <div>
                    <h2 className="text-lg font-bold text-slate-800 dark:text-white">Remover Duplicatas</h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400">Detecta e remove lançamentos duplicados no Firestore (mesmo cliente + vencimento + valor)</p>
                </div>
            </div>

            <div className="bg-red-50 dark:bg-red-900/10 p-4 rounded-lg border border-red-200 dark:border-red-800 mb-5">
                <p className="text-sm text-red-800 dark:text-red-300 flex gap-2 items-start">
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                    <span>
                        Use quando o dashboard exibir o <strong>mesmo lançamento em duplicidade</strong>.
                        O sistema mantém o documento mais antigo e remove os repetidos.
                    </span>
                </p>
            </div>

            <button
                onClick={handleDedup}
                disabled={isDeduplying}
                className="w-full sm:w-auto px-6 py-2.5 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 text-sm font-medium flex items-center justify-center gap-2 shadow-sm"
            >
                {isDeduplying ? (
                    <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span>Analisando...</span>
                    </>
                ) : (
                    <>
                        <Trash2 className="h-4 w-4" />
                        <span>Remover Duplicatas Agora</span>
                    </>
                )}
            </button>

            {dedupMessage && (
                <div className={`mt-4 p-3 rounded-lg text-sm flex items-center gap-2 animate-in fade-in slide-in-from-top-1 ${
                    dedupMessage.type === 'success' ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300 border border-green-200 dark:border-green-800' :
                    dedupMessage.type === 'error' ? 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300 border border-red-200 dark:border-red-800' :
                    'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300 border border-blue-200 dark:border-blue-800'
                }`}>
                    {dedupMessage.type === 'success' ? <CheckCircle className="h-4 w-4 shrink-0" /> :
                     dedupMessage.type === 'error' ? <XCircle className="h-4 w-4 shrink-0" /> :
                     <Clock className="h-4 w-4 shrink-0" />}
                    <span className="font-medium">{dedupMessage.text}</span>
                </div>
            )}
        </div>

        {/* User Management Table */}
        <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center">
             <h3 className="font-bold text-slate-800 dark:text-white">Usuários do Sistema</h3>
             <div className="flex items-center gap-2">
               <span className="text-xs px-2 py-1 bg-slate-100 dark:bg-slate-800 text-slate-500 rounded">Total: {users.length}</span>
               <button
                 onClick={loadAllUsers}
                 className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
                 title="Atualizar lista"
               >
                 <RefreshCw className="h-4 w-4 text-slate-400" />
               </button>
             </div>
          </div>
          
          {loading ? (
             <div className="p-10 flex justify-center">
                <Loader2 className="h-8 w-8 text-royal-600 animate-spin" />
             </div>
          ) : (
            <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-800">
                <thead className="bg-slate-50 dark:bg-slate-800">
                    <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Usuário</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Nome</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Perfil</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Status (Bloquear)</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Ações</th>
                    </tr>
                </thead>
                <tbody className="bg-white dark:bg-slate-900 divide-y divide-slate-200 dark:divide-slate-800">
                    {users.map((user) => (
                    <tr key={user.id} className="hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                        <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                            <div className="flex-shrink-0 h-8 w-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-500 border border-slate-200 dark:border-slate-700">
                            <User className="h-4 w-4" />
                            </div>
                            <div className="ml-4">
                            <div className="text-sm font-medium text-slate-900 dark:text-slate-100">{user.username}</div>
                            </div>
                        </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600 dark:text-slate-300">
                        {user.name}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            user.role === 'admin' 
                                ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300' 
                                : 'bg-royal-100 text-royal-800 dark:bg-blue-900/30 dark:text-blue-300'
                        }`}>
                            {user.role === 'admin' && <Shield className="w-3 h-3 mr-1" />}
                            {user.role}
                        </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                            <button 
                                onClick={() => handleToggleStatus(user)}
                                className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium transition-all hover:scale-105 active:scale-95 ${
                                user.active 
                                    ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 hover:bg-red-100 hover:text-red-800 dark:hover:bg-red-900/40 dark:hover:text-red-300 group' 
                                    : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300 hover:bg-green-100 hover:text-green-800 dark:hover:bg-green-900/40 dark:hover:text-green-300 group'
                            }`}>
                                {user.active ? (
                                <>
                                    <span className="flex items-center group-hover:hidden"><Unlock className="w-3 h-3 mr-1" /> Ativo</span>
                                    <span className="hidden group-hover:flex items-center"><Lock className="w-3 h-3 mr-1" /> Bloquear?</span>
                                </>
                                ) : (
                                <>
                                    <span className="flex items-center group-hover:hidden"><Lock className="w-3 h-3 mr-1" /> Bloqueado</span>
                                    <span className="hidden group-hover:flex items-center"><Unlock className="w-3 h-3 mr-1" /> Desbloquear?</span>
                                </>
                                )}
                            </button>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                            <button 
                                onClick={() => handleOpenChangePass(user)}
                                className="inline-flex items-center gap-1 px-3 py-1.5 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-md transition-colors text-xs font-semibold"
                            >
                                <Key className="h-3 w-3" />
                                Alterar Senha
                            </button>
                        </td>
                    </tr>
                    ))}
                </tbody>
                </table>
            </div>
          )}
        </div>
      </div>
      
      {/* ... (Modals omitted for brevity, they are unchanged) ... */}
      {/* Modal Alterar Senha */}
      {showChangePassModal && selectedUserForPass && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 animate-in fade-in">
          <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-sm animate-in zoom-in-95">
             <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700">
                <div className="flex items-center gap-3">
                   <div className="p-2 bg-amber-100 dark:bg-amber-900/30 rounded-lg">
                      <Key className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                   </div>
                   <div>
                       <h2 className="text-lg font-bold text-slate-800 dark:text-white">Alterar Senha</h2>
                       <p className="text-xs text-slate-500 dark:text-slate-400">Usuário: <span className="font-semibold text-royal-600 dark:text-royal-400">{selectedUserForPass.username}</span></p>
                   </div>
                </div>
                <button
                  onClick={() => setShowChangePassModal(false)}
                  className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
                >
                  <X className="h-5 w-5 text-slate-500" />
                </button>
             </div>
             <div className="p-6">
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                   Nova Senha de Acesso
                </label>
                <div className="relative">
                   <input
                      type="text"
                      value={newAdminPassword}
                      onChange={(e) => setNewAdminPassword(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-amber-500 focus:border-amber-500 font-mono"
                      placeholder="Mínimo 6 caracteres"
                   />
                </div>
                <p className="text-xs text-slate-500 mt-2">
                   Esta ação substitui a senha atual imediatamente.
                </p>
             </div>
             <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 rounded-b-xl">
                 <button
                    onClick={() => setShowChangePassModal(false)}
                    className="px-4 py-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
                 >
                    Cancelar
                 </button>
                 <button
                    onClick={handleSavePassword}
                    disabled={isSavingPass || newAdminPassword.length < 6}
                    className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
                 >
                    {isSavingPass ? (
                       <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Salvando...
                       </>
                    ) : (
                       <>
                          <Save className="h-4 w-4" />
                          Salvar Senha
                       </>
                    )}
                 </button>
             </div>
          </div>
        </div>
      )}

      {/* Modal Novo Usuário */}
      {showNewUserModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 animate-in fade-in">
          <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-md animate-in zoom-in-95">
            {/* Header do Modal */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-green-100 dark:bg-green-900/30 rounded-lg">
                  <UserPlus className="h-5 w-5 text-green-600 dark:text-green-400" />
                </div>
                <h2 className="text-lg font-bold text-slate-800 dark:text-white">Novo Usuário</h2>
              </div>
              <button
                onClick={() => {
                  setShowNewUserModal(false);
                  setCreateUserMessage(null);
                }}
                className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
              >
                <X className="h-5 w-5 text-slate-500" />
              </button>
            </div>

            {/* Corpo do Modal */}
            <div className="p-6 space-y-4">
              {/* Nome */}
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Nome Completo *
                </label>
                <input
                  type="text"
                  value={newUserForm.name}
                  onChange={(e) => setNewUserForm({...newUserForm, name: e.target.value})}
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="Nome do usuário"
                />
              </div>

              {/* E-mail e Telefone */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    E-mail *
                  </label>
                  <input
                    type="email"
                    value={newUserForm.email}
                    onChange={(e) => setNewUserForm({...newUserForm, email: e.target.value})}
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="email@empresa.com"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Telefone
                  </label>
                  <input
                    type="tel"
                    value={newUserForm.phone}
                    onChange={(e) => setNewUserForm({...newUserForm, phone: e.target.value})}
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="(11) 99999-9999"
                  />
                </div>
              </div>

              {/* Usuário */}
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Usuário de Acesso *
                </label>
                <input
                  type="text"
                  value={newUserForm.username}
                  onChange={(e) => setNewUserForm({...newUserForm, username: e.target.value.toLowerCase().replace(/\s/g, '')})}
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="nome.sobrenome"
                />
                <p className="text-xs text-slate-500 mt-1">Sem espaços, letras minúsculas</p>
              </div>

              {/* Perfil */}
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Perfil
                </label>
                <select
                  value={newUserForm.role}
                  onChange={(e) => setNewUserForm({...newUserForm, role: e.target.value})}
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="operacional">Operacional</option>
                  <option value="admin">Administrador</option>
                </select>
              </div>

              {/* Senhas */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Senha *
                  </label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={newUserForm.password}
                      onChange={(e) => setNewUserForm({...newUserForm, password: e.target.value})}
                      className="w-full px-3 py-2 pr-10 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      placeholder="••••••"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Confirmar *
                  </label>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={newUserForm.confirmPassword}
                    onChange={(e) => setNewUserForm({...newUserForm, confirmPassword: e.target.value})}
                    className={`w-full px-3 py-2 border rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                      newUserForm.confirmPassword && newUserForm.password !== newUserForm.confirmPassword
                        ? 'border-red-500'
                        : 'border-slate-300 dark:border-slate-600'
                    }`}
                    placeholder="••••••"
                  />
                </div>
              </div>

              {/* Mensagem de erro/sucesso */}
              {createUserMessage && (
                <div className={`p-3 rounded-lg text-sm flex items-center gap-2 ${
                  createUserMessage.type === 'success' 
                    ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300 border border-green-200 dark:border-green-800' 
                    : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300 border border-red-200 dark:border-red-800'
                }`}>
                  {createUserMessage.type === 'success' ? <CheckCircle className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                  {createUserMessage.text}
                </div>
              )}
            </div>

            {/* Footer do Modal */}
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 rounded-b-xl">
              <button
                onClick={() => {
                  setShowNewUserModal(false);
                  setCreateUserMessage(null);
                }}
                className="px-4 py-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleCreateUser}
                disabled={isCreatingUser}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {isCreatingUser ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Criando...
                  </>
                ) : (
                  <>
                    <UserPlus className="h-4 w-4" />
                    Criar Usuário
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

        {/* ===== MÓDULO EDITOR DE LANÇAMENTOS ===== */}
        <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 p-6 animate-in slide-in-from-bottom-2">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="p-2 bg-royal-900/20 rounded-lg text-royal-600 dark:text-royal-400">
                <FileEdit className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-800 dark:text-white">Editar Lançamentos</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">Pesquise, edite, crie ou exclua lançamentos diretamente no Firebase</p>
              </div>
            </div>
            <button
              onClick={() => { setShowNewTxModal(true); setNewTxMessage(null); }}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium transition-colors"
            >
              <PlusCircle className="h-4 w-4" />
              Novo Lançamento
            </button>
          </div>

          {/* Busca */}
          <div className="flex gap-2 mb-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                type="text"
                value={txSearch}
                onChange={e => setTxSearch(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleTxSearch()}
                placeholder="Buscar por descrição, cliente ou ID..."
                className="w-full pl-9 pr-4 py-2.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm focus:ring-2 focus:ring-royal-600/10 focus:border-royal-600 outline-none"
              />
            </div>
            <button
              onClick={handleTxSearch}
              disabled={txSearching}
              className="px-4 py-2.5 bg-royal-800 hover:bg-royal-900 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {txSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              Buscar
            </button>
          </div>

          {/* Resultados */}
          {txSearched && txResults.length === 0 && (
            <p className="text-sm text-slate-500 dark:text-slate-400 text-center py-6">Nenhum lançamento encontrado.</p>
          )}
          {txResults.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Descrição</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Cliente</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Vencimento</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Status</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Valor</th>
                    <th className="px-4 py-2.5"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {txResults.map(tx => (
                    <tr key={tx.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                      <td className="px-4 py-3 text-slate-800 dark:text-white max-w-[200px] truncate">{tx.description}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300 max-w-[150px] truncate">{tx.client}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{tx.dueDate}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${ tx.status === 'Pago' ? 'bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-300' : tx.status === 'Pendente' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300' : 'bg-blue-100 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300' }`}>{tx.status}</span>
                      </td>
                      <td className="px-4 py-3 text-slate-700 dark:text-slate-200 font-mono text-xs">
                        {tx.movement === 'Entrada' ? (tx.valueReceived || 0).toLocaleString('pt-BR', {style:'currency',currency:'BRL'}) : (tx.valuePaid || 0).toLocaleString('pt-BR', {style:'currency',currency:'BRL'})}
                      </td>
                      <td className="px-4 py-3">
                        <button onClick={() => openEditTx(tx)} className="flex items-center gap-1 px-3 py-1.5 bg-royal-800 hover:bg-royal-900 text-white rounded-lg text-xs font-medium transition-colors">
                          <FileEdit className="h-3 w-3" /> Editar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* MODAL: Editar Lançamento */}
        {showTxModal && selectedTx && (
          <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700">
                <h3 className="font-bold text-slate-800 dark:text-white flex items-center gap-2"><FileEdit className="h-4 w-4" /> Editar Lançamento</h3>
                <button onClick={() => setShowTxModal(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"><X className="h-5 w-5" /></button>
              </div>
              <div className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Descrição */}
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 uppercase tracking-wider">Descrição / Movimentação</label>
                  <input type="text" value={txForm.description || ''} onChange={e => setTxForm(p => ({...p, description: e.target.value}))} className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm focus:ring-2 focus:ring-royal-600/10 focus:border-royal-600 outline-none" />
                </div>
                {/* Cliente */}
                <div>
                  <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 uppercase tracking-wider">Cliente / Credor</label>
                  <input type="text" value={txForm.client || ''} onChange={e => setTxForm(p => ({...p, client: e.target.value}))} className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm focus:ring-2 focus:ring-royal-600/10 focus:border-royal-600 outline-none" />
                </div>
                {/* Banco */}
                <div>
                  <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 uppercase tracking-wider">Conta Bancária</label>
                  <input type="text" value={txForm.bankAccount || ''} onChange={e => setTxForm(p => ({...p, bankAccount: e.target.value}))} className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm focus:ring-2 focus:ring-royal-600/10 focus:border-royal-600 outline-none" />
                </div>
                {/* Status */}
                <div>
                  <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 uppercase tracking-wider">Status</label>
                  <select value={txForm.status || 'Pendente'} onChange={e => setTxForm(p => ({...p, status: e.target.value as any}))} className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm focus:ring-2 focus:ring-royal-600/10 focus:border-royal-600 outline-none">
                    <option value="Pendente">Pendente</option>
                    <option value="Pago">Pago</option>
                    <option value="Agendado">Agendado</option>
                  </select>
                </div>
                {/* Movimentação */}
                <div>
                  <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 uppercase tracking-wider">Movimentação</label>
                  <select value={txForm.movement || 'Saída'} onChange={e => setTxForm(p => ({...p, movement: e.target.value as any}))} className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm focus:ring-2 focus:ring-royal-600/10 focus:border-royal-600 outline-none">
                    <option value="Saída">Saída</option>
                    <option value="Entrada">Entrada</option>
                  </select>
                </div>
                {/* Data Emissão */}
                <div>
                  <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 uppercase tracking-wider">Data Emissão</label>
                  <input type="date" value={txForm.date || ''} onChange={e => setTxForm(p => ({...p, date: e.target.value}))} className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm focus:ring-2 focus:ring-royal-600/10 focus:border-royal-600 outline-none" />
                </div>
                {/* Vencimento */}
                <div>
                  <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 uppercase tracking-wider">Vencimento</label>
                  <input type="date" value={txForm.dueDate || ''} onChange={e => setTxForm(p => ({...p, dueDate: e.target.value}))} className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm focus:ring-2 focus:ring-royal-600/10 focus:border-royal-600 outline-none" />
                </div>
                {/* Data Pagamento */}
                <div>
                  <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 uppercase tracking-wider">Data Pagamento (Baixa)</label>
                  <input type="date" value={txForm.paymentDate || ''} onChange={e => setTxForm(p => ({...p, paymentDate: e.target.value}))} className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm focus:ring-2 focus:ring-royal-600/10 focus:border-royal-600 outline-none" />
                </div>
                {/* Valor Pago */}
                <div>
                  <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 uppercase tracking-wider">Valor Pago / Saída (R$)</label>
                  <input type="number" step="0.01" value={txForm.valuePaid || 0} onChange={e => setTxForm(p => ({...p, valuePaid: parseFloat(e.target.value)}))} className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm focus:ring-2 focus:ring-royal-600/10 focus:border-royal-600 outline-none" />
                </div>
                {/* Valor Recebido */}
                <div>
                  <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 uppercase tracking-wider">Valor Recebido / Entrada (R$)</label>
                  <input type="number" step="0.01" value={txForm.valueReceived || 0} onChange={e => setTxForm(p => ({...p, valueReceived: parseFloat(e.target.value)}))} className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm focus:ring-2 focus:ring-royal-600/10 focus:border-royal-600 outline-none" />
                </div>
                {/* Pago Por */}
                <div>
                  <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 uppercase tracking-wider">Pago Por</label>
                  <input type="text" value={txForm.paidBy || ''} onChange={e => setTxForm(p => ({...p, paidBy: e.target.value}))} className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm focus:ring-2 focus:ring-royal-600/10 focus:border-royal-600 outline-none" />
                </div>
                {/* Observação */}
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 uppercase tracking-wider">Observação</label>
                  <textarea rows={2} value={txForm.observacaoAPagar || ''} onChange={e => setTxForm(p => ({...p, observacaoAPagar: e.target.value}))} className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm focus:ring-2 focus:ring-royal-600/10 focus:border-royal-600 outline-none resize-none" />
                </div>
                {/* IDs (readonly) */}
                <div>
                  <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 uppercase tracking-wider">ID Firebase</label>
                  <input type="text" value={selectedTx.id} readOnly className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-800 text-slate-400 text-xs font-mono" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 uppercase tracking-wider">
                    JotForm Submission ID
                    {!(selectedTx as any).submissionId && <span className="ml-2 text-amber-500 normal-case font-normal">(não disponível — próximas baixas via JotForm serão sincronizadas)</span>}
                  </label>
                  <input type="text" value={(selectedTx as any).submissionId || '—'} readOnly className={`w-full px-3 py-2 border rounded-lg text-xs font-mono ${ (selectedTx as any).submissionId ? 'border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300' : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-400' }`} />
                </div>
                {txMessage && (
                  <div className={`sm:col-span-2 p-3 rounded-lg text-sm flex items-center gap-2 ${ txMessage.type === 'success' ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300 border border-green-200 dark:border-green-800' : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300 border border-red-200 dark:border-red-800' }`}>
                    {txMessage.type === 'success' ? <CheckCircle className="h-4 w-4 shrink-0" /> : <XCircle className="h-4 w-4 shrink-0" />}
                    {txMessage.text}
                  </div>
                )}
              </div>
              <div className="flex items-center justify-between px-6 py-4 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 rounded-b-xl">
                <button onClick={handleDeleteTx} disabled={txSaving} className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
                  <Trash2 className="h-4 w-4" /> Excluir
                </button>
                <div className="flex gap-2">
                  <button onClick={() => setShowTxModal(false)} className="px-4 py-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors text-sm">Cancelar</button>
                  <button onClick={handleSaveTx} disabled={txSaving} className="flex items-center gap-2 px-4 py-2 bg-royal-800 hover:bg-royal-900 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
                    {txSaving ? <><Loader2 className="h-4 w-4 animate-spin" /> Salvando...</> : <><Save className="h-4 w-4" /> Salvar</>}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* MODAL: Novo Lançamento */}
        {showNewTxModal && (
          <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700">
                <h3 className="font-bold text-slate-800 dark:text-white flex items-center gap-2"><PlusCircle className="h-4 w-4 text-green-600" /> Novo Lançamento</h3>
                <button onClick={() => setShowNewTxModal(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"><X className="h-5 w-5" /></button>
              </div>
              <div className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 uppercase tracking-wider">Descrição *</label>
                  <input type="text" value={newTxForm.description || ''} onChange={e => setNewTxForm(p => ({...p, description: e.target.value}))} className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm focus:ring-2 focus:ring-green-500/20 focus:border-green-500 outline-none" placeholder="Ex: Pagamento fornecedor XYZ" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 uppercase tracking-wider">Cliente / Credor</label>
                  <input type="text" value={newTxForm.client || ''} onChange={e => setNewTxForm(p => ({...p, client: e.target.value}))} className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm focus:ring-2 focus:ring-green-500/20 focus:border-green-500 outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 uppercase tracking-wider">Conta Bancária</label>
                  <input type="text" value={newTxForm.bankAccount || ''} onChange={e => setNewTxForm(p => ({...p, bankAccount: e.target.value}))} className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm focus:ring-2 focus:ring-green-500/20 focus:border-green-500 outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 uppercase tracking-wider">Status</label>
                  <select value={newTxForm.status || 'Pendente'} onChange={e => setNewTxForm(p => ({...p, status: e.target.value as any}))} className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm focus:ring-2 focus:ring-green-500/20 focus:border-green-500 outline-none">
                    <option value="Pendente">Pendente</option>
                    <option value="Pago">Pago</option>
                    <option value="Agendado">Agendado</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 uppercase tracking-wider">Movimentação</label>
                  <select value={newTxForm.movement || 'Saída'} onChange={e => setNewTxForm(p => ({...p, movement: e.target.value as any}))} className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm focus:ring-2 focus:ring-green-500/20 focus:border-green-500 outline-none">
                    <option value="Saída">Saída (A Pagar)</option>
                    <option value="Entrada">Entrada (A Receber)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 uppercase tracking-wider">Data Emissão *</label>
                  <input type="date" value={newTxForm.date || ''} onChange={e => setNewTxForm(p => ({...p, date: e.target.value}))} className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm focus:ring-2 focus:ring-green-500/20 focus:border-green-500 outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 uppercase tracking-wider">Vencimento *</label>
                  <input type="date" value={newTxForm.dueDate || ''} onChange={e => setNewTxForm(p => ({...p, dueDate: e.target.value}))} className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm focus:ring-2 focus:ring-green-500/20 focus:border-green-500 outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 uppercase tracking-wider">Valor Saída / Pago (R$)</label>
                  <input type="number" step="0.01" value={newTxForm.valuePaid || 0} onChange={e => setNewTxForm(p => ({...p, valuePaid: parseFloat(e.target.value)}))} className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm focus:ring-2 focus:ring-green-500/20 focus:border-green-500 outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 uppercase tracking-wider">Valor Entrada / Recebido (R$)</label>
                  <input type="number" step="0.01" value={newTxForm.valueReceived || 0} onChange={e => setNewTxForm(p => ({...p, valueReceived: parseFloat(e.target.value)}))} className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm focus:ring-2 focus:ring-green-500/20 focus:border-green-500 outline-none" />
                </div>
                {newTxMessage && (
                  <div className={`sm:col-span-2 p-3 rounded-lg text-sm flex items-center gap-2 ${ newTxMessage.type === 'success' ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300 border border-green-200 dark:border-green-800' : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300 border border-red-200 dark:border-red-800' }`}>
                    {newTxMessage.type === 'success' ? <CheckCircle className="h-4 w-4 shrink-0" /> : <XCircle className="h-4 w-4 shrink-0" />}
                    {newTxMessage.text}
                  </div>
                )}
              </div>
              <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 rounded-b-xl">
                <button onClick={() => setShowNewTxModal(false)} className="px-4 py-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors text-sm">Cancelar</button>
                <button onClick={handleCreateTx} disabled={newTxSaving} className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
                  {newTxSaving ? <><Loader2 className="h-4 w-4 animate-spin" /> Criando...</> : <><PlusCircle className="h-4 w-4" /> Criar Lançamento</>}
                </button>
              </div>
            </div>
          </div>
        )}

    </Layout>
  );
};

export default Admin;
// deploy trigger Sun Mar  8 14:35:57 UTC 2026
