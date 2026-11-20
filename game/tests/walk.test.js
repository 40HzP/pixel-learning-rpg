// 散歩の要素（設計ページ「散歩の要素」2026-11-20）：前世の足跡（石碑）・歩いた距離・道端のものと散歩帳
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  tick, moveToFloor, spawnGroup, damageEnemy, reincarnate, startGame, heroTitles, steles, walkedKm, likenDistance,
  pickRoadside, roadsideQuestions, walkBookPages, inWalkBook,
  tameZako, setWalker, walkerEntry, isHometown, walkerNotice, walkedWithKm, raiseAffinity, flyPrototype,
} from '../js/sim.js';
import { beginRoadside, answerRoadside, beginRecall } from '../js/quiz.js';
import { balance, makeCtx, newGame, constRng, seqRng, questions, stages } from './helpers.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const roadside = JSON.parse(readFileSync(root + 'game/data/roadside.json', 'utf8'));
const zako = (ctx) => ctx.monsters.find((m) => m.kind === 'monster' && !m.world).id;

/** 前世を1人つくった2世代目（前世は floor 階層まで、月面は moon 階層まで歩いた） */
function secondLife(floor = 12, moon = 0, name = 'まえのひと') {
  const s = newGame(0);
  s.legacy.lives.push({ generation: 1, name, age: 81, level: 50, maxFloor: floor, moonFloor: moon, gold: 0, walked: 0 });
  s.life.generation = 2;
  s.life.maxFloor = 40;
  return s;
}

/** 群れを1つ倒して次の階層に進む（その階層の残りのザコを1体にして倒す） */
function clearFloor(s, ctx) {
  const ev = [];
  s.adventure.kills = balance.floor.monstersPerFloor - 1;
  spawnGroup(s, ctx, ev, [zako(ctx)]);
  damageEnemy(s, 1e12, ctx, ev);
  return ev;
}

test('前世の足跡：前世の最高階層に着くと、群れを出す前に石碑の前で立ち止まる（steleStopSec 秒）', () => {
  const ctx = makeCtx();
  const s = secondLife(12);
  assert.deepEqual(steles(s, ctx).map((x) => [x.floor, x.name, x.age]), [[12, 'まえのひと', 81]]);
  moveToFloor(s, ctx, 12);
  assert.equal(s.adventure.stop.kind, 'stele');
  const ev = tick(s, balance.walk.steleStopSec - 0.2, ctx);
  const st = ev.find((e) => e.type === 'stele');
  assert.ok(st, '立ち止まり始めに石碑の知らせ');
  assert.equal(st.steles[0].generation, 1);
  assert.equal(s.adventure.enemies.length, 0, '立ち止まっている間は群れが出ない');
  const ev2 = tick(s, 1, ctx);
  assert.ok(ev2.some((e) => e.type === 'steleDone'));
  assert.ok(s.adventure.enemies.length > 0, '立ち止まったあとは、いつもどおり群れが出る');
  assert.equal(s.adventure.stop, null);
});

test('前世の足跡：石碑の階層を越えると「前世の自分を追い越した」を一度だけ。やられて戻って、また越えても出ない', () => {
  const ctx = makeCtx();
  const s = secondLife(12);
  moveToFloor(s, ctx, 12);
  const ev = clearFloor(s, ctx);
  const over = ev.filter((e) => e.type === 'steleOvertaken');
  assert.equal(over.length, 1);
  assert.equal(over[0].name, 'まえのひと');
  assert.equal(s.adventure.floor, 13);
  moveToFloor(s, ctx, 12);
  assert.equal(clearFloor(s, ctx).filter((e) => e.type === 'steleOvertaken').length, 0, '同じ人生では一度だけ');
  // ほかの階層を越えても出ない
  assert.equal(clearFloor(s, ctx).filter((e) => e.type === 'steleOvertaken').length, 0);
});

