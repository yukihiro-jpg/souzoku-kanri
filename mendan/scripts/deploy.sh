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
#
#   入口の確認について（組織のポリシー「ドメインで制限された共有」への対応）:
#     kskac.com の組織では「allUsers（だれでも）」に権限を付けられないため、
#     中継サーバーと画面から呼ぶサーバー処理だけは、Google Cloud 側の入口の確認（IAM）を外して公開する
#     （gcloud run ... --no-invoker-iam-check）。
#     その代わり、アプリ自身が毎回確認する:
#       - サーバー処理: Firebase のログイン（ALLOWED_EMAILS に書いたアドレスのみ）
#       - 中継サーバー: サーバー処理が発行した1回限り・2分以内のチケット
#     毎日の録音削除（purgeExpiredAudio）は Google Cloud 側の確認を残したまま。
# =====================================================================
set -euo pipefail

PROJECT="${PROJECT:-gen-lang-client-0548763356}"
REGION="asia-northeast1"                         # Cloud Run・Cloud Functions（東京）
VERTEX_LOCATION="${VERTEX_LOCATION:-global}"     # Vertex AI（gemini-3.5-transcribe-live は global / us / eu のみ提供）
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
if [ "${node_major:-0}" != "22" ]; then
  # Cloud Shell の Node.js が 22 以外のときは、公式サイトから Node.js 22 をホームフォルダに用意する（初回のみ・1分ほど）
  NODE_DIR="$HOME/.mendan-node22"
  if [ ! -x "$NODE_DIR/bin/node" ]; then
    echo "Node.js 22 を用意します（初回のみ）…"
    BASE="https://nodejs.org/dist/latest-v22.x"
    SUMS="$(curl -fsSL "$BASE/SHASUMS256.txt")"
    FILE="$(echo "$SUMS" | grep -oE 'node-v22\.[0-9.]+-linux-x64\.tar\.xz' | head -1)"
    TMP="$(mktemp -d)"
    curl -fsSL -o "$TMP/$FILE" "$BASE/$FILE"
    # 改ざんされていないか確認（公式の SHA256 と一致すること）
    (cd "$TMP" && echo "$SUMS" | grep " ${FILE}\$" | sha256sum -c - >/dev/null)
    rm -rf "$NODE_DIR" && mkdir -p "$NODE_DIR"
    tar -xJf "$TMP/$FILE" -C "$NODE_DIR" --strip-components=1
    rm -rf "$TMP"
  fi
  export PATH="$NODE_DIR/bin:$PATH"
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

step "2b. 標準の作業用アカウント（ビルドとサーバー処理の実行）に必要な権限"
# 新しいプロジェクトでは、Cloud Build と Cloud Functions が使う「Compute Engine の既定のサービスアカウント」に
# 権限が付いていないため、ビルド（ソースの読み込み・イメージの保存）と実行（Firestore・録音データ・ログ）に必要な分だけ付ける
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')"
COMPUTE_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
for ROLE in roles/cloudbuild.builds.builder roles/datastore.user roles/storage.objectAdmin roles/logging.logWriter roles/run.invoker; do
  gcloud projects add-iam-policy-binding "$PROJECT" --member "serviceAccount:${COMPUTE_SA}" --role "$ROLE" --condition None --quiet >/dev/null
done
echo "権限を付けました: ${COMPUTE_SA}（ビルド・Firestore・録音データ・ログ・関数の呼び出し）"
echo "権限の反映を待っています（1分）…"
sleep 60

step "3. 依存パッケージのインストール"
npm ci --no-audit --no-fund

step "4. 文字起こし中継サーバーを Cloud Run（東京）に公開"
( cd relay && npm run build && gcloud run deploy transcribe-relay --source . --region "$REGION" \
    --service-account "$RELAY_SA" --no-invoker-iam-check --timeout 3600 --min-instances 0 --max-instances 5 \
    --set-env-vars "GOOGLE_CLOUD_PROJECT=${PROJECT},VERTEX_LOCATION=${VERTEX_LOCATION}" --quiet )
RELAY_URL="$(gcloud run services describe transcribe-relay --region "$REGION" --format 'value(status.url)')"
echo "中継サーバー: ${RELAY_URL}"

step "5. サーバーの設定ファイル（functions/.env.${PROJECT}）"
ENV_FILE="functions/.env.${PROJECT}"
if [ ! -f "$ENV_FILE" ]; then
  read -rp "ログインを許可する Google Workspace のドメイン（例: kskac.com）: " DOMAIN
  read -rp "最初に管理者にするメールアドレス（例: yukihiro@kskac.com）: " ADMIN
  read -rp "ログインを許可するメールアドレス（カンマ区切り。Enter のみ = 管理者のアドレスだけ）: " ALLOWED
  cat > "$ENV_FILE" <<EOF
