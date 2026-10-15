import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sleep, sleepAtBed, bedFloor, genreState, heroStats, spawnGroup, challengeMidboss, challengeableMidboss, tick } from '../js/sim.js';
import { balance, makeCtx, newGame, seqRng } from './helpers.js';

function setup() {
  const s = newGame(0);
  Object.assign(genreState(s, '生物'), { level: 2, studied: true });   // 解いたジャンル
  Object.assign(genreState(s, '数学'), { level: 3, studied: false });  // 解いていないジャンル
  Object.assign(genreState(s, '法学'), { level: 0, studied: false });  // Lv0 は下がらない
  return s;
}

test('睡眠：解いたジャンルは上がり、解いていないジャンルは下がる（乱数を固定）', () => {
  const s = setup();
  // GENRES の並びで 数学 → 生物 の順に判定される
  const r = sleep(s, makeCtx(seqRng([0.01, 0.01])), 'bed');
  assert.equal(s.knowledge.genres['生物'].level, 3);
  assert.equal(s.knowledge.genres['数学'].level, 2);
  assert.equal(s.knowledge.genres['法学'].level, 0);
  assert.deepEqual(r.up, ['生物']);
  assert.deepEqual(r.down, ['数学']);
});

test('睡眠：確率に外れたら変わらない', () => {
  const s = setup();
  const r = sleep(s, makeCtx(seqRng([0.99, 0.99])), 'bed');
  assert.equal(s.knowledge.genres['生物'].level, 2);
  assert.equal(s.knowledge.genres['数学'].level, 3);
  assert.deepEqual([r.up, r.down], [[], []]);
});

test('睡眠：確率のちょうど境目（15%・5%）は外れ扱い', () => {
  const s = setup();
  sleep(s, makeCtx(seqRng([balance.sleep.downChance, balance.sleep.upChance])), 'bed');
  assert.equal(s.knowledge.genres['生物'].level, 2);
  assert.equal(s.knowledge.genres['数学'].level, 3);
});

test('睡眠：10時間進んで全回復し、「解いたか」が消える。最大5で止まる', () => {
  const s = setup();
  genreState(s, '生物').level = 5;
  s.hero.hp = 1;
  const before = s.life.gameHours;
  sleep(s, makeCtx(seqRng([0.99, 0.0])), 'bed');
  assert.equal(s.life.gameHours - before, balance.sleep.gameHours);
  assert.equal(s.hero.hp, heroStats(s, makeCtx()).maxHp);
  assert.equal(s.knowledge.genres['生物'].level, 5);
  assert.equal(s.knowledge.genres['生物'].studied, false);
});

test('寝床（テント）で眠ると、1つ手前の階層の最初に戻って全回復する', () => {
  const s = newGame(0);
  const ctx = makeCtx();
  s.adventure.floor = 5;
  s.adventure.kills = 3;
  spawnGroup(s, ctx, []);
  s.hero.hp = 1;
  s.hero.mp = 0;
  const hours = s.life.gameHours;
  assert.equal(bedFloor(s), 4);
  const r = sleepAtBed(s, ctx);
  assert.equal(s.adventure.floor, 4, '1つ手前の階層');
  assert.equal(s.adventure.kills, 0, '階層の最初から');
  assert.deepEqual(s.adventure.enemies, [], '戦っていた群れは退く');
  const hs = heroStats(s, ctx);
  assert.equal(s.hero.hp, hs.maxHp);
  assert.equal(s.hero.mp, hs.maxMp);
  assert.equal(s.life.gameHours, hours + balance.sleep.gameHours, '睡眠の時間が進む');
  assert.equal(r.reason, 'bed');
  assert.equal(r.floor, 4);
  // 少しすると戻った階層の群れが出る
  const ev = tick(s, balance.floor.spawnDelaySec + 0.01, ctx);
  assert.ok(ev.some((e) => e.type === 'spawn' && e.floor === 4));
});

test('寝床（テント）：1階層で眠ると1階層の最初から。中ボスと戦っている途中なら中ボスは退き、また挑戦できる', () => {
  const s = newGame(7);
  const ctx = makeCtx();
  assert.equal(bedFloor(s), 1);
  s.knowledge.totalCorrect = 99;
  const mb = challengeMidboss(s, ctx, []);
  assert.ok(mb, '中ボスに挑戦できる年齢');
  sleepAtBed(s, ctx);
  assert.equal(s.adventure.floor, 1);
  assert.deepEqual(s.adventure.enemies, []);
  assert.equal(challengeableMidboss(s, ctx).id, mb.monsterId, 'また挑戦できる');
});