test('前世の足跡：石碑は直近 steleLives 人の前世の分だけ。月面には、月面に行った前世の石碑だけ。初回の作り話の前世は置かない', () => {
  const ctx = makeCtx();
  const s = newGame(0);
  assert.equal(steles(s, ctx).length, 0, '1世代目（前世は作り話）には石碑が無い');
  for (let g = 1; g <= 5; g++) s.legacy.lives.push({ generation: g, name: `p${g}`, age: 80, level: 1, maxFloor: g * 10, moonFloor: g === 5 ? 3 : 0, gold: 0 });
  s.life.generation = 6;
  const earth = steles(s, ctx, 'earth');
  assert.equal(earth.length, balance.walk.steleLives);
  assert.deepEqual(earth.map((x) => x.generation), [3, 4, 5], '新しい前世から');
  assert.deepEqual(steles(s, ctx, 'moon').map((x) => [x.generation, x.floor]), [[5, 3]]);
});

test('歩いた距離：階層を歩き切るたびに数える（やられてやり直した分も）。階層の移動では数えない。生まれ変わると歴代の合計に入る', () => {
  const ctx = makeCtx();
  const s = newGame(0);
  s.life.maxFloor = 30;
  clearFloor(s, ctx);
  clearFloor(s, ctx);
  assert.equal(s.life.walkedFloors, 2);
  assert.deepEqual(walkedKm(s, ctx), { life: 2 * balance.walk.kmPerFloor, total: 2 * balance.walk.kmPerFloor });
  moveToFloor(s, ctx, 20);
  assert.equal(s.life.walkedFloors, 2, '階層の移動は歩いていない');
  // 同じ階層をまた歩き切った分も数える（やられて1つ手前からやり直したときと同じ）
  moveToFloor(s, ctx, 21);
  clearFloor(s, ctx);
  assert.equal(s.life.walkedFloors, 3);
  const prev = reincarnate(s, ctx);
  assert.equal(prev.walked, 3, '前世のまとめに歩いた階層の数');
  assert.equal(s.life.walkedFloors, 0);
  startGame(s, 0);
  clearFloor(s, ctx);
  assert.deepEqual(walkedKm(s, ctx), { life: balance.walk.kmPerFloor, total: 4 * balance.walk.kmPerFloor });
});

test('歩いた距離：歴代の合計が月まで（moonKm）に届くと、一度だけ知らせて称号が付く。称号は生まれ変わっても残る', () => {
  const ctx = makeCtx();
  const s = newGame(0);
  const need = Math.ceil(balance.walk.moonKm / balance.walk.kmPerFloor);
  s.legacy.walkedFloors = need - 1;
  assert.ok(!heroTitles(s, ctx).includes(balance.walk.moonTitle));
  const ev = clearFloor(s, ctx);
  const moon = ev.find((e) => e.type === 'walkedToMoon');
  assert.ok(moon && moon.km >= balance.walk.moonKm);
  assert.equal(moon.title, balance.walk.moonTitle);
  assert.ok(heroTitles(s, ctx).includes(balance.walk.moonTitle));
  assert.equal(clearFloor(s, ctx).filter((e) => e.type === 'walkedToMoon').length, 0, '一度だけ');
  reincarnate(s, ctx);
  assert.ok(heroTitles(s, ctx).includes(balance.walk.moonTitle));
});

test('歩いた距離のたとえ：東京〜大阪まであと何km → 東京〜大阪の何倍 → 地球何周分 → 月まで行ける距離の何倍', () => {
  assert.equal(likenDistance(120, balance), '東京〜大阪の直線（約400km）まで、あと280km');
  assert.equal(likenDistance(1200, balance), '東京〜大阪の直線の約3倍');
  assert.equal(likenDistance(6000, balance), '東京〜大阪の直線の約15倍');
  assert.equal(likenDistance(60000, balance), '地球1.5周分（月までは約38万km）');
  assert.equal(likenDistance(400000, balance), '歩いて月まで行ける距離の約1倍');
});

