import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serialize, deserialize, SAVE_VERSION } from '../js/save.js';
import { tick, buyItem } from '../js/sim.js';
import { createSession, nextQuestion, answer } from '../js/quiz.js';
import { balance, makeCtx, newGame, seededRng } from './helpers.js';

function playedState() {
  const s = newGame(0);
  const ctx = makeCtx(seededRng(11));
  for (let i = 0; i < 120; i++) tick(s, 1, ctx);
  for (let i = 0; i < 4; i++) {
    const sess = createSession(s, 'quiz', ctx);
    nextQuestion(s, sess, ctx);
    answer(s, sess, i % 2 ? 0 : null, ctx);
  }
  s.gold += 100;
  buyItem(s, 'wood_sword', ctx);
  return s;
}

test('セーブを書き出して読み込むと状態が一致する', () => {
  const s = playedState();
  const text = serialize(s, 123);
  assert.equal(JSON.parse(text).version, SAVE_VERSION);
  assert.deepEqual(deserialize(text, balance), s);
});

test('セーブに無い項目は既定値で埋める（項目を足したとき）', () => {
  const s = playedState();
  const save = JSON.parse(serialize(s));
  delete save.state.life.generation;
  delete save.state.knowledge.zukan;
  delete save.state.lastSleep;
  const back = deserialize(JSON.stringify(save), balance);
  assert.equal(back.life.generation, 1);
  assert.deepEqual(back.knowledge.zukan, {});
  assert.equal(back.lastSleep, null);
  assert.equal(back.hero.level, s.hero.level);
});

test('古い版のセーブを移行できる', () => {
  // 版1→版2で「所持金を gold から wallet.gold に移した」と仮定した移行
  const migrations = {
    1: (save) => {
      save.state.wallet = { gold: save.state.gold };
      delete save.state.gold;
      save.version = 2;
      return save;
    },
  };
  const s = playedState();
  const old = serialize(s); // 版1
  const back = deserialize(old, balance, { migrations, version: 2 });
  assert.equal(back.wallet.gold, s.gold);
  assert.equal(back.hero.totalExp, s.hero.totalExp);
});

test('新しすぎる版・移行できない版・壊れた文字列は読めない', () => {
  const s = newGame(0);
  const future = JSON.stringify({ version: SAVE_VERSION + 1, state: s });
  assert.throws(() => deserialize(future, balance), /新しい版/);
  assert.throws(() => deserialize(JSON.stringify({ state: s }), balance), /移行できません/);
  assert.throws(() => deserialize('{broken', balance), /壊れています/);
});
