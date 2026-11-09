// ゲームの計算：階層の移動と、足場（構造工学）

import { fieldActive } from '../fields.js';
import { bossState } from './knowledge.js';
import { worldOf, onMoon, stageFor } from './world.js';
import { restartFloor } from './battle.js';

/** 今いる世界で、この人生で到達した一番深い階層（地球は life.maxFloor、月面は life.moonMaxFloor） */
export const reachedFloor = (state) => Math.max(1, (onMoon(state) ? state.life.moonMaxFloor : state.life.maxFloor) || 1);

/**
 * 階層の移動の行き先：今いる世界の、この人生で到達した階層を、エリア（10階層ごと）に分けて返す。
 * 地球のエリアは10階層ごとの世界（stages.json。101階層から先は天空の神殿が10階層ずつ続く）、月面は月面の10階層ずつ。
 * エリアごとに、出るザコのうち図鑑でまだ出会っていない数（unmet）と、そのエリアのボスを付ける
 */
export function floorAreas(state, ctx) {
  const world = state.adventure.world || 'earth';
  const max = reachedFloor(state);
  const zk = state.knowledge.zukan;
  const met = (m) => (zk[m.id] || {}).stage >= 1;
  const zakoAll = ctx.monsters.filter((m) => m.kind === 'monster' && worldOf(m) === world);
  const areas = [];
  for (let from = 1; from <= max; from += 10) {
    const to = from + 9;
    const stage = world === 'earth' && ctx.stages ? stageFor(from, ctx.stages, 'earth') : null;
    let zako = stage ? zakoAll.filter((m) => (m.areas || []).includes(stage.name)) : zakoAll;
    if (!zako.length) zako = zakoAll;
    const boss = ctx.monsters.find((m) => m.kind === 'boss' && worldOf(m) === world && m.floor >= from && m.floor <= to) || null;
    areas.push({
      from, to, last: Math.min(to, max),
      name: stage ? stage.name : '月面',
      zako: zako.length, unmet: zako.filter((m) => !met(m)).length,
      boss: boss ? { id: boss.id, name: boss.name, floor: boss.floor, defeated: bossState(state, boss.id).status === 'defeated' } : null,
    });
  }
  return areas;
}

/**
 * この人生で到達した階層（今いる世界）に移動する。その階層の最初から始める（戦っていた群れや中ボスは退く）。
 * 一度倒したボスの階層は、ボスの代わりにその世界のザコが出る（いつもと同じ）
 */
export function moveToFloor(state, ctx, floor) {
  const f = Math.floor(floor);
  const max = reachedFloor(state);
  if (!(f >= 1 && f <= max)) return { ok: false, reason: `${onMoon(state) ? '月面' : ''}${max}階層より先には、まだ行ったことがない` };
  if (f === state.adventure.floor && !state.adventure.enemies.some((e) => e.kind === 'midboss')) return { ok: false, reason: `もう${onMoon(state) ? '月面' : ''}${f}階層にいる` };
  restartFloor(state, f, ctx);
  return { ok: true, floor: f, world: state.adventure.world || 'earth' };
}


export const STRUCTURAL = 'structural_engineering';

/** 今出ているボスに与えたダメージ（分かれたブンレツセツは、分かれた2体の残りのHPから） */
export function bossDamage(state, monsterId) {
  const es = state.adventure.enemies.filter((e) => e.kind === 'boss' && e.monsterId === monsterId);
  if (!es.length) return 0;
  const whole = es[0].part ? es[0].wholeMaxHp : es[0].maxHp;
  return Math.max(0, whole - es.reduce((n, e) => n + Math.max(0, e.hp), 0));
}

/**
 * 足場を組む（構造工学を専攻にしていて休眠していないとき）：倒しきれずにボスの前を離れる（やられた・階層を移った・中ボスに挑んだ・ロケットで移った）とき、
 * 与えたダメージを覚えておく。次にそのボスが出たとき、そのダメージを受けた状態で出る（applyScaffold）
 */
export function stashScaffold(state, ctx) {
  if (!fieldActive(state, ctx, STRUCTURAL)) return;
  for (const id of new Set(state.adventure.enemies.filter((e) => e.kind === 'boss').map((e) => e.monsterId))) {
    const dmg = bossDamage(state, id);
    if (dmg > 0) state.scaffold[id] = Math.max(state.scaffold[id] || 0, dmg);
  }
}

/** ボスが出たとき、足場に覚えたダメージを受けた状態にする（構造工学が働いているときだけ） */
export function applyScaffold(state, ctx, e, events) {
  const dmg = state.scaffold[e.monsterId];
  if (!dmg || !fieldActive(state, ctx, STRUCTURAL)) return;
  e.hp = Math.max(1, e.maxHp - dmg);
  events.push({ type: 'scaffold', monsterId: e.monsterId, name: e.name, damage: Math.round(dmg), left: e.hp / e.maxHp });
}
