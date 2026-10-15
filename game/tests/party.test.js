import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tick, spawnGroup, setInParty, partyAllies, inParty, hireRecruit } from '../js/sim.js';
import { makeCtx, newGame, constRng } from './helpers.js';

/** 中ボスだった仲間を2人と、契約した仲間を1人つれた主人公 */
function withAllies() {
  const s = newGame(7);
  s.allies.push(
    { id: 'teacher_elementary', name: '小学校教師', atk: 50, maxHp: 100, hp: 100, cd: 0.1 },
    { id: 'teacher_junior', name: '中学校教師', atk: 50, maxHp: 100, hp: 100, cd: 0.1 },
  );
  s.gold = 1e6;
  return s;
}

test('中ボスだった仲間は、パーティーに入れたり外したり（控え）をいつでも選べる。最初はパーティーにいる', () => {
  const s = withAllies();
  const ctx = makeCtx(constRng(0.5));
  assert.deepEqual(partyAllies(s).map((a) => a.id), ['teacher_elementary', 'teacher_junior']);
  assert.equal(setInParty(s, 'teacher_junior', false), true);
  assert.equal(inParty(s.allies[1]), false);
  assert.deepEqual(partyAllies(s).map((a) => a.id), ['teacher_elementary']);
  assert.equal(setInParty(s, 'teacher_junior', true), true);
  assert.equal(inParty(s.allies[1]), true);
  assert.ok(!('benched' in s.allies[1]), 'パーティーに戻すと印は消える（セーブの形は前と同じ）');
  // 契約した仲間は対象外（やめるときは解約）
  assert.equal(hireRecruit(s, 'warrior', ctx).ok, true);
  assert.equal(setInParty(s, 'warrior', false), false);
  assert.equal(setInParty(s, 'nobody', false), false);
});

test('控えの仲間は戦わない。パーティーの仲間は戦う', () => {
  const s = withAllies();
  const ctx = makeCtx(constRng(0.5));
  setInParty(s, 'teacher_junior', false);
  s.hero.hp = 1e9;
  spawnGroup(s, ctx, []);
  const ev = [];
  for (let t = 0; t < 6; t += 0.5) ev.push(...tick(s, 0.5, ctx));
  const by = new Set(ev.filter((e) => e.type === 'attack' && e.by === 'ally').map((e) => e.allyId));
  assert.ok(by.has('teacher_elementary'), 'パーティーの仲間は攻撃する');
  assert.ok(!by.has('teacher_junior'), '控えの仲間は攻撃しない');
});
