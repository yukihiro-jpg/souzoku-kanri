import json, sys, re
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.utils import get_column_letter

d = json.load(open(sys.argv[1]))
OUT = sys.argv[2]
PREV = json.load(open(sys.argv[3])) if len(sys.argv) > 3 else {}
RESP = json.load(open(sys.argv[4])) if len(sys.argv) > 4 else {}
REMOVED = json.load(open(sys.argv[5])) if len(sys.argv) > 5 else []
EX_BY_DOC = {"shinkin_capital": "水戸信用金庫", "retirement_notice": "株式会社山田商事", "car_docs": "トヨタ・プリウス", "membership_docs": "水戸ゴルフクラブ",
  "loan_receivable": "長男への貸付金", "valuables_docs": "絵画", "receivable_docs": "所得税の還付金", "crypto_docs": "ビットコイン", "emoney_docs": "PayPay残高",
  "gold_docs": "純金積立", "foreign_assets": "米国の証券口座", "solar_docs": "自宅の太陽光発電", "safe_box": "常陽銀行", "other_asset_eval": "会話で出た財産の名前",
  "debt_balance": "常陽銀行の住宅ローン", "debt_contract": "個人からの借入金", "card_statement": "クレジットカード", "nominee_property": "長男名義の土地", "nominee_passbook": "孫名義の預金",
  "fuhyo_heirs": "長男", "predeceased_koseki": "長男", "overseas_heir_docs": "次男", "renunciation_cert": "次男", "ienaki_lease": "長男", "disability_card": "長女", "annuity_docs": "日本生命"}
EX_BY_CAT = {"deposits": "常陽銀行", "real_estate": "水戸市の自宅", "securities": "野村證券", "unlisted": "株式会社山田商事", "insurance": "日本生命", "gifts": "長男", "other_assets": "会話で出た財産の名前", "misc": "米国の証券口座"}
EX_BY_TYPE = {"bank_account": "常陽銀行", "real_estate": "水戸市の自宅", "listed_security": "野村證券", "unlisted_share": "株式会社山田商事", "life_insurance": "日本生命", "retirement_allowance": "株式会社山田商事",
  "other_asset": "会話で出た財産の名前", "debt": "常陽銀行の住宅ローン", "lifetime_gift": "長男", "nominee_deposit": "孫名義の預金", "situation": "長男", "heir": "長男", "decedent": "被相続人"}
def ex_doc(x, text):
    e = EX_BY_DOC.get(x["id"]) or EX_BY_CAT.get(x["category"], "対象の名前")
    return text.replace("{target}", f"［{e}］")
def ex_type(t, text):
    return text.replace("{target}", f"［{EX_BY_TYPE.get(t, '対象の名前')}］")
FONT = "游ゴシック"
CAT = {c["id"]: f'{c["no"]}. {c["label"]}' for c in d["CATEGORIES"]}
CATNO = {c["id"]: c["no"] for c in d["CATEGORIES"]}
ETL = d["ENTITY_TYPE_LABELS"]
SPECS = d["ENTITY_SPECS"]
DOCS = {x["id"]: x for x in d["DOCUMENT_MASTER"]}
PRI = {"high": "高", "medium": "中", "low": "低"}
YEARS = d["DEFAULT_SETTINGS"]["transactionHistoryYears"]

thin = Side(style="thin", color="BFBFBF")
BORDER = Border(left=thin, right=thin, top=thin, bottom=thin)
HEAD_FILL = PatternFill("solid", fgColor="1F4E78")
INPUT_FILL = PatternFill("solid", fgColor="FFFF00")
INPUT_HEAD_FILL = PatternFill("solid", fgColor="BF8F00")
BASE = Font(name=FONT, size=10)
WRAP = Alignment(wrap_text=True, vertical="top")
JUDGE = ["OK", "修正", "不要", "要相談"]

def attr_label(etype, attr):
    a = SPECS.get(etype, {}).get("attributes", {}).get(attr, attr)
    return re.split(r"[（(]", a)[0]

