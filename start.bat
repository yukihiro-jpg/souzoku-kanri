@echo off
rem === 相続管理アプリ 起動用 ===
rem このファイルを index.html と同じフォルダに置いてダブルクリックしてください。
cd /d "%~dp0"
echo ブラウザで http://localhost:8000/ を開きます...
start "" http://localhost:8000/
echo.
echo サーバーを起動します。使い終わったらこのウィンドウを閉じてください。
echo （Python が必要です。未インストールの場合は https://www.python.org/ から
echo  「Add Python to PATH」にチェックを入れてインストールしてください）
echo.
python -m http.server 8000
if errorlevel 9009 py -m http.server 8000
if errorlevel 9009 (
  echo.
  echo Python が見つかりませんでした。上記URLからインストール後、もう一度実行してください。
  pause
)
