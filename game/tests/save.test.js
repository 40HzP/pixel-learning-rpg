import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serialize, deserialize, SAVE_VERSION, MIGRATIONS } from '../js/save.js';
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

test('版1のセーブ（敵が1体・名前やMPが無い）を版2に移行できる', () => {
  const v1 = {
    version: 1,
    state: {
      meta: { startAge: 0 },
      life: { generation: 1, gameHours: 1234 },
      hero: { level: 7, exp: 3, totalExp: 120, hp: 40 },
      gold: 77,
      adventure: { floor: 3, kills: 2, enemy: { monsterId: 'tsugihakuro', name: 'ツギハクロ', kind: 'monster', maxHp: 20, hp: 9, atk: 4, def: 1, exp: 6, gold: 4, cd: 0.5 }, spawnTimer: 0, heroCd: 0.2 },
      knowledge: { genres: { 生物: { level: 1, progress: 3, correct: 13, studied: true } }, totalCorrect: 13, review: [], recent: [], zukan: {} },
    },
  };
  const s = deserialize(JSON.stringify(v1), balance);
  assert.equal(s.adventure.enemy, undefined);
  assert.equal(s.adventure.enemies.length, 1);
  assert.equal(s.adventure.enemies[0].hp, 9, '戦っていた敵はそのまま');
  assert.equal(s.adventure.enemies[0].uid, 1);
  assert.equal(s.adventure.nextUid, 2);
  assert.equal(s.hero.name, '主人公', '名前は既定値');
  assert.equal(s.hero.mp, balance.hero.base.mp, 'MPは既定値');
  assert.equal(s.hero.level, 7);
  assert.equal(s.gold, 77);
  assert.equal(s.knowledge.totalCorrect, 13);
  // 続けて遊べる
  const ctx = makeCtx(seededRng(2));
  for (let i = 0; i < 30; i++) tick(s, 1, ctx);
  assert.ok(s.hero.totalExp > 120);
});

test('移行は版ごとに順につながる（版4を足したと仮定）', () => {
  const migrations = {
    ...MIGRATIONS,
    3: (save) => { save.state.wallet = { gold: save.state.gold }; delete save.state.gold; save.version = 4; return save; },
  };
  const s = playedState();
  const back = deserialize(serialize(s), balance, { migrations, version: 4 });
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

test('版2→3：会社1つ（company）と社員（staff）は、会社の並び（companies）の1つ目とその新人の社員になる', () => {
  const s = newGame(0);
  const v2 = JSON.parse(serialize(s));
  v2.version = 2;
  delete v2.state.companies; delete v2.state.nextCompanyUid;
  v2.state.company = { industry: 'pharma', foundedAt: 123 };
  v2.state.staff = [{ id: 'sales', name: '営業', paidUntil: 999 }, { id: 'clerk', name: '事務員', paidUntil: 888 }];
  const back = deserialize(JSON.stringify(v2), balance);
  assert.deepEqual(back.companies, [{ uid: 1, industry: 'pharma', foundedAt: 123, staff: [{ id: 'sales', grade: 0, paidUntil: 999 }, { id: 'clerk', grade: 0, paidUntil: 888 }] }]);
  assert.equal(back.nextCompanyUid, 2);
  assert.ok(!('company' in back) && !('staff' in back));
  // 会社が無いのに雇っていた社員は、契約を終える
  const v2b = JSON.parse(JSON.stringify(v2));
  v2b.state.company = null;
  const back2 = deserialize(JSON.stringify(v2b), balance);
  assert.deepEqual(back2.companies, []);
  assert.equal(back2.nextCompanyUid, 1);
});
