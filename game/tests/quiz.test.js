import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSession, nextQuestion, presentQuestion, answer, buildChoices, pickDifficulty, pickQuestion, averageLevel, timeLimitFor, forgetMissingQuestions } from '../js/quiz.js';
import { genreState, spawnEnemy } from '../js/sim.js';
import { balance, makeCtx, newGame, questions, constRng, seededRng, questionFor } from './helpers.js';

const answerIndex = (cur) => cur.choices.findIndex((c) => c.kind === 'answer');
const mythIndex = (cur) => cur.choices.findIndex((c) => c.kind === 'myth');

test('選択肢は4つで、解答がちょうど1つ含まれる', () => {
  const rng = seededRng(1);
  for (const q of questions) {
    const c = buildChoices(q, rng);
    assert.equal(c.length, 4);
    assert.equal(c.filter((x) => x.kind === 'answer').length, 1);
    assert.equal(c.filter((x) => x.kind === 'myth').length, 1);
    assert.deepEqual(new Set(c.map((x) => x.text)), new Set([q.answer, ...q.wrong]));
  }
});

test('正解10回で熟練Lvが1上がり、最大5で止まる', () => {
  const s = newGame(0);
  const ctx = makeCtx();
  const q = questions.find((x) => x.genre === '生物');
  const g = genreState(s, '生物');
  for (let n = 1; n <= 60; n++) {
    const sess = createSession(s, 'quiz', ctx);
    const cur = presentQuestion(sess, q, ctx);
    const r = answer(s, sess, answerIndex(cur), ctx);
    assert.equal(r.correct, true);
    if (n === 9) assert.equal(g.level, 0);
    if (n === 10) { assert.equal(g.level, 1); assert.deepEqual(r.levelUp, { genre: '生物', level: 1 }); }
  }
  assert.equal(g.level, 5);
  assert.equal(g.correct, 60);
  assert.equal(s.knowledge.totalCorrect, 60);
});

test('不正解・時間切れは過去問復習に入り、正解すると外れる', () => {
  const s = newGame(0);
  const ctx = makeCtx();
  const q = questions[0];
  let sess = createSession(s, 'quiz', ctx);
  presentQuestion(sess, q, ctx);
  const r = answer(s, sess, null, ctx);
  assert.equal(r.timeout, true);
  assert.equal(r.correct, false);
  assert.deepEqual(s.knowledge.review, [q.id]);
  sess = createSession(s, 'review', ctx);
  assert.equal(sess.total, 1);
  const cur = nextQuestion(s, sess, ctx);
  assert.equal(cur.question.id, q.id);
  answer(s, sess, answerIndex(cur), ctx);
  assert.deepEqual(s.knowledge.review, []);
});

test('難易度の割合は熟練Lvの表に従う', () => {
  assert.equal(pickDifficulty(0, balance, constRng(0.0)), 1);
  assert.equal(pickDifficulty(0, balance, constRng(0.69)), 1);
  assert.equal(pickDifficulty(0, balance, constRng(0.71)), 2);
  assert.equal(pickDifficulty(0, balance, constRng(0.999)), 2);   // Lv0 に☆☆☆以上は無い
  assert.equal(pickDifficulty(5, balance, constRng(0.0)), 2);     // Lv5 に☆は無い
  assert.equal(pickDifficulty(5, balance, constRng(0.999)), 5);
});

test('その難易度の問題が無ければ近い難易度から選ぶ', () => {
  const ctx = makeCtx(constRng(0.999)); // Lv5 → ☆☆☆☆☆ を選ぶ
  const cands = [{ id: 'a', difficulty: 1 }, { id: 'b', difficulty: 3 }];
  assert.equal(pickQuestion(cands, 5, [], ctx).id, 'b');
});

test('直近5問は避け、候補が無くなったら重複を許す', () => {
  const ctx = makeCtx(constRng(0));
  const cands = [{ id: 'a', difficulty: 1 }, { id: 'b', difficulty: 1 }];
  assert.equal(pickQuestion(cands, 0, ['a'], ctx).id, 'b');
  assert.equal(pickQuestion(cands, 0, ['a', 'b'], ctx).id, 'a');
  const s = newGame(0);
  const seen = [];
  for (let i = 0; i < 6; i++) {
    const se = createSession(s, 'quiz', makeCtx(seededRng(i)));
    const cur = nextQuestion(s, se, makeCtx(seededRng(i)));
    assert.ok(!seen.slice(-5).includes(cur.question.id), '直近5問と重ならない');
    seen.push(cur.question.id);
    answer(s, se, 0, makeCtx());
  }
  assert.equal(s.knowledge.recent.length, 5);
});

