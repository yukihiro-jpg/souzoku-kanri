import { describe, expect, it } from "vitest";
import { analysis, entityOp, newState, run, seg } from "./helpers.js";

const bankDocs = (state: ReturnType<typeof newState>, bank: string) => state.documents.filter((d) => d.target === bank);

describe("預貯金の発言 → 確認事項・必要資料", () => {
  it("「父は常陽銀行に普通預金がありました」で残高証明書・取引履歴が候補に追加される", () => {
    const s1 = seg(1, "父は常陽銀行に普通預金がありました");
    const { state } = run(
      newState(),
      analysis({
        entities: [
          entityOp({
            entity_type: "bank_account",
            label: "常陽銀行",
            attributes: [
              { key: "institution", value: "常陽銀行" },
              { key: "deposit_types", value: "普通預金" },
            ],
            evidence_segment_ids: [s1.id],
          }),
        ],
      }),
      [s1],
    );
    const bank = state.entities.find((e) => e.type === "bank_account")!;
    expect(bank.attributes.institution.value).toBe("常陽銀行");
    expect(bank.evidenceSegmentIds).toEqual([s1.id]);

    const docs = bankDocs(state, "常陽銀行");
    expect(docs.map((d) => d.documentId).sort()).toEqual(["bank_balance", "bank_history", "bank_passbook"]);
    expect(docs.every((d) => d.status === "candidate" && d.decidedBy === "rule")).toBe(true);
    const history = docs.find((d) => d.documentId === "bank_history")!;
    // 取引履歴の期間は事務所の調査方針（5年）で算定
    expect(history.period).toContain("2021-08-21〜2026-08-20");
    expect(history.evidenceSegmentIds).toEqual([s1.id]);

    // 確認事項「取引金融機関」は AI確認候補（確認済みにはしない）
    const ci = state.checkItems.find((c) => c.id === "deposits.institutions")!;
    expect(ci.status).toBe("ai_candidate");
    expect(ci.answer).toBe("常陽銀行");
    // 定期預金の発言はないので既経過利息は不要
    expect(state.documents.some((d) => d.documentId === "bank_accrued_interest")).toBe(false);
    // 銀行ごとの追加確認項目
    expect(state.checkItems.some((c) => c.templateId === "bank.branch" && c.entityId === bank.id)).toBe(true);
  });

  it("同じ銀行が2回話題に出ても実体・資料は重複しない", () => {
    const s1 = seg(1, "常陽銀行に普通預金があります");
    const s2 = seg(2, "常陽銀行には定期預金もあります");
    let { state } = run(newState(), analysis({ entities: [entityOp({ entity_type: "bank_account", label: "常陽銀行", attributes: [{ key: "institution", value: "常陽銀行" }], evidence_segment_ids: [s1.id] })] }), [s1]);
    ({ state } = run(
      state,
      analysis({ entities: [entityOp({ entity_type: "bank_account", label: "常陽", attributes: [{ key: "institution", value: "常陽" }, { key: "deposit_types", value: "普通預金、定期預金" }], evidence_segment_ids: [s2.id] })] }),
      [s1, s2],
    ));
    expect(state.entities.filter((e) => e.type === "bank_account")).toHaveLength(1);
    expect(state.documents.filter((d) => d.documentId === "bank_balance")).toHaveLength(1);
    // 定期預金の追加で既経過利息計算書が追加
    expect(state.documents.some((d) => d.documentId === "bank_accrued_interest")).toBe(true);
  });
});

