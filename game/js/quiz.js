// 出題・判定・熟練（描画しない・ブラウザの機能に触らない）。
// ctx = { balance, monsters, items, questions, rng }（questions は questions.json の questions 配列）

import { GENRES } from './genres.js';
import { genreState, raiseZukan, zukanEntry, breakMidbosses, damageEnemy, healEnemy, proficiencyCap } from './sim.js';
import { fieldActive, fieldById } from './fields.js';

export { GENRES };

export const MODES = { quiz: 'クイズ', test: 'テスト', review: '過去問復習' };

/**
 * セーブに残っている、もう無い問題（同期で外した問題など）を、過去問復習と直近の出題から外す。
 * 残したままだと「過去問復習」が押せるのに1問も出ない。外した数を返す
 */
export function forgetMissingQuestions(state, ctx) {
  const ids = new Set(ctx.questions.map((q) => q.id));
  const k = state.knowledge;
  const before = k.review.length;
  k.review = k.review.filter((id) => ids.has(id));
  k.recent = k.recent.filter((id) => ids.has(id));
  return before - k.review.length;
}

/* ================= 出題の選び方 ================= */

/** 熟練Lvに応じた割合で難易度（1〜5）を選ぶ */
export function pickDifficulty(level, balance, rng) {
  const table = balance.quiz.difficultyMixByLevel;
  const mix = table[Math.max(0, Math.min(table.length - 1, level))];
  const total = mix.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let i = 0; i < mix.length; i++) {
    r -= mix[i];
    if (r < 0 && mix[i] > 0) return i + 1;
  }
  for (let i = mix.length - 1; i >= 0; i--) if (mix[i] > 0) return i + 1;
  return 1;
}

/** クイズで使う熟練Lv：全ジャンルの熟練の平均を四捨五入 */
export function averageLevel(state) {
  const sum = GENRES.reduce((s, g) => s + (state.knowledge.genres[g] ? state.knowledge.genres[g].level : 0), 0);
  return Math.round(sum / GENRES.length);
}

/**
 * 候補から1問選ぶ。直近の問題（avoid）は避けるが、候補が無くなったら重複を許す。
 * 選んだ難易度の問題が無ければ、近い難易度から選ぶ（同じ近さなら易しいほう）。
 */
export function pickQuestion(candidates, level, avoid, ctx) {
  if (!candidates.length) return null;
  const fresh = candidates.filter((q) => !avoid.includes(q.id));
  const pool = fresh.length ? fresh : candidates;
  const want = pickDifficulty(level, ctx.balance, ctx.rng);
  let best = null;
  for (const q of pool) {
    const d = Math.abs(q.difficulty - want);
    if (best == null || d < best.d || (d === best.d && q.difficulty < best.diff)) best = { d, diff: q.difficulty };
  }
  const same = pool.filter((q) => q.difficulty === best.diff);
  return same[Math.floor(ctx.rng() * same.length)];
}

/** 解答＋誤答を無作為に並べる。誤答1（wrong[0]）は俗説の枠 */
export function buildChoices(q, rng) {
  const choices = [{ text: q.answer, kind: 'answer' }];
  q.wrong.forEach((w, i) => { if (w) choices.push({ text: w, kind: i === 0 ? 'myth' : 'wrong' }); });
  for (let i = choices.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [choices[i], choices[j]] = [choices[j], choices[i]];
  }
  return choices;
}

export const timeLimitFor = (difficulty, balance) => balance.quiz.timeLimitSec[Math.max(1, Math.min(5, difficulty)) - 1];

/* ================= 1回分の勉強（セッション） ================= */

/**
 * mode: 'quiz'（全ジャンルから1問）| 'test'（genre から testQuestions 問）| 'review'（過去問復習、最大 testQuestions 問）
 */
export function createSession(state, mode, ctx, genre = null) {
  let total = 1;
  if (mode === 'test') total = ctx.balance.quiz.testQuestions;
  if (mode === 'review') total = Math.min(ctx.balance.quiz.testQuestions, state.knowledge.review.length);
  return { mode, genre, total, index: 0, asked: [], current: null, results: [] };
}

export function candidatesFor(state, session, ctx) {
  if (session.mode === 'test') return ctx.questions.filter((q) => q.genre === session.genre);
  if (session.mode === 'review') return ctx.questions.filter((q) => state.knowledge.review.includes(q.id));
  return ctx.questions;
}

