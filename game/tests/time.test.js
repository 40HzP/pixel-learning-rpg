import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClock, clockFrame, tick, formatDate, gameDate, HOURS_PER_YEAR, HOURS_PER_MONTH, createState, createRateTracker, trackTime, trackGain, trackRates, monthlyRates } from '../js/sim.js';
import { balance, makeCtx, newGame } from './helpers.js';

test('隠れている間は時間が進まず、戻った最初のフレームも0', () => {
  const c = createClock();
  assert.equal(clockFrame(c, 0, true, 1), 0);
  assert.equal(clockFrame(c, 500, true, 1), 0.5);
  assert.equal(clockFrame(c, 600, false, 1), 0);          // 隠れた
  assert.equal(clockFrame(c, 60_000, false, 1), 0);       // 隠れている間
  assert.equal(clockFrame(c, 120_000, true, 1), 0);       // 戻った最初のフレーム
  assert.equal(clockFrame(c, 120_250, true, 1), 0.25);
});

test('1フレームの経過時間は最大1秒で打ち切る', () => {
  const c = createClock();
  clockFrame(c, 0, true, balance.time.maxFrameSeconds);
  assert.equal(clockFrame(c, 30_000, true, balance.time.maxFrameSeconds), 1);
});

test('現実1秒でゲーム内の時間が gameHoursPerRealSecond だけ進む。開始年齢を選ぶまでは進まない', () => {
  const ctx = makeCtx();
  const idle = createState(balance);
  tick(idle, 1, ctx);
  assert.equal(idle.life.gameHours, 0);
  const s = newGame(0);
  tick(s, 1, ctx);
  assert.ok(Math.abs(s.life.gameHours - balance.time.gameHoursPerRealSecond) < 1e-9);
});

test('現実の1時間でゲーム内の24年進む（40HzP の依頼で設計の24倍速）', () => {
  // 冒険でやられると睡眠の分も時間が進むので、時間の速さの値そのものを確かめる
  assert.ok(Math.abs(balance.time.gameHoursPerRealSecond * 3600 - 24 * HOURS_PER_YEAR) < 1e-6);
});

test('日時は0歳1月1日0時から数える。表示は日付まで', () => {
  assert.equal(formatDate(0), '0歳 1月1日');
  assert.equal(formatDate(25), '0歳 1月2日');
  assert.equal(formatDate(31 * 24), '0歳 2月1日');
  assert.equal(formatDate(7 * HOURS_PER_YEAR + 364 * 24 + 23), '7歳 12月31日');
  assert.deepEqual(gameDate(HOURS_PER_YEAR), { age: 1, month: 1, day: 1, hour: 0 });
});

test('秒間獲得量は直近の時間で平均する', () => {
  const tr = createRateTracker();
  trackTime(tr, 10);
  trackGain(tr, 20, 10);
  const r = trackRates(tr, 60);
  assert.equal(r.exp, 2);
  assert.equal(r.gold, 1);
  trackTime(tr, 100);
  assert.deepEqual(trackRates(tr, 60), { exp: 0, gold: 0 });
});

test('冒険画面にはゲーム内1か月あたりの獲得量を出す（秒あたり×1か月の秒数）', () => {
  const tr = createRateTracker();
  trackTime(tr, 10);
  trackGain(tr, 20, 10);
  const perSec = trackRates(tr, balance.rateWindowSec);
  const m = monthlyRates(tr, balance);
  const secPerMonth = HOURS_PER_MONTH / balance.time.gameHoursPerRealSecond;
  assert.ok(Math.abs(m.exp - perSec.exp * secPerMonth) < 1e-9);
  assert.ok(Math.abs(m.gold - perSec.gold * secPerMonth) < 1e-9);
  assert.ok(Math.abs(secPerMonth - 12.5) < 1e-9, '今の速さでは1か月＝現実12.5秒');
});
