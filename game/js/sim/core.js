// ゲームの計算：共通の定数（時間の単位・名前の長さ・性別・戦闘を刻む幅）

export const HOURS_PER_YEAR = 8760;
export const HOURS_PER_MONTH = HOURS_PER_YEAR / 12; // 契約料を払う間隔（ゲーム内の1か月）
export const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
export const STEP_SEC = 0.1; // 戦闘を細かく刻む幅（速さ×600でも攻撃の順番が崩れないように）
export const DEFAULT_HERO_NAME = '主人公';
export const HERO_NAME_MAX = 8;
/** 主人公の性別（初回起動時と転生時に選ぶ。40HzP の依頼）。変わるのは見た目（hero_* と heroine_* の絵）と、先生の呼び方（君・さん）だけ */
export const GENDERS = ['male', 'female'];
