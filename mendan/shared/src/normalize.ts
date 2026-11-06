import { NAME_ALIASES } from "./masters/vocabulary.js";
import { ENTITY_SPECS } from "./masters/attributes.js";
import type { EntityType } from "./types.js";

/** 全角/半角・空白・記号の揺れをそろえる */
export function normalizeText(s: string): string {
  return (s || "")
    .normalize("NFKC")
    .replace(/[\s　]+/g, "")
    .replace(/[「」『』（）()【】、。,.・]/g, "")
    .trim();
}

export function canonicalName(s: string): string {
  const n = normalizeText(s);
  if (!n) return n;
  if (NAME_ALIASES[n]) return NAME_ALIASES[n];
  return n;
}

/** 実体の重複判定キー */
export function entityKey(type: EntityType, attrs: Record<string, string | undefined>, label: string): string {
  const spec = ENTITY_SPECS[type];
  if (spec.keyAttrs.length === 0) return `${type}`; // 被相続人・遺言は案件に1つ
  const parts = spec.keyAttrs.map((k) => canonicalName(attrs[k] ?? "")).filter(Boolean);
  if (parts.length === 0) parts.push(canonicalName(label));
  return `${type}:${parts.join("|")}`;
}

/** 文字起こしの重複検出用（再接続時の同一文の二重確定を防ぐ） */
export function similarText(a: string, b: string): boolean {
  const x = normalizeText(a);
  const y = normalizeText(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 8 && long.includes(short);
}

export function fillTemplate(tpl: string, vars: Record<string, string | null | undefined>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k: string) => (vars[k] ?? "").toString() || "（未確認）");
}
