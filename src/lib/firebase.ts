import { initializeApp, getApps } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getAnalytics, isSupported, Analytics } from "firebase/analytics";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyCaqqnhf8VIW9WTNk6B2rVmAbpch1er398",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "lifesyncai-f9630.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "lifesyncai-f9630",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "lifesyncai-f9630.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "1095392109549",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:1095392109549:web:c84124e94a7729d299bde4",
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || "G-F0JQM430FF",
};

const app = getApps().length
? getApps()[0]
: initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);

export let analytics: Analytics | null = null;

if (typeof window !== "undefined") {
isSupported()
.then((supported) => {
if (supported) {
analytics = getAnalytics(app);
}
})
.catch((err) => {
console.warn("Analytics not supported:", err);
});
}

export default app;
