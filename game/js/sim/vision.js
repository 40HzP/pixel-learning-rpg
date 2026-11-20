// ゲームの計算：色の見え方が違う人生（設計ページ「色の見え方が違う人生（2026-11-20）」）。
// 生まれ変わって始まりの画面で性別を選ぶと、現実と同じ確率で、その人生の色の見え方が決まる（1型・2型・3型。
// 確率は balance.vision の性別ごとの表。vision.fromGeneration 世代目から）。強さ・ゴールド・経験値には一切効かせない。
// 生まれた瞬間には知らせず、7歳の小学校教師の場面（monsters.json の visionCheck を付けた中ボスが出てくるとき）で分かる。
// 画面のフィルタは ui/vision.js、フィルタの行列は colorsim.js

import { VISION_TYPES } from '../colorsim.js';
import { fieldActive } from '../fields.js';
import { logProficiency } from './birthday.js';

/** 性別ごとの確率：{ protan（1型）, deutan（2型）, tritan（3型） }（balance.vision の male・female） */
export const visionChances = (ctx, gender) => ctx.balance.vision[gender === 'female' ? 'female' : 'male'];

/** この人生で色の見え方を決めるか（vision.fromGeneration 世代目から） */
export const rollsVision = (state, ctx) => state.life.generation >= ctx.balance.vision.fromGeneration;

/** 確率論（数学＋統計学）を専攻にしていると、生まれ変わるときの確率が見える（設計ページの案。ロケットの成功率と同じ） */
export const visionChancesVisible = (state, ctx) => fieldActive(state, ctx, 'probability');

/**
 * 始まりの画面で性別を選んで人生が始まったとき：その人生の色の見え方を決める（rng を1回使う。決めない世代では使わない）。
 * 決まった型（'protan'・'deutan'・'tritan'）か、ふつうの見え方なら null を返す
 */
export function rollVision(state, ctx, rng = ctx.rng) {
  state.life.vision = null;
  state.life.visionKnown = false;
  if (!rollsVision(state, ctx)) return null;
  const ch = visionChances(ctx, state.hero.gender);
  let r = rng();
  for (const t of VISION_TYPES) {
    const p = ch[t] || 0;
    if (r < p) { state.life.vision = t; break; }
    r -= p;
  }
  return state.life.vision;
}

/**
 * 学校の色覚検査（小学校教師が出てくる場面）：その人生の色の見え方が分かる。一度だけ。
 * 熟練の記録に1行（{ vision, reason: 'check' }）残し、visionCheck を events に積む（ミニムービーは ui/scenes.js）。ふつうの見え方の人生では何もしない
 */
export function checkVision(state, ctx, events, monsterId = null) {
  const v = state.life.vision;
  if (!v || state.life.visionKnown) return false;
  state.life.visionKnown = true;
  logProficiency(state, { vision: v, reason: 'check' });
  events.push({ type: 'visionCheck', vision: v, monsterId });
  return true;
}