test('テストは指定ジャンルから5問。クイズは全ジャンルの平均Lvを使う', () => {
  const s = newGame(0);
  const ctx = makeCtx(seededRng(3));
  const sess = createSession(s, 'test', ctx, '統計学');
  assert.equal(sess.total, 5);
  let n = 0;
  while (nextQuestion(s, sess, ctx)) {
    assert.equal(sess.current.question.genre, '統計学');
    answer(s, sess, 0, ctx);
    n++;
  }
  assert.equal(n, 5);
  for (const g of ['生物', '数学', '物理']) genreState(s, g).level = 5;
  assert.equal(averageLevel(s), Math.round(15 / 29));
});

test('干渉：関連する魔物と戦っているときに正解すると撃破、図鑑の正体が開く', () => {
  const s = newGame(0);
  const ctx = makeCtx();
  spawnEnemy(s, ctx, [], 'tsugihakuro');
  const sess = createSession(s, 'quiz', ctx);
  const cur = presentQuestion(sess, questionFor('ツギハクロ'), ctx);
  const r = answer(s, sess, answerIndex(cur), ctx);
  assert.equal(r.interfered, true);
  assert.equal(r.defeated, true);
  assert.deepEqual(s.adventure.enemies, []);
  assert.equal(s.knowledge.zukan.tsugihakuro.stage, 2);
});

test('干渉：俗説を選ぶと魔物が回復し、騙された回数が増え、過去問復習に入る', () => {
  const s = newGame(0);
  const ctx = makeCtx();
  const e = spawnEnemy(s, ctx, [], 'tsugihakuro');
  e.hp = 1;
  const sess = createSession(s, 'quiz', ctx);
  const q = questionFor('ツギハクロ');
  const cur = presentQuestion(sess, q, ctx);
  const r = answer(s, sess, mythIndex(cur), ctx);
  assert.equal(r.fooled, true);
  assert.equal(e.hp, 1 + Math.round(e.maxHp * balance.quiz.mythHealRatio));
  assert.equal(s.knowledge.zukan.tsugihakuro.fooled, 1);
  assert.ok(s.knowledge.review.includes(q.id));
});

test('干渉していないとき：正解は最大HPの50%、俗説を選んでも回復しない', () => {
  const s = newGame(0);
  const ctx = makeCtx();
  const e = spawnEnemy(s, ctx, [], 'nidoochizu');
  const sess = createSession(s, 'quiz', ctx);
  let cur = presentQuestion(sess, questionFor('ツギハクロ'), ctx);
  let r = answer(s, sess, answerIndex(cur), ctx);
  assert.equal(r.interfered, false);
  assert.equal(r.damage, Math.ceil(e.maxHp * 0.5));
  const hp = e.hp;
  cur = presentQuestion(sess, questionFor('ツギハクロ'), ctx);
  r = answer(s, sess, mythIndex(cur), ctx);
  assert.equal(r.fooled, false);
  assert.equal(e.hp, hp);
  assert.equal(s.knowledge.zukan.tsugihakuro.fooled, 0);
});

test('制限時間は難易度ごとに balance.json の値（☆1が20秒〜☆5が70秒）', () => {
  assert.deepEqual([1, 2, 3, 4, 5].map((d) => timeLimitFor(d, balance)), [20, 30, 40, 55, 70]);
});

test('同期で外した問題は、過去問復習と直近の出題から外す（復習が押せるのに出ない、を防ぐ）', () => {
  const s = newGame(0);
  const ctx = makeCtx(constRng(0.5));
  const keep = questions[0].id;
  s.knowledge.review = [keep, 'gone-question-id'];
  s.knowledge.recent = ['gone-question-id', keep];
  assert.equal(forgetMissingQuestions(s, ctx), 1);
  assert.deepEqual(s.knowledge.review, [keep]);
  assert.deepEqual(s.knowledge.recent, [keep]);
  const sess = createSession(s, 'review', ctx);
  assert.equal(sess.total, 1);
  assert.ok(nextQuestion(s, sess, ctx), '残った問題は出る');
});