def cond_text(etype, c):
    lab = attr_label(etype, c["attr"])
    v = c.get("value", "")
    op = c["op"]
    if op == "exists": return f"「{lab}」の発言がある"
    if op == "not_exists": return f"「{lab}」の発言がない"
    if op == "equals": return f"「{lab}」が「{v}」"
    if op == "contains": return f"「{lab}」に「{v}」を含む"
    if op == "not_contains": return f"「{lab}」に「{v}」を含まない"
    if op == "contains_any": return f"「{lab}」に「{'・'.join(v.split('|'))}」のいずれかを含む"
    return str(c)

def period_text(p):
    k = p["kind"]
    if k == "as_of_death": return "相続開始日時点"
    if k == "years_before_death": return f"相続開始前{p.get('years') or YEARS}年間（事務所の調査方針。設定で変更可）"
    if k == "fiscal_years": return f"相続開始直前の{p.get('years', 3)}期分"
    if k == "gift_addition": return "暦年贈与の加算対象期間（相続開始日から自動計算：2026年までの相続は3年、以後段階的に7年）。精算課税は選択年以後すべて"
    return "－"

def target_text(r):
    a = r["appliesTo"]
    return "すべての案件" if a["kind"] == "case" else f"{ETL[a['entityType']]}の話が出たとき"

def setup(ws, headers, widths, input_cols):
    ws.append(headers)
    for i, (h, w) in enumerate(zip(headers, widths), 1):
        c = ws.cell(row=1, column=i)
        c.font = Font(name=FONT, size=10, bold=True, color="FFFFFF")
        c.fill = INPUT_HEAD_FILL if i in input_cols else HEAD_FILL
        c.alignment = Alignment(wrap_text=True, vertical="center", horizontal="center")
        c.border = BORDER
        ws.column_dimensions[get_column_letter(i)].width = w
    ws.row_dimensions[1].height = 32
    ws.freeze_panes = "B2"
    ws.page_setup.orientation = "landscape"
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.print_title_rows = "1:1"

def finish(ws, input_cols, judge_col):
    n = ws.max_row
    for row in ws.iter_rows(min_row=2, max_row=n):
        for c in row:
            c.font = BASE
            c.alignment = WRAP
            c.border = BORDER
            if c.column in input_cols:
                c.fill = INPUT_FILL
    dv = DataValidation(type="list", formula1='"' + ",".join(JUDGE) + '"', allow_blank=True, showErrorMessage=True, errorTitle="判定", error="OK・修正・不要・要相談 から選んでください")
    ws.add_data_validation(dv)
    col = get_column_letter(judge_col)
    dv.add(f"{col}2:{col}{n}")
    ws.auto_filter.ref = f"A1:{get_column_letter(ws.max_column)}{n}"

wb = Workbook()

# ===== はじめに =====
intro = wb.active
intro.title = "はじめに"

# ===== ① 必要資料 =====
ws1 = wb.create_sheet("①必要資料")
h1 = ["No", "カテゴリー", "資料名（相続人へのご案内に表示）", "取得先", "取得方法（相続人向けの説明）", "提出者", "単位", "この資料が追加される条件", "資料ID", "判定", "修正内容・コメント", "前回のご指摘と対応"]
setup(ws1, h1, [5, 16, 34, 22, 60, 12, 10, 34, 18, 9, 36, 44], {10, 11})
rules_by_doc = {}
for r in d["DEFAULT_RULES"]:
    for doc in r["documentIds"]:
        rules_by_doc.setdefault(doc, []).append(r)
