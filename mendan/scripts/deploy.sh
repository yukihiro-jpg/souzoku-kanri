#!/usr/bin/env bash
# =====================================================================
# 相続税 AI面談システムの公開（Google Cloud Shell で実行）
#
#   使い方（Cloud Shell）:
#     git clone -b claude/trusting-wozniak-swj60e https://github.com/yukihiro-jpg/souzoku-kanri.git
#     cd souzoku-kanri/mendan
#     bash scripts/deploy.sh
#
#   2回目以降（更新の反映）は、同じフォルダで
#     git pull && bash scripts/deploy.sh
#
#   行うこと:
#     1. 必要な Google Cloud の機能（API）を有効化
#     2. 文字起こし中継サーバー専用のサービスアカウントを作成（Vertex AI と Firestore だけ使える）
#     3. 文字起こし中継サーバーを Cloud Run（東京）に公開
#     4. サーバーの設定ファイルを作成（初回のみ質問あり）
#     5. Claude の API キーを Secret Manager に登録（初回のみ。入力は画面に表示されません）
#     6. セキュリティルール・サーバー処理（Cloud Functions）・画面（Hosting）を公開
# =====================================================================
set -euo pipefail

PROJECT="${PROJECT:-gen-lang-client-0548763356}"
REGION="asia-northeast1"                         # Cloud Run・Cloud Functions（東京）
VERTEX_LOCATION="${VERTEX_LOCATION:-us-central1}" # Vertex AI（文字起こしモデルが東京で使えれば asia-northeast1 に変更）
RELAY_SA_NAME="transcribe-relay"
RELAY_SA="${RELAY_SA_NAME}@${PROJECT}.iam.gserviceaccount.com"

cd "$(dirname "$0")/.."
step() { printf '\n\033[1;34m== %s\033[0m\n' "$1"; }

# 実行内容を記録（エラーで止まったときは、このファイルの最後を見れば原因が分かる）
LOG_FILE="$HOME/deploy-$(date +%Y%m%d-%H%M%S).log"
exec > >(tee -a "$LOG_FILE") 2>&1
trap 'code=$?; [ $code -ne 0 ] && printf "\n\033[1;31m止まりました（行 %s・終了コード %s）。記録: %s\033[0m\n確認方法: tail -40 %s\n" "$LINENO" "$code" "$LOG_FILE" "$LOG_FILE"' EXIT
echo "記録ファイル: ${LOG_FILE}"

# Cloud Shell のログイン状態を確認（承認画面が出たら「承認」を押す）
if ! gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null | grep -q '@'; then
  echo "Google Cloud にログインしていません。Cloud Shell の承認画面で「承認」を押してから、もう一度実行してください。"
  exit 1
fi

step "0. 準備（プロジェクト: ${PROJECT}）"
gcloud config set project "$PROJECT" >/dev/null
node_major="$(node -v 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/' || echo 0)"
if [ "${node_major:-0}" -lt 22 ]; then
  echo "Node.js 22 を用意します…"
  # nvm は未定義の変数を参照するため、この間だけ厳格モードを外す
  set +u
  # shellcheck disable=SC1091
  source "${NVM_DIR:-$HOME/.nvm}/nvm.sh"
  nvm install 22 >/dev/null
  nvm use 22 >/dev/null
  set -u
fi
echo "Node.js $(node -v)"

step "1. Google Cloud の機能を有効化（初回は数分かかります）"
gcloud services enable \
  aiplatform.googleapis.com run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  cloudfunctions.googleapis.com secretmanager.googleapis.com cloudscheduler.googleapis.com \
  eventarc.googleapis.com pubsub.googleapis.com firestore.googleapis.com firebasestorage.googleapis.com \
  firebaserules.googleapis.com firebasehosting.googleapis.com identitytoolkit.googleapis.com --quiet

step "2. 文字起こし中継サーバー専用のサービスアカウント"
if ! gcloud iam service-accounts describe "$RELAY_SA" >/dev/null 2>&1; then
  gcloud iam service-accounts create "$RELAY_SA_NAME" --display-name "相続面談 文字起こし中継" --quiet
