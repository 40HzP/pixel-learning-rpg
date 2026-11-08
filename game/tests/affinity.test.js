// 懐き度（設計ページ「懐き度（2026-11-08）」）：飼育小屋のザコの懐き度と、つながる5つの機能
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  tameZako, barnEntry, affinityOf, isFriendly, isReformed, raiseAffinity, touchZako, birthday, flyPrototype, seeOffFriends,
  reincarnate, heroSnapshot, compareSnapshots, HOURS_PER_YEAR,
} from '../js/sim.js';
import { createSession, nextQuestion, presentTest, answer, barnHelp, presentQuestion } from '../js/quiz.js';
import { serialize, deserialize } from '../js/save.js';
import { balance, monsters, questions, items, makeCtx, newGame, constRng, seqRng } from './helpers.js';

const b = balance.barn;
const byName = (name) => monsters.find((m) => m.name === name);
const DOG = byName('イヌハモノクロ');
const PLAIN = monsters.find((m) => m.kind === 'monster' && !m.world && !m.space && questions.some((q) => q.monster === m.name && q.wrong.filter(Boolean).length === 3));
const PLAIN_Q = questions.find((q) => q.monster === PLAIN.name && q.wrong.filter(Boolean).length === 3);
const OTHER = monsters.find((m) => m.kind === 'monster' && !m.world && !m.space && m.id !== PLAIN.id);

function withZako(id, affinity = 0) {
  const s = newGame(7);
  tameZako(s, makeCtx(), id, [], true);
  barnEntry(s, id).affinity = affinity;
  return s;
}

test('数値：懐き度は0〜100で、懐いた（贈り物・手伝い）のは半分から。上がり方はどれも正の数', () => {
  assert.equal(b.affinityMax, 100);
  assert.ok(b.friendlyAffinity > 0 && b.friendlyAffinity < b.affinityMax);
  for (const k of ['affinityPerYear', 'affinityPerCorrect', 'affinityPerTouch', 'affinityPerFlight', 'giftGoldKills', 'seeOffMax']) assert.ok(b[k] > 0, k);
});

test('小屋に入ったときの懐き度は0。上がるだけで、最大で止まる。懐いた・更生したときに知らせ', () => {
  const s = withZako(PLAIN.id);
  const ctx = makeCtx();
  assert.equal(affinityOf(s, PLAIN.id), 0);
  const ev = [];
  assert.equal(raiseAffinity(s, ctx, PLAIN.id, b.friendlyAffinity, ev), b.friendlyAffinity);
  assert.ok(isFriendly(s, ctx, PLAIN.id));
  assert.equal(ev[0].type, 'barnFriendly');
  assert.equal(raiseAffinity(s, ctx, PLAIN.id, 999, ev), b.affinityMax - b.friendlyAffinity);
  assert.ok(isReformed(s, ctx, PLAIN.id));
  assert.equal(ev.at(-1).type, 'barnReformed');
  assert.equal(ev.at(-1).truth, PLAIN.truth);
  assert.equal(raiseAffinity(s, ctx, PLAIN.id, 5, ev), 0);
  assert.equal(affinityOf(s, PLAIN.id), b.affinityMax);
  // 小屋にいないザコは上がらない
  assert.equal(raiseAffinity(s, ctx, OTHER.id, 5, []), 0);
});

test('誕生日ごとに小屋のザコ全員の懐き度が上がる（起動している間に少しずつ）', () => {
  const s = withZako(PLAIN.id);
  tameZako(s, makeCtx(), OTHER.id, [], true);
  birthday(s, makeCtx(), []);
  assert.equal(affinityOf(s, PLAIN.id), b.affinityPerYear);
  assert.equal(affinityOf(s, OTHER.id), b.affinityPerYear);
});

test('そのザコの問題に正解すると上がる（間違えると上がらない）', () => {
  const s = withZako(PLAIN.id);
  const ctx = makeCtx();
  const session = createSession(s, 'quiz', ctx);
  presentQuestion(session, PLAIN_Q, ctx);
  const wrongIdx = session.current.choices.findIndex((c) => c.kind !== 'answer');
  answer(s, session, wrongIdx, ctx);
  assert.equal(affinityOf(s, PLAIN.id), 0);
  presentQuestion(session, PLAIN_Q, ctx);
  const r = answer(s, session, session.current.choices.findIndex((c) => c.kind === 'answer'), ctx);
  assert.equal(affinityOf(s, PLAIN.id), b.affinityPerCorrect);
  assert.deepEqual(r.affinity, { monsterId: PLAIN.id, name: PLAIN.name, gained: b.affinityPerCorrect });
});

