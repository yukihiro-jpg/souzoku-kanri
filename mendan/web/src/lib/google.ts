/**
 * 顧問モードの Google ドライブ連携（ブラウザ側）
 *  - 連携: Google の許可画面（ポップアップ）でコードを受け取り、サーバーへ渡す（鍵の交換と保存はサーバー）
 *  - ファイル選択: Google の「ファイルを選ぶ」画面（Picker）。選んだファイルだけがアプリから使えるようになる（drive.file）
 * 設定（VITE_GOOGLE_OAUTH_CLIENT_ID など）がない開発環境では、開発用のドキュメントを選ぶ簡易画面になる。
 */
const env = import.meta.env;
export const googleClientId: string = env.VITE_GOOGLE_OAUTH_CLIENT_ID ?? "";
const pickerApiKey: string = env.VITE_GOOGLE_PICKER_API_KEY ?? "";
const projectNumber: string = env.VITE_GOOGLE_PROJECT_NUMBER ?? "";
const SCOPE = "openid email https://www.googleapis.com/auth/drive.file";

export const googleUiConfigured = () => !!googleClientId && !!pickerApiKey && !!projectNumber;

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    google?: any;
    gapi?: any;
  }
}

const loaded = new Map<string, Promise<void>>();
function loadScript(src: string): Promise<void> {
  if (!loaded.has(src)) {
    loaded.set(
      src,
      new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = src;
        s.async = true;
        s.onload = () => resolve();
        s.onerror = () => reject(new Error(`読み込みに失敗しました: ${src}`));
        document.head.appendChild(s);
      }),
    );
  }
  return loaded.get(src)!;
}

/** Google の許可画面を開き、許可のコードを返す（サーバーで更新用の鍵に交換する） */
export async function requestAuthCode(loginHint?: string): Promise<string> {
  await loadScript("https://accounts.google.com/gsi/client");
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initCodeClient({
      client_id: googleClientId,
      scope: SCOPE,
      ux_mode: "popup",
      prompt: "consent",
      ...(loginHint ? { login_hint: loginHint } : {}),
      callback: (r: { code?: string; error?: string }) => (r.code ? resolve(r.code) : reject(new Error(r.error ?? "許可されませんでした"))),
      error_callback: (e: { type?: string }) => reject(new Error(e?.type === "popup_closed" ? "許可の画面が閉じられました" : "許可の画面を開けませんでした（ポップアップを許可してください）")),
    });
    client.requestCode();
  });
}

let accessToken: { token: string; exp: number } | null = null;
async function pickerToken(loginHint?: string): Promise<string> {
  if (accessToken && accessToken.exp > Date.now() + 60_000) return accessToken.token;
  await loadScript("https://accounts.google.com/gsi/client");
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: googleClientId,
      scope: SCOPE,
      prompt: "",
      ...(loginHint ? { login_hint: loginHint } : {}),
      callback: (r: { access_token?: string; expires_in?: number; error?: string }) => {
        if (!r.access_token) return reject(new Error(r.error ?? "許可されませんでした"));
        accessToken = { token: r.access_token, exp: Date.now() + (r.expires_in ?? 3000) * 1000 };
        resolve(r.access_token);
      },
      error_callback: () => reject(new Error("許可の画面を開けませんでした（ポップアップを許可してください）")),
    });
    client.requestAccessToken();
  });
}

export interface PickedFile {
  id: string;
  name: string;
}

/** Google ドキュメントを1つ選ぶ（共有ドライブも可）。キャンセルなら null */
export async function pickGoogleDoc(title: string, loginHint?: string): Promise<PickedFile | null> {
  const token = await pickerToken(loginHint);
  await loadScript("https://apis.google.com/js/api.js");
  await new Promise<void>((r) => window.gapi.load("picker", { callback: () => r() }));
  const g = window.google.picker;
  return new Promise((resolve) => {
    const view = new g.DocsView(g.ViewId.DOCUMENTS).setIncludeFolders(true).setMimeTypes("application/vnd.google-apps.document").setEnableDrives(true);
    const picker = new g.PickerBuilder()
      .setTitle(title)
      .addView(view)
      .addView(new g.DocsView(g.ViewId.RECENTLY_PICKED))
      .enableFeature(g.Feature.SUPPORT_DRIVES)
      .setOAuthToken(token)
      .setDeveloperKey(pickerApiKey)
      .setAppId(projectNumber)
      .setLocale("ja")
      .setCallback((d: { action: string; docs?: { id: string; name: string }[] }) => {
        if (d.action === g.Action.PICKED && d.docs?.[0]) resolve({ id: d.docs[0].id, name: d.docs[0].name });
        else if (d.action === g.Action.CANCEL) resolve(null);
      })
      .build();
    picker.setVisible(true);
  });
}
