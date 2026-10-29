import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createSession, nextQuestion, answer, presentTest, dayKey, dayLabel, dailyQuestionFor, refreshDaily, dailyPending, dailyCardVisible, markDailyOpened, dailyInfo,
} from '../js/quiz.js';
import { genreState, reincarnate } from '../js/sim.js';
import { serialize, deserialize } from '../js/save.js';
import { balance, questions, makeCtx, newGame, seededRng } from './helpers.js';

// 出題日の付いた問題を混ぜた問題の並び（10月29日に2問、2月29日に1問。ほかは出題日なし）
const dated = questions.map((q, i) => (i === 3 ? { ...q, date: '10-29', anniversary: 'てすとの日' } : i === 4 ? { ...q, date: '10-29' } : i === 5 ? { ...q, date: '02-29' } : q));
const ctxWith = (qs = dated) => ({ ...makeCtx(), questions: qs });
const correctIndex = (cur) => cur.choices.findIndex((c) => c.kind === 'answer');
const wrongIndex = (cur) => cur.choices.findIndex((c) => c.kind !== 'answer');

test('日付：端末の時計から YYYY-MM-DD、表示は「10月29日」', () => {
  assert.equal(dayKey(new Date(2026, 9, 29, 23, 59)), '2026-10-29');
  assert.equal(dayKey(new Date(2027, 0, 5, 0, 0)), '2027-01-05');
  assert.equal(dayLabel('2026-01-05'), '1月5日');
});

test('今日の1問は、出題日（MM-DD、毎年くり返す）がその日の問題。同じ日の問題が2問なら日付で決まる1問。無い日は出題日の無い問題から', () => {
  const ctx = ctxWith();
  const a = dailyQuestionFor(ctx, '2026-10-29');
  assert.equal(a.date, '10-29');
  assert.equal(dailyQuestionFor(ctx, '2026-10-29').id, a.id, '同じ日は同じ問題');
  assert.equal(dailyQuestionFor(ctx, '2027-10-29').date, '10-29', '次の年の同じ日も、その日の問題');
  assert.equal(dailyQuestionFor(ctx, '2028-02-29').id, dated[5].id);
  const none = dailyQuestionFor(ctx, '2026-10-30');
  assert.ok(none && !none.date, 'その日の問題が無ければ、出題日の無い問題');
  assert.equal(dailyQuestionFor(ctx, '2026-10-30').id, none.id);
});

test('日付が変わったら今日の1問を入れ替えて、冒険画面に札を出す。開いて閉じると札は消える（掲示板に残る）', () => {
  const s = newGame(7);
  const ctx = ctxWith();
  assert.equal(dailyCardVisible(s, ctx), false, 'まだ日付を見ていない');
  assert.equal(refreshDaily(s, ctx, '2026-10-29'), true);
  assert.equal(refreshDaily(s, ctx, '2026-10-29'), false, '同じ日は入れ替えない');
  assert.deepEqual([dailyPending(s, ctx), dailyCardVisible(s, ctx)], [true, true]);
  const info = dailyInfo(s, ctx);
  assert.deepEqual([info.label, info.question.date, info.result], ['10月29日', '10-29', null]);
  assert.equal(info.anniversary, info.question.anniversary || null, '記念日は、その日の問題のときだけ');
  assert.equal(dailyInfo({ legacy: { daily: { day: '2026-10-30', id: dailyQuestionFor(ctx, '2026-10-30').id } } }, ctx).anniversary, null);
  markDailyOpened(s);
  assert.deepEqual([dailyPending(s, ctx), dailyCardVisible(s, ctx)], [true, false], '札は消えるが、まだ答えていない');
  assert.equal(refreshDaily(s, ctx, '2026-10-30'), true, '次の日');
  assert.deepEqual([s.legacy.daily.opened, dailyCardVisible(s, ctx)], [false, true]);
});

test('今日の1問に正解すると、熟練が5/10進む（ふつうの正解は1）。その日に1回だけ数える', () => {
  const s = newGame(7);
  const ctx = ctxWith();
  refreshDaily(s, ctx, '2026-10-29');
  const q = dailyInfo(s, ctx).question;
  const g = genreState(s, q.genre);
  g.progress = 7;
  const sess = createSession(s, 'daily', ctx);
  const cur = nextQuestion(s, sess, ctx);
  assert.equal(cur.question.id, q.id);
  const before = s.knowledge.totalCorrect;
  const r = answer(s, sess, correctIndex(cur), ctx);
  assert.equal(balance.quiz.dailyProgress, 5);
  assert.deepEqual(r.daily, { progress: 5 });
  assert.deepEqual([g.level, g.progress], [1, 2], '7 + 5 = 12 → Lv が1つ上がって 2/10');
  assert.deepEqual(r.levelUp, { genre: q.genre, level: 1 });
  assert.equal(s.knowledge.totalCorrect, before + 1, '累計の正解数は1つ');
  assert.equal(s.legacy.daily.result.correct, true);
  assert.equal(s.legacy.daily.opened, true, '答えたら札は消える');
  assert.equal(dailyPending(s, ctx), false);
  // もう1回は出ない。クイズもふつうの問題になり、正解しても1しか進まない
  assert.equal(nextQuestion(s, createSession(s, 'daily', ctx), ctx), null);
  const qs = createSession(s, 'quiz', ctx);
  const cur2 = nextQuestion(s, qs, ctx);
  assert.equal(qs.daily, null);
  const g2 = genreState(s, cur2.question.genre);
  const p0 = g2.progress, l0 = g2.level;
  const r2 = answer(s, qs, correctIndex(cur2), ctx);
  assert.equal(r2.daily, undefined);
  assert.equal(g2.level * 10 + g2.progress, l0 * 10 + p0 + 1);
});