/** 次の問題を出す。出せなければ null（セッション終了） */
export function nextQuestion(state, session, ctx) {
  if (session.index >= session.total) { session.current = null; return null; }
  const cands = candidatesFor(state, session, ctx);
  const level = session.mode === 'test' ? genreState(state, session.genre).level : averageLevel(state);
  const avoid = [...state.knowledge.recent, ...session.asked];
  const q = pickQuestion(cands, level, avoid, ctx);
  if (!q) { session.current = null; return null; }
  const cur = presentQuestion(session, q, ctx);
  trimChoices(state, cur, ctx);
  return cur;
}

/**
 * 科学史（学際分野）：小ボス（かつての学説）と戦っている間、誤答が1つ消える。
 * 消すのは俗説の枠（誤答1）ではない誤答。消したら current.trimmedBy に学際分野の名前を入れる
 */
function trimChoices(state, cur, ctx) {
  const id = 'history_of_science';
  if (!fieldActive(state, ctx, id) || !state.adventure.enemies.some((e) => e.kind === 'boss')) return;
  const wrong = cur.choices.filter((c) => c.kind === 'wrong');
  if (!wrong.length) return;
  cur.choices.splice(cur.choices.indexOf(wrong[Math.floor(ctx.rng() * wrong.length)]), 1);
  cur.trimmedBy = fieldById(ctx, id).name;
}

/** 決まった問題を出す（nextQuestion の中身。テストでも使う） */
export function presentQuestion(session, q, ctx) {
  session.asked.push(q.id);
  session.current = {
    question: q,
    choices: buildChoices(q, ctx.rng),
    timeLimit: timeLimitFor(q.difficulty, ctx.balance),
  };
  return session.current;
}

/** この問題に関連する魔物が今の群れにいれば、その敵（口を挟めるかどうかは問わない） */
function relatedEnemy(state, question, ctx) {
  if (!question.monster) return null;
  const m = ctx.monsters.find((x) => x.name === question.monster);
  if (!m) return null;
  return state.adventure.enemies.find((e) => e.monsterId === m.id) || null;
}

/** 行動経済学（学際分野）：経済系の俗説の魔物（genres が blockGenres に入る）は口を挟めない。封じた学際分野を返す */
function blockedBy(state, monsterId, ctx) {
  const f = fieldById(ctx, 'behavioral_economics');
  if (!f || !fieldActive(state, ctx, f.id)) return null;
  const m = ctx.monsters.find((x) => x.id === monsterId);
  return m && (m.genres || []).some((g) => (f.blockGenres || []).includes(g)) ? f : null;
}

/** この問題に口を挟んでいる敵（今の群れの中に関連する魔物がいるとき。学際分野で封じた魔物は除く）。いなければ null */
export function interferingEnemy(state, question, ctx) {
  const e = relatedEnemy(state, question, ctx);
  return e && !blockedBy(state, e.monsterId, ctx) ? e : null;
}

/** 口を挟もうとしたが学際分野で封じられた魔物：{ monster, field }（いなければ null） */
export function blockedInterference(state, question, ctx) {
  const e = relatedEnemy(state, question, ctx);
  const f = e && blockedBy(state, e.monsterId, ctx);
  return f ? { monster: ctx.monsters.find((m) => m.id === e.monsterId), field: f } : null;
}

/** この問題に口を挟んでいる魔物（monsters.json の定義）。いなければ null */
export function interferingMonster(state, question, ctx) {
  const e = interferingEnemy(state, question, ctx);
  return e ? ctx.monsters.find((m) => m.id === e.monsterId) || null : null;
}

function pushRecent(state, id, ctx) {
  const r = state.knowledge.recent;
  const i = r.indexOf(id);
  if (i >= 0) r.splice(i, 1);
  r.push(id);
  while (r.length > ctx.balance.quiz.recentAvoid) r.shift();
}

/**
 * 答える。choiceIndex が null なら時間切れ（不正解）。
 * 干渉の判定は答えた瞬間の敵の群れで行う。
 * 正解：干渉していればその魔物に大ダメージ、そうでなければ群れの先頭にダメージ。
 * 俗説（誤答1）を選んだ：干渉している魔物が回復する。
 * 返り値の events は sim.tick と同じ形（描画・通知用）
 */
