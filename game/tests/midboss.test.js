import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tick, spawnEnemy, chooseNextMonster, midbossState } from '../js/sim.js';
import { createSession, presentQuestion, answer } from '../js/quiz.js';
import { makeCtx, newGame, questions, constRng } from './helpers.js';

const correctOnce = (s, ctx) => {
  const sess = createSession(s, 'quiz', ctx);
  const cur = presentQuestion(sess, questions[0], ctx);
  return answer(s, sess, cur.choices.findIndex((c) => c.kind === 'answer'), ctx);
};

test('7歳になるまでは小学校教師は出ない。7歳になったら次に出る', () => {
  const ctx = makeCtx(constRng(0.3));
  assert.equal(chooseNextMonster(newGame(0), ctx).kind, 'monster');
  assert.equal(chooseNextMonster(newGame(7), ctx).id, 'teacher_elementary');
});

test('中ボス：正解5回まではダメージ0、その後は自動攻撃も勉強も効く', () => {
  const s = newGame(7);
  const ctx = makeCtx(constRng(0.5));
  s.hero.hp = 99999;
  const ev = [];
  spawnEnemy(s, ctx, ev);
  assert.equal(ev.find((x) => x.type === 'spawn').first, true, '初めて出たときだけ first');
  const again = [];
  const e = spawnEnemy(s, ctx, again); // やられた後にまた出てきたとき
  assert.equal(again.find((x) => x.type === 'spawn').first, false);
  assert.equal(e.kind, 'midboss');
  assert.equal(s.adventure.enemy, e);
  assert.equal(midbossState(s, e.monsterId).status, 'appeared');

  const hits = tick(s, 3, ctx).filter((x) => x.type === 'attack' && x.by === 'hero');
  assert.ok(hits.length >= 2);
  assert.ok(hits.every((x) => x.dmg === 0), '自動攻撃は0');
  assert.equal(e.hp, e.maxHp);

  for (let i = 1; i <= 4; i++) {
    const r = correctOnce(s, ctx);
    assert.equal(r.damage, 0, `正解${i}回目はダメージ0`);
    assert.equal(r.midbossBroken, false);
  }
  const r5 = correctOnce(s, ctx);
  assert.equal(r5.midbossBroken, true);
  assert.equal(midbossState(s, e.monsterId).status, 'broken');
  assert.ok(r5.damage > 0, '崩れた後は勉強のダメージが入る');

  const hp = e.hp;
  const after = tick(s, 2, ctx).filter((x) => x.type === 'attack' && x.by === 'hero');
  assert.ok(after.length && after.every((x) => x.dmg > 0), '自動攻撃が効く');
  assert.ok(e.hp < hp || s.adventure.enemy !== e);
});

test('中ボスを倒すと仲間になり、以後は出てこない', () => {
  const s = newGame(7);
  const ctx = makeCtx(constRng(0.5));
  s.hero.hp = 99999;
  const e = spawnEnemy(s, ctx, []);
  midbossState(s, e.monsterId).status = 'broken';
  e.hp = 1;
  const events = tick(s, 1, ctx);
  assert.ok(events.some((x) => x.type === 'allyJoined' && x.id === 'teacher_elementary'));
  assert.equal(s.allies.length, 1);
  assert.equal(midbossState(s, 'teacher_elementary').status, 'defeated');
  assert.equal(s.knowledge.zukan.teacher_elementary.stage, 2);
  assert.equal(chooseNextMonster(s, ctx).kind, 'monster');
  const allyHits = tick(s, 5, ctx).filter((x) => x.type === 'attack' && x.by === 'ally');
  assert.ok(allyHits.length >= 1, '仲間も攻撃する');
});
