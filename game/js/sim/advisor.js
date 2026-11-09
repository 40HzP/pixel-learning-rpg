// ゲームの計算：顧問（仲間にした中ボスを街の施設に置く）

import { bossState } from './knowledge.js';
import { worldOf } from './world.js';
import { partyFull } from './allies.js';

/**
 * 仲間にした中ボスは、街の施設に「顧問」として置ける（設計ページ「仲間にした後の役目（顧問）」。40HzP の依頼）。
 * 置いている間はパーティーから外れて戦わない。効果は1人1つで、置く場所は中ボスごとに決まっている（monsters.json の advisor.place）。
 * 場所ごとに置ける人数は balance.advisor.slots。advisor.soon のある中ボス（税務調査官）は、その仕組みができるまで置けない
 */
export const ADVISOR_PLACES = { school: '学校', lab: '研究室', company: '会社', rocket: 'ロケット発射場' };
export const advisorDef = (ctx, id) => (ctx.monsters.find((m) => m.id === id) || {}).advisor || null;
export const advisorSlots = (ctx, place) => (ctx.balance.advisor.slots || {})[place] || 0;
/** その場所に顧問として置いている仲間 */
export const advisorsAt = (state, ctx, place) => state.allies.filter((a) => a.advisor && (advisorDef(ctx, a.id) || {}).place === place);
/** 中ボスだった仲間（id）を顧問に置いていて、効果が出ているか */
export const advisorActive = (state, ctx, id) => {
  const d = advisorDef(ctx, id);
  return !!d && !d.soon && state.allies.some((a) => a.id === id && a.advisor && !a.hired);
};

/**
 * 中ボスだった仲間を顧問に置く（on=true）・顧問をやめさせる（on=false）。いつでも何度でも変えられる。
 * 置くとパーティーから外れる。やめさせると、パーティーに空きがあればパーティーに、なければ控えに戻る
 */
export function setAdvisor(state, id, on, ctx) {
  const ally = state.allies.find((a) => a.id === id && !a.hired);
  if (!ally) return { ok: false, reason: '中ボスだった仲間ではありません' };
  const d = advisorDef(ctx, id);
  if (!d) return { ok: false, reason: `${ally.name}は顧問にならない` };
  if (!on) {
    if (!ally.advisor) return { ok: false, reason: `${ally.name}は顧問ではありません` };
    delete ally.advisor;
    if (partyFull(state, ctx)) ally.benched = true;
    else delete ally.benched;
    return { ok: true, benched: !!ally.benched };
  }
  if (ally.advisor) return { ok: false, reason: `${ally.name}はもう顧問にいる` };
  if (d.soon) return { ok: false, reason: `${ally.name}の${d.role}は、${d.soon}置ける` };
  const place = ADVISOR_PLACES[d.place];
  if (advisorsAt(state, ctx, d.place).length >= advisorSlots(ctx, d.place)) return { ok: false, reason: `${place}の顧問の枠がいっぱい（今の顧問をやめさせてから置く）` };
  delete ally.benched;
  ally.advisor = true;
  return { ok: true, place };
}

/** 就職面接官（会社の顧問）の人事：社員の効果に掛ける倍率 */
export const hrFactor = (state, ctx) => 1 + (advisorActive(state, ctx, 'interviewer') ? ctx.balance.advisor.hrStaffBonus : 0);

/** ロケットの建造費。政治家（ロケット発射場の顧問）の補助金で balance.advisor.rocketSubsidy の分だけ安くなる */
export const rocketBuildCost = (state, ctx) =>
  Math.round(ctx.balance.rocket.buildCost * (1 - (advisorActive(state, ctx, 'politician') ? ctx.balance.advisor.rocketSubsidy : 0)));

/** 学会の査読者（研究室の顧問）の「要出典」が、次の誕生日までにあと何回使えるか */
export const citationsLeft = (state, ctx) => Math.max(0, ctx.balance.advisor.citationsPerYear - (state.citationsUsed || 0));

/** 次に戦うボス（今いる世界で、この人生でまだ倒していないボスのうち、いちばん手前の階層）。大学教授（研究室の顧問）の予習で使う */
export function nextBoss(state, ctx) {
  const world = state.adventure.world || 'earth';
  return ctx.monsters.filter((m) => m.kind === 'boss' && worldOf(m) === world && bossState(state, m.id).status !== 'defeated')
    .sort((a, b) => a.floor - b.floor)[0] || null;
}