export function answer(state, session, choiceIndex, ctx) {
  const cur = session.current;
  const q = cur.question;
  const qb = ctx.balance.quiz;
  const choice = choiceIndex == null ? null : cur.choices[choiceIndex];
  const correct = !!choice && choice.kind === 'answer';
  const k = state.knowledge;
  const g = genreState(state, q.genre);
  const relatedMonster = q.monster ? ctx.monsters.find((m) => m.name === q.monster) || null : null;
  const interferer = interferingEnemy(state, q, ctx);
  const blocked = blockedInterference(state, q, ctx);
  const target = interferer || state.adventure.enemies[0] || null;
  const events = [];
  const res = {
    correct, timeout: choiceIndex == null, chose: choice ? choice.kind : null,
    interfered: !!interferer, monsterId: relatedMonster ? relatedMonster.id : null,
    blocked: blocked ? { name: blocked.monster.name, field: blocked.field.name } : null, // 学際分野で口出しを封じた魔物
    targetName: target ? target.name : null,
    targetMidboss: target && target.kind === 'midboss' ? target.monsterId : null,
    levelUp: null, fooled: false, damage: 0, healed: 0, defeated: false, midbossBroken: false,
    zukan: [], events,
  };

  g.studied = true;
  pushRecent(state, q.id, ctx);

  if (correct) {
    g.correct++;
    k.totalCorrect++;
    if (g.level < proficiencyCap(state, ctx.balance)) {
      g.progress++;
      if (g.progress >= qb.correctPerProficiencyLevel) {
        g.progress = 0;
        g.level++;
        res.levelUp = { genre: q.genre, level: g.level };
      }
    }
    const ri = k.review.indexOf(q.id);
    if (ri >= 0) k.review.splice(ri, 1);
    if (relatedMonster && raiseZukan(state, relatedMonster.id, 2, events)) res.zukan.push({ monsterId: relatedMonster.id, stage: 2 });

    // 中ボスの防御は累計の正解数で崩れる（出てくる前の正解も数える）
    if (breakMidbosses(state, ctx, events).length) res.midbossBroken = true;
    if (target) {
      // 中ボスには正解のダメージを小さくする（勉強だけで一気に倒せないように）
      const ratio = interferer ? qb.interferedCorrectDamageRatio
        : target.kind === 'midboss' ? (qb.midbossDamageRatio ?? qb.correctDamageRatio) : qb.correctDamageRatio;
      res.damage = damageEnemy(state, Math.ceil(target.maxHp * ratio), ctx, events, 'quiz', target);
      res.defeated = !state.adventure.enemies.includes(target);
    }
  } else {
    if (!k.review.includes(q.id)) k.review.push(q.id);
    if (interferer && choice && choice.kind === 'myth') {
      res.fooled = true;
      zukanEntry(state, interferer.monsterId).fooled++;
      res.healed = healEnemy(state, interferer.maxHp * qb.mythHealRatio, events, interferer);
    }
  }

  session.results.push(res);
  session.index++;
  session.current = null;
  return res;
}

/* ================= 心理統計学（学際分野） ================= */

/**
 * どの俗説に騙されやすいか。図鑑の騙された回数を多い順に並べ、魔物のジャンルごとにも合計する。
 * review は過去問復習に残っている（間違えたままの）問題の数をジャンルごとに数えたもの
 */
export function fooledAnalysis(state, ctx) {
  const myths = ctx.monsters
    .map((m) => ({ monster: m, fooled: (state.knowledge.zukan[m.id] || {}).fooled || 0 }))
    .filter((x) => x.fooled > 0)
    .sort((a, b) => b.fooled - a.fooled);
  const count = (pairs) => Object.entries(pairs.reduce((acc, [k, n]) => ({ ...acc, [k]: (acc[k] || 0) + n }), {}))
    .map(([genre, n]) => ({ genre, count: n })).sort((a, b) => b.count - a.count);
  const reviewQs = state.knowledge.review.map((id) => ctx.questions.find((q) => q.id === id)).filter(Boolean);
  return {
    total: myths.reduce((sum, x) => sum + x.fooled, 0),
    myths,
    genres: count(myths.flatMap((x) => (x.monster.genres || []).map((g) => [g, x.fooled]))),
    review: count(reviewQs.map((q) => [q.genre, 1])),
  };
}
