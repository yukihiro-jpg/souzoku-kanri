# 設計書（データベース・画面・処理）

## 1. データベース設計（Cloud Firestore）

指示書9の主要データとの対応:

| 指示書の名称 | Firestore のパス | 主な項目 |
|---|---|---|
| Users | `users/{uid}` | email, displayName, role（admin/staff/viewer）, active |
| Cases | `cases/{caseId}` | name, decedentName, inheritanceStartDate, memberIds, members{uid:role}, **consent**（録音・AI同意、説明者、日時、方法） |
| Meetings | `cases/{c}/meetings/{m}` | no, interviewer, status, startedAt/endedAt, lastSeq, gaps（通信断）, audioParts（録音）, aiQuestions, questionsSeq, usage（トークン・音声時間・概算料金）, reanalysis |
| TranscriptSegments | `cases/{c}/meetings/{m}/segments/{segId}` | seq, speaker（staff/client/other/unknown）, speakerLabel, speakerConfirmed, text, kind（speech/system）, suspectedDuplicateOf, analysisStatus, timings（発話開始・暫定表示・確定） |
| Facts | `cases/{c}/entities/{entId}` | type, key（重複判定）, label, assertion（present/absent/unknown/retracted）, attributes{key:{value, evidenceSegmentIds, updatedSeq, source, history}}, status, confidence, lockedByUser, supersedes/supersededBy, history |
| CheckItems | `cases/{c}/checkItems/{id}` | category, question, prompt, priority, status, answer, aiProposal, confidence, evidenceSegmentIds, entityId（財産ごとの追加確認）, lockedByUser, manualBy, history |
| DocumentRequirements | `cases/{c}/documents/{documentId__entityId}` | name, target, reasons, ruleIds/ruleVersions, period, submitter, dueDate, status, decidedBy（rule/user）, evidenceSegmentIds, source/howTo（資料マスタ）, lockedByUser, needsReview, followUp（Phase 4） |
| DocumentRules | `documentRules/{ruleId}`（未登録なら初期ルール） | appliesTo, conditions, exceptions, documentIds, reason, period, importance, followUps, effectiveFrom, version, approval |
| SuggestedQuestions | `meetings/{m}.aiQuestions`（最新の提案）＋ 確認事項から都度算出 | question, checkItemId, priority, reason |
| （追加確認候補） | `cases/{c}/reviewItems/{id}` | kind, title, detail, evidenceSegmentIds, proposal, status |
| AuditLogs | `cases/{c}/auditLogs/{id}` | actor, action, target, detail, at（会話内容は記録しない） |
| AIJobs | `cases/{c}/aiJobs/{jobId}` | kind, segmentIds, maxSeq, status, model, usage, rejected, timings, clientTimings |
| CostLogs | `costLogs/{id}`, 月次集計 `costSummary/{YYYY-MM}` | provider, model, tokens, audioSeconds, usd |
| （設定） | `settings/app`, `vocabulary/{id}`, `documentMaster/{id}`, `notifications/{id}` | 調査方針（取引履歴の年数）、録音保存期間、予算 など |

- 1つの案件に複数の面談。**抽出情報・確認事項・必要資料は案件単位**に持つので、2回目以降の面談でも未確認事項を引き継ぎます。
- 発言IDは `seg_{面談ID末尾6桁}_{連番5桁}` で決定的に作り、同じIDの二重保存はセキュリティルールで拒否します。

## 2. 処理の流れと保証

### リアルタイム解析（`functions/src/analyze.ts`）
1. ブラウザが確定発言を Firestore に保存（`analysisStatus: pending`）
2. 短い発言（14文字未満）は最大1.2秒待って次とまとめ、発言IDのみを `analyzeSegments` に送る（同時2件まで）
3. サーバーは発言本文を Firestore から読み、直近12発言・抽出済み情報・確認状況と一緒に Claude へ送る
4. Claude は Structured Outputs で JSON を返す（zod で型検証）
5. `applyAnalysis`（`shared/src/merge.ts`）をトランザクション内で実行
   - 根拠の発言IDが入力に含まれない事実 → 登録しない（rejected に記録）
   - AI は「確認済み」「該当なし」「必要確定」を設定しない（AI確認候補・要追加確認・矛盾ありまで）
   - `lockedByUser` の情報は変更しない → 差分は追加確認候補（reviewItems）
   - 訂正: 旧実体は `retracted` + `supersededBy`、属性の旧値は `history` に保存
   - 各属性・確認事項に `updatedSeq`（根拠発言の最大seq）を持たせ、**古い解析結果が新しい情報を上書きしない**
   - ルールエンジンで必要資料を再判定し、`documentId × 実体` で一意（重複なし）。根拠がなくなった候補は「削除候補」
6. 画面は Firestore の購読で自動更新。クライアントは反映時刻を `aiJobs.clientTimings` に記録（P50/P95 集計用）

