// ゲームの計算：時間（年齢・ゲーム内の日付・時計・1か月あたりの獲得量）

import { HOURS_PER_YEAR, HOURS_PER_MONTH, MONTH_DAYS } from './core.js';

export const ageYears = (state) => Math.floor(state.life.gameHours / HOURS_PER_YEAR);

/** ゲーム内の日時（0歳1月1日0時から数える。うるう年なし） */
export function gameDate(gameHours) {
  const total = Math.floor(gameHours);
  const age = Math.floor(total / HOURS_PER_YEAR);
  const inYear = total % HOURS_PER_YEAR;
  let day = Math.floor(inYear / 24);
  const hour = inYear % 24;
  let month = 0;
  while (day >= MONTH_DAYS[month]) { day -= MONTH_DAYS[month]; month++; }
  return { age, month: month + 1, day: day + 1, hour };
}

/** 表示は日付まで（時間の進みが速く「◯時」はめまぐるしく変わるだけなので出さない） */
export function formatDate(gameHours) {
  const d = gameDate(gameHours);
  return `${d.age}歳 ${d.month}月${d.day}日`;
}

/** 画面が見えている間だけ進む時計。戻ってきた最初のフレームは0（止まっていた分を取り戻さない） */
export function createClock() { return { last: null }; }

export function clockFrame(clock, nowMs, visible, maxFrameSeconds) {
  if (!visible) { clock.last = null; return 0; }
  if (clock.last == null) { clock.last = nowMs; return 0; }
  const dt = (nowMs - clock.last) / 1000;
  clock.last = nowMs;
  return Math.min(Math.max(dt, 0), maxFrameSeconds);
}

/** 秒間獲得量（直近 windowSec 秒の平均）を数える */
export function createRateTracker() { return { t: 0, log: [] }; }
export function trackTime(tr, dt) { tr.t += dt; }
export function trackGain(tr, exp, gold) { tr.log.push([tr.t, exp, gold]); }
export function trackRates(tr, windowSec) {
  const from = tr.t - windowSec;
  while (tr.log.length && tr.log[0][0] < from) tr.log.shift();
  const span = Math.max(1, Math.min(windowSec, tr.t));
  let exp = 0, gold = 0;
  for (const [, e, g] of tr.log) { exp += e; gold += g; }
  return { exp: exp / span, gold: gold / span };
}

/** ゲーム内1か月あたりの獲得量（直近 rateWindowSec 秒の平均を、1か月の長さに直す） */
export function monthlyRates(tr, balance) {
  const r = trackRates(tr, balance.rateWindowSec);
  const secPerMonth = HOURS_PER_MONTH / balance.time.gameHoursPerRealSecond;
  return { exp: r.exp * secPerMonth, gold: r.gold * secPerMonth };
}
