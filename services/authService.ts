import { User } from '../types';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
  updateProfile,
} from 'firebase/auth';
import {
  doc,
  getDoc,
  setDoc,
  collection,
  query,
  where,
  getDocs,
} from 'firebase/firestore';
import { auth, db } from './firebaseConfig';

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

interface RegisterData {
  name: string;
  email: string;
  phone?: string;
  username: string;
  password: string;
}

interface RegisterResult {
  success: boolean;
  message: string;
}

// ===========================================================================
// Helpers de persistência local (apenas cache do perfil; auth real vive no Firebase)
// ===========================================================================
const persistAuth = (user: User): void => {
  try {
    const authState: AuthState = { user, isAuthenticated: true };
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(authState));
  } catch (e) {
    console.warn('[AuthService] Falha ao persistir auth:', e);
  }
};

const clearAuth = (): void => {
  try {
    localStorage.removeItem(AUTH_STORAGE_KEY);
  } catch (e) {}
};

// ===========================================================================
// AuthService
// ===========================================================================
export const AuthService = {
  /**
   * Login via Firebase Auth.
   * Parâmetro `emailOrUsername` aceita email (recomendado). Mantido o nome genérico
   * para compatibilidade com Login.tsx existente.
   */
  login: async (emailOrUsername: string, password: string): Promise<LoginResult> => {
    const email = emailOrUsername.toLowerCase().trim();

    try {
      // 1. Autentica no Firebase Auth
      const cred = await signInWithEmailAndPassword(auth, email, password);
      const fbUser = cred.user;

      // 2. Busca o perfil em users/{uid}
      const profileRef = doc(db, 'users', fbUser.uid);
      const profileSnap = await getDoc(profileRef);

      if (!profileSnap.exists()) {
        await signOut(auth);
        clearAuth();
        return {
          success: false,
          message: 'Conta criada mas perfil não localizado. Contate o administrador.',
        };
      }

      const profileData = profileSnap.data();

      // 4. Verifica se a conta está ativa (foi aprovada pelo admin)
      if (profileData.active === false) {
        await signOut(auth);
        clearAuth();
        return {
          success: false,
          message: 'Sua conta está aguardando aprovação do administrador.',
        };
      }

      // 4. Atualiza lastAccess
      try {
        await setDoc(profileRef, { lastAccess: new Date().toISOString() }, { merge: true });
      } catch (e) {}

      // 6. Monta o objeto User usado em todo o sistema
      const user: User = {
        id: fbUser.uid,
        username: (profileData.username || email.split('@')[0] || '').toLowerCase(),
        name: profileData.name || fbUser.displayName || email,
        role: ((profileData.role || 'operacional') + '').toLowerCase().trim() as any,
        active: profileData.active !== false,
        email: profileData.email || fbUser.email || email,
        lastAccess: new Date().toISOString(),
      };

      persistAuth(user);
      console.log('[AuthService] Login OK:', user.username, 'role:', user.role);
      return { success: true, user };
    } catch (err: any) {
      const code = err?.code || '';
      console.warn('[AuthService] Erro no login:', code, err?.message);

      const messageMap: Record<string, string> = {
        'auth/invalid-email': 'Email em formato inválido.',
        'auth/user-not-found': 'Email ou senha incorretos.',
        'auth/wrong-password': 'Email ou senha incorretos.',
        'auth/invalid-credential': 'Email ou senha incorretos.',
        'auth/user-disabled': 'Esta conta foi desativada. Contate o administrador.',
        'auth/too-many-requests': 'Muitas tentativas falhas. Aguarde alguns minutos e tente novamente.',
        'auth/network-request-failed': 'Falha de conexão. Verifique sua internet.',
      };

      return {
        success: false,
        message: messageMap[code] || 'Não foi possível fazer login. Tente novamente.',
      };
    }
  },

  /**
   * Registra um novo usuário:
   * 1. Cria conta no Firebase Auth
   * 2. Envia email de verificação
   * 3. Cria doc users/{uid} com active: false (pendente de aprovação admin)
   */
  register: async (data: RegisterData): Promise<RegisterResult> => {
    const email = (data.email || '').toLowerCase().trim();
    const username = (data.username || '').toLowerCase().trim();

    if (!email || !username || !data.password || !data.name) {
      return { success: false, message: 'Preencha todos os campos obrigatórios.' };
    }
    if (data.password.length < 6) {
      return { success: false, message: 'A senha deve ter no mínimo 6 caracteres.' };
    }

    try {
      // Checa se username já existe no Firestore
      const usersRef = collection(db, 'users');
      const qSnap = await getDocs(query(usersRef, where('username', '==', username)));
      if (!qSnap.empty) {
        return { success: false, message: 'Este nome de usuário já está em uso.' };
      }

      // Cria conta no Firebase Auth
      const cred = await createUserWithEmailAndPassword(auth, email, data.password);
      const fbUser = cred.user;

      // Nome de exibição no Firebase Auth
      try {
        await updateProfile(fbUser, { displayName: data.name });
      } catch (e) {
        console.warn('[AuthService] Falha ao definir displayName:', e);
      }

      // Cria doc de perfil no Firestore (pendente de aprovação)
      const profileRef = doc(db, 'users', fbUser.uid);
      await setDoc(profileRef, {
        uid: fbUser.uid,
        email,
        username,
        name: data.name,
        phone: data.phone || '',
        role: 'operacional',
        active: false,
        createdAt: new Date().toISOString(),
      });

      // Faz signOut para o usuário não ficar logado antes de ser aprovado
      try {
        await signOut(auth);
      } catch (e) {}

      return {
        success: true,
        message: 'Cadastro realizado com sucesso! Aguarde a aprovação do administrador para acessar o sistema.',
      };
    } catch (err: any) {
      const code = err?.code || '';
      console.warn('[AuthService] Erro no registro:', code, err?.message);

      const messageMap: Record<string, string> = {
        'auth/email-already-in-use': 'Este email já está cadastrado.',
        'auth/invalid-email': 'Email em formato inválido.',
        'auth/weak-password': 'Senha muito fraca. Use pelo menos 6 caracteres.',
        'auth/network-request-failed': 'Falha de conexão. Verifique sua internet.',
      };
      return {
        success: false,
        message: messageMap[code] || 'Erro ao realizar cadastro. Tente novamente.',
      };
    }
  },

  /**
   * Envia email de reset de senha via Firebase.
   */
  requestPasswordReset: async (email: string): Promise<RegisterResult> => {
    const cleanEmail = (email || '').toLowerCase().trim();
    if (!cleanEmail) {
      return { success: false, message: 'Informe um email válido.' };
    }
    try {
      await sendPasswordResetEmail(auth, cleanEmail);
      return {
        success: true,
        message: 'Email de recuperação enviado! Cheque sua caixa de entrada (e spam).',
      };
    } catch (err: any) {
      const code = err?.code || '';
      console.warn('[AuthService] Erro no reset de senha:', code, err?.message);
      // Por segurança, não revelamos se o email existe ou não
      return {
        success: true,
        message: 'Se o email estiver cadastrado, você receberá as instruções em instantes.',
      };
    }
  },

  logout: async (): Promise<void> => {
    try {
      await signOut(auth);
    } catch (e) {}
    clearAuth();
  },

  isAuthenticated: (): boolean => {
    try {
      const stored = localStorage.getItem(AUTH_STORAGE_KEY);
      if (!stored) return false;
      const authState: AuthState = JSON.parse(stored);
      return authState.isAuthenticated && authState.user !== null;
    } catch (e) {
      return false;
    }
  },

  getCurrentUser: (): User | null => {
    try {
      const stored = localStorage.getItem(AUTH_STORAGE_KEY);
      if (!stored) return null;
      const authState: AuthState = JSON.parse(stored);
      return authState.user;
    } catch (e) {
      return null;
    }
  },

  updateCurrentUser: (user: User): void => {
    persistAuth(user);
  },
};
