import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sleep, genreState, heroStats } from '../js/sim.js';
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
