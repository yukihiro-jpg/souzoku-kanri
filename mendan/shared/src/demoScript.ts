/**
 * 架空の相続面談（デモ再生・動作テスト用）。人物・金額はすべて架空。
 * マイクを使わずに「文字起こし→解析→資料リスト更新」の流れを確認できる。
 */
export interface DemoLine {
  speaker: "staff" | "client";
  text: string;
  /** 前の発言からの間（ミリ秒） */
  pauseMs?: number;
}

export const DEMO_SCRIPT: DemoLine[] = [
  { speaker: "staff", text: "本日はよろしくお願いいたします。まず、お亡くなりになった日を教えていただけますか。" },
  { speaker: "client", text: "はい、父の山田太郎は2026年8月20日に亡くなりました。" },
  { speaker: "staff", text: "ありがとうございます。相続人になる方はどなたですか。" },
  { speaker: "client", text: "相続人は母と私と弟の3人です。" },
  { speaker: "staff", text: "お父様の預金口座はどちらの銀行にありましたか。" },
  { speaker: "client", text: "常陽銀行に普通預金がありました。" },
  { speaker: "client", text: "すみません、常陽銀行ではなく筑波銀行でした。" },
  { speaker: "client", text: "あとはゆうちょ銀行にも定期預金があったと思います。" },
  { speaker: "staff", text: "承知しました。不動産はいかがでしょうか。" },
  { speaker: "client", text: "水戸市に自宅の土地と建物があります。" },
  { speaker: "client", text: "自宅には父と母が二人で住んでいました。" },
  { speaker: "staff", text: "生命保険はありましたか。" },
  { speaker: "client", text: "さくら生命の保険があって、受取人は母です。金額は500万円だったと思います。" },
  { speaker: "staff", text: "借入金やローンはありましたか。" },
  { speaker: "client", text: "借金はありません。" },
  { speaker: "staff", text: "過去に、お父様からお金をもらった方はいらっしゃいますか。" },
  { speaker: "client", text: "孫の教育費として、たぶん5年前くらいに100万円ほど援助してもらったはずです。" },
  { speaker: "client", text: "それと、孫名義の口座に父が毎年お金を入れていた通帳があります。" },
  { speaker: "staff", text: "遺言書はありますか。" },
  { speaker: "client", text: "遺言書があるかどうかは分からないです。" },
];
