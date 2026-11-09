// ゲームの計算：寿命と転生（寿命・病院の治療・熟練Lvの上限・世代の倍率・生まれ変わり）

import { MAX_PROFICIENCY } from '../genres.js';
import { createState } from './state.js';
import { ageYears } from './time.js';
import { heroTitles } from './knowledge.js';
import { worldOf } from './world.js';

/** 生まれるたびに決める寿命（lifespanYears ± lifespanSpread 歳） */
export const lifespanFor = (balance, rng) =>
  balance.life.lifespanYears + Math.round((rng() * 2 - 1) * balance.life.lifespanSpread);

/** 今の寿命（歳）：生まれたときに決まった寿命（life.lifespan）＋病院の治療で延びた分 */
export const lifespanOf = (state, balance) => state.life.lifespan + (state.life.treatments || 0) * balance.hospital.extendYears;

/** 体の不調を感じ始める年齢：生まれたときの寿命の life.ailmentYearsBefore 年前（寿命80歳なら70歳。治療で延びた分は数えない） */
export const ailmentAge = (state, balance) => state.life.lifespan - balance.life.ailmentYearsBefore;

/** 冒険画面の主人公を年を取った姿で描くか：体の不調を感じ始めてから（40HzP の依頼）。生まれ変わると若い姿に戻る */
export const heroLooksOld = (state) => !!state.life.ailing;

/**
 * 病院の治療（次の1回）。体の不調を感じ始めてから受けられ、1回ごとに寿命が hospital.extendYears 年延びる。
 * 治療費は hospital.treatmentCosts の順（1回目・2回目…）で、1つの人生で受けられるのはその数まで
 */
export function treatmentInfo(state, ctx) {
  const h = ctx.balance.hospital;
  const count = state.life.treatments || 0;
  const max = h.treatmentCosts.length;
  const cost = count < max ? h.treatmentCosts[count] : null;
  let reason = null;
  if (!state.life.ailing) reason = '体の不調を感じ始めてから受けられる';
  else if (cost == null) reason = 'これ以上の治療はできない';
  else if (state.gold < cost) reason = 'ゴールドが足りません';
  return { count, max, cost, years: h.extendYears, ok: !reason, reason };
}

/** 病院で治療を受ける：治療費を払い、寿命が hospital.extendYears 年延びる */
export function receiveTreatment(state, ctx) {
  const t = treatmentInfo(state, ctx);
  if (!t.ok) return { ok: false, reason: t.reason };
  state.gold -= t.cost;
  state.life.treatments = t.count + 1;
  return { ok: true, cost: t.cost, years: t.years, lifespan: lifespanOf(state, ctx.balance) };
}

/** 熟練Lvの上限：1世代目は MAX_PROFICIENCY（5）。生まれ変わるたびに reincarnation.proficiencyCapStep（5）ずつ上がる（2世代目10・3世代目15…） */
export const proficiencyCap = (state, balance) => MAX_PROFICIENCY + (balance.reincarnation.proficiencyCapStep || 0) * (state.life.generation - 1);

/** 世代の倍率：ステータスの伸び・獲得経験値・獲得ゴールドに掛かる（1世代目は1、2世代目は1.5、3世代目は2.25…） */
export const generationMultiplier = (state, balance) => balance.reincarnation.multiplier ** (state.life.generation - 1);

/**
 * 寿命で亡くなり、次の世代に生まれ変わる。
 * 最初からになるもの：Lv・経験値・ゴールド・品物と装備・仲間（契約も）・会社・中ボス・ボス（倒したボスにもまた会う。40HzP の依頼）・階層（月面にいても地球の1階層から）・年齢。
 * 引き継ぐもの：知識（熟練・累計正解数・間違えたままの問題・過去問復習・図鑑・学際分野と専攻）・称号・名前・ロケット計画の工程・飼育小屋のザコ。
 * 足場（構造工学。ボスに与えたダメージ）はボスと一緒に最初から。
 * 年齢を選ぶまで（meta.startAge＝null）時間は止まる。前世のまとめを返す
 */
export function reincarnate(state, ctx) {
  const b = ctx.balance;
  const prev = {
    generation: state.life.generation, name: state.hero.name, age: ageYears(state),
    level: state.hero.level, maxFloor: state.life.maxFloor || 1, moonFloor: state.life.moonMaxFloor || 0, gold: Math.floor(state.gold),
  };
  state.legacy.titles = [...new Set([...state.legacy.titles, ...heroTitles(state, ctx)])];
  state.legacy.lives.push(prev);
  const fresh = createState(b);
  state.meta = fresh.meta;
  state.life = { ...fresh.life, generation: prev.generation + 1 };
  state.hero = { ...fresh.hero, name: state.hero.name, gender: state.hero.gender }; // 名前と性別は、生まれ変わったときの案内に前のものを入れておく（選び直せる）
  state.gold = 0;
  state.equipment = fresh.equipment;
  state.owned = [];
  state.allies = [];
  state.citationsUsed = 0;
  state.companies = [];
  state.tax = fresh.tax;
  state.adventure = fresh.adventure;
  state.midbosses = {};
  state.bosses = {};
  state.scaffold = {};
  return prev;
}

/**
 * 前のセーブ（生まれ変わっても倒したボスが出なかった版）で、前世で倒したボスにまた会えるようにする。
 * ボスを倒すと次の階層に進むので、この人生で倒したボスは、この人生の最高階層（life.maxFloor）より手前の階層にいる。
 * 最高階層かそれより先の階層のボスは前世で倒したものなので、倒した印を消す。消したボスの id を返す
 * （月面のボスはこの版で入ったので、前の版のセーブには倒した印が無い。月面の階層は数え方が違うので見ない）
 */
export function forgetPastLifeBosses(state, ctx) {
  if (state.life.generation < 2) return [];
  const reached = state.life.maxFloor || 1;
  const back = [];
  for (const m of ctx.monsters) {
    if (m.kind !== 'boss' || worldOf(m) !== 'earth' || m.floor < reached || (state.bosses[m.id] || {}).status !== 'defeated') continue;
    delete state.bosses[m.id];
    back.push(m.id);
  }
  return back;
}
