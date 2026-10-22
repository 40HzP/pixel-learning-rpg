import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testShareText, SHARE_HASHTAG } from '../js/quiz.js';
import { regionAt, createDoodle } from '../js/ui/doodle.js';

const r = (correct, oogiri = null) => ({ correct, oogiri });

test('ツイートの文：名前・ジャンル・点数とハッシュタグ。公開した版ならゲームの場所も付ける', () => {
  const t = testShareText({ name: 'ゆうしゃ', genre: '数学', results: [r(true), r(false), r(true)], url: 'https://example.github.io/game/' });
  assert.equal(t, `ゆうしゃは「数学」のテストで3問中2問正解した！\n#${SHARE_HASHTAG}\nhttps://example.github.io/game/`);
  assert.ok(!testShareText({ name: 'a', genre: '数学', results: [r(true)] }).includes('http'), '場所が無ければ付けない');
});

test('ツイートの文：満点・0点・大喜利で答えた問題にひとこと', () => {
  assert.match(testShareText({ name: 'a', genre: '物理', results: [r(true), r(true)] }), /2問中2問正解した！満点！/);
  assert.match(testShareText({ name: 'a', genre: '物理', results: [r(false), r(false, 'ねこ')] }), /2問中0問正解した！0点…（大喜利で答えた問題：1問）/);
  // X は日本語を2文字に数えて280まで（140字ほど）。長い名前とジャンルでも収まる
  const long = testShareText({ name: 'あ'.repeat(8), genre: 'い'.repeat(10), results: Array(5).fill(r(false, 'x')), url: 'https://40hzp.github.io/pixel-learning-rpg/game/' });
  assert.ok(long.length < 140, long);
});

test('落書き：線は描き始めた場所の問題（無ければ用紙の上端）を基準に覚える', () => {
  const regions = [{ key: 'head', top: 0 }, { key: '0', top: 120 }, { key: '1', top: 400 }];
  assert.equal(regionAt(regions, 10).key, 'head');
  assert.equal(regionAt(regions, 119.5).key, 'head');
  assert.equal(regionAt(regions, 120).key, '0');
  assert.equal(regionAt(regions, 399).key, '0');
  assert.equal(regionAt(regions, 2000).key, '1');
  assert.deepEqual(createDoodle(), { strokes: [], pen: false }, 'はじめは何も描いていない・ペンはしまってある');
});
