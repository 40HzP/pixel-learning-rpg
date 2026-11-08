import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  tick, spawnGroup, damageEnemy, frontEnemy, reincarnate, launchInfo, launchSuccessRate, rocketSteps, HOURS_PER_YEAR,
  tameZako, barnAnimals, barnCapacity, isSpaceDog, prototypeEffect, prototypeInfo, flyPrototype, launchRocket,
} from '../js/sim.js';
import { serialize, deserialize } from '../js/save.js';
import { balance, monsters, fields, makeCtx, newGame, constRng } from './helpers.js';

const byName = (name) => monsters.find((m) => m.name === name);
const DOG = byName('イヌハモノクロ');
const MOON_DOG = byName('ツキボエ');
const MONKEY = byName('サルカラニンゲン');
const TURTLE = byName('コウラヌギ');
const SPIDER = byName('クモコンチュウ');
const PLAIN = monsters.find((m) => m.kind === 'monster' && !m.world && !m.space);
const STEP_HOURS = balance.rocket.stepYears * HOURS_PER_YEAR;
const pr = balance.rocket.prototype;

/** 機体設計の工程を終えたことにする（試作機を飛ばせる） */
function airframeDone(s) {
  s.legacy.rocket.steps.airframe = STEP_HOURS;
}
/** ザコを小屋に入れ、試作機の費用を持たせる */
function ready(s, ctx, ...ids) {
  airframeDone(s);
  for (const id of ids) assert.equal(tameZako(s, ctx, id, [], true), true, id);
  s.gold = pr.cost * 10;
}

test('データ：宇宙を飛んだ生き物のザコ（犬2体・サル・カメ・クモ2体）と、効果の工程', () => {
  const space = monsters.filter((m) => m.space);
  assert.deepEqual(space.map((m) => m.name).sort(), ['イヌハモノクロ', 'クモコンチュウ', 'コウラヌギ', 'サルカラニンゲン', 'ツキボエ', 'ネゴハチグモ'].sort());
  assert.ok(isSpaceDog(DOG) && isSpaceDog(MOON_DOG));
  assert.equal(MOON_DOG.world, 'moon');
  const stepIds = fields.rocketSteps.map((st) => st.id);
  for (const m of space) {
    assert.equal(m.kind, 'monster', m.name);
    assert.ok(m.space.history && m.space.history.startsWith(isSpaceDog(m) ? (m.world ? 'オオカミは犬の仲間。史実：' : '史実：') : '史実：'), m.name);
    // 動物が死んだ話はゲームの中で出さない（設計ページ）
    assert.ok(!/死|亡|ライカ/.test(m.space.history), m.name);
    if (!isSpaceDog(m)) assert.ok(stepIds.includes(m.space.step), m.name);
  }
  assert.equal(MONKEY.space.step, 'permit');
  assert.equal(TURTLE.space.step, 'orbit');
  assert.equal(SPIDER.space.step, 'airframe');
  // エンジン・推進剤の工程は、動物では進まない
  assert.ok(!space.some((m) => m.space.step === 'engine'));
  assert.ok(balance.barn.joinChance > 0 && balance.barn.joinChance <= 0.05);
});

test('ザコを倒すと balance.barn.joinChance の確率でなついて、飼育小屋に入る（同じザコは1体まで）', () => {
  const s = newGame(7);
  const ctx = makeCtx(constRng(0));            // 0 < joinChance：必ずなつく
  spawnGroup(s, ctx, [], [PLAIN.id]);
  const events = [];
  damageEnemy(s, 1e9, ctx, events, 'quiz', frontEnemy(s));
  const join = events.find((e) => e.type === 'barnJoin');
  assert.ok(join);
  assert.equal(join.monsterId, PLAIN.id);
  assert.equal(join.barn, '飼育小屋');
  assert.deepEqual(barnAnimals(s, ctx, 'earth').map((a) => a.id), [PLAIN.id]);
  // 同じザコはもう入らない
  spawnGroup(s, ctx, [], [PLAIN.id]);
  const again = [];
  damageEnemy(s, 1e9, ctx, again, 'quiz', frontEnemy(s));
  assert.ok(!again.some((e) => e.type === 'barnJoin'));
  assert.equal(s.legacy.barn.length, 1);
  // 確率に外れると入らない
  const s2 = newGame(7);
  const ctx2 = makeCtx(constRng(balance.barn.joinChance));
  spawnGroup(s2, ctx2, [], [PLAIN.id]);
  damageEnemy(s2, 1e9, ctx2, [], 'quiz', frontEnemy(s2));
  assert.equal(s2.legacy.barn.length, 0);
});

