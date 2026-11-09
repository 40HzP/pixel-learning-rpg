// ゲームの計算：熟練・図鑑・中ボスとボスの記録・称号・作問権

import { GENRES } from '../genres.js';
import { fieldTitles } from '../fields.js';

export function genreState(state, genre) {
  const g = state.knowledge.genres;
  if (!g[genre]) g[genre] = { level: 0, progress: 0, correct: 0, studied: false, idle: 0 };
  return g[genre];
}

export function zukanEntry(state, monsterId) {
  const z = state.knowledge.zukan;
  if (!z[monsterId]) z[monsterId] = { stage: 0, fooled: 0 };
  return z[monsterId];
}

/** 図鑑の段階を上げる（下げない）。上がったら events に積む */
export function raiseZukan(state, monsterId, stage, events) {
  const z = zukanEntry(state, monsterId);
  if (z.stage >= stage) return false;
  z.stage = stage;
  if (events) events.push({ type: 'zukan', monsterId, stage });
  return true;
}

export function midbossState(state, id) {
  if (!state.midbosses[id]) state.midbosses[id] = { status: 'waiting' };
  return state.midbosses[id];
}

/** 中ボスの防御が崩れるまでに要る正解の残り。累計の正解数（中ボスが出る前の正解も含む）で数える */
export const midbossLeft = (state, monster) => Math.max(0, (monster.unlockCorrect || 0) - state.knowledge.totalCorrect);

/**
 * 出ている中ボスのうち、累計の正解数が足りたものの防御を崩す。崩れたら events に積む。
 * 正解したとき（quiz.js）と毎回の tick で呼ぶ（古いセーブや、先に正解を貯めていた場合もここで崩れる）
 */
export function breakMidbosses(state, ctx, events) {
  const broken = [];
  for (const e of state.adventure.enemies) {
    if (e.kind !== 'midboss') continue;
    const st = midbossState(state, e.monsterId);
    const m = ctx.monsters.find((x) => x.id === e.monsterId);
    if (st.status === 'appeared' && m && midbossLeft(state, m) === 0) {
      st.status = 'broken';
      broken.push(e.monsterId);
      if (events) events.push({ type: 'midbossBroken', monsterId: e.monsterId });
    }
  }
  return broken;
}

export function bossState(state, id) {
  if (!state.bosses[id]) state.bosses[id] = { status: 'waiting' };
  return state.bosses[id];
}

/** 称号：中ボスを倒してもらったもの（monsters.json の title。仲間にならない中ボス＝孫）と、解放した学際分野のもの */
export const heroTitles = (state, ctx) => [...new Set([
  ...state.legacy.titles,
  ...ctx.monsters.filter((m) => m.kind === 'midboss' && m.title && midbossState(state, m.id).status === 'defeated').map((m) => m.title),
  ...fieldTitles(state, ctx),
  // 月面を踏破した（月面の最後のボスを倒した）称号。知識なので生まれ変わっても残る
  ...(state.knowledge.moonCleared ? ctx.monsters.filter((m) => m.clear && m.clear.title).map((m) => m.clear.title) : []),
])];


/**
 * 作問権（設計ページ「作問権（いずれか2ジャンルをLv5）：そのジャンルの作問申請ができる。腕のある人だけが投稿するので審査の負担も減る」）。
 * 熟練が balance.authoring.rightsLevel（5）以上のジャンルが rightsGenres（2）つそろうと作問権がもらえ、Lv5 以上のジャンルの問題を作って送れる。
 * そのあと Lv5 に届いたジャンルも足していく。一度もらったジャンルは、誕生日の判定で熟練が下がっても残る（knowledge なので生まれ変わっても残る）。
 * 新しくもらったら authorRights（first：はじめての作問権）
 */
export function updateAuthorRights(state, ctx, events) {
  const a = ctx.balance.authoring;
  const k = state.knowledge;
  const high = GENRES.filter((g) => (k.genres[g] || { level: 0 }).level >= a.rightsLevel);
  const first = k.authorGenres.length === 0;
  if (first && high.length < a.rightsGenres) return;
  const added = high.filter((g) => !k.authorGenres.includes(g));
  if (!added.length) return;
  k.authorGenres.push(...added);
  events.push({ type: 'authorRights', genres: added, first });
}

/** 作問権の進み具合：持っているか・作問できるジャンル・熟練の高いジャンル（作問権がまだ無いときの目安） */
export function authorRightsInfo(state, ctx) {
  const a = ctx.balance.authoring;
  const k = state.knowledge;
  const levels = GENRES.map((g) => ({ genre: g, level: (k.genres[g] || { level: 0 }).level })).filter((x) => x.level > 0).sort((x, y) => y.level - x.level);
  return { granted: k.authorGenres.length > 0, genres: [...k.authorGenres], need: a.rightsGenres, level: a.rightsLevel, reached: levels.filter((x) => x.level >= a.rightsLevel).length, top: levels.slice(0, 5) };
}
