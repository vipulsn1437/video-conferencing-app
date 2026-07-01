import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth, browserLocalPersistence, setPersistence } from 'firebase/auth';

if (!process.env.REACT_APP_FIREBASE_API_KEY) {
  console.error('❌ REACT_APP_FIREBASE_API_KEY is not set in .env — Firebase will not work.');
}

const firebaseConfig = {
  apiKey:            process.env.REACT_APP_FIREBASE_API_KEY,
  authDomain:        "video-conf-app-d5832.firebaseapp.com",
  projectId:         "video-conf-app-d5832",
  storageBucket:     "video-conf-app-d5832.firebasestorage.app",
  messagingSenderId: "725191445147",
  appId:             "1:725191445147:web:4030bed09353802087543e",
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);

setPersistence(auth, browserLocalPersistence).catch(console.error);