fi
for ROLE in roles/aiplatform.user roles/datastore.user; do
  gcloud projects add-iam-policy-binding "$PROJECT" --member "serviceAccount:${RELAY_SA}" --role "$ROLE" --condition None --quiet >/dev/null
done
echo "権限: Vertex AI の利用・Firestore（チケット確認と使用量の記録）のみ"

step "3. 依存パッケージのインストール"
npm ci --no-audit --no-fund

step "4. 文字起こし中継サーバーを Cloud Run（東京）に公開"
( cd relay && npm run build && gcloud run deploy transcribe-relay --source . --region "$REGION" \
    --service-account "$RELAY_SA" --allow-unauthenticated --timeout 3600 --min-instances 0 --max-instances 5 \
    --set-env-vars "GOOGLE_CLOUD_PROJECT=${PROJECT},VERTEX_LOCATION=${VERTEX_LOCATION}" --quiet )
RELAY_URL="$(gcloud run services describe transcribe-relay --region "$REGION" --format 'value(status.url)')"
echo "中継サーバー: ${RELAY_URL}"

step "5. サーバーの設定ファイル（functions/.env.${PROJECT}）"
ENV_FILE="functions/.env.${PROJECT}"
if [ ! -f "$ENV_FILE" ]; then
  read -rp "ログインを許可する Google Workspace のドメイン（例: kskac.com）: " DOMAIN
  read -rp "最初に管理者にするメールアドレス（例: yukihiro@kskac.com）: " ADMIN
  cat > "$ENV_FILE" <<EOF
ALLOWED_EMAIL_DOMAINS=${DOMAIN}
ADMIN_EMAILS=${ADMIN}
AI_MODE=claude
TRANSCRIBE_MODE=vertex
RELAY_URL=${RELAY_URL}
CLAUDE_MODEL_REALTIME=claude-sonnet-5-5
CLAUDE_MODEL_REVIEW=claude-sonnet-5-5
CLAUDE_EFFORT_REALTIME=low
CLAUDE_EFFORT_REVIEW=high
CLAUDE_FALLBACKS=default
GEMINI_MODEL=gemini-3.5-transcribe-live
GEMINI_LANGUAGE=ja-JP
GEMINI_TRANSCRIPTION_MODE=VERBATIM
GEMINI_DIARIZATION=false
GEMINI_SESSION_RESUMPTION=true
GEMINI_RESPONSE_MODALITIES=TEXT
GEMINI_VOCAB_LIMIT=100
GEMINI_USD_PER_AUDIO_HOUR=0.54
EOF
else
  # 中継サーバーの URL だけは毎回最新にそろえる
  sed -i "s#^RELAY_URL=.*#RELAY_URL=${RELAY_URL}#" "$ENV_FILE"
fi
echo "設定ファイル: ${ENV_FILE}（このファイルは Git に含めません）"

step "6. Firebase へのログイン確認"
if ! npx firebase projects:list >/dev/null 2>&1; then
  echo "Firebase にログインします。表示される URL をブラウザで開き、事務所のアカウントで許可して、表示されたコードを貼り付けてください。"
  npx firebase login --no-localhost
fi

step "7. Claude の API キー（Secret Manager）"
if gcloud secrets describe ANTHROPIC_API_KEY >/dev/null 2>&1; then
  echo "登録済みです（変更する場合: npx firebase functions:secrets:set ANTHROPIC_API_KEY --project ${PROJECT}）"
else
  echo "Claude の API キー（sk-ant- で始まる文字列）を貼り付けて Enter を押してください。入力した文字は画面に表示されません。"
  npx firebase functions:secrets:set ANTHROPIC_API_KEY --project "$PROJECT"
fi

step "8. 画面をビルド"
npm run build -w web

step "9. ルール・サーバー処理・画面を公開"
echo "途中で「Y/n」と聞かれた場合は、Y を入力して Enter を押してください。"
npx firebase deploy --project "$PROJECT" --only firestore,storage,functions,hosting

step "完了"
echo "画面:            https://${PROJECT}.web.app"
echo "文字起こし中継:  ${RELAY_URL}"
echo "最初に管理者のアカウントでログインし、管理画面 →「専門用語」→「初期語彙を登録」を押してください。"