describe("発言訂正", () => {
  it("常陽銀行→筑波銀行の訂正: 旧情報は撤回として履歴に残り、資料は削除候補になる", () => {
    const s1 = seg(1, "常陽銀行に口座があります");
    const s2 = seg(2, "すみません、常陽銀行ではなく筑波銀行でした");
    let { state } = run(newState(), analysis({ entities: [entityOp({ entity_type: "bank_account", label: "常陽銀行", attributes: [{ key: "institution", value: "常陽銀行" }], evidence_segment_ids: [s1.id] })] }), [s1]);
    const joyo = state.entities[0];
    ({ state } = run(
      state,
      analysis({ entities: [entityOp({ entity_type: "bank_account", label: "筑波銀行", attributes: [{ key: "institution", value: "筑波銀行" }], corrects_entity_id: joyo.id, evidence_segment_ids: [s2.id] })] }),
      [s1, s2],
    ));
    const old = state.entities.find((e) => e.id === joyo.id)!;
    const tsukuba = state.entities.find((e) => e.label === "筑波銀行")!;
    expect(old.status).toBe("retracted"); // 削除せず撤回
    expect(old.supersededBy).toBe(tsukuba.id);
    expect(old.history.some((h) => h.action === "corrected")).toBe(true);
    expect(tsukuba.supersedes).toBe(joyo.id);

    expect(bankDocs(state, "常陽銀行").every((d) => d.status === "removal_candidate")).toBe(true);
    expect(bankDocs(state, "筑波銀行").every((d) => d.status === "candidate")).toBe(true);
    expect(state.checkItems.find((c) => c.id === "deposits.institutions")!.answer).toBe("筑波銀行");
    // 撤回された銀行の追加確認項目は不要扱い
    expect(state.checkItems.filter((c) => c.entityId === joyo.id).every((c) => c.obsolete)).toBe(true);
  });

  it("担当者が承認済みの情報・資料は、訂正発言があってもAIが変更しない（追加確認候補になる）", () => {
    const s1 = seg(1, "常陽銀行に口座があります");
    const s2 = seg(2, "常陽銀行ではなく筑波銀行でした");
    let { state } = run(newState(), analysis({ entities: [entityOp({ entity_type: "bank_account", label: "常陽銀行", attributes: [{ key: "institution", value: "常陽銀行" }], evidence_segment_ids: [s1.id] })] }), [s1]);
    // 担当者が実体と資料を承認
    state.entities[0].lockedByUser = true;
    state.entities[0].status = "confirmed";
    for (const d of state.documents) if (d.target === "常陽銀行") Object.assign(d, { status: "required", lockedByUser: true, decidedBy: "user" });
    const before = structuredClone(state.entities[0]);

    const { state: after, result } = run(
      state,
      analysis({ entities: [entityOp({ entity_type: "bank_account", label: "筑波銀行", attributes: [{ key: "institution", value: "筑波銀行" }], corrects_entity_id: before.id, evidence_segment_ids: [s2.id] })] }),
      [s1, s2],
    );
    const joyo = after.entities.find((e) => e.id === before.id)!;
    expect(joyo.status).toBe("confirmed");
    expect(joyo.attributes).toEqual(before.attributes);
    expect(bankDocs(after, "常陽銀行").every((d) => d.status === "required")).toBe(true);
    expect(result.reviewItems.some((r) => r.kind === "correction_on_locked")).toBe(true);
  });

  it("金額の訂正は同じ実体の値を更新し、旧値を履歴に残す", () => {
    const s1 = seg(1, "保険金は300万円です");
    const s2 = seg(2, "いえ、500万円でした");
    let { state } = run(newState(), analysis({ entities: [entityOp({ entity_type: "life_insurance", label: "さくら生命", attributes: [{ key: "insurer", value: "さくら生命" }, { key: "amount", value: "300万円" }], evidence_segment_ids: [s1.id] })] }), [s1]);
    const id = state.entities[0].id;
    ({ state } = run(state, analysis({ entities: [entityOp({ entity_id: id, entity_type: "life_insurance", label: "さくら生命", attributes: [{ key: "amount", value: "500万円" }], evidence_segment_ids: [s2.id] })] }), [s1, s2]));
    const ins = state.entities.find((e) => e.id === id)!;
    expect(ins.attributes.amount.value).toBe("500万円");
    expect(ins.attributes.amount.history?.[0].value).toBe("300万円");
  });
});