test('ボス・中ボスは小屋に入らない。月面のザコは月面の飼育ドームに入る', () => {
  const s = newGame(7);
  const ctx = makeCtx(constRng(0));
  const boss = monsters.find((m) => m.kind === 'boss');
  const mid = monsters.find((m) => m.kind === 'midboss');
  assert.equal(tameZako(s, ctx, boss.id, [], true), false);
  assert.equal(tameZako(s, ctx, mid.id, [], true), false);
  const events = [];
  assert.equal(tameZako(s, ctx, MOON_DOG.id, events, true), true);
  assert.equal(events[0].world, 'moon');
  assert.equal(events[0].barn, '月面の飼育ドーム');
  assert.deepEqual(barnAnimals(s, ctx, 'moon').map((a) => a.id), [MOON_DOG.id]);
  assert.equal(barnAnimals(s, ctx, 'earth').length, 0);
  assert.equal(barnCapacity(ctx, 'moon'), monsters.filter((m) => m.kind === 'monster' && m.world === 'moon').length);
});

test('長く戦うと、ザコが少しずつなついて小屋に入る（1%）', () => {
  const s = newGame(7);
  let seed = 7;
  const ctx = makeCtx(() => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; });
  for (let i = 0; i < 20 * 60 * 10; i++) tick(s, 0.1, ctx); // 20分
  assert.ok(s.legacy.barn.length >= 1, `${s.legacy.barn.length}`);
  for (const a of s.legacy.barn) assert.equal(monsters.find((m) => m.id === a.id).kind, 'monster');
});

test('小屋のザコは生まれ変わっても残り、セーブにも残る（前のセーブは空の小屋）', () => {
  const s = newGame(7);
  const ctx = makeCtx(constRng(0));
  tameZako(s, ctx, DOG.id, [], true);
  reincarnate(s, ctx);
  assert.deepEqual(s.legacy.barn.map((a) => a.id), [DOG.id]);
  const back = deserialize(serialize(s), balance);
  assert.deepEqual(back.legacy.barn, s.legacy.barn);
  const old = JSON.parse(serialize(newGame(7)));
  delete old.state.legacy.barn;
  delete old.state.legacy.rocket.flown;
  delete old.state.legacy.rocket.rateBonus;
  const loaded = deserialize(JSON.stringify(old), balance);
  assert.deepEqual(loaded.legacy.barn, []);
  assert.deepEqual(loaded.legacy.rocket.flown, []);
  assert.equal(loaded.legacy.rocket.rateBonus, 0);
});

test('試作機は「機体設計」の工程が終わると、地球から飛ばせる', () => {
  const s = newGame(7);
  const ctx = makeCtx();
  assert.equal(prototypeInfo(s, ctx).ok, false);
  assert.match(prototypeInfo(s, ctx).reason, /機体設計/);
  tameZako(s, ctx, DOG.id, [], true);
  s.gold = pr.cost;
  assert.equal(flyPrototype(s, ctx, DOG.id).ok, false);
  assert.equal(s.gold, pr.cost);
  airframeDone(s);
  assert.equal(prototypeInfo(s, ctx).ok, true);
  s.adventure.world = 'moon';
  assert.equal(prototypeInfo(s, ctx).ok, false);
});

