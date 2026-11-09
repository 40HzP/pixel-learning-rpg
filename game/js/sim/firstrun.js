// ゲームの計算：最初の3分（前世で吹き込まれた噂のザコ・図鑑の数・寿命と経験値の帯・起動から3分の比較）

import { ageYears } from './time.js';
import { heroStats, expToNext } from './stats.js';
import { raiseZukan } from './knowledge.js';
import { lifespanOf } from './life.js';
import { worldOf, zakoPool } from './world.js';
import { makeEnemy } from './battle.js';

// 前世の記憶をたどる（前の名前は常識チェック）の出題と答えは quiz.js（beginFirstRun・answerFirstCheck）。ここは冒険のほう

/** 覚えたザコ（前世で魔物に吹き込まれた噂）を優先して出すのは、その人生の地球のこの階層まで */
export const FIRST_LIFE_FLOORS = 10;

/**
 * 前世の記憶をたどるで覚えたザコ（前世で魔物に吹き込まれた噂）：正解しなかった問題のザコ（答えた順。{ monster, believed }）。
 * believed は誤答1（その魔物の噂そのもの）を選んだとき。誤答2・3と時間切れは false（どれも噂として出る）
 */
export function rememberedZako(state, ctx) {
  const check = state.firstRun && state.firstRun.check;
  const out = [];
  for (const a of (check && check.answers) || []) {
    if (a.kind === 'correct' || !a.monsterId || out.some((x) => x.monster.id === a.monsterId)) continue;
    const m = ctx.monsters.find((x) => x.id === a.monsterId);
    if (m) out.push({ monster: m, believed: a.kind === 'myth' });
  }
  return out;
}

/** 今いる場所で覚えたザコを出すか（前世の記憶をたどった人生の、地球の1〜10階層。生まれ変わるたびに入れ替わる） */
export function rememberedHere(state, ctx) {
  const adv = state.adventure;
  const check = state.firstRun && state.firstRun.check;
  if (!check || (check.generation || 1) !== state.life.generation || worldOf(adv) !== 'earth' || adv.floor > FIRST_LIFE_FLOORS) return [];
  return rememberedZako(state, ctx);
}

/**
 * ザコの群れを選ぶ。最初の人生の1〜10階層では、前世の記憶をたどるで覚えたザコのうちまだ出していないものを先頭に並べ、
 * 残りは今いる世界のザコ（と覚えたザコ）から選ぶ。出したザコは introduced に入れ、misbelief に積む
 */
export function pickZakoGroup(state, ctx, n, misbelief) {
  const remembered = rememberedHere(state, ctx);
  const pool = zakoPool(state, ctx);
  for (const r of remembered) if (!pool.includes(r.monster)) pool.push(r.monster);
  const list = [];
  for (const r of remembered) {
    if (list.length >= n || state.firstRun.introduced.includes(r.monster.id)) continue;
    state.firstRun.introduced.push(r.monster.id);
    list.push(r.monster);
    misbelief.push(r);
  }
  while (list.length < n && pool.length) list.push(pool[Math.floor(ctx.rng() * pool.length)]);
  return list;
}

/**
 * 前世の記憶をたどるで間違えた問題のザコを、答えてすぐ今の群れに出す（ザコの群れと戦っている最中に答えたとき。デバッグの「前世の記憶をたどり直す」など）。
 * 最初の人生の1〜10階層で、ザコの群れと戦っているときだけ。そのザコがもう群れにいればそれに印を付け、
 * いなければ群れのいちばん後ろのザコ（先頭以外）と入れ替える（強さは同じ階層の強さで、HPは満タン）。
 * 入れ替えられる相手がいなければ（先頭の1体だけ）、次の群れの先頭で出る（pickZakoGroup）。出したザコを misbelief の知らせに積む
 */
