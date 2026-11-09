// ゲームの計算：ロケット計画（工程・建造費・打ち上げ）

import { fieldActive, fieldById } from '../fields.js';
import { HOURS_PER_YEAR } from './core.js';
import { onMoon, goToWorld } from './world.js';
import { rocketBuildCost } from './advisor.js';

/**
 * ロケット計画の工程（fields.json の rocketSteps：機体設計・エンジン・軌道計算・打ち上げ許可）。
 * 打ち上げに失敗すると、redoOnFailure の工程（エンジン・推進剤）が0に戻る（launchRocket）。
 * 工程の学際分野を専攻にしていて休眠していない間、ゲーム内の時間で進み、balance.rocket.stepYears 年で完了する。
 * 進み具合は legacy.rocket.steps に残る（生まれ変わっても残る）
 */
export function rocketSteps(state, ctx) {
  const need = ctx.balance.rocket.stepYears * HOURS_PER_YEAR;
  return ((ctx.fields && ctx.fields.rocketSteps) || []).map((st) => {
    const hours = state.legacy.rocket.steps[st.id] || 0;
    return { ...st, fieldDef: fieldById(ctx, st.field), hours, need, done: hours >= need, active: fieldActive(state, ctx, st.field) };
  });
}

export function advanceRocket(state, dt, ctx, events) {
  const hours = dt * ctx.balance.time.gameHoursPerRealSecond;
  for (const st of rocketSteps(state, ctx)) {
    if (st.done || !st.active) continue;
    state.legacy.rocket.steps[st.id] = Math.min(st.need, st.hours + hours);
    if (state.legacy.rocket.steps[st.id] >= st.need) events.push({ type: 'rocketStepDone', id: st.id, name: st.name });
  }
}

/**
 * ロケットの建造費（balance.rocket.buildCost。政治家の補助金があれば rocketBuildCost）を払う。払った工程は転生しても残る（設計ページ「工程ごとに完了を保存する」）
 */
export function payRocketBuildCost(state, ctx) {
  const cost = rocketBuildCost(state, ctx);
  if (state.legacy.rocket.buildCostPaid) return { ok: false, reason: 'もう建造費は払った' };
  if (state.gold < cost) return { ok: false, reason: 'ゴールドが足りません' };
  state.gold -= cost;
  state.legacy.rocket.buildCostPaid = true;
  return { ok: true, cost };
}

/** 打ち上げの成功率が見えるか：確率論（学際分野）を専攻にしていて休眠していない（設計ページ「確率論があれば成功率が見える」） */
export const launchRateVisible = (state, ctx) => fieldActive(state, ctx, 'probability');

/**
 * 本番の打ち上げの成功率：balance.rocket.launchSuccessRate に、試作機で上がった分（legacy.rocket.rateBonus）を足す。
 * 上限は balance.rocket.launchSuccessRateMax
 */
export const launchSuccessRate = (state, ctx) => {
  const r = ctx.balance.rocket;
  return Math.min(r.launchSuccessRateMax, r.launchSuccessRate + (state.legacy.rocket.rateBonus || 0));
};

/**
 * ロケットを打ち上げられるか：建造費を払い、すべての工程が終わっていて、地球にいる。
 * { ok, reason, successRate, rateVisible }（成功率は launchSuccessRate）
 */
export function launchInfo(state, ctx) {
  const r = ctx.balance.rocket;
  const left = rocketSteps(state, ctx).filter((st) => !st.done);
  let reason = null;
  if (onMoon(state)) reason = 'もう月面にいる';
  else if (!state.legacy.rocket.buildCostPaid) reason = '建造費を払うと打ち上げられる';
  else if (left.length) reason = `まだ終わっていない工程：${left.map((st) => st.name).join('・')}`;
  return { ok: !reason, reason, successRate: launchSuccessRate(state, ctx), rateVisible: launchRateVisible(state, ctx) };
}

/**
 * 打ち上げる（地球 → 月面）。打ち上げは無料（建造費は一度払えばよい）。
 * 成功すると月面の階層へ（前に月面にいたら、その階層から）。失敗すると、rocketSteps の redoOnFailure の工程
 * （エンジン・推進剤）だけやり直しになり、地球に残る（設計ページ「失敗するとエンジン・推進剤の工程だけやり直し」）
 */
export function launchRocket(state, ctx) {
  const info = launchInfo(state, ctx);
  if (!info.ok) return { ok: false, reason: info.reason };
  if (ctx.rng() >= info.successRate) {
    const redo = ((ctx.fields && ctx.fields.rocketSteps) || []).filter((st) => st.redoOnFailure);
    for (const st of redo) state.legacy.rocket.steps[st.id] = 0;
    return { ok: true, success: false, redo: redo.map((st) => st.name) };
  }
  goToWorld(state, ctx, 'moon');
  return { ok: true, success: true, floor: state.adventure.floor };
}

/** 月面の街の帰還ロケットで地球に帰る（無料で、いつでも、必ず帰れる）。地球は打ち上げた階層から */
export function returnToEarth(state, ctx) {
  if (!onMoon(state)) return { ok: false, reason: 'もう地球にいる' };
  goToWorld(state, ctx, 'earth');
  return { ok: true, floor: state.adventure.floor };
}