test('犬：成功すると本番の打ち上げの成功率が上がる（80%→90%）。失敗しても必ず生きて帰ってくる', () => {
  const s = newGame(7);
  ready(s, makeCtx(), DOG.id);
  const gold = s.gold;
  const fail = flyPrototype(s, makeCtx(constRng(0.99)), DOG.id);
  assert.equal(fail.ok, true);
  assert.equal(fail.success, false);
  assert.equal(fail.dog, true);
  assert.equal(fail.left, false);
  assert.equal(s.gold, gold - pr.cost);
  assert.equal(s.legacy.barn.length, 1);              // 小屋に残る
  assert.ok(!s.legacy.barn[0].space);
  assert.equal(launchSuccessRate(s, makeCtx()), balance.rocket.launchSuccessRate);

  const ok = flyPrototype(s, makeCtx(constRng(0)), DOG.id);
  assert.equal(ok.success, true);
  assert.equal(ok.effect.kind, 'rate');
  assert.ok(ok.history.includes('ベルカとストレルカ'));
  assert.equal(s.legacy.barn[0].space, true);          // 宇宙帰りの印
  assert.ok(Math.abs(launchSuccessRate(s, makeCtx()) - 0.9) < 1e-9);
  assert.ok(Math.abs(launchInfo(s, makeCtx()).successRate - 0.9) < 1e-9);
  // 同じザコの効果は1回まで
  assert.deepEqual(prototypeEffect(s, makeCtx(), DOG.id), { kind: 'none', used: true });
  flyPrototype(s, makeCtx(constRng(0)), DOG.id);
  assert.ok(Math.abs(launchSuccessRate(s, makeCtx()) - 0.9) < 1e-9);
  assert.equal(s.legacy.barn[0].flights, 2);
});

test('本番の打ち上げは、試作機で上がった成功率で決まる', () => {
  const s = newGame(7);
  ready(s, makeCtx(), DOG.id);
  flyPrototype(s, makeCtx(constRng(0)), DOG.id);
  s.legacy.rocket.buildCostPaid = true;
  for (const st of fields.rocketSteps) s.legacy.rocket.steps[st.id] = STEP_HOURS;
  // 0.85 は前の成功率（80%）なら失敗、今の成功率（90%）なら成功
  assert.equal(launchRocket(s, makeCtx(constRng(0.85))).success, true);
});

test('犬以外：失敗すると小屋からいなくなり、野に戻る（また仲間にできる）。成功すると少しだけ成功率が上がる', () => {
  const s = newGame(7);
  ready(s, makeCtx(), PLAIN.id);
  const r = flyPrototype(s, makeCtx(constRng(0.99)), PLAIN.id);
  assert.equal(r.success, false);
  assert.equal(r.left, true);
  assert.equal(s.legacy.barn.length, 0);
  assert.equal(launchSuccessRate(s, makeCtx()), balance.rocket.launchSuccessRate);
  // また仲間にできる
  assert.equal(tameZako(s, makeCtx(), PLAIN.id, [], true), true);
  const ok = flyPrototype(s, makeCtx(constRng(0)), PLAIN.id);
  assert.equal(ok.success, true);
  assert.equal(ok.effect.kind, 'rate');
  assert.ok(Math.abs(launchSuccessRate(s, makeCtx()) - (balance.rocket.launchSuccessRate + pr.otherBonus)) < 1e-9);
  assert.equal(s.legacy.barn[0].space, true);
  assert.equal(ok.history, null);
});

