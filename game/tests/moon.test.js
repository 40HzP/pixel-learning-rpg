import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  tick, spawnGroup, monsterStats, launchInfo, launchRocket, returnToEarth, onMoon, zakoPool, strengthFloor, stageFor, currentStage,
  sleepAtBed, respawnFloor, buildBase, reincarnate, rocketSteps, genreState, HOURS_PER_YEAR,
} from '../js/sim.js';
import { setMajor, fieldById } from '../js/fields.js';
import { serialize, deserialize } from '../js/save.js';
import { balance, monsters, fields, makeCtx, newGame, constRng } from './helpers.js';

const { stages } = JSON.parse(readFileSync(fileURLToPath(new URL('../data/stages.json', import.meta.url)), 'utf8'));
const moonZako = monsters.filter((m) => m.kind === 'monster' && m.world === 'moon');

/** 建造費を払い、すべての工程を終えたことにする */
function buildRocket(s) {
  s.legacy.rocket.buildCostPaid = true;
  for (const st of fields.rocketSteps) s.legacy.rocket.steps[st.id] = balance.rocket.stepYears * HOURS_PER_YEAR;
}
/** 学際分野の2つのジャンルを解放の熟練にして、専攻に入れる */
function major(s, ctx, id, slot = 0) {
  for (const g of fieldById(ctx, id).genres) genreState(s, g).level = balance.fields.unlockLevel;
  tick(s, 0.01, ctx);
  assert.equal(setMajor(s, slot, id, ctx).ok, true, id);
}

test('データ：月面の世界（stages.json の world: moon）と、設計ページの月面のザコ19体（月面にだけ出る）', () => {
  const moon = stages.filter((st) => st.world === 'moon');
  assert.equal(moon.length, 1);
  assert.equal(moon[0].from, 1);
  assert.equal(moon[0].background, 'bg_moon');
  assert.equal(moonZako.length, 19);
  for (const m of moonZako) assert.ok(m.myth && m.truth && m.genres.length, m.name);
  assert.ok(balance.moon.floorOffset > 0);
  assert.ok(balance.rocket.launchSuccessRate > 0 && balance.rocket.launchSuccessRate < 1);
});

test('打ち上げ：建造費を払い、すべての工程が終わるまでは打ち上げられない', () => {
  const ctx = makeCtx(constRng(0));
  const s = newGame(7);
  let info = launchInfo(s, ctx);
  assert.equal(info.ok, false);
  assert.match(info.reason, /建造費/);
  s.legacy.rocket.buildCostPaid = true;
  info = launchInfo(s, ctx);
  assert.equal(info.ok, false);
  assert.match(info.reason, /機体設計/);
  assert.equal(launchRocket(s, ctx).ok, false);
  assert.equal(onMoon(s), false);
  buildRocket(s);
  info = launchInfo(s, ctx);
  assert.equal(info.ok, true);
  assert.equal(info.successRate, balance.rocket.launchSuccessRate);
  assert.equal(info.rateVisible, false, '確率論が無いと成功率は見えない');
});

test('打ち上げに成功すると月面の1階層へ。地球の階層は取っておく。打ち上げは無料（ゴールドは減らない）', () => {
  const ctx = makeCtx(constRng(0.1));
  const s = newGame(7);
  buildRocket(s);
  s.adventure.floor = 123;
  s.gold = 500;
  spawnGroup(s, ctx, []);
  const r = launchRocket(s, ctx);
  assert.deepEqual(r, { ok: true, success: true, floor: 1 });
  assert.equal(onMoon(s), true);
  assert.equal(s.adventure.floor, 1);
  assert.equal(s.adventure.earthFloor, 123);
  assert.equal(s.adventure.enemies.length, 0, '地球の群れは退く');
  assert.equal(s.gold, 500);
  assert.equal(s.life.moonMaxFloor, 1);
  assert.equal(s.life.maxFloor, 1, '地球の最高階層は月面の階層で変わらない');
  assert.equal(launchInfo(s, ctx).ok, false, '月面からは打ち上げない（帰還ロケットで帰る）');
});

test('打ち上げに失敗すると地球に残り、エンジン・推進剤の工程だけやり直しになる（ほかの工程と建造費はそのまま）', () => {
  const ctx = makeCtx(constRng(0.99));
  const s = newGame(7);
  buildRocket(s);
  const r = launchRocket(s, ctx);
  assert.deepEqual(r, { ok: true, success: false, redo: ['エンジン・推進剤'] });
  assert.equal(onMoon(s), false);
  const steps = Object.fromEntries(rocketSteps(s, ctx).map((st) => [st.id, st]));
  assert.equal(steps.engine.hours, 0);
  assert.equal(steps.airframe.done && steps.orbit.done && steps.permit.done, true);
  assert.equal(s.legacy.rocket.buildCostPaid, true);
  assert.match(launchInfo(s, ctx).reason, /エンジン・推進剤/);
});

test('確率論（数学＋統計学）を専攻にしていると、打ち上げの成功率が見える', () => {
  const ctx = makeCtx();
  const s = newGame(7);
  buildRocket(s);
  major(s, ctx, 'probability');
  assert.equal(launchInfo(s, ctx).rateVisible, true);
});

