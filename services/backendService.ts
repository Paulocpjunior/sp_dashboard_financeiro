
import { Transaction, User } from '../types';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  updateDoc,
  query,
  where,
  orderBy,
} from 'firebase/firestore';
import { db } from './firebaseConfig';

// =========================================================================================
// CONFIGURACAO DO BANCO DE DADOS (GOOGLE SHEETS - LEGADO)
// Mantido apenas para compatibilidade com funcoes que ainda usam o ID da planilha
// =========================================================================================
const DEFAULT_SPREADSHEET_ID = '17mHd8eqKoj7Cl6E2MCkr0PczFj-lKv_vmFRCY5hypwg';
const DEFAULT_GID = '1276925607';

const STORAGE_KEY_DB_SOURCE = 'cashflow_db_source_id';
const STORAGE_KEY_DB_GID = 'cashflow_db_gid';

// =========================================================================================
// BackendService
// Auth/registro/reset agora estao em AuthService (Firebase Auth).
// Este servico lida com dados de negocio (usuarios, transacoes) no Firestore.
// =========================================================================================
export const BackendService = {

  isProduction: (): boolean => true,

  getSpreadsheetId: (): string => {
    try { return localStorage.getItem(STORAGE_KEY_DB_SOURCE) || DEFAULT_SPREADSHEET_ID; }
    catch (e) { return DEFAULT_SPREADSHEET_ID; }
  },

  getSpreadsheetGid: (): string => {
    try { return localStorage.getItem(STORAGE_KEY_DB_GID) || DEFAULT_GID; }
    catch (e) { return DEFAULT_GID; }
  },

  setSpreadsheetId: (id: string): void => {
    try { localStorage.setItem(STORAGE_KEY_DB_SOURCE, id); } catch (e) {}
  },

  setSpreadsheetGid: (gid: string): void => {
    try { localStorage.setItem(STORAGE_KEY_DB_GID, gid); } catch (e) {}
  },

  // =======================================================================================
  // USUARIOS (Firestore direto, sem MOCK_USERS)
  // =======================================================================================

  /**
   * Lista todos os usuarios do Firestore (ativos e pendentes).
   * Nao retorna passwordHash (legado, nem deveria existir mais).
   */
  fetchUsers: async (): Promise<User[]> => {
    try {
      const snap = await getDocs(collection(db, 'users'));
      const users: User[] = [];
      snap.forEach(d => {
        const data = d.data();
        users.push({
          id: d.id,
          username: (data.username || '').toLowerCase(),
          name: data.name || data.username || '',
          role: ((data.role || 'operacional') + '').toLowerCase().trim() as any,
          active: data.active !== false,
          email: data.email || '',
          lastAccess: data.lastAccess || '',
        });
      });
      return users;
    } catch (e) {
      console.error('[BackendService.fetchUsers] Erro:', e);
      return [];
    }
  },

  /**
   * Lista usuarios pendentes de aprovacao (active: false).
   */
  fetchPendingUsers: async (): Promise<User[]> => {
    try {
      const q = query(collection(db, 'users'), where('active', '==', false));
      const snap = await getDocs(q);
      const users: User[] = [];
      snap.forEach(d => {
        const data = d.data();
        users.push({
          id: d.id,
          username: (data.username || '').toLowerCase(),
          name: data.name || data.username || '',
          role: ((data.role || 'operacional') + '').toLowerCase().trim() as any,
          active: false,
          email: data.email || '',
        });
      });
      return users;
    } catch (e) {
      console.error('[BackendService.fetchPendingUsers] Erro:', e);
      return [];
    }
  },

  /**
   * Aprova um usuario pendente: define active = true no Firestore.
   * O usuario ja tem conta no Firebase Auth criada no momento do cadastro.
   */
  approvePendingUser: async (uid: string): Promise<{ success: boolean; message: string }> => {
    try {
      const ref = doc(db, 'users', uid);
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        return { success: false, message: 'Usuario nao encontrado.' };
      }
      await updateDoc(ref, {
        active: true,
        approvedAt: new Date().toISOString(),
      });
      return { success: true, message: 'Usuario aprovado com sucesso.' };
    } catch (e: any) {
      console.error('[BackendService.approvePendingUser] Erro:', e);
      return { success: false, message: e?.message || 'Erro ao aprovar usuario.' };
    }
  },

  /**
   * Rejeita um cadastro pendente: marca o doc como rejeitado (sem deletar).
   * Nao apaga a conta do Firebase Auth aqui - isso requer Admin SDK no backend.
   * O usuario rejeitado simplesmente nao conseguira logar (active: false continua).
   */
  rejectPendingUser: async (uid: string, reason?: string): Promise<{ success: boolean; message: string }> => {
    try {
      const ref = doc(db, 'users', uid);
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        return { success: false, message: 'Usuario nao encontrado.' };
      }
      await updateDoc(ref, {
        active: false,
        rejected: true,
        rejectedAt: new Date().toISOString(),
        rejectionReason: reason || '',
      });
      return { success: true, message: 'Cadastro rejeitado.' };
    } catch (e: any) {
      console.error('[BackendService.rejectPendingUser] Erro:', e);
      return { success: false, message: e?.message || 'Erro ao rejeitar cadastro.' };
    }
  },

  /**
   * Ativa/desativa um usuario existente.
   */
  setUserActive: async (uid: string, active: boolean): Promise<{ success: boolean; message: string }> => {
    try {
      const ref = doc(db, 'users', uid);
      await updateDoc(ref, { active });
      return { success: true, message: active ? 'Usuario reativado.' : 'Usuario desativado.' };
    } catch (e: any) {
      console.error('[BackendService.setUserActive] Erro:', e);
      return { success: false, message: e?.message || 'Erro ao atualizar usuario.' };
    }
  },

  /**
   * Atualiza role de um usuario (admin/operacional).
   */
  setUserRole: async (uid: string, role: 'admin' | 'operacional'): Promise<{ success: boolean; message: string }> => {
    try {
      const ref = doc(db, 'users', uid);
      await updateDoc(ref, { role });
      return { success: true, message: 'Role atualizada.' };
    } catch (e: any) {
      console.error('[BackendService.setUserRole] Erro:', e);
      return { success: false, message: e?.message || 'Erro ao atualizar role.' };
    }
  },
};