test('道端のもの：地球の道端の物がある世界で、roadsideChance の確率で出る。まだ散歩帳に無い物が先。月面・石碑の前・前世の記憶をたどるの間は出ない', () => {
  const ctx = makeCtx();
  const s = newGame(0);
  const here = roadsideQuestions(ctx, 'はじまりの草原');
  assert.ok(here.length >= 1);
  assert.equal(pickRoadside(s, ctx, constRng(balance.walk.roadsideChance)), null, '確率に当たらなければ出ない');
  const q = pickRoadside(s, ctx, seqRng([0, 0]));
  assert.equal(q.roadside.world, 'はじまりの草原');
  // 散歩帳に載ったら、まだ載っていない物を先に
  s.knowledge.walkBook = [{ id: here[0].id }];
  if (here.length > 1) assert.notEqual(pickRoadside(s, ctx, seqRng([0, 0])).id, here[0].id);
  // 海の底（道端の物がまだ無い世界）では出ない
  s.adventure.floor = 85;
  assert.equal(roadsideQuestions(ctx, '海の底').length, 0);
  assert.equal(pickRoadside(s, ctx, seqRng([0, 0])), null);
  s.adventure.floor = 1;
  // 前世の記憶をたどるの5問を答え終わるまでは出ない
  beginRecall(s, ctx);
  assert.equal(pickRoadside(s, ctx, seqRng([0, 0])), null);
  s.firstRun.check.answers = s.firstRun.check.questions.map((id) => ({ id, kind: 'correct' }));
  assert.ok(pickRoadside(s, ctx, seqRng([0, 0])));
  // 石碑の前で立ち止まっている間は出ない
  s.adventure.stop = { kind: 'stele', sec: 1, started: true, steles: [] };
  assert.equal(pickRoadside(s, ctx, seqRng([0, 0])), null);
  s.adventure.stop = null;
  // 月面には置かない
  s.adventure.world = 'moon';
  assert.equal(pickRoadside(s, ctx, seqRng([0, 0])), null);
});

test('道端のもの：正解すると散歩帳に載り、ふつうの勉強と同じく数える。間違えても罰は無く、載らないだけ。散歩帳は生まれ変わっても残る', () => {
  const ctx = makeCtx(constRng(0));
  const s = newGame(0);
  const q = roadsideQuestions(ctx)[0];
  let session = beginRoadside(s, ctx, q.id);
  const wrong = session.current.choices.findIndex((c) => c.kind !== 'answer');
  const before = s.knowledge.totalCorrect;
  let res = answerRoadside(s, session, wrong, ctx);
  assert.equal(res.correct, false);
  assert.equal(inWalkBook(s, q.id), false);
  assert.ok(s.knowledge.review.includes(q.id), '間違えたままの問題に入る（ふつうの勉強と同じ）');
  session = beginRoadside(s, ctx, q.id);
  res = answerRoadside(s, session, session.current.choices.findIndex((c) => c.kind === 'answer'), ctx);
  assert.equal(res.correct, true);
  assert.equal(s.knowledge.totalCorrect, before + 1);
  assert.equal(s.knowledge.history[0].id, q.id, '過去問復習の最近解いた問題に入る');
  assert.deepEqual(res.walkBook, { added: true, count: 1, total: roadsideQuestions(ctx).length });
  assert.equal(beginRoadside(s, ctx, questions.find((x) => !x.roadside).id), null, '道端の問題でなければ出さない');
  reincarnate(s, ctx);
  assert.equal(inWalkBook(s, q.id), true);
  const pages = walkBookPages(s, ctx);
  assert.equal(pages.length, roadsideQuestions(ctx).length);
  assert.equal(pages.filter((p) => p.found).length, 1);
  const order = stages.map((x) => x.name);
  assert.deepEqual(pages.map((p) => order.indexOf(p.world)), [...pages.map((p) => order.indexOf(p.world))].sort((a, b) => a - b), '世界の順に並ぶ');
});

test('道端のもののデータ：問題リストの道端の世界は10階層ごとの世界の名前。ザコとつながっていない。物ごとに絵（16×16）がある', () => {
  const names = new Set(stages.filter((x) => !x.world).map((x) => x.name));
  const list = questions.filter((q) => q.roadside);
  assert.ok(list.length >= 1);
  for (const q of list) {
    assert.ok(names.has(q.roadside.world), `${q.roadside.name}：${q.roadside.world} は世界の名前`);
    assert.equal(q.monster, null, `${q.roadside.name}：ザコとつながっていない`);
    const sprite = roadside.items[q.roadside.name];
    assert.ok(sprite, `${q.roadside.name} の絵の名前が roadside.json にある`);
    const p = `${root}pixel/sprites/${sprite}.json`;
    assert.ok(existsSync(p), `${sprite}.json がある`);
    const sp = JSON.parse(readFileSync(p, 'utf8'));
    assert.deepEqual([sp.w, sp.h], [16, 16]);
  }
  assert.ok(existsSync(`${root}pixel/sprites/${roadside.stele}.json`), '石碑の絵がある');
});

