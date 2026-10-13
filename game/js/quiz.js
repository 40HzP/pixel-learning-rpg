// 出題・判定・熟練（描画しない・ブラウザの機能に触らない）。
// ctx = { balance, monsters, items, questions, rng }（questions は questions.json の questions 配列）

import { GENRES, MAX_PROFICIENCY } from './genres.js';
import { genreState, raiseZukan, zukanEntry, midbossState, damageEnemy, healEnemy } from './sim.js';

export { GENRES };

export const MODES = { quiz: 'クイズ', test: 'テスト', review: '過去問復習' };

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
  return presentQuestion(session, q, ctx);
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

/** この問題に口を挟んでいる魔物（今戦っている敵が関連する魔物のとき）。無ければ null */
export function interferingMonster(state, question, ctx) {
  const e = state.adventure.enemy;
  if (!e || !question.monster) return null;
  const m = ctx.monsters.find((x) => x.name === question.monster);
  return m && m.id === e.monsterId ? m : null;
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
 * 干渉の判定は答えた瞬間の敵で行う。
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
  const interfering = interferingMonster(state, q, ctx);
  const enemy = state.adventure.enemy;
  const events = [];
  const res = {
    correct, timeout: choiceIndex == null, chose: choice ? choice.kind : null,
    interfered: !!interfering, monsterId: relatedMonster ? relatedMonster.id : null,
    levelUp: null, fooled: false, damage: 0, healed: 0, defeated: false, midbossBroken: false,
    zukan: [], events,
  };

  g.studied = true;
  pushRecent(state, q.id, ctx);

  if (correct) {
    g.correct++;
    k.totalCorrect++;
    if (g.level < MAX_PROFICIENCY) {
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

    if (enemy) {
      if (enemy.kind === 'midboss') {
        const st = midbossState(state, enemy.monsterId);
        const mb = ctx.monsters.find((m) => m.id === enemy.monsterId);
        if (st.status === 'appeared') {
          st.correct++;
          if (st.correct >= mb.unlockCorrect) {
            st.status = 'broken';
            res.midbossBroken = true;
            events.push({ type: 'midbossBroken', monsterId: enemy.monsterId });
          }
        }
      }
      const ratio = interfering ? qb.interferedCorrectDamageRatio : qb.correctDamageRatio;
      res.damage = damageEnemy(state, Math.ceil(enemy.maxHp * ratio), ctx, events, 'quiz');
      res.defeated = !state.adventure.enemy || state.adventure.enemy !== enemy;
    }
  } else {
    if (!k.review.includes(q.id)) k.review.push(q.id);
    if (interfering && choice && choice.kind === 'myth') {
      res.fooled = true;
      zukanEntry(state, interfering.id).fooled++;
      res.healed = healEnemy(state, enemy.maxHp * qb.mythHealRatio, events);
    }
  }

  session.results.push(res);
  session.index++;
  session.current = null;
  return res;
}
