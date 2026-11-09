// ゲームの計算：誕生日（全回復・熟練の判定・熟練の記録）

import { GENRES } from '../genres.js';
import { ageYears } from './time.js';
import { proficiencyCap } from './life.js';
import { healAll } from './battle.js';
import { barnBirthday } from './barn.js';

/** 熟練の記録の件数の上限（新しい順に残す。1件はセーブで60字ほど） */
export const PROF_LOG_MAX = 200;

/**
 * 熟練の記録（knowledge.profLog）に1件足す。世代と年齢を付ける。
 * entry：{ genre, from, to, reason: 'study'（勉強で正解）| 'year'（この1年に勉強した）| 'cap'（上限に届いている）| 'idle'（years 年勉強していない） }
 * または { field: 学際分野の名前, reason: 'dormant'（休眠）| 'awake'（復活） }
 */
export function logProficiency(state, entry) {
  const log = state.knowledge.profLog || (state.knowledge.profLog = []);
  log.unshift({ gen: state.life.generation, age: ageYears(state), ...entry });
  if (log.length > PROF_LOG_MAX) log.length = PROF_LOG_MAX;
}

/**
 * 終わったばかりの人生（generation）の熟練の記録から、生まれ変わりの場面に流す数行を選ぶ（設計ページ「生まれ変わるたびの『前世の記憶をたどる』」の案）。
 * 古い順に、その人生の始まり・終わりを含めて均等に max 件まで（記録が無ければ空）
 */
export function lifeLogHighlights(state, generation, max = 4) {
  const life = (state.knowledge.profLog || []).filter((c) => c.gen === generation).reverse(); // 古い順
  if (life.length <= max) return life;
  const picks = [];
  for (let i = 0; i < max; i++) picks.push(life[Math.round((i * (life.length - 1)) / (max - 1))]);
  return picks;
}

/**
 * 誕生日（ゲーム内で1歳年を取るたび）：HP・MPを全回復し、ジャンルごとに熟練を判定し、学会の査読者の「要出典」の回数を戻す。
 * 熟練の判定（balance.birthday）：前の誕生日から勉強したジャンルは upChance で+1（上限に届いていれば上がらない）。
 * 勉強していないジャンルは、勉強していない年数（idle）が idleYears 以上で Lv1 以上なら downChance で−1。
 * 乱数はジャンルの並び順（GENRES）に、判定するジャンルごとに1回ずつ使う。変わったジャンルを返す（熟練の記録にも残す）
 */
export function birthday(state, ctx, events = []) {
  const b = ctx.balance.birthday;
  healAll(state, ctx);
  state.citationsUsed = 0;
  const cap = proficiencyCap(state, ctx.balance);
  const changes = [];
  for (const genre of GENRES) {
    const g = state.knowledge.genres[genre];
    if (!g) continue;
    if (g.studied) {
      g.idle = 0;
      if (ctx.rng() < b.upChance) {
        const c = g.level < cap ? { genre, from: g.level, to: g.level + 1, reason: 'year' } : { genre, from: g.level, to: g.level, reason: 'cap' };
        g.level = c.to;
        changes.push(c);
      }
    } else {
      g.idle = (g.idle || 0) + 1;
      if (g.level >= 1 && g.idle >= b.idleYears && ctx.rng() < b.downChance) {
        changes.push({ genre, from: g.level, to: g.level - 1, reason: 'idle', years: g.idle });
        g.level--;
      }
    }
    g.studied = false;
  }
  for (const c of changes) logProficiency(state, c);
  events.push({ type: 'birthday', age: ageYears(state), changes });
  barnBirthday(state, ctx, events); // 飼育小屋のザコの懐き度と、懐いたザコの贈り物
  return changes;
}

/** 年を取っていたら誕生日の処理をする（tick から。何歳か飛んだときは、その数だけ） */
export function birthdays(state, ctx, events) {
  const age = ageYears(state);
  if (!(state.life.birthday >= 0)) state.life.birthday = age;
  while (state.life.birthday < age) {
    state.life.birthday++;
    birthday(state, ctx, events);
  }
}
