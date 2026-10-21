import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeAuthorCode, ensureAuthorCode, adoptedQuestions, takeNewAdoptions } from '../js/quiz.js';
import { reincarnate } from '../js/sim.js';
import { GENRES } from '../js/genres.js';
import { serialize, deserialize } from '../js/save.js';
import { balance, questions, makeCtx, newGame, seededRng } from './helpers.js';

const submit = JSON.parse(readFileSync(fileURLToPath(new URL('../data/submit.json', import.meta.url)), 'utf8'));

test('作問者コードは XXXX-XXXX（見まちがえやすい 0・O・1・I は使わない）。一度決まると変わらず、生まれ変わっても同じ', () => {
  const rng = seededRng(3);
  for (let i = 0; i < 50; i++) assert.match(makeAuthorCode(rng), /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  const s = newGame(7);
  assert.equal(s.legacy.author.code, null);
  const code = ensureAuthorCode(s, rng);
  assert.equal(ensureAuthorCode(s, rng), code, '2回目は同じコード');
  reincarnate(s, makeCtx());
  assert.equal(s.legacy.author.code, code);
});

test('採用された問題：questions.json の author.code が作問者コードと同じ問題（大文字小文字・ハイフンのちがいは同じとみなす）。起動したときに一度だけ知らせる', () => {
  const s = newGame(7);
  s.legacy.author.code = 'K7Q2-9MXP';
  const qs = questions.slice(0, 4).map((q, i) => ({ ...q, author: i < 2 ? { code: i === 0 ? 'K7Q2-9MXP' : 'k7q29mxp', name: '問題好き' } : i === 2 ? { code: 'ZZZZ-ZZZZ', name: null } : undefined }));
  const ctx = { ...makeCtx(), questions: qs };
  assert.deepEqual(adoptedQuestions(s, ctx).map((q) => q.id), [qs[0].id, qs[1].id]);
  assert.deepEqual(takeNewAdoptions(s, ctx).map((q) => q.id), [qs[0].id, qs[1].id]);
  assert.deepEqual(takeNewAdoptions(s, ctx), [], '知らせるのは一度だけ');
  // コードが無ければ、どの問題も自分のものではない
  const t = newGame(7);
  assert.deepEqual(adoptedQuestions(t, ctx), []);
});

test('作問者コードと知らせた問題はセーブに残る。前のセーブも読める', () => {
  const s = newGame(7);
  s.legacy.author = { code: 'ABCD-EFGH', seen: ['x'] };
  assert.deepEqual(deserialize(serialize(s), balance).legacy.author, { code: 'ABCD-EFGH', seen: ['x'] });
  const old = JSON.parse(serialize(s));
  delete old.state.legacy.author;
  assert.deepEqual(deserialize(JSON.stringify(old), balance).legacy.author, { code: null, seen: [] });
});

test('作問フォーム（data/submit.json）：必ず書くのは問題文・解答・メインジャンル（選択式）・解説の4つ', () => {
  assert.equal(typeof submit.formUrl, 'string');
  assert.deepEqual(submit.required, ['問題文', '解答', 'メインジャンル（選択式）', '解説']);
  assert.ok(submit.optional.length > 0);
  if (submit.formUrl) assert.match(submit.formUrl, /^https:\/\//);
});

test('問題ジャンルは設計ページの38個（都市計画・気象学・哲学・美術・考古学を足した）', () => {
  assert.equal(GENRES.length, 38);
  for (const g of ['都市計画', '気象学', '哲学', '美術', '考古学']) assert.ok(GENRES.includes(g), g);
  assert.equal(new Set(GENRES).size, GENRES.length);
});
