import { User } from '../types';
import { MOCK_USERS, APPS_SCRIPT_URL, ALT_APPS_SCRIPT_URLS } from '../constants';
import { collection, getDocs } from 'firebase/firestore';
import { db } from './firebaseConfig';

const AUTH_STORAGE_KEY = 'sp_contabil_auth';

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
}

interface LoginResult {
  success: boolean;
  user?: User;
  message?: string;
}

const MOCK_PASSWORDS: Record<string, string> = {
  'admin': 'admin123',
  'operador1': 'op1234',
  'operador2': 'op5678'
};

const sha256 = async (message: string): Promise<string> => {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
};

const loginViaFirestore = async (username: string, password: string): Promise<LoginResult> => {
  try {
    const usersRef = collection(db, 'users');
    const snapshot = await getDocs(usersRef);
    const passwordHash = await sha256(password);
    
    for (const doc of snapshot.docs) {
      const userData = doc.data();
      const dbUsername = (userData.username || userData.name || '').toLowerCase().trim();
      const dbEmail = (userData.email || '').toLowerCase().trim();
      
      if (dbUsername === username || dbEmail === username) {
        const dbPassHash = userData.passwordHash || userData.password_hash || '';
        const dbPassword = userData.password || '';
        
        if (dbPassHash === passwordHash || dbPassword === password) {
          const user: User = {
            id: doc.id,
            username: dbUsername,
            name: userData.name || dbUsername,
            role: (userData.role || 'operacional').toLowerCase().trim() as any,
            active: userData.active !== false && userData.isVerified !== false,
            email: userData.email || '',
            passwordHash: dbPassHash
          };
          
          if (!user.active) {
            return { success: false, message: 'Usuário desativado. Contate o administrador.' };
          }
          return { success: true, user };
        }
      }
    }
    return { success: false, message: '' };
  } catch (error) {
    console.warn('[AuthService] Firestore auth falhou:', error);
    return { success: false, message: '' };
  }
};

const loginViaMock = (username: string, password: string): LoginResult => {
  const mockUser = MOCK_USERS.find(u => u.username === username);
  if (mockUser && MOCK_PASSWORDS[username] === password) {
    return { success: true, user: mockUser };
  }
  return { success: false, message: '' };
};

const loginViaAPI = async (username: string, password: string): Promise<LoginResult> => {
  const urlsToTry = [APPS_SCRIPT_URL, ...ALT_APPS_SCRIPT_URLS];
  for (const baseUrl of urlsToTry) {
    try {
      const params = new URLSearchParams({ action: 'loginGet', username, password });
      const url = `${baseUrl}?${params.toString()}`;
      const response = await fetch(url, { method: 'GET', redirect: 'follow' });
      if (!response.ok) continue;
      const text = await response.text();
      try {
        const result = JSON.parse(text);
        if (result && (result.success || result.user)) return result;
        if (result && result.success === false) return result;
      } catch (e) { continue; }
    } catch (error) { continue; }
  }
  return { success: false, message: '' };
};

export const AuthService = {
  login: async (username: string, password: string): Promise<LoginResult> => {
    const usernameClean = username.toLowerCase().trim();
    console.log('[AuthService] Tentando login:', usernameClean);
    
    // 1. Mock users
    const mockResult = loginViaMock(usernameClean, password);
    if (mockResult.success && mockResult.user) {
      const authState: AuthState = { user: mockResult.user, isAuthenticated: true };
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(authState));
      console.log('[AuthService] Login via Mock:', mockResult.user.name);
      return { success: true, user: mockResult.user };
    }
    
    // 2. Firestore
    const firestoreResult = await loginViaFirestore(usernameClean, password);
    if (firestoreResult.success && firestoreResult.user) {
      const user = { ...firestoreResult.user, role: (firestoreResult.user.role || 'operacional').toLowerCase().trim() as any };
      const authState: AuthState = { user, isAuthenticated: true };
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(authState));
      console.log('[AuthService] Login via Firestore:', user.name, 'Role:', user.role);
      return { success: true, user };
    }
    
    // 3. Apps Script (legacy)
    const apiResult = await loginViaAPI(usernameClean, password);
    if (apiResult.success && apiResult.user) {
      const user = { ...apiResult.user, role: (apiResult.user.role || 'operacional').toLowerCase().trim() as any };
      const authState: AuthState = { user, isAuthenticated: true };
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(authState));
      return { success: true, user };
    }
    
    return { success: false, message: firestoreResult.message || apiResult.message || 'Usuário não encontrado ou senha incorreta.' };
  },

  logout: (): void => {
    try { localStorage.removeItem(AUTH_STORAGE_KEY); } catch (e) {}
  },

  isAuthenticated: (): boolean => {
    try {
      const stored = localStorage.getItem(AUTH_STORAGE_KEY);
      if (!stored) return false;
      const authState: AuthState = JSON.parse(stored);
      return authState.isAuthenticated && authState.user !== null;
    } catch (e) { return false; }
  },

  getCurrentUser: (): User | null => {
    try {
      const stored = localStorage.getItem(AUTH_STORAGE_KEY);
      if (!stored) return null;
      const authState: AuthState = JSON.parse(stored);
      return authState.user;
    } catch (e) { return null; }
  },

  updateCurrentUser: (user: User): void => {
    try {
      const authState: AuthState = { user, isAuthenticated: true };
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(authState));
    } catch (e) {}
  },
};