docs_sorted = sorted(d["DOCUMENT_MASTER"], key=lambda x: (CATNO[x["category"]], d["DOCUMENT_MASTER"].index(x)))
for i, x in enumerate(docs_sorted, 1):
    rs = rules_by_doc.get(x["id"], [])
    when = "\n".join(f"・{r['title']}（{target_text(r)}）［{r['id']}］" for r in rs) or "（手動追加のみ）"
    name = ex_doc(x, x["name"])
    src = ex_doc(x, x["source"])
    pj, pc = PREV.get("①必要資料", {}).get(x["id"], [None, None])
    resp = RESP.get(x["id"])
    hist = f"【前回】{pj}：{pc or ''}\n【対応】{resp}" if resp else ""
    ws1.append([i, CAT[x["category"]], name, src, x["howTo"], x["defaultSubmitter"], "案件に1つ" if x.get("perCase") else "財産ごと", when, x["id"], None if resp else pj, None, hist])
    if resp:
        for col in range(1, 10): ws1.cell(row=ws1.max_row, column=col).fill = PatternFill("solid", fgColor="FCE4D6")
finish(ws1, {10, 11}, 10)
for r in range(2, ws1.max_row + 1):
    ws1.cell(r, 12).font = Font(name=FONT, size=9, color="7F3F00")

# ===== ② 判定ルール =====
ws2 = wb.create_sheet("②判定ルール")
h2 = ["ルールID", "カテゴリー", "ルール名", "対象", "適用する条件", "適用しない条件（除外）", "追加される資料", "必要な理由（画面に表示）", "対象期間", "重要度", "判定", "修正内容・コメント"]
setup(ws2, h2, [14, 16, 22, 20, 34, 30, 44, 40, 26, 7, 9, 36], {11, 12})
for r in sorted(d["DEFAULT_RULES"], key=lambda r: (CATNO[r["category"]], d["DEFAULT_RULES"].index(r))):
    et = r["appliesTo"].get("entityType")
    conds = "\n".join(cond_text(et, c) for c in r["conditions"]) or ("常に" if r["appliesTo"]["kind"] == "case" else "その財産の話が出れば常に")
    exc = "\n".join(cond_text(et, c) for c in r["exceptions"]) or "－"
    docs = "\n".join("・" + ex_doc(DOCS[x], DOCS[x]["name"]) for x in r["documentIds"])
    reason = re.sub(r"\{(\w+)\}", lambda m: f"［{EX_BY_TYPE.get(et, '対象の名前')}］" if m.group(1) == "target" else f"（{attr_label(et, m.group(1))}）", r["reason"])
    pj, pc = PREV.get("②判定ルール", {}).get(r["id"], [None, None])
    ws2.append([r["id"], CAT[r["category"]], r["title"], target_text(r), conds, exc, docs, reason, period_text(r["period"]), PRI[r["importance"]], pj, pc])
finish(ws2, {11, 12}, 11)

# ===== ③ 確認事項 =====
ws3 = wb.create_sheet("③確認事項")
h3 = ["ID", "カテゴリー", "確認事項", "担当者の質問例（画面下部に表示）", "重要度", "自動で「AI確認候補」になる条件", "判定", "修正内容・コメント"]
setup(ws3, h3, [26, 18, 40, 52, 7, 40, 9, 36], {7, 8})
for c in d["CHECK_ITEM_MASTER"]:
    auto = [f"{ETL[t]}の話が出たとき" for t in c.get("autoFromEntityTypes", [])]
    for a in c.get("autoFrom", []):
        lab = attr_label(a["type"], a["attr"])
        if a.get("any"): auto.append(f"{ETL[a['type']]}の「{lab}」に「{'・'.join(a['any'].split('|'))}」のいずれかを含む")
        elif a.get("notAny"): auto.append(f"{ETL[a['type']]}の「{lab}」が「{'・'.join(a['notAny'].split('|'))}」以外")
        else: auto.append(f"{ETL[a['type']]}の「{lab}」の発言がある")
    pj, pc = PREV.get("③確認事項", {}).get(c["id"], [None, None])
    ws3.append([c["id"], CAT[c["category"]], c["question"], c["prompt"], PRI[c["priority"]], "\n".join(auto) or "（会話の回答内容からAIが判断）", pj, pc])
finish(ws3, {7, 8}, 7)