### 文字起こし（`web/src/live/geminiTranscriber.ts`）
- 暫定テキスト（`interimInputTranscription`）は表示専用。確定（`inputTranscription.finished` / `turnComplete`、2.5秒の確定待ち）で1回だけ確定通知
- 直近60秒の送信音声をバッファ。切断時は指数バックオフで再接続し、セッション再開時は `lastConsumedClientMessageIndex` より後、再開不可時は最後の確定以降の音声を再送
- それでも埋まらない区間は「通信断」として発言一覧と面談データに記録（録音で照合）
- 発話があるのに15秒応答がない場合は再接続（無応答の検知）
- 同じ文が20秒以内に再確定した場合は「重複の疑い」として保存し、解析しない

### 面談後の再解析（`functions/src/reanalyze.ts`）
- 文字起こし全文 + 登録済み情報を Claude（effort=high）に渡し、差分（抽出漏れ・反映漏れ・矛盾・質問されなかった事項・不整合・誤認識の疑い）だけを返させる
- 結果は自動反映せず「追加確認候補」に登録。担当者が承認したものだけを反映（承認済み情報の変更もここでのみ可能）

## 3. 資料判定ルール（`shared/src/masters/rules.ts`）

```jsonc
{
  "id": "R-DEP-002", "version": 1, "category": "deposits",
  "appliesTo": { "kind": "entity", "entityType": "bank_account" },   // または { "kind": "case" }
  "conditions": [{ "attr": "deposit_types", "op": "contains", "value": "定期" }],
  "exceptions": [],                                                   // いずれかに該当すれば適用しない
  "documentIds": ["bank_accrued_interest"],                           // 資料マスタのID
  "reason": "{target}に定期預金があると発言があったため",
  "period": { "kind": "as_of_death" },     // as_of_death / years_before_death（調査方針） / fiscal_years / none
  "importance": "medium",
  "followUps": [ /* 財産ごとの追加確認項目（任意） */ ],
  "effectiveFrom": "2024-01-01",
  "approval": { "status": "pending_review", "by": null, "at": null },
  "enabled": true
}
```
- `op`: exists / not_exists / equals / contains / not_contains / contains_any（value を「|」で区切ったいずれかを含む）
- その他の財産（`other_asset`）と特記事項（`situation`）は `kind` 属性の値で資料を出し分けます。種類が当てはまらない財産には汎用の資料（内容・価額がわかる資料）を出します。
- 期間 `gift_addition` は、相続開始日から暦年課税の生前贈与加算の対象期間を自動で算定して表示します。
- 変更すると版が上がり、税理士の再承認待ちになります。設定「税理士承認済みのルールだけを適用する」で未承認ルールを止められます。
- **取引履歴の収集期間**（事務所の調査方針・設定値）と **生前贈与加算の対象期間**（`shared/src/period.ts`、令和5年度改正の段階的延長）は別の値として管理しています。

## 4. 画面設計

| 画面 | パス | 内容 |
|---|---|---|
| ログイン | `/login` | Google ログイン（許可ドメインのみ）。エミュレーター時は開発用ログイン |
| 案件一覧 | `/` | 担当案件一覧、新規作成 |
| 案件 | `/cases/:id` | 概要、確認完了率、**同意の説明文と記録**、面談の開始・履歴、メンバー追加 |
| 面談 | `/cases/:id/meetings/:mid` | 下図 |
| 資料依頼書 | `/cases/:id/print` | 印刷・PDF保存用 |
| 管理画面 | `/admin` | ルール、専門用語、設定、費用・性能、ユーザー |

面談画面（PC横長）:
```
┌───────────────────────────────────────────────────────────────────────────┐
│ 案件名 被相続人 相続開始日 担当 開始 経過 確認完了率 必要資料 未確認 反映○秒 [録音][デモ][終了] │
├──────────────────── 接続状態（録音中／再接続中／通信断 n 回） ─────────────────────┤
│ 左 約47%                              │ 右 約53%                                 │
│ [確認事項][必要資料][未確認・追加質問]   │ リアルタイム文字起こし                      │
│  ・抽出した財産・人物（承認/却下）       │  14:07:05 [相続人] 常陽銀行に…   確定 解析済 │
│  ・カテゴリー別の確認事項               │  14:07:08 [相続人] すみません…   確定 解析中 │
│    状態・回答・信頼度・根拠・操作        │  暫定  水戸市に自宅の…▍                    │
│                                       │                       [最新の発言へ ↓]   │
├───────────────────────────────────────────────────────────────────────────┤
│ 次に確認すべき質問  (1) …  (2) …  (3) …                                         │
└───────────────────────────────────────────────────────────────────────────┘
```
- 左の「根拠」→ 右の該当発言へスクロールして点滅
- 右の発言クリック → 左で対応する項目を黄色枠で強調（件数をバーに表示）
- 話者バッジのクリックで話者を修正（Shift+クリックで同じ話者ラベルの発言すべて）
- 過去の発言を見ている間は自動スクロールを停止
