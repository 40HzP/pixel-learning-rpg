// ゲームの計算：世界（地球と月面・階層の強さ・ザコの出現エリア・10階層ごとの世界・最高到達・地球と月面の行き来）

import { monsterStats } from './stats.js';
import { restartFloor } from './battle.js';

/* ---------- 地球と月面 ---------- */

/** 魔物・世界がどちらの世界のものか（monsters.json・stages.json の world。書いていなければ地球） */
export const worldOf = (x) => (x && x.world) || 'earth';
/** 月面にいるか（ロケットで打ち上げて行く。月面の階層は地球とは別に1から数える） */
export const onMoon = (state) => state.adventure.world === 'moon';

/**
 * 敵の強さを決める階層：地球はその階層。月面は balance.moon.floorOffset ＋ 月面の階層
 * （月面1階層は地球の floorOffset＋1 階層と同じ強さ。ロケットができるころの主人公に合わせた）
 */
export const strengthFloor = (state, ctx) => state.adventure.floor + (onMoon(state) ? ctx.balance.moon.floorOffset : 0);

/**
 * 月面の強さの倍率（40HzP の依頼「月面1階から段階的に強くして」）：月面1階層は1倍で、月面 moon.rampFloor（60）階層まで
 * 階層ごとに同じ割合で増え、rampFloor で moon.rampTo 倍になる。その先は rampTo 倍のまま（地球と同じく1階層ごとに少しずつ強くなる）。
 * 主人公は世代ごとに掛け算で強くなるので、月面も掛け算で強くして、何世代もかけて登る階層にした（60階層は10世代目でやっと越えられる）
 */
export function moonRamp(floor, balance) {
  const m = balance.moon;
  const f = Math.min(Math.max(floor, 1), m.rampFloor);
  return m.rampTo ** ((f - 1) / (m.rampFloor - 1));
}

/** 今いる階層の敵（ザコ）の数値。月面は地球の（floorOffset＋階層）の数値に、HP・攻撃・防御・経験値・ゴールドとも moonRamp を掛ける */
export function floorStats(state, ctx) {
  const s = monsterStats(strengthFloor(state, ctx), ctx.balance);
  if (!onMoon(state)) return s;
  const k = moonRamp(state.adventure.floor, ctx.balance);
  return Object.fromEntries(Object.entries(s).map(([key, v]) => [key, key === 'def' ? Math.round(v * k) : Math.max(1, Math.round(v * k))]));
}

/**
 * 今いる世界に出るザコ（月面には月面のザコだけ、地球には地球のザコだけが出る）。
 * 地球のザコは出現エリア（monsters.json の areas。10階層ごとの世界の名前）が今いる世界のものだけ。
 * 今いる世界に出られるザコが1体もいなければ、地球のザコ全体から選ぶ（設計ページ「出現エリア」）
 */
export function zakoPool(state, ctx) {
  const world = state.adventure.world || 'earth';
  const all = ctx.monsters.filter((m) => m.kind === 'monster' && worldOf(m) === world);
  if (world !== 'earth' || !ctx.stages) return all;
  const stage = currentStage(state, ctx.stages);
  const here = stage ? all.filter((m) => (m.areas || []).includes(stage.name)) : [];
  return here.length ? here : all;
}

/** 世界（stages.json の1件）の階層の範囲 [始まり, 終わり]。最後の世界は終わりが null（その先もずっと続く） */
export function stageRange(stage, stages) {
  const next = (stages || []).filter((s) => worldOf(s) === worldOf(stage) && s.from > stage.from).map((s) => s.from);
  return [stage.from, next.length ? Math.min(...next) - 1 : null];
}

/** ザコの出現エリアの説明（図鑑の未遭遇の札に出す）。例：「はじまりの草原（1〜10階層）」 */
export function areaLabels(m, stages) {
  return (m.areas || []).map((name) => {
    const st = (stages || []).find((s) => s.name === name && worldOf(s) === worldOf(m));
    if (!st) return name;
    const [a, b] = stageRange(st, stages);
    return `${name}（${a}〜${b === null ? '' : b}階層）`;
  });
}

/**
 * その階層の世界（stages.json）。from がその階層以下で一番大きい世界を返す。
 * 最後の世界より先の階層は、最後の世界のまま（世界を足すまで）。
 * world を渡すと、その世界（earth＝地球・moon＝月面。stages.json の world、書いていなければ地球）の中から選ぶ
 */
export function stageFor(floor, stages, world = 'earth') {
  let st = null;
  for (const s of stages || []) if (worldOf(s) === world && floor >= s.from && (!st || s.from > st.from)) st = s;
  return st;
}

/** 今いる階層の世界（地球の10階層ごとの世界か、月面） */
export const currentStage = (state, stages) => stageFor(state.adventure.floor, stages, state.adventure.world || 'earth');

/**
 * 最高到達地点（主人公のステータスに出す。40HzP の依頼）：この人生でいちばん深く進んだ地球の階層とその世界、月面の階層（行っていなければ0）。
 * best・bestMoon は、前世（legacy.lives）も含めたいちばん深い階層と、それが何世代目か（同じ深さなら先の世代）
 */
export function farthestReached(state, stages) {
  const floor = state.life.maxFloor || 1;
  const moon = state.life.moonMaxFloor || 0;
  const lives = [
    ...(state.legacy.lives || []).map((p) => ({ generation: p.generation, floor: p.maxFloor || 1, moon: p.moonFloor || 0 })),
    { generation: state.life.generation, floor, moon },
  ];
  const top = (k) => lives.reduce((a, p) => (p[k] > a[k] ? p : a));
  const best = top('floor'), bestMoon = top('moon');
  return {
    floor, stage: stageFor(floor, stages, 'earth'), moon,
    best: { floor: best.floor, generation: best.generation },
    bestMoon: { floor: bestMoon.moon, generation: bestMoon.generation },
  };
}

/**
 * 地球と月面を行き来する。今いる世界の階層を取っておき、行き先の世界の取っておいた階層の最初から始める
 * （月面は初めてなら1階層）。戦っていた群れや中ボスは退く
 */
export function goToWorld(state, ctx, world) {
  const adv = state.adventure;
  if (world === 'moon') {
    adv.earthFloor = adv.floor;
    adv.world = 'moon';
    restartFloor(state, adv.moonFloor || 1, ctx);
    state.life.moonMaxFloor = Math.max(state.life.moonMaxFloor || 0, adv.floor);
  } else {
    adv.moonFloor = adv.floor;
    adv.world = 'earth';
    restartFloor(state, adv.earthFloor || 1, ctx);
    adv.earthFloor = null;
  }
}
