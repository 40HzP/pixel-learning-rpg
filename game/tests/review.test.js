import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSession, presentQuestion, answer, nextQuestion, presentTest, gradeTest, toggleFavorite, isFavorite, reviewLists, forgetMissingQuestions } from '../js/quiz.js';
import { reincarnate } from '../js/sim.js';
import { serialize, deserialize } from '../js/save.js';
import { balance, questions, makeCtx, newGame } from './helpers.js';

/** 問題 q に答える（right：正解を選ぶか、俗説でない誤答を選ぶか。null なら時間切れ） */
function solve(s, ctx, q, right) {
  const sess = createSession(s, 'quiz', ctx);
  const cur = presentQuestion(sess, q, ctx);
  const i = right == null ? null : cur.choices.findIndex((c) => (right ? c.kind === 'answer' : c.kind !== 'answer'));
  return answer(s, sess, i, ctx);
}

test('過去問復習の「最近解いた問題」：正解でも不正解でも、新しい順に10問まで。同じ問題は新しいほうだけ（40HzP の依頼）', () => {
  const s = newGame(7);
  const ctx = makeCtx();
  assert.equal(balance.quiz.historySize, 10);
  for (let i = 0; i < 12; i++) solve(s, ctx, questions[i], i % 2 === 0);
  const h = s.knowledge.history;
  assert.equal(h.length, 10);
  assert.deepEqual(h.map((x) => x.id), questions.slice(2, 12).map((q) => q.id).reverse(), '新しい順');
  assert.deepEqual(h.map((x) => x.correct), [false, true, false, true, false, true, false, true, false, true]);
  assert.equal(h[1].chosen, questions[10].answer, '選んだ選択肢の文を残す');
  assert.ok(h[0].chosen && h[0].chosen !== questions[11].answer);
  solve(s, ctx, questions[5], null); // もう一度答えると先頭へ（時間切れは選んだ文なし）
  assert.equal(s.knowledge.history.length, 10);
  assert.deepEqual(s.knowledge.history[0], { id: questions[5].id, correct: false, chosen: null });
  assert.equal(s.knowledge.history.filter((x) => x.id === questions[5].id).length, 1);
});

test('テストの答えも最近解いた問題に入る。大喜利は書いた文も残す', () => {
  const s = newGame(7);
  const ctx = makeCtx();
  const genre = questions.find((q) => questions.filter((x) => x.genre === q.genre).length >= 2).genre;
  const sess = createSession(s, 'test', ctx, genre);
  const sheet = presentTest(s, sess, ctx);
  gradeTest(s, sess, sheet.map((cur, i) => (i === 0 ? { oogiri: '先生のメガネ' } : cur.choices.findIndex((c) => c.kind === 'answer'))), ctx);
  const h = s.knowledge.history;
  assert.equal(h.length, sheet.length);
  const first = h.find((x) => x.id === sheet[0].question.id);
  assert.deepEqual([first.correct, first.oogiri], [false, '先生のメガネ']);
  assert.ok(h.filter((x) => x.id !== sheet[0].question.id).every((x) => x.correct));
});

test('お気に入りは5問まで。いっぱいなら入れられず、外すと入れられる。入れた新しい順に並ぶ', () => {
  const s = newGame(7);
  const ctx = makeCtx();
  for (let i = 0; i < 5; i++) assert.deepEqual(toggleFavorite(s, questions[i].id, ctx), { ok: true, favorite: true });
  const full = toggleFavorite(s, questions[5].id, ctx);
  assert.equal(full.ok, false);
  assert.match(full.reason, /5問まで/);
  assert.equal(isFavorite(s, questions[5].id), false);
  assert.deepEqual(toggleFavorite(s, questions[2].id, ctx), { ok: true, favorite: false }, 'もう一度押すと外れる');
  assert.equal(toggleFavorite(s, questions[5].id, ctx).ok, true);
  assert.deepEqual(reviewLists(s, ctx).favorites.map((q) => q.id), [5, 4, 3, 1, 0].map((i) => questions[i].id));
});

test('解き直す：並べた問題を、その順に全部出す（直近に出した問題でも出す）。答えはふつうに数える', () => {
  const s = newGame(7);
  const ctx = makeCtx();
  for (let i = 0; i < 4; i++) solve(s, ctx, questions[i], false);
  const pool = reviewLists(s, ctx).recent.map((h) => h.id);
  const sess = createSession(s, 'review', ctx, null, pool);
  assert.equal(sess.total, 4);
  const asked = [];
  for (let cur = nextQuestion(s, sess, ctx); cur; cur = nextQuestion(s, sess, ctx)) {
    asked.push(cur.question.id);
    answer(s, sess, cur.choices.findIndex((c) => c.kind === 'answer'), ctx);
  }
  assert.deepEqual(asked, pool);
  assert.equal(s.knowledge.totalCorrect, 4);
  assert.ok(s.knowledge.history.slice(0, 4).every((h) => h.correct), '解き直した答えが最近解いた問題の先頭に来る');
});

test('最近解いた問題とお気に入りは、セーブに残り、生まれ変わっても残る。もう無い問題は外す', () => {
  const s = newGame(7);
  const ctx = makeCtx();
  solve(s, ctx, questions[0], true);
  toggleFavorite(s, questions[1].id, ctx);
  const back = deserialize(serialize(s, 0), balance);
  assert.equal(back.knowledge.history[0].id, questions[0].id);
  assert.deepEqual(back.knowledge.favorites, [questions[1].id]);
  reincarnate(back, ctx);
  assert.equal(back.knowledge.history.length, 1);
  assert.equal(back.knowledge.favorites.length, 1);
  const fewer = { ...ctx, questions: questions.slice(2) };
  forgetMissingQuestions(back, fewer);
  assert.deepEqual([back.knowledge.history, back.knowledge.favorites], [[], []]);
});