describe("根拠・順序の保証", () => {
  it("入力にない発言IDを根拠にした事実は登録しない", () => {
    const s1 = seg(1, "こんにちは");
    const { state, result } = run(newState(), analysis({ entities: [entityOp({ entity_type: "bank_account", label: "架空銀行", evidence_segment_ids: ["seg_9999"] })] }), [s1]);
    expect(state.entities).toHaveLength(0);
    expect(state.documents.filter((d) => d.entityId)).toHaveLength(0);
    expect(result.rejected[0].reason).toBe("no_valid_evidence");
  });

  it("古い解析結果（小さいseq）は新しい値を上書きしない", () => {
    const s1 = seg(1, "支店は本店です");
    const s2 = seg(2, "あ、支店は水戸駅前支店でした");
    let { state } = run(newState(), analysis({ entities: [entityOp({ entity_type: "bank_account", label: "常陽銀行", attributes: [{ key: "institution", value: "常陽銀行" }, { key: "branch", value: "水戸駅前支店" }], evidence_segment_ids: [s2.id] })] }), [s1, s2]);
    // 遅れて届いた古い解析
    ({ state } = run(state, analysis({ entities: [entityOp({ entity_type: "bank_account", label: "常陽銀行", attributes: [{ key: "institution", value: "常陽銀行" }, { key: "branch", value: "本店" }], evidence_segment_ids: [s1.id] })] }), [s1]));
    expect(state.entities[0].attributes.branch.value).toBe("水戸駅前支店");
  });

  it("会話に出てこなかった確認事項は未確認のまま（該当なしにしない）", () => {
    const s1 = seg(1, "常陽銀行に口座があります");
    const { state } = run(newState(), analysis({ entities: [entityOp({ entity_type: "bank_account", label: "常陽銀行", attributes: [{ key: "institution", value: "常陽銀行" }], evidence_segment_ids: [s1.id] })] }), [s1]);
    expect(state.checkItems.find((c) => c.id === "debts.loans")!.status).toBe("unconfirmed");
    expect(state.checkItems.filter((c) => c.status === "not_applicable" || c.status === "confirmed")).toHaveLength(0);
  });

  it("「借金はありません」はAI確認候補（該当なしの提案）にとどまり、確定は担当者", () => {
    const s1 = seg(1, "借金はありません");
    const { state } = run(newState(), analysis({ check_items: [{ check_item_id: "debts.loans", status: "not_applicable", answer: "借入金なし", evidence_segment_ids: [s1.id], confidence: 0.9 }] }), [s1]);
    const it = state.checkItems.find((c) => c.id === "debts.loans")!;
    expect(it.status).toBe("ai_candidate");
    expect(it.aiProposal).toBe("not_applicable");
  });

  it("担当者が確認済みにした事項に矛盾する発言は、変更せず追加確認候補にする", () => {
    const s1 = seg(1, "借金はありません");
    const s2 = seg(2, "そういえば車のローンが残っていました");
    let { state } = run(newState(), analysis({ check_items: [{ check_item_id: "debts.loans", status: "not_applicable", answer: "借入金なし", evidence_segment_ids: [s1.id], confidence: 0.9 }] }), [s1]);
    const item = state.checkItems.find((c) => c.id === "debts.loans")!;
    Object.assign(item, { status: "not_applicable", lockedByUser: true });
    const { state: after, result } = run(state, analysis({ check_items: [{ check_item_id: "debts.loans", status: "contradiction", answer: "車のローンあり", evidence_segment_ids: [s2.id], confidence: 0.8 }] }), [s1, s2]);
    expect(after.checkItems.find((c) => c.id === "debts.loans")!.status).toBe("not_applicable");
    expect(result.reviewItems).toHaveLength(1);
  });
});

describe("不動産", () => {
  it("「水戸市に自宅の土地と建物があります」で評価資料と未確認項目が登録される", () => {
    const s1 = seg(1, "水戸市に自宅の土地と建物があります");
    const { state } = run(
      newState(),
      analysis({
        entities: [
          entityOp({
            entity_type: "real_estate",
            label: "水戸市の自宅",
            attributes: [
              { key: "location", value: "水戸市" },
              { key: "kinds", value: "土地、建物" },
              { key: "usage", value: "自宅" },
            ],
            evidence_segment_ids: [s1.id],
          }),
        ],
      }),
      [s1],
    );
    const ids = state.documents.filter((d) => d.entityId).map((d) => d.documentId).sort();
    expect(ids).toEqual(["re_maps", "re_nayose", "re_registry", "re_tax_notice", "re_valuation"]);
    const followUps = state.checkItems.filter((c) => c.source === "rule").map((c) => c.templateId).sort();
    expect(followUps).toEqual(["re.address_detail", "re.ownership", "re.residents", "re.usage"]);
    // 利用状況は発言済みなのでAI確認候補、所在地の詳細・所有関係・同居人は未確認
    expect(state.checkItems.find((c) => c.templateId === "re.usage")!.status).toBe("ai_candidate");
    expect(state.checkItems.find((c) => c.templateId === "re.residents")!.status).toBe("unconfirmed");
  });
});