# ===== ④ 財産ごとの追加確認 =====
ws4 = wb.create_sheet("④財産ごとの追加確認")
h4 = ["ルールID", "財産の種類", "追加される確認事項", "担当者の質問例", "重要度", "回答済みとみなす情報", "判定", "修正内容・コメント"]
setup(ws4, h4, [14, 16, 40, 46, 7, 22, 9, 36], {7, 8})
for r in d["DEFAULT_RULES"]:
    for f in r.get("followUps") or []:
        et = r["appliesTo"]["entityType"]
        prevkey = r["id"] + "#" + f["question"].replace("{target}", "〇〇")
        pj, pc = PREV.get("④財産ごとの追加確認", {}).get(prevkey, [None, None])
        ws4.append([r["id"], ETL[et], ex_type(et, f["question"]), ex_type(et, f["prompt"]), PRI[f["priority"]], attr_label(et, f.get("answeredByAttr", "")) if f.get("answeredByAttr") else "－", pj, pc])
finish(ws4, {7, 8}, 7)

# ===== ⑤ 追加してほしい資料 =====
ws5 = wb.create_sheet("⑤追加したい資料")
h5 = ["No", "資料名", "どんなときに必要か（会話の内容）", "取得先", "取得方法（相続人向けの説明）", "提出者", "備考"]
setup(ws5, h5, [5, 30, 36, 22, 50, 12, 30], set(range(2, 8)))
for i in range(1, 21):
    ws5.append([i, None, None, None, None, None, None])
for row in ws5.iter_rows(min_row=2, max_row=ws5.max_row):
    for c in row:
        c.font = BASE; c.alignment = WRAP; c.border = BORDER
        if c.column >= 2: c.fill = INPUT_FILL

# ===== はじめに（説明・進捗） =====
B = Font(name=FONT, size=10)
intro.column_dimensions["A"].width = 26
for col in "BCDEFG": intro.column_dimensions[col].width = 13
intro["A1"] = "相続税AI面談システム　資料マスタ・判定ルール確認表（第2版）"
intro["A1"].font = Font(name=FONT, size=14, bold=True)
lines = [
    "この表は、システムが実際に使っている「必要資料」「判定ルール」「確認事項」をそのまま一覧にしたものです（2026年11月7日時点・第2版）。前回の判定は引き継いでいます。",
    "内容は事務所の資料収集ガイド（guide.pdf）をもとに、説明文を事務所の言葉で書き直し、現行制度に合わせて更新しています。事務所による取得代行の案内は入れていません。",
    "",
    "【確認のしかた】",
    "1. 各シートの黄色の列（判定・修正内容・コメント）だけを記入してください。他の列は変更しないでください。",
    "2. 「判定」はセルを選ぶと出る▼から選びます：OK ／ 修正 ／ 不要 ／ 要相談",
    "3. 「修正」の場合は、直したい内容を普段の言葉で「修正内容・コメント」に書いてください。",
    "4. 足りない資料は「⑤追加したい資料」シートに書いてください。",
    "5. ［ ］の中は例です（例：［常陽銀行］）。実際のご案内では、面談で出てきた金融機関名・所在地・人の名前などが自動で入ります。",
    "6. 前回「修正」「要相談」「不要」とされた項目は、①必要資料シートでオレンジ色の行になっています。右端の「前回のご指摘と対応」を見て、判定を付け直してください。",
    "",
    "【記入例】（①必要資料シートの場合）",
]
r = 3
for t in lines:
    intro.cell(row=r, column=1, value=t).font = Font(name=FONT, size=10, bold=t.startswith("【"))
    r += 1
ex_head = ["資料名", "判定", "修正内容・コメント"]
ex_rows = [["［常陽銀行］の残高証明書（相続開始日時点）", "修正", "「すべての口座を記載するよう依頼」の一文は残し、外貨預金の例は削除してほしい"],
           ["住宅地図（該当部分）", "不要", "当事務所では使っていないため"]]
for j, h in enumerate(ex_head):
    c = intro.cell(row=r, column=1 + j * 2 if j else 1, value=h)