test('クイズは、その日の最初の1問が今日の1問（まだ答えていなければ）。間違えても答えたことになる', () => {
  const s = newGame(7);
  const ctx = ctxWith();
  refreshDaily(s, ctx, '2026-10-29');
  const id = s.legacy.daily.id;
  const sess = createSession(s, 'quiz', ctx);
  const cur = nextQuestion(s, sess, ctx);
  assert.equal(cur.question.id, id);
  const g = genreState(s, cur.question.genre);
  const p0 = g.progress;
  const r = answer(s, sess, wrongIndex(cur), ctx);
  assert.deepEqual([r.correct, r.daily], [false, { progress: 0 }]);
  assert.equal(g.progress, p0);
  assert.deepEqual([s.legacy.daily.result.correct, dailyPending(s, ctx), dailyCardVisible(s, ctx)], [false, false, false]);
  assert.equal(createSession(s, 'quiz', ctx).daily, null, '次のクイズはふつうの問題');
});

test('テスト・孫の「なんで？」では今日の1問は出さない', () => {
  const s = newGame(7);
  const ctx = ctxWith();
  refreshDaily(s, ctx, '2026-10-29');
  const q = dailyInfo(s, ctx).question;
  const t = createSession(s, 'test', ctx, q.genre);
  assert.equal(t.daily, null);
  presentTest(s, t, ctx);
  const n = createSession(s, 'nande', ctx);
  assert.equal(n.daily, null);
  assert.ok(nextQuestion(s, n, ctx));
  assert.equal(dailyPending(s, ctx), true);
});

test('今日の1問はセーブに残り、生まれ変わっても残る（現実の日付のことなので）。前のセーブは「まだ」から始まる', () => {
  const s = newGame(7);
  const ctx = ctxWith();
  refreshDaily(s, ctx, '2026-10-29');
  markDailyOpened(s);
  const back = deserialize(serialize(s, 0), balance);
  assert.deepEqual(back.legacy.daily, s.legacy.daily);
  reincarnate(back, ctx);
  assert.equal(back.legacy.daily.id, s.legacy.daily.id);
  assert.equal(refreshDaily(back, ctx, '2026-10-29'), false);
  delete s.legacy.daily; // 前の版のセーブ
  const old = deserialize(serialize(s, 0), balance);
  assert.deepEqual(old.legacy.daily, { day: null, id: null, opened: false, result: null });
});

test('同期で今日の1問が無くなっていたら選び直す（答えたかどうかはそのまま）', () => {
  const s = newGame(7);
  const ctx = ctxWith();
  refreshDaily(s, ctx, '2026-10-29');
  const id = s.legacy.daily.id;
  const fewer = ctxWith(dated.filter((q) => q.id !== id));
  assert.equal(refreshDaily(s, fewer, '2026-10-29'), false);
  assert.notEqual(s.legacy.daily.id, id);
  assert.equal(dailyInfo(s, fewer).question.date, '10-29');
});

test('出題日のある問題も、メインジャンルのふつうの問題として出る（クイズ・テスト）。その日の今日の1問は、答えるまでほかでは出さない', () => {
  // 問題の多いジャンルの2問に出題日を付ける（10月29日と5月5日）
  const counts = {};
  for (const q of questions) counts[q.genre] = (counts[q.genre] || 0) + 1;
  const g = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
  const inG = questions.filter((q) => q.genre === g);
  const [today, other] = inG;
  const qs = questions.map((q) => (q.id === today.id ? { ...q, date: '10-29' } : q.id === other.id ? { ...q, date: '05-05' } : q));
  const ctx = ctxWith(qs);
  const sheetOf = (s) => { const t = createSession(s, 'test', ctx, g); t.total = inG.length - 1; return presentTest(s, t, ctx).map((c) => c.question.id); };

  // その日の今日の1問は、答えるまでテストに出さない（ほかの日の出題日の問題は出る）
  const s = newGame(7);
  refreshDaily(s, ctx, '2026-10-29');
  assert.equal(s.legacy.daily.id, today.id);
  const before = sheetOf(s);
  assert.ok(!before.includes(today.id), '今日の1問はまだテストに出さない');
  assert.ok(before.includes(other.id), 'ほかの日の出題日の問題は、メインジャンルのテストに出る');
  // 答えたあとは、ふつうの問題としてテストにも出る
  const sess = createSession(s, 'daily', ctx);
  answer(s, sess, correctIndex(nextQuestion(s, sess, ctx)), ctx);
  s.knowledge.recent = [];
  const t = createSession(s, 'test', ctx, g); t.total = inG.length;
  assert.ok(presentTest(s, t, ctx).some((c) => c.question.id === today.id), '答えたあとはテストにも出る');
  // クイズにも出題日のある問題が出る
  const only = { ...ctx, questions: qs.filter((q) => q.date) };
  const seen = new Set();
  for (let i = 1; i <= 12; i++) { s.knowledge.recent = []; const c = { ...only, rng: seededRng(i) }; seen.add(nextQuestion(s, createSession(s, 'quiz', c), c).question.id); }
  assert.ok(seen.has(other.id), 'クイズにも出題日のある問題が出る');
});