export function summonRemembered(state, ctx, events) {
  const adv = state.adventure;
  if (!state.firstRun || !adv.enemies.length || adv.enemies.some((e) => e.kind !== 'monster' || e.minion)) return [];
  const introduced = state.firstRun.introduced;
  const out = [];
  for (const r of rememberedHere(state, ctx)) {
    if (introduced.includes(r.monster.id)) continue;
    let e = adv.enemies.find((x) => x.monsterId === r.monster.id);
    let swapped = false;
    if (!e) {
      let i = adv.enemies.length - 1;
      while (i > 0 && introduced.includes(adv.enemies[i].monsterId)) i--;
      if (i <= 0) break;
      const old = adv.enemies[i];
      e = makeEnemy(r.monster, state, ctx, old.slot);
      e.cd = old.cd;
      adv.enemies[i] = e;
      raiseZukan(state, e.monsterId, 1, events);
      swapped = true;
    }
    introduced.push(r.monster.id);
    events.push({ type: 'misbelief', monsterId: r.monster.id, name: r.monster.name, myth: r.monster.myth, believed: r.believed, uid: e.uid, slot: e.slot, swapped });
    out.push(e);
  }
  return out;
}

/** 図鑑のザコ（地球と月面）のうち、正体まで開いた数と全数（初めてザコを倒したときの「1／171」） */
export function zakoZukanCount(state, ctx) {
  const zako = ctx.monsters.filter((m) => m.kind === 'monster');
  const z = state.knowledge.zukan;
  return { opened: zako.filter((m) => (z[m.id] || {}).stage >= 2).length, total: zako.length };
}

/** 寿命の帯（数字は出さない。40HzP の依頼）：今の年齢（誕生日ごとに1つ進む）と寿命（治療で延びた分も） */
export function lifeBar(state, balance) {
  const lifespan = lifespanOf(state, balance);
  return { age: Math.min(ageYears(state), lifespan), lifespan };
}

/**
 * 経験値の帯（40HzP の依頼「寿命バーと同じように、次のレベルまでに必要な量がわかるバー」）：
 * 今のレベルでためた経験値 exp・次のレベルまでに要る量 need・あと rest・たまった割合 ratio（0〜1）
 */
export function expBar(state, balance) {
  const need = expToNext(state.hero.level, balance);
  const exp = Math.max(0, Math.min(state.hero.exp, need));
  return { level: state.hero.level, exp, need, rest: need - exp, ratio: exp / need };
}

/**
 * 起動したときの主人公を覚えておく（起動から3分で「今」と比べる。40HzP の依頼で毎回）。
 * floor・moonFloor はこの人生の最高到達、zukan は図鑑に載った（出会った）魔物の数、correct は累計の正解数
 */
export function heroSnapshot(state, ctx) {
  const hs = heroStats(state, ctx);
  return {
    generation: state.life.generation, level: state.hero.level,
    maxHp: hs.maxHp, maxMp: hs.maxMp, atk: hs.atk, def: hs.def, wis: hs.wis,
    floor: state.life.maxFloor, moonFloor: state.life.moonMaxFloor || 0,
    zukan: Object.values(state.knowledge.zukan).filter((e) => e.stage >= 1).length,
    correct: state.knowledge.totalCorrect,
    barn: Object.fromEntries((state.legacy.barn || []).map((a) => [a.id, a.affinity || 0])), // 飼育小屋のザコの懐き度
  };
}

export const SNAPSHOT_ROWS = [
  ['level', 'Lv'], ['maxHp', 'HP'], ['maxMp', 'MP'], ['atk', '攻撃'], ['def', '防御'], ['wis', '賢さ'],
  ['floor', '最高到達'], ['moonFloor', '最高到達（月面）'],
];

/**
 * 起動したとき（before）と今（after）を比べる：伸びたものだけ（{ key, label, from, to }）と、図鑑に加わった数・正解した数・
 * 懐き度が上がったザコ（affinity：{ id, gain } の上がった量の多い順。起動したあとに小屋に入ったザコは0から数える）。
 * 間に生まれ変わっていたら比べられない（null）
 */
export function compareSnapshots(before, after) {
  if (!before || !after || before.generation !== after.generation) return null;
  const rows = SNAPSHOT_ROWS.filter(([k]) => after[k] > before[k]).map(([key, label]) => ({ key, label, from: before[key], to: after[key] }));
  const was = before.barn || {};
  const affinity = Object.entries(after.barn || {})
    .map(([id, v]) => ({ id, gain: Math.floor(v) - Math.floor(was[id] || 0) }))
    .filter((x) => x.gain > 0)
    .sort((x, y) => y.gain - x.gain);
  return { rows, zukan: Math.max(0, after.zukan - before.zukan), correct: Math.max(0, after.correct - before.correct), affinity };
}