test('小屋で触ると、そのザコは1日に1回だけ上がる', () => {
  const s = withZako(PLAIN.id);
  const ctx = makeCtx();
  assert.deepEqual(touchZako(s, ctx, PLAIN.id, '2026-11-08', []), { ok: true, gained: b.affinityPerTouch, already: false });
  assert.deepEqual(touchZako(s, ctx, PLAIN.id, '2026-11-08', []), { ok: true, gained: 0, already: true });
  assert.equal(touchZako(s, ctx, PLAIN.id, '2026-11-09', []).gained, b.affinityPerTouch);
  assert.equal(affinityOf(s, PLAIN.id), b.affinityPerTouch * 2);
  assert.equal(touchZako(s, ctx, OTHER.id, '2026-11-09', []).ok, false);
});

test('① 試作機：犬以外は失敗しても懐き度%で帰ってくる。帰ってくると懐き度が上がる。野に戻ってまた仲間になると0から', () => {
  const s = withZako(PLAIN.id, 60);
  s.legacy.rocket.steps.airframe = balance.rocket.stepYears * HOURS_PER_YEAR;
  s.gold = balance.rocket.prototype.cost * 10;
  // 失敗（0.99 ≥ 成功率）して、0.5 < 懐き度60% なので帰ってくる
  const r = flyPrototype(s, makeCtx(seqRng([0.99, 0.5])), PLAIN.id);
  assert.equal(r.success, false);
  assert.equal(r.cameBack, true);
  assert.equal(r.left, false);
  assert.equal(r.affinity, b.affinityPerFlight);
  assert.equal(affinityOf(s, PLAIN.id), 60 + b.affinityPerFlight);
  assert.ok(!barnEntry(s, PLAIN.id).space); // 成功していないので宇宙帰りの印は付かない
  // 0.9 ≥ 懐き度70% なので帰ってこない（野に戻る）
  const r2 = flyPrototype(s, makeCtx(seqRng([0.99, 0.9])), PLAIN.id);
  assert.equal(r2.left, true);
  assert.equal(barnEntry(s, PLAIN.id), null);
  tameZako(s, makeCtx(), PLAIN.id, [], true);
  assert.equal(affinityOf(s, PLAIN.id), 0);
  // 成功しても上がる
  const r3 = flyPrototype(s, makeCtx(constRng(0)), PLAIN.id);
  assert.equal(r3.success, true);
  assert.equal(affinityOf(s, PLAIN.id), b.affinityPerFlight);
  // 懐き度0なら、失敗するといつも野に戻る
  const s2 = withZako(OTHER.id, 0);
  s2.legacy.rocket.steps.airframe = balance.rocket.stepYears * HOURS_PER_YEAR;
  s2.gold = balance.rocket.prototype.cost;
  assert.equal(flyPrototype(s2, makeCtx(seqRng([0.99, 0])), OTHER.id).left, true);
});

test('① 試作機：犬は今までどおり必ず帰ってきて、懐き度も上がる', () => {
  const s = withZako(DOG.id, 0);
  s.legacy.rocket.steps.airframe = balance.rocket.stepYears * HOURS_PER_YEAR;
  s.gold = balance.rocket.prototype.cost;
  const r = flyPrototype(s, makeCtx(constRng(0.99)), DOG.id);
  assert.equal(r.success, false);
  assert.equal(r.left, false);
  assert.equal(affinityOf(s, DOG.id), b.affinityPerFlight);
});

test('② 誕生日：懐いたザコの1体が小さな贈り物（ゴールドか、それで買える強い品）を持ってくる。懐いていなければ無い', () => {
  const ctx = makeCtx(constRng(0.99));
  const s = withZako(PLAIN.id, b.friendlyAffinity - b.affinityPerYear - 1);
  const ev = [];
  birthday(s, ctx, ev);
  assert.ok(!ev.some((e) => e.type === 'barnGift'));
  // 懐いた：持っていなくて入荷した品が無い（勉強0問なら木の剣と布の服は入荷しているので、先に持たせておく）
  const s2 = withZako(PLAIN.id, b.friendlyAffinity);
  s2.owned = items.filter((it) => !it.moon).map((it) => it.id);
  const gold = s2.gold;
  const ev2 = [];
  birthday(s2, ctx, ev2);
  const gift = ev2.find((e) => e.type === 'barnGift');
  assert.ok(gift);
  assert.equal(gift.name, PLAIN.name);
  assert.ok(gift.gold > 0);
  assert.equal(s2.gold, gold + gift.gold);
  // 贈り物のゴールドで買える、今の装備より強い品があれば、いちばん安いその品
  const s3 = withZako(PLAIN.id, b.friendlyAffinity);
  s3.adventure.floor = 30;
  const ev3 = [];
  birthday(s3, ctx, ev3);
  const g3 = ev3.find((e) => e.type === 'barnGift');
  assert.ok(g3.itemId, JSON.stringify(g3));
  assert.ok(s3.owned.includes(g3.itemId));
  const it = items.find((x) => x.id === g3.itemId);
  assert.equal(s3.equipment[it.slot], it.id);
});

