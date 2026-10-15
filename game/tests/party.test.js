import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tick, spawnGroup, setInParty, partyAllies, inParty, partyFull, fitParty, hireRecruit, challengeMidboss, midbossState, HOURS_PER_YEAR } from '../js/sim.js';
import { balance, monsters, makeCtx, newGame, constRng } from './helpers.js';

const MAX = balance.ally.partyMax;
const boss = (id) => ({ id, name: monsters.find((m) => m.id === id).name, atk: 50, maxHp: 100, hp: 100, cd: 0.1 });

/** 中ボスだった仲間を n 人つれた主人公 */
function withAllies(n = 2) {
  const s = newGame(7);
  const ids = monsters.filter((m) => m.kind === 'midboss' && m.ally !== false).map((m) => m.id).slice(0, n);
  s.allies.push(...ids.map(boss));
  s.gold = 1e6;
  return s;
}

test('中ボスだった仲間は、パーティーに入れたり外したり（控え）をいつでも選べる。最初はパーティーにいる', () => {
  const s = withAllies(2);
  const ctx = makeCtx(constRng(0.5));
  assert.deepEqual(partyAllies(s).map((a) => a.id), ['teacher_elementary', 'teacher_junior']);
  assert.equal(setInParty(s, 'teacher_junior', false, ctx).ok, true);
  assert.equal(inParty(s.allies[1]), false);
  assert.deepEqual(partyAllies(s).map((a) => a.id), ['teacher_elementary']);
  assert.equal(setInParty(s, 'teacher_junior', true, ctx).ok, true);
  assert.equal(inParty(s.allies[1]), true);
  assert.ok(!('benched' in s.allies[1]), 'パーティーに戻すと印は消える（セーブの形は前と同じ）');
  // 契約した仲間は対象外（やめるときは解約）
  assert.equal(hireRecruit(s, 'warrior', ctx).ok, true);
  assert.equal(setInParty(s, 'warrior', false, ctx).ok, false);
  assert.equal(setInParty(s, 'nobody', false, ctx).ok, false);
});

test(`パーティーは契約した仲間と合わせて${MAX}人まで。いっぱいなら入れられず、契約もできない`, () => {
  const s = withAllies(MAX + 1);
  const ctx = makeCtx(constRng(0.5));
  setInParty(s, s.allies[MAX].id, false, ctx);
  assert.equal(partyAllies(s).length, MAX);
  assert.ok(partyFull(s, ctx));
  const res = setInParty(s, s.allies[MAX].id, true, ctx);
  assert.equal(res.ok, false);
  assert.match(res.reason, new RegExp(`${MAX}人まで`));
  assert.equal(hireRecruit(s, 'warrior', ctx).ok, false, 'いっぱいなら契約できない');
  setInParty(s, s.allies[0].id, false, ctx);
  assert.equal(hireRecruit(s, 'warrior', ctx).ok, true, '1人外すと契約できる');
  assert.ok(partyFull(s, ctx));
});

test('パーティーがいっぱいのときに中ボスを倒すと、その仲間は控えに入る', () => {
  const s = withAllies(MAX);
  const ctx = makeCtx(constRng(0.5));
  // 小学校教師〜高校教師（5人目まで）は仲間にいる。次の中ボスを倒す
  const next = monsters.filter((m) => m.kind === 'midboss')[MAX];
  for (const m of monsters.filter((x) => x.kind === 'midboss')) { if (m.id === next.id) break; midbossState(s, m.id).status = 'defeated'; }
  s.life.gameHours = next.appearAge * HOURS_PER_YEAR;
  s.knowledge.totalCorrect = 1000;
  s.hero.level = 400; s.hero.hp = 1e9;
  challengeMidboss(s, ctx, []);
  const ev = [];
  for (let t = 0; t < 120 && !ev.some((e) => e.type === 'allyJoined'); t += 0.5) ev.push(...tick(s, 0.5, ctx));
  const joined = ev.find((e) => e.type === 'allyJoined');
  assert.equal(joined.id, next.id);
  assert.equal(joined.benched, true);
  assert.equal(inParty(s.allies.find((a) => a.id === next.id)), false);
  assert.equal(partyAllies(s).length, MAX);
});

test(`前のセーブでパーティーが${MAX}人を超えていたら、後ろの中ボスだった仲間から控えに回す`, () => {
  const s = withAllies(MAX + 2);
  const ctx = makeCtx(constRng(0.5));
  const names = fitParty(s, ctx);
  assert.deepEqual(names, s.allies.slice(MAX).map((a) => a.name));
  assert.equal(partyAllies(s).length, MAX);
  assert.deepEqual(fitParty(s, ctx), [], '2回目は何もしない');
});

test(`控えの仲間は戦わない。戦うのはパーティーの${MAX}人まで`, () => {
  const s = withAllies(MAX + 2);
  const ctx = makeCtx(constRng(0.5));
  s.allies[MAX + 1].benched = true;      // 控え
  // s.allies[MAX] はパーティーの印のまま（上限を超えた分は戦わない）
  s.hero.hp = 1e9;
  spawnGroup(s, ctx, []);
  const ev = [];
  for (let t = 0; t < 6; t += 0.5) ev.push(...tick(s, 0.5, ctx));
  const by = new Set(ev.filter((e) => e.type === 'attack' && e.by === 'ally').map((e) => e.allyId));
  assert.ok(by.has(s.allies[0].id), 'パーティーの仲間は攻撃する');
  assert.ok(!by.has(s.allies[MAX + 1].id), '控えの仲間は攻撃しない');
  assert.ok(!by.has(s.allies[MAX].id), `${MAX + 1}人目は攻撃しない`);
  assert.ok(by.size <= MAX);
});
