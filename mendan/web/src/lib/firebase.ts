import { initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import { connectFirestoreEmulator, initializeFirestore, persistentLocalCache } from "firebase/firestore";
import { connectFunctionsEmulator, getFunctions } from "firebase/functions";
import { connectStorageEmulator, getStorage } from "firebase/storage";

const env = import.meta.env;
export const useEmulators = env.VITE_USE_EMULATORS === "true";

export const app = initializeApp({
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  appId: env.VITE_FIREBASE_APP_ID,
});

export const auth = getAuth(app);
// 通信が一時的に切れても、確定した発言はブラウザに保持され、復帰後に自動送信される
export const db = initializeFirestore(app, useEmulators ? {} : { localCache: persistentLocalCache() });
export const functions = getFunctions(app, "asia-northeast1");
export const storage = getStorage(app);

if (useEmulators) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  connectStorageEmulator(storage, "127.0.0.1", 9199);
}
