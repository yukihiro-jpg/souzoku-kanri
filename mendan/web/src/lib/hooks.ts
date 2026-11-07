import { useEffect, useRef, useState } from "react";
import { collection, doc, onSnapshot, query, type QueryConstraint } from "firebase/firestore";
import { db } from "./firebase";

/** Firestore のリアルタイム購読 */
export function useDoc<T>(path: string | null): { data: T | null; loading: boolean; error: string | null } {
  const [state, set] = useState<{ data: T | null; loading: boolean; error: string | null }>({ data: null, loading: !!path, error: null });
  useEffect(() => {
    if (!path) return;
    return onSnapshot(
      doc(db, path),
      (s) => set({ data: (s.data() as T) ?? null, loading: false, error: null }),
      (e) => set({ data: null, loading: false, error: e.message }),
    );
  }, [path]);
  return state;
}

export function useCollection<T>(path: string | null, constraints: QueryConstraint[] = [], key = ""): { data: T[]; loading: boolean; error: string | null; updatedAt: number } {
  const [state, set] = useState<{ data: T[]; loading: boolean; error: string | null; updatedAt: number }>({ data: [], loading: !!path, error: null, updatedAt: 0 });
  const c = useRef(constraints);
  c.current = constraints;
  useEffect(() => {
    if (!path) return;
    return onSnapshot(
      query(collection(db, path), ...c.current),
      (s) => set({ data: s.docs.map((d) => d.data() as T), loading: false, error: null, updatedAt: Date.now() }),
      (e) => set({ data: [], loading: false, error: e.message, updatedAt: Date.now() }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, key]);
  return state;
}

export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
