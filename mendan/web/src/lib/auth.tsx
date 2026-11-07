import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { GoogleAuthProvider, onAuthStateChanged, signInWithCredential, signInWithPopup, signOut, type User } from "firebase/auth";
import type { Role } from "@mendan/shared";
import { api, errorMessage } from "./api";
import { auth, useEmulators } from "./firebase";

interface Profile {
  role: Role;
  email: string;
  displayName: string;
}
interface AuthState {
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  error: string | null;
  signIn: () => Promise<void>;
  devSignIn: (email: string) => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(
    () =>
      onAuthStateChanged(auth, async (u) => {
        setUser(u);
        setProfile(null);
        if (!u) {
          setLoading(false);
          return;
        }
        try {
          // 許可された Google Workspace アカウントかをサーバーで確認
          const p = await api.ensureUser();
          setProfile({ role: p.role, email: p.email, displayName: p.displayName });
          setError(null);
        } catch (e) {
          setError(errorMessage(e));
          await signOut(auth);
        } finally {
          setLoading(false);
        }
      }),
    [],
  );

  const value: AuthState = {
    user,
    profile,
    loading,
    error,
    signIn: async () => {
      setError(null);
      const provider = new GoogleAuthProvider();
      const hd = import.meta.env.VITE_ALLOWED_DOMAIN;
      provider.setCustomParameters({ prompt: "select_account", ...(hd ? { hd } : {}) });
      await signInWithPopup(auth, provider);
    },
    devSignIn: async (email: string) => {
      if (!useEmulators) throw new Error("エミュレーター接続時のみ利用できます");
      const cred = GoogleAuthProvider.credential(JSON.stringify({ sub: email, email, email_verified: true, name: email.split("@")[0] }));
      await signInWithCredential(auth, cred);
    },
    logout: () => signOut(auth),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error("AuthProvider がありません");
  return v;
}