test('月面に行った前世の石碑は、月面のその階層に出る', () => {
  const ctx = makeCtx();
  const s = secondLife(30, 2);
  s.adventure.world = 'moon'; // ロケットで月面に着いた
  s.life.moonMaxFloor = 5;
  moveToFloor(s, ctx, 2);
  assert.equal(s.adventure.stop && s.adventure.stop.kind, 'stele');
  assert.equal(s.adventure.stop.steles[0].world, 'moon');
});

/* ---------- ザコの散歩（設計ページ「ザコの散歩（2026-11-20）」） ---------- */

const byName = (ctx, name) => ctx.monsters.find((m) => m.name === name);

test('ザコの散歩：小屋のザコを1体だけ連れて行ける（ほかのザコを選ぶと交代）。小屋にいないザコは連れて行けない。生まれ変わっても連れたまま', () => {
  const ctx = makeCtx();
  const s = newGame(0);
  const a = byName(ctx, 'ネンリンホウイ'), b = byName(ctx, 'ジュッパーノウ');
  assert.equal(setWalker(s, ctx, a.id).ok, false, '小屋にいない');
  tameZako(s, ctx, a.id, [], true);
  tameZako(s, ctx, b.id, [], true);
  assert.equal(s.legacy.barn.find((x) => x.id === a.id).since, 1, 'なついた世代を残す');
  assert.equal(setWalker(s, ctx, a.id).name, 'ネンリンホウイ');
  assert.equal(walkerEntry(s, ctx).id, a.id);
  const r = setWalker(s, ctx, b.id);
  assert.equal(r.back, 'ネンリンホウイ', '連れていたザコは小屋に帰る');
  assert.equal(walkerEntry(s, ctx).id, b.id);
  reincarnate(s, ctx);
  assert.equal(walkerEntry(s, ctx).id, b.id, '小屋のザコと同じく、生まれ変わっても残る');
  assert.equal(setWalker(s, ctx, null).back, 'ジュッパーノウ');
  assert.equal(walkerEntry(s, ctx), null);
});

test('ザコの散歩：一緒に歩いた距離は、連れて階層を歩き切るごとに数える（階層の移動は数えない）。連れていないザコは増えない', () => {
  const ctx = makeCtx();
  const s = newGame(0);
  const a = byName(ctx, 'ジュッパーノウ'), b = byName(ctx, 'ボキボキ');
  tameZako(s, ctx, a.id, [], true);
  tameZako(s, ctx, b.id, [], true);
  setWalker(s, ctx, a.id);
  s.life.maxFloor = 20;
  clearFloor(s, ctx);
  clearFloor(s, ctx);
  moveToFloor(s, ctx, 10);
  assert.equal(walkedWithKm(s, ctx, a.id), 2 * balance.walk.kmPerFloor);
  assert.equal(walkedWithKm(s, ctx, b.id), 0);
});

test('ザコの散歩：連れて歩いている間は、懐き度が walkerAffinityRate 倍上がりやすい（動物行動学の倍率と掛け合わせる）。強さは変わらない', () => {
  const ctx = makeCtx();
  const s = newGame(0);
  const a = byName(ctx, 'ジュッパーノウ'), b = byName(ctx, 'ボキボキ');
  tameZako(s, ctx, a.id, [], true);
  tameZako(s, ctx, b.id, [], true);
  setWalker(s, ctx, a.id);
  assert.equal(raiseAffinity(s, ctx, a.id, 4, []), 4 * balance.walk.walkerAffinityRate);
  assert.equal(raiseAffinity(s, ctx, b.id, 4, []), 4);
});

