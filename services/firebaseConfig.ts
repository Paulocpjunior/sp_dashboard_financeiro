import { initializeApp, getApps } from 'firebase/app';
import { initializeFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyD8ALStO87VkkDcI00oe570cctmKCB7iBg",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "gen-lang-client-0888019226.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "gen-lang-client-0888019226",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "gen-lang-client-0888019226.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "291088837584",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:291088837584:web:47efddccf7d8d268a1a7d5",
};

const app = !getApps().length ? initializeApp(firebaseConfig) : getApps()[0];
// Força detecção automática de long-polling para contornar bugs do WebChannel
// em Safari modo privado, redes corporativas com proxy, etc.
export const db = initializeFirestore(app, {
  experimentalAutoDetectLongPolling: true,
});
export const auth = getAuth(app);
