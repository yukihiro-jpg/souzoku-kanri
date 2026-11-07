# 確認用Excel（資料マスタ・判定ルール確認表）の作り直し

システムの現在の設定から、確認用Excelを作り直す手順です（税理士の確認・修正依頼用）。

```bash
cd mendan
npx tsx tools/review-sheet/export-masters.ts /tmp/masters.json          # システムの設定を書き出す
python3 tools/review-sheet/build_review_xlsx.py /tmp/masters.json 確認表.xlsx   # Excelを作る
```

前回の判定を引き継ぐ場合は、3番目以降の引数に「前回の判定（JSON）」「対応内容（JSON）」「削除した資料（JSON）」を渡します。
`responses-2026-11-07.json` は第2版を作ったときの対応内容の記録です。