for rr, vals in enumerate([ex_head] + ex_rows):
    intro.cell(row=r + rr, column=1, value=vals[0])
    intro.cell(row=r + rr, column=2, value=vals[1])
    intro.cell(row=r + rr, column=3, value=vals[2])
    for col in (1, 2, 3):
        c = intro.cell(row=r + rr, column=col)
        c.font = Font(name=FONT, size=10, bold=(rr == 0), color="FFFFFF" if rr == 0 else "000000")
        c.fill = HEAD_FILL if rr == 0 else (INPUT_FILL if col > 1 else PatternFill())
        c.border = BORDER
        c.alignment = WRAP
    intro.merge_cells(start_row=r + rr, start_column=3, end_row=r + rr, end_column=7)
    intro.row_dimensions[r + rr].height = 30 if rr else 18
r += len(ex_rows) + 2

intro.cell(row=r, column=1, value="【確認の進み具合】（自動集計）").font = Font(name=FONT, size=10, bold=True)
r += 1
heads = ["シート", "件数", "OK", "修正", "不要", "要相談", "未記入"]
for j, h in enumerate(heads, 1):
    c = intro.cell(row=r, column=j, value=h)
    c.font = Font(name=FONT, size=10, bold=True, color="FFFFFF"); c.fill = HEAD_FILL; c.border = BORDER
    c.alignment = Alignment(horizontal="center")
sheets = [("①必要資料", ws1, "I", "J"), ("②判定ルール", ws2, "A", "K"), ("③確認事項", ws3, "A", "G"), ("④財産ごとの追加確認", ws4, "A", "G")]
first = r + 1
for name, ws, idcol, jcol in sheets:
    r += 1
    n = ws.max_row
    q = f"'{name}'"
    vals = [name,
            f"=COUNTA({q}!{idcol}2:{idcol}{n})",
            f'=COUNTIF({q}!{jcol}2:{jcol}{n},"OK")',
            f'=COUNTIF({q}!{jcol}2:{jcol}{n},"修正")',
            f'=COUNTIF({q}!{jcol}2:{jcol}{n},"不要")',
            f'=COUNTIF({q}!{jcol}2:{jcol}{n},"要相談")',
            f"=B{r}-COUNTA({q}!{jcol}2:{jcol}{n})"]
    for j, v in enumerate(vals, 1):
        c = intro.cell(row=r, column=j, value=v); c.font = B; c.border = BORDER
r += 1
intro.cell(row=r, column=1, value="合計").font = Font(name=FONT, size=10, bold=True)
for j in range(2, 8):
    col = get_column_letter(j)
    c = intro.cell(row=r, column=j, value=f"=SUM({col}{first}:{col}{r-1})")
    c.font = Font(name=FONT, size=10, bold=True); c.border = BORDER
intro.cell(row=r, column=1).border = BORDER
r += 2
notes = [
    "【補足】",
    f"・取引履歴・通帳の対象期間は「相続開始前{YEARS}年間」（ガイドの「過去5年分」に合わせた事務所の調査方針）。管理画面の設定で変更できます。",
    "・生前贈与の対象期間は、相続税法の改正（加算期間の3年→7年への段階的延長）に合わせて相続開始日から自動計算します。",
    "・判定ルールは確認表第2版（2026-11-07）で承認済みです。管理画面でルールを変更すると、版が上がり再承認待ちになります。",
    "・必要資料はAIではなくこのルールで決まります。AIは会話から事実（財産・人物・回答）を抜き出す役割だけです。",
]
if REMOVED:
    notes.append("・前回「不要」とされたため削除した資料：" + "、".join(REMOVED))
for t in notes:
    intro.cell(row=r, column=1, value=t).font = Font(name=FONT, size=10, bold=t.startswith("【"))
    r += 1
intro.sheet_view.showGridLines = False

wb.save(OUT)
print("saved", OUT, ws1.max_row - 1, ws2.max_row - 1, ws3.max_row - 1, ws4.max_row - 1)
