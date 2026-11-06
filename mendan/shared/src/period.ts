import type { PeriodSpec } from "./types.js";

/**
 * 期間の算定。
 *
 * 1) 取引履歴の収集期間 … 事務所の調査方針（settings.transactionHistoryYears）で決まる。
 * 2) 生前贈与加算の対象期間 … 相続税法19条（令和5年度改正）で決まる。
 * この2つは別概念として扱い、混同しない（指示書 6. 具体例：預貯金）。
 */

function parseDate(s: string | null | undefined): Date | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addYears(d: Date, years: number): Date {
  const r = new Date(d.getTime());
  r.setUTCFullYear(r.getUTCFullYear() + years);
  return r;
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86400000);
}

/** 資料の対象期間（表示用文字列） */
export function describePeriod(spec: PeriodSpec | null, deathDate: string | null, transactionHistoryYears: number): string | null {
  if (!spec || spec.kind === "none") return null;
  const death = parseDate(deathDate);
  switch (spec.kind) {
    case "as_of_death":
      return death ? `${fmt(death)}（相続開始日）時点` : "相続開始日時点";
    case "years_before_death": {
      const years = spec.years ?? transactionHistoryYears;
      if (!death) return `相続開始日前${years}年間〜相続開始日以後の直近まで（事務所調査方針）`;
      const from = addDays(addYears(death, -years), 1);
      return `${fmt(from)}〜${fmt(death)}以後の直近まで（事務所調査方針：${years}年）`;
    }
    case "fiscal_years":
      return `相続開始日の直前${spec.years ?? 3}期分`;
    default:
      return null;
  }
}

/**
 * 暦年課税の生前贈与加算の対象期間（参考表示用）。
 * 令和5年度税制改正：令和6年1月1日以後の贈与から段階的に3年→7年へ延長。
 *  - 相続開始 〜2026-12-31 : 相続開始前3年以内
 *  - 2027-01-01〜2030-12-31 : 2024-01-01 〜 相続開始日
 *  - 2031-01-01〜          : 相続開始前7年以内
 * 税務上の最終判断は税理士が行う（AIや本関数で結論を確定しない）。
 */
export function giftAdditionPeriod(deathDate: string | null): { from: string; to: string; note: string } | null {
  const death = parseDate(deathDate);
  if (!death) return null;
  const y = death.getUTCFullYear();
  let from: Date;
  if (y <= 2026) from = addDays(addYears(death, -3), 1);
  else if (y <= 2030) from = new Date("2024-01-01T00:00:00Z");
  else from = addDays(addYears(death, -7), 1);
  return {
    from: fmt(from),
    to: fmt(death),
    note: "暦年課税分の加算対象期間（参考）。3年超7年以内の贈与は合計100万円控除あり。最終判断は税理士が確認。",
  };
}
