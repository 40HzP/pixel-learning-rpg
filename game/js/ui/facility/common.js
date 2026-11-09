// 街の施設の中身（ui/facility/ の各ファイル）が共通で使うもの：画面の要素・入っている施設・書き換える部分（live）、
// 知らせ（say）、作り直し（update）、小さな表示の関数。2026-11-09 に ui/facility.js から分けた
import { canFound } from '../../sim.js';
import { el } from '../dom.js';

/** 街の画面の要素（#screen-facility） */
export let root = null;
/** 'town'（街）か、入っている施設の id（主人公は 'hero'） */
export let view = 'town';
/** 毎回作り直さずに書き換える部分（所持金・HP・買うボタンなど） */
export let live = null;
export const setRoot = (x) => { root = x; };
export const setView = (x) => { view = x; };
export const setLive = (x) => { live = x; };

// 施設の中身を作り直す（ui/facility.js の update。中身のファイルから facility.js を読み込まなくて済むように、ここを通して呼ぶ）
let updater = null;
export const setUpdater = (f) => { updater = f; };
export function update(app, force) { updater(app, force); }

/**
 * 知らせを出す。月面の通信基地で決めたことは「地球へ送信中…」と出て、地球からの返事が balance.moon.relaySec 秒あとに届く
 * （地球と月の往復の通信時間。設計ページ「月面の街」）。効果はすぐに出る。断られたこと（'bad'）は送る前なので、すぐに出す
 */
export function say(app, text, kind = '') {
  if (view !== 'moon_comm' || kind === 'bad') { app.notify(text, kind); return; }
  const sec = app.ctx.balance.moon.relaySec;
  app.notify(`地球へ送信中…（返事まで約${sec}秒）`);
  setTimeout(() => app.notify(`地球から返事：${text}`, kind), sec * 1000);
}

export const note = (text) => el('div', { class: 'muted', style: { fontSize: '14px', marginBottom: '8px' } }, text);

/** 仲間が集まる場所：ゲーム内の1か月ごとに契約料を払って仲間にする */
export const pct = (x) => `${Math.round(x * 100)}%`;
export const genreLv = (s, g) => (s.knowledge.genres[g] || { level: 0 }).level;

/**
 * 条件を満たすまで「準備中」にする施設（id → まだなら解放の条件の文、もう入れるなら null）。
 * 会社：経営学の熟練レベルが1以上で解放（town.json の説明にも書く。もう会社があれば、あとで熟練が下がっても入れる）
 */
const LOCKS = {
  company: (app) => {
    const s = app.state;
    const u = app.ctx.business.unlock;
    if (s.companies.length || canFound(s, app.ctx)) return null;
    return `今の${u.genre}の熟練レベル：${genreLv(s, u.genre)}（勉強で${u.genre}の問題に正解すると上がる）`;
  },
};
export const lockText = (app, id) => (LOCKS[id] ? LOCKS[id](app) : null);