test('② 贈り物は小さい：今の階層のザコ数体分のゴールド', () => {
  const s = withZako(PLAIN.id, b.friendlyAffinity);
  s.owned = items.filter((it) => !it.moon).map((it) => it.id);
  s.adventure.floor = 50;
  const ev = [];
  birthday(s, makeCtx(constRng(0.99)), ev);
  const gift = ev.find((e) => e.type === 'barnGift');
  const perZako = balance.monster.base.gold + balance.monster.perFloor.gold * 49;
  assert.ok(gift.gold <= perZako * b.giftGoldKills * 1.01 + 1, `${gift.gold}`);
});

test('③ 前世の最期：懐いたザコが懐き度の高い順に見送る（seeOffMax 体まで）。生まれ変わっても懐き度は残る', () => {
  const s = newGame(7);
  const ctx = makeCtx();
  const zako = monsters.filter((m) => m.kind === 'monster' && !m.world).slice(0, 7);
  zako.forEach((m, i) => { tameZako(s, ctx, m.id, [], true); barnEntry(s, m.id).affinity = 40 + i * 10; });
  const friends = seeOffFriends(s, ctx);
  assert.equal(friends.length, Math.min(b.seeOffMax, zako.filter((_, i) => 40 + i * 10 >= b.friendlyAffinity).length));
  assert.deepEqual(friends.map((f) => f.affinity), [...friends.map((f) => f.affinity)].sort((x, y) => y - x));
  assert.ok(friends.every((f) => f.affinity >= b.friendlyAffinity));
  reincarnate(s, ctx);
  assert.equal(affinityOf(s, zako[6].id), 100);
  const back = deserialize(serialize(s), balance);
  assert.equal(affinityOf(back, zako[6].id), 100);
});

test('④ 勉強の手伝い：懐いたザコは、自分の問題で誤答2・3のどちらかを1つ消す（誤答1は残す）', () => {
  const ctx = makeCtx();
  const not = withZako(PLAIN.id, b.friendlyAffinity - 1);
  const sess = createSession(not, 'quiz', ctx);
  const c1 = presentQuestion(sess, PLAIN_Q, ctx);
  barnHelp(not, c1, ctx);
  assert.equal(c1.choices.length, 4);
  assert.ok(!c1.helpedBy);
  const s = withZako(PLAIN.id, b.friendlyAffinity);
  const sess2 = createSession(s, 'quiz', ctx);
  const c2 = presentQuestion(sess2, PLAIN_Q, ctx);
  barnHelp(s, c2, ctx);
  assert.equal(c2.choices.length, 3);
  assert.equal(c2.helpedBy, PLAIN.name);
  assert.ok(c2.choices.some((c) => c.kind === 'myth'));
  assert.ok(c2.choices.some((c) => c.kind === 'answer'));
  assert.equal(c2.choices.filter((c) => c.kind === 'wrong').length, 1);
});

test('④ 勉強の手伝いは、クイズ・テスト・同じザコが敵として口を挟んでいても起きる', () => {
  const ctx = makeCtx();
  const s = withZako(PLAIN.id, b.friendlyAffinity);
  // クイズ：その問題しか出ないようにする
  const quizCtx = { ...ctx, questions: [PLAIN_Q] };
  const sess = createSession(s, 'quiz', quizCtx);
  s.knowledge.recent = [];
  const cur = nextQuestion(s, sess, quizCtx);
  assert.equal(cur.helpedBy, PLAIN.name);
  // テスト
  const t = createSession(s, 'test', quizCtx, PLAIN_Q.genre);
  const sheet = presentTest(s, t, quizCtx);
  assert.equal(sheet[0].helpedBy, PLAIN.name);
  assert.equal(sheet[0].choices.length, 3);
  // 敵として群れにいても
  s.adventure.enemies = [{ uid: 1, monsterId: PLAIN.id, name: PLAIN.name, kind: 'monster', hp: 10, maxHp: 10, atk: 1, def: 0, exp: 1, gold: 1, slot: 0 }];
  const sess3 = createSession(s, 'quiz', quizCtx);
  s.knowledge.recent = [];
  assert.equal(nextQuestion(s, sess3, quizCtx).helpedBy, PLAIN.name);
});

test('起動から3分の比較：懐き度が上がったザコを、上がった量の多い順に添える', () => {
  const s = withZako(PLAIN.id, 10);
  tameZako(s, makeCtx(), OTHER.id, [], true);
  const before = heroSnapshot(s, makeCtx());
  raiseAffinity(s, makeCtx(), OTHER.id, 8, []);
  raiseAffinity(s, makeCtx(), PLAIN.id, 3, []);
  const cmp = compareSnapshots(before, heroSnapshot(s, makeCtx()));
  assert.deepEqual(cmp.affinity, [{ id: OTHER.id, gain: 8 }, { id: PLAIN.id, gain: 3 }]);
});