ALLOWED_EMAIL_DOMAINS=${DOMAIN}
ALLOWED_EMAILS=${ALLOWED:-$ADMIN}
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
  # 以前の設定ファイルには ALLOWED_EMAILS がないため、管理者のアドレスだけに絞る設定を追加する
  if ! grep -q '^ALLOWED_EMAILS=' "$ENV_FILE"; then
    echo "ALLOWED_EMAILS=$(sed -n 's/^ADMIN_EMAILS=//p' "$ENV_FILE")" >> "$ENV_FILE"
  fi
fi
echo "設定ファイル: ${ENV_FILE}（このファイルは Git に含めません）"
echo "ログインできるアカウント: $(sed -n 's/^ALLOWED_EMAILS=//p' "$ENV_FILE")"
if [ -z "$(sed -n 's/^ALLOWED_EMAILS=//p' "$ENV_FILE")" ]; then
  echo "（ALLOWED_EMAILS が空欄のため、$(sed -n 's/^ALLOWED_EMAIL_DOMAINS=//p' "$ENV_FILE") の全員がログインできます）"
fi

step "6. Firebase へのログイン確認"
# Cloud Shell では、Cloud Shell 自身のログイン（gcloud と同じアカウント）で Firebase を操作する。
# 以前に firebase login した古いログイン情報が残っていると、そちらが優先されて
# 「credentials are no longer valid」で止まるため、先に消しておく（URL を開く手順は不要になる）。
export GOOGLE_CLOUD_QUOTA_PROJECT="$PROJECT"
npx firebase logout >/dev/null 2>&1 || true
if npx firebase projects:list >/dev/null 2>&1; then
  echo "Cloud Shell のログイン（$(gcloud config get-value account 2>/dev/null)）で Firebase を操作します。"
else
  echo "Cloud Shell のログインで Firebase を操作できませんでした。Firebase に直接ログインします。"
  echo "表示される URL をブラウザで開き、事務所のアカウントで許可して、表示されたコードを貼り付けてください。"
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

step "9. セキュリティルールを公開"
echo "途中で「Y/n」と聞かれた場合は、Y を入力して Enter を押してください。"
npx firebase deploy --project "$PROJECT" --only firestore,storage

step "10. サーバー処理（Cloud Functions）を公開（初回は10分ほどかかります）"
# 初回は Firebase が「だれでも呼べる」設定（allUsers）を付けようとして、組織のポリシーで断られる。
# 関数そのものは作られるので、ここでは止めずに次の 11 で入口の確認を外す。
set +e
npx firebase deploy --project "$PROJECT" --only functions
FUNCTIONS_CODE=$?
set -e
if [ "$FUNCTIONS_CODE" -ne 0 ]; then
  echo ""
  echo "※ 上に「Unable to set the invoker for the IAM policy」と出ている場合は想定どおりです（次で対応します）。"
fi

step "11. 画面から呼ぶサーバー処理の入口の確認を外す"
# functions/src/index.ts で公開している関数のうち、毎日の録音削除（スケジュール実行）以外
FUNCTION_NAMES="$(sed -n 's/^export {\(.*\)} from.*/\1/p' functions/src/index.ts | tr ',' '\n' | tr -d ' ' | grep -v '^purgeExpiredAudio$' | grep -v '^$')"
MISSING=""
for NAME in $FUNCTION_NAMES; do
  SVC="$(echo "$NAME" | tr '[:upper:]' '[:lower:]')"
  if gcloud run services describe "$SVC" --region "$REGION" >/dev/null 2>&1; then
    gcloud run services update "$SVC" --region "$REGION" --no-invoker-iam-check --quiet >/dev/null
    echo "  ✔ ${NAME}"
  else
    echo "  ✘ ${NAME}（まだ作られていません）"
    MISSING="${MISSING} ${NAME}"
  fi
done
if [ -n "$MISSING" ]; then
  echo "作られていないサーバー処理があります:${MISSING}"
  echo "10 の表示（または記録ファイル ${LOG_FILE}）に原因が出ています。もう一度 bash scripts/deploy.sh を実行してください。"
  exit 1
fi

step "12. 画面（Hosting）を公開"
npx firebase deploy --project "$PROJECT" --only hosting

step "完了"
echo "画面:            https://${PROJECT}.web.app"
echo "文字起こし中継:  ${RELAY_URL}"
echo "最初に管理者のアカウントでログインし、管理画面 →「専門用語」→「初期語彙を登録」を押してください。"