test('ザコの散歩：ふるさと（出現エリアの世界。月面のザコは月面）を歩いているときだけ、はしゃぐ', () => {
  const ctx = makeCtx();
  const s = newGame(0);
  const m = byName(ctx, 'ネンリンホウイ'); // 生き物の森
  s.adventure.floor = 15;
  assert.equal(isHometown(s, ctx, m), true);
  s.adventure.floor = 5;
  assert.equal(isHometown(s, ctx, m), false);
  const two = byName(ctx, 'ニドオチズ'); // 火山と天空の神殿
  s.adventure.floor = 55; assert.equal(isHometown(s, ctx, two), true);
  s.adventure.floor = 95; assert.equal(isHometown(s, ctx, two), true);
  const moon = ctx.monsters.find((x) => x.kind === 'monster' && x.world === 'moon');
  assert.equal(isHometown(s, ctx, moon), false);
  s.adventure.world = 'moon';
  assert.equal(isHometown(s, ctx, moon), true);
  assert.equal(isHometown(s, ctx, m), false);
});

test('ザコの散歩：なついた世代と同じか後の前世の石碑では座り込む（覚えている）。なつく前の前世・前のセーブ（since が無い）では座り込まない', () => {
  const ctx = makeCtx();
  const s = secondLife(12);
  const m = byName(ctx, 'ジュッパーノウ');
  tameZako(s, ctx, m.id, [], true); // 2世代目になついた
  setWalker(s, ctx, m.id);
  moveToFloor(s, ctx, 12);
  let st = tick(s, 0.1, ctx).find((e) => e.type === 'stele');
  assert.equal(st.sit, false, '1世代目の前世とは歩いていない');
  s.legacy.barn[0].since = 1;
  moveToFloor(s, ctx, 11); moveToFloor(s, ctx, 12);
  st = tick(s, 0.1, ctx).find((e) => e.type === 'stele');
  assert.equal(st.sit, true, '1世代目からいたザコは覚えている');
  delete s.legacy.barn[0].since;
  moveToFloor(s, ctx, 11); moveToFloor(s, ctx, 12);
  assert.equal(tick(s, 0.1, ctx).find((e) => e.type === 'stele').sit, false, '前のセーブは座り込まないとして読む');
});

test('ザコの散歩：道端の物が自分の俗説に関わるザコは一言（誤解。更生したら本当のこと）。関わらない物ではにおいを嗅ぐだけ。問題は出さない', () => {
  const ctx = makeCtx();
  const s = newGame(0);
  assert.equal(walkerNotice(s, ctx, '切り株'), null, '連れていなければ何もしない');
  const m = byName(ctx, 'ネンリンホウイ');
  tameZako(s, ctx, m.id, [], true);
  setWalker(s, ctx, m.id);
  const say = walkerNotice(s, ctx, '切り株');
  assert.deepEqual([say.kind, say.line], ['say', m.myth]);
  assert.equal(walkerNotice(s, ctx, '朝露の葉').kind, 'sniff');
  s.legacy.barn[0].affinity = balance.barn.affinityMax;
  assert.equal(walkerNotice(s, ctx, '切り株').line, m.truth, '更生したら本当のこと');
});

test('ザコの散歩のデータ：道端の物で一言いうザコ（roadside.json の zako）は、道端の物の名前とザコの名前がそろっている', () => {
  const ctx = makeCtx();
  const items = new Set(Object.keys(roadside.items));
  for (const [thing, names] of Object.entries(roadside.zako)) {
    assert.ok(items.has(thing), `${thing} は道端の物`);
    for (const n of names) {
      const m = byName(ctx, n);
      assert.ok(m && m.kind === 'monster', `${n} はザコ`);
      assert.ok(!m.debated, `${n} は議論中（⚠）のザコではない`);
    }
  }
});

test('ザコの散歩：連れていたザコが試作機で野に戻ったら、散歩もおしまい', () => {
  const ctx = makeCtx(constRng(0.99)); // 試作機は失敗し、帰ってこない
  const s = newGame(0);
  const m = byName(ctx, 'ジュッパーノウ');
  tameZako(s, ctx, m.id, [], true);
  setWalker(s, ctx, m.id);
  s.legacy.rocket.steps.airframe = 1e9; // 機体設計が終わった
  s.gold = 1e15;
  const r = flyPrototype(s, ctx, m.id, []);
  assert.equal(r.left, true);
  assert.equal(s.legacy.walker, null);
  assert.equal(walkerEntry(s, ctx), null);
});