test('月面：月面のザコだけが出て、強さは地球の（floorOffset＋月面の階層）階層と同じ。地球には月面のザコは出ない', () => {
  const ctx = makeCtx(constRng(0.3));
  const s = newGame(7);
  assert.ok(zakoPool(s, ctx).every((m) => m.world !== 'moon'));
  assert.ok(zakoPool(s, ctx).length > 0);
  buildRocket(s);
  launchRocket(s, ctx);
  s.adventure.floor = 4;
  assert.deepEqual(zakoPool(s, ctx).map((m) => m.id).sort(), moonZako.map((m) => m.id).sort());
  assert.equal(strengthFloor(s, ctx), balance.moon.floorOffset + 4);
  const group = spawnGroup(s, ctx, []);
  const want = monsterStats(balance.moon.floorOffset + 4, balance);
  for (const e of group) {
    assert.ok(moonZako.some((m) => m.id === e.monsterId), e.name);
    assert.equal(e.maxHp, want.maxHp);
    assert.equal(e.atk, want.atk);
  }
  assert.equal(currentStage(s, stages).background, 'bg_moon');
  assert.equal(stageFor(4, stages).background, 'bg_floor01', '地球の4階層は今までどおり');
});

test('月面の階層を進むと月面の最高階層が増える（地球の最高階層は変わらない）', () => {
  const ctx = makeCtx(constRng(0.3));
  const s = newGame(7);
  buildRocket(s);
  launchRocket(s, ctx);
  s.hero.level = 2000;
  s.hero.hp = 1e12;
  const ups = [];
  for (let t = 0; t < 120 && s.adventure.floor < 3; t++) ups.push(...tick(s, 1, ctx).filter((e) => e.type === 'floorUp'));
  assert.ok(s.adventure.floor >= 3);
  assert.equal(ups[0].world, 'moon');
  assert.equal(s.life.moonMaxFloor, s.adventure.floor);
  assert.equal(s.life.maxFloor, 1);
});

test('月面でやられると月面の1階層から（地球の拠点は使わない）。月面基地で眠ると1つ手前の月面の階層へ', () => {
  const ctx = makeCtx(constRng(0.1));
  const s = newGame(7);
  major(s, ctx, 'structural_engineering');
  s.adventure.floor = 50;
  assert.equal(buildBase(s, ctx).ok, true);
  buildRocket(s);
  launchRocket(s, ctx);
  s.adventure.floor = 9;
  assert.equal(respawnFloor(s, ctx), 1);
  assert.equal(buildBase(s, ctx).ok, false, '月面には拠点を建てられない');
  const r = sleepAtBed(s, ctx);
  assert.equal(s.adventure.floor, 8);
  assert.equal(r.world, 'moon');
  assert.equal(onMoon(s), true);
  // やられる
  s.hero.hp = 1;
  s.hero.level = 1;
  spawnGroup(s, ctx, []);
  let defeated = null;
  for (let t = 0; t < 60 && !defeated; t++) defeated = tick(s, 0.5, ctx).find((e) => e.type === 'heroDefeated');
  assert.ok(defeated);
  assert.equal(s.adventure.floor, 1);
  assert.equal(onMoon(s), true, 'やられても月面にいる');
  assert.equal(defeated.sleep.world, 'moon');
});

test('帰還ロケット：無料でいつでも地球に帰れ、地球は打ち上げた階層から。また打ち上げると月面は前の階層から', () => {
  const ctx = makeCtx(constRng(0.1));
  const s = newGame(7);
  buildRocket(s);
  s.adventure.floor = 77;
  assert.equal(returnToEarth(s, ctx).ok, false, '地球にいるときは帰れない');
  launchRocket(s, ctx);
  s.adventure.floor = 12;
  s.gold = 0;
  assert.deepEqual(returnToEarth(s, ctx), { ok: true, floor: 77 });
  assert.equal(onMoon(s), false);
  assert.equal(s.adventure.moonFloor, 12);
  assert.equal(s.adventure.earthFloor, null);
  assert.equal(currentStage(s, stages).background, stageFor(77, stages).background);
  launchRocket(s, ctx);
  assert.equal(s.adventure.floor, 12);
  assert.equal(s.adventure.earthFloor, 77);
});

test('月面で寿命が来ると、地球の1階層に生まれ変わる。ロケットの工程は残るので、次の人生でも打ち上げられる', () => {
  const ctx = makeCtx(constRng(0.1));
  const s = newGame(7);
  buildRocket(s);
  launchRocket(s, ctx);
  s.adventure.floor = 30;
  s.life.moonMaxFloor = 31;
  const prev = reincarnate(s, ctx);
  assert.equal(prev.moonFloor, 31);
  assert.equal(onMoon(s), false);
  assert.equal(s.adventure.floor, 1);
  assert.equal(s.adventure.moonFloor, 1, '月面も1階層から');
  assert.equal(s.life.moonMaxFloor, 0);
  assert.equal(launchInfo(s, ctx).ok, true);
});

test('前のセーブ（世界の項目が無い）は地球として読める。月面にいるセーブもそのまま読める', () => {
  const ctx = makeCtx(constRng(0.1));
  const s = newGame(7);
  delete s.adventure.world;
  delete s.adventure.earthFloor;
  delete s.adventure.moonFloor;
  delete s.life.moonMaxFloor;
  let loaded = deserialize(serialize(s), balance);
  assert.equal(loaded.adventure.world, 'earth');
  assert.equal(loaded.adventure.moonFloor, 1);
  assert.equal(loaded.life.moonMaxFloor, 0);
  buildRocket(loaded);
  launchRocket(loaded, ctx);
  loaded.adventure.floor = 5;
  loaded = deserialize(serialize(loaded), balance);
  assert.equal(onMoon(loaded), true);
  assert.equal(loaded.adventure.floor, 5);
});
