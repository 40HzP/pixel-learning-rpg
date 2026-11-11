// ゲームの計算：時間を進める（毎フレーム呼ぶ。寿命・誕生日・契約料・会社・学際分野・ロケット・中ボス・戦い）

import { updateFields } from '../fields.js';
import { STEP_SEC } from './core.js';
import { ageYears } from './time.js';
import { breakMidbosses, updateAuthorRights } from './knowledge.js';
import { lifespanOf, ailmentAge, reincarnate } from './life.js';
import { combatStep } from './battle.js';
import { announceMidbosses } from './midboss.js';
import { logProficiency, birthdays } from './birthday.js';
import { payContracts } from './allies.js';
import { earnCompany, settleTaxes } from './company.js';
import { advanceRocket } from './rocket.js';
import { syncBarnRooms } from './barn.js';

/** 経過時間 dt 秒（速さ倍率をかけた後）だけゲームを進める。起きたことを events で返す */
export function tick(state, dt, ctx) {
  const events = [];
  if (state.meta.startAge == null || !(dt > 0)) return events;
  state.life.gameHours += dt * ctx.balance.time.gameHoursPerRealSecond;
  if (ageYears(state) >= lifespanOf(state, ctx.balance)) {
    // 寿命：生まれ変わる（年齢を選ぶまで時間は止まる）
    const life = reincarnate(state, ctx);
    events.push({ type: 'reincarnated', life, generation: state.life.generation });
    return events;
  }
  if (!state.life.ailing && ageYears(state) >= ailmentAge(state, ctx.balance)) {
    // 年を取って、体の不調を感じ始める（ミニムービー。このあと病院で治療を受けられる）
    state.life.ailing = true;
    events.push({ type: 'ailment', age: ageYears(state) });
  }
  // 飼育小屋の部屋：建築の熟練Lvに合わせて建てる（勉強の正解で上がった分と、誕生日に上がった分。下がっても部屋は残る）
  syncBarnRooms(state, ctx, events);
  birthdays(state, ctx, events);
  syncBarnRooms(state, ctx, events);
  payContracts(state, ctx, events);
  earnCompany(state, dt, ctx);
  settleTaxes(state, ctx, events);
  const fieldEvents = [];
  updateFields(state, ctx, fieldEvents);
  // 学際分野の休眠と復活も熟練の記録に残す（知らせは main.js が、専攻に入れているものだけ出す）
  for (const e of fieldEvents) if (e.type === 'fieldDormant' || e.type === 'fieldAwake') logProficiency(state, { field: e.name, reason: e.type === 'fieldDormant' ? 'dormant' : 'awake' });
  events.push(...fieldEvents);
  updateAuthorRights(state, ctx, events);
  advanceRocket(state, dt, ctx, events);
  announceMidbosses(state, ctx, events);
  breakMidbosses(state, ctx, events);
  let remaining = dt;
  while (remaining > 1e-9) {
    const step = Math.min(remaining, STEP_SEC);
    remaining -= step;
    combatStep(state, step, ctx, events);
  }
  return events;
}
