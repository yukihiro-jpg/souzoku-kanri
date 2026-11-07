export const fmtTime = (ms: number | string | null | undefined) => {
  if (!ms) return "";
  const d = new Date(ms);
  return d.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
};
export const fmtDateTime = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString("ja-JP", { dateStyle: "short", timeStyle: "short" }) : "");
export const fmtElapsed = (fromIso: string | null | undefined, now: number) => {
  if (!fromIso) return "00:00";
  const s = Math.max(0, Math.floor((now - new Date(fromIso).getTime()) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return (h ? `${h}:` : "") + `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
};
export const pct = (v: number) => `${Math.round(v * 100)}%`;
export const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");