test('サル→打ち上げ許可・カメ→軌道計算が進む（成功したときだけ・1回まで）。工程が終わっていればほかのザコと同じ', () => {
  const s = newGame(7);
  ready(s, makeCtx(), MONKEY.id, TURTLE.id, SPIDER.id);
  const fail = flyPrototype(s, makeCtx(constRng(0.99)), TURTLE.id);
  assert.equal(fail.left, true);
  assert.equal(s.legacy.rocket.steps.orbit || 0, 0);
  const m = flyPrototype(s, makeCtx(constRng(0)), MONKEY.id);
  assert.equal(m.effect.kind, 'step');
  assert.equal(m.effect.stepName, '打ち上げ許可');
  assert.equal(s.legacy.rocket.steps.permit, pr.stepYears * HOURS_PER_YEAR);
  assert.equal(m.stepDone, false);
  assert.equal(launchSuccessRate(s, makeCtx()), balance.rocket.launchSuccessRate);
  assert.equal(prototypeEffect(s, makeCtx(), MONKEY.id).used, true);
  // 工程の残りより多くは進まず、終われば stepDone
  tameZako(s, makeCtx(), TURTLE.id, [], true);
  s.legacy.rocket.steps.orbit = STEP_HOURS - 10;
  const t = flyPrototype(s, makeCtx(constRng(0)), TURTLE.id);
  assert.equal(t.effect.hours, 10);
  assert.equal(t.stepDone, true);
  assert.equal(rocketSteps(s, makeCtx()).find((st) => st.id === 'orbit').done, true);
  // クモ（機体設計）：試作機を飛ばせる時点で機体設計は終わっているので、ほかのザコと同じく成功率が少し上がる
  const sp = prototypeEffect(s, makeCtx(), SPIDER.id);
  assert.equal(sp.kind, 'rate');
  assert.equal(sp.amount, pr.otherBonus);
});

test('打ち上げの成功率は launchSuccessRateMax まで。上限なら効果は無く、使ったことにしない', () => {
  const s = newGame(7);
  ready(s, makeCtx(), DOG.id, MOON_DOG.id, PLAIN.id);
  flyPrototype(s, makeCtx(constRng(0)), DOG.id);
  const second = flyPrototype(s, makeCtx(constRng(0)), MOON_DOG.id);
  assert.ok(second.effect.amount < pr.dogBonus);       // 上限までしか上がらない
  assert.ok(Math.abs(launchSuccessRate(s, makeCtx()) - balance.rocket.launchSuccessRateMax) < 1e-9);
  const e = prototypeEffect(s, makeCtx(), PLAIN.id);
  assert.deepEqual(e, { kind: 'none', capped: true });
  flyPrototype(s, makeCtx(constRng(0)), PLAIN.id);
  assert.ok(!s.legacy.rocket.flown.includes(PLAIN.id));
});

test('試作機の費用が足りなければ飛ばせない。小屋にいないザコは乗せられない', () => {
  const s = newGame(7);
  ready(s, makeCtx(), DOG.id);
  s.gold = pr.cost - 1;
  assert.equal(flyPrototype(s, makeCtx(constRng(0)), DOG.id).ok, false);
  assert.equal(s.gold, pr.cost - 1);
  s.gold = pr.cost;
  assert.equal(flyPrototype(s, makeCtx(constRng(0)), PLAIN.id).ok, false);
});

test('絵：飼育小屋と月面の飼育ドームの建物（32×32）と、中の景色（90×64）がある。街の拠点の跡と前線基地の跡に置く', async () => {
  const { readFileSync } = await import('node:fs');
  const read = (n) => JSON.parse(readFileSync(new URL(`../../pixel/sprites/${n}.json`, import.meta.url), 'utf8'));
  for (const [n, w, h] of [['town_barn', 32, 32], ['town_moon_barn', 32, 32], ['scene_barn', 90, 64], ['scene_moon_barn', 90, 64]]) {
    const d = read(n);
    assert.equal(d.name, n);
    assert.equal(d.w, w, n);
    assert.equal(d.h, h, n);
  }
  const town = JSON.parse(readFileSync(new URL('../data/town.json', import.meta.url), 'utf8'));
  const barn = town.facilities.find((f) => f.id === 'barn');
  const dome = town.moon.facilities.find((f) => f.id === 'moon_barn');
  assert.equal(barn.sprite, 'town_barn');
  assert.equal(dome.sprite, 'town_moon_barn');
  assert.deepEqual(dome.earth, ['barn']);
  assert.deepEqual([dome.x, dome.y], [barn.x, barn.y]);
});
