import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  tick, spawnGroup, monsterStats, launchInfo, launchRocket, returnToEarth, onMoon, zakoPool, strengthFloor, stageFor, currentStage,
  sleepAtBed, respawnFloor, buildBase, reincarnate, rocketSteps, genreState, HOURS_PER_YEAR,
  damageEnemy, markSmooth, newspaperActive, heroStats, heroTitles, forgetPastLifeBosses, moonRamp,
  shopList, buyItem, recruitList, hireRecruit,
} from '../js/sim.js';
import { createSession, presentQuestion, answer, flyerSpan } from '../js/quiz.js';
import { setMajor, fieldById } from '../js/fields.js';
import { serialize, deserialize } from '../js/save.js';
import { balance, monsters, fields, questions, makeCtx, newGame, constRng, seededRng } from './helpers.js';

const { stages } = JSON.parse(readFileSync(fileURLToPath(new URL('../data/stages.json', import.meta.url)), 'utf8'));
const moonZako = monsters.filter((m) => m.kind === 'monster' && m.world === 'moon');

/** 建造費を払い、すべての工程を終えたことにする */
function buildRocket(s) {
  s.legacy.rocket.buildCostPaid = true;
  for (const st of fields.rocketSteps) s.legacy.rocket.steps[st.id] = balance.rocket.stepYears * HOURS_PER_YEAR;
}
/** 学際分野の2つのジャンルを解放の熟練にして、専攻に入れる */
function major(s, ctx, id, slot = 0) {
  for (const g of fieldById(ctx, id).genres) genreState(s, g).level = balance.fields.unlockLevel;
  tick(s, 0.01, ctx);
  assert.equal(setMajor(s, slot, id, ctx).ok, true, id);
}

test('データ：月面の世界（stages.json の world: moon）と、設計ページの月面のザコ19体（月面にだけ出る）', () => {
  const moon = stages.filter((st) => st.world === 'moon');
  assert.equal(moon.length, 1);
  assert.equal(moon[0].from, 1);
  assert.equal(moon[0].background, 'bg_moon');
  assert.equal(moonZako.length, 19);
  for (const m of moonZako) assert.ok(m.myth && m.truth && m.genres.length, m.name);
  assert.ok(balance.moon.floorOffset > 0);
  assert.ok(balance.rocket.launchSuccessRate > 0 && balance.rocket.launchSuccessRate < 1);
});

test('打ち上げ：建造費を払い、すべての工程が終わるまでは打ち上げられない', () => {
  const ctx = makeCtx(constRng(0));
  const s = newGame(7);
  let info = launchInfo(s, ctx);
  assert.equal(info.ok, false);
  assert.match(info.reason, /建造費/);
  s.legacy.rocket.buildCostPaid = true;
  info = launchInfo(s, ctx);
  assert.equal(info.ok, false);
  assert.match(info.reason, /機体設計/);
  assert.equal(launchRocket(s, ctx).ok, false);
  assert.equal(onMoon(s), false);
  buildRocket(s);
  info = launchInfo(s, ctx);
  assert.equal(info.ok, true);
  assert.equal(info.successRate, balance.rocket.launchSuccessRate);
  assert.equal(info.rateVisible, false, '確率論が無いと成功率は見えない');
});

test('打ち上げに成功すると月面の1階層へ。地球の階層は取っておく。打ち上げは無料（ゴールドは減らない）', () => {
  const ctx = makeCtx(constRng(0.1));
  const s = newGame(7);
  buildRocket(s);
  s.adventure.floor = 123;
  s.gold = 500;
  spawnGroup(s, ctx, []);
  const r = launchRocket(s, ctx);
  assert.deepEqual(r, { ok: true, success: true, floor: 1 });
  assert.equal(onMoon(s), true);
  assert.equal(s.adventure.floor, 1);
  assert.equal(s.adventure.earthFloor, 123);
  assert.equal(s.adventure.enemies.length, 0, '地球の群れは退く');
  assert.equal(s.gold, 500);
  assert.equal(s.life.moonMaxFloor, 1);
  assert.equal(s.life.maxFloor, 1, '地球の最高階層は月面の階層で変わらない');
  assert.equal(launchInfo(s, ctx).ok, false, '月面からは打ち上げない（帰還ロケットで帰る）');
});

test('打ち上げに失敗すると地球に残り、エンジン・推進剤の工程だけやり直しになる（ほかの工程と建造費はそのまま）', () => {
  const ctx = makeCtx(constRng(0.99));
  const s = newGame(7);
  buildRocket(s);
  const r = launchRocket(s, ctx);
  assert.deepEqual(r, { ok: true, success: false, redo: ['エンジン・推進剤'] });
  assert.equal(onMoon(s), false);
  const steps = Object.fromEntries(rocketSteps(s, ctx).map((st) => [st.id, st]));
  assert.equal(steps.engine.hours, 0);
  assert.equal(steps.airframe.done && steps.orbit.done && steps.permit.done, true);
  assert.equal(s.legacy.rocket.buildCostPaid, true);
  assert.match(launchInfo(s, ctx).reason, /エンジン・推進剤/);
});

test('確率論（数学＋統計学）を専攻にしていると、打ち上げの成功率が見える', () => {
  const ctx = makeCtx();
  const s = newGame(7);
  buildRocket(s);
  major(s, ctx, 'probability');
  assert.equal(launchInfo(s, ctx).rateVisible, true);
});

test('月面：月面のザコだけが出て、強さは地球の（floorOffset＋月面の階層）階層に月面の倍率（moonRamp）を掛けたもの。地球には月面のザコは出ない', () => {
  const ctx = makeCtx(constRng(0.3));
  const s = newGame(7);
  assert.ok(zakoPool(s, ctx).every((m) => m.world !== 'moon'));
  assert.ok(zakoPool(s, ctx).length > 0);
  buildRocket(s);
  launchRocket(s, ctx);
  s.adventure.floor = 4;
  assert.deepEqual(zakoPool(s, ctx).map((m) => m.id).sort(), moonZako.map((m) => m.id).sort());
  assert.equal(strengthFloor(s, ctx), balance.moon.floorOffset + 4);
  const group = spawnGroup(s, ctx, []);
  const base = monsterStats(balance.moon.floorOffset + 4, balance);
  const k = moonRamp(4, balance);
  for (const e of group) {
    assert.ok(moonZako.some((m) => m.id === e.monsterId), e.name);
    assert.equal(e.maxHp, Math.round(base.maxHp * k));
    assert.equal(e.atk, Math.round(base.atk * k));
    assert.equal(e.exp, Math.round(base.exp * k), '経験値も同じ倍率');
  }
  assert.equal(currentStage(s, stages).background, 'bg_moon');
  assert.equal(stageFor(4, stages).background, 'bg_floor01', '地球の4階層は今までどおり');
});

test('月面の倍率：月面1階層は1倍で、60階層まで1階層ごとに同じ割合で強くなり、60階層で rampTo 倍。その先は rampTo 倍のまま（40HzP の依頼「月面1階から段階的に強くして」）', () => {
  const r = (f) => moonRamp(f, balance);
  assert.equal(r(1), 1);
  assert.ok(Math.abs(r(balance.moon.rampFloor) - balance.moon.rampTo) < 1e-6);
  const step = r(2) / r(1);
  for (let f = 2; f <= 60; f++) assert.ok(Math.abs(r(f) / r(f - 1) - step) < 1e-9, `${f}階層`);
  assert.equal(r(61), r(60));
  assert.equal(r(500), r(60));
  assert.equal(balance.moon.rampFloor, 60);
});

test('月面の階層を進むと月面の最高階層が増える（地球の最高階層は変わらない）', () => {
  const ctx = makeCtx(constRng(0.3));
  const s = newGame(7);
  buildRocket(s);
  launchRocket(s, ctx);
  s.hero.level = 2000;
  s.hero.hp = 1e12;
  const ups = [];
  for (let t = 0; t < 120 && s.adventure.floor < 3; t++) ups.push(...tick(s, 1, ctx).filter((e) => e.type === 'floorUp'));
  assert.ok(s.adventure.floor >= 3);
  assert.equal(ups[0].world, 'moon');
  assert.equal(s.life.moonMaxFloor, s.adventure.floor);
  assert.equal(s.life.maxFloor, 1);
});

test('月面でやられると月面の1階層から（地球の拠点は使わない）。月面基地で眠ると1つ手前の月面の階層へ', () => {
  const ctx = makeCtx(constRng(0.1));
  const s = newGame(7);
  major(s, ctx, 'structural_engineering');
  s.adventure.floor = 50;
  assert.equal(buildBase(s, ctx).ok, true);
  buildRocket(s);
  launchRocket(s, ctx);
  s.adventure.floor = 9;
  assert.equal(respawnFloor(s, ctx), 1);
  assert.equal(buildBase(s, ctx).ok, false, '月面には拠点を建てられない');
  const r = sleepAtBed(s, ctx);
  assert.equal(s.adventure.floor, 8);
  assert.equal(r.world, 'moon');
  assert.equal(onMoon(s), true);
  // やられる
  s.hero.hp = 1;
  s.hero.level = 1;
  spawnGroup(s, ctx, []);
  let defeated = null;
  for (let t = 0; t < 60 && !defeated; t++) defeated = tick(s, 0.5, ctx).find((e) => e.type === 'heroDefeated');
  assert.ok(defeated);
  assert.equal(s.adventure.floor, 1);
  assert.equal(onMoon(s), true, 'やられても月面にいる');
  assert.equal(defeated.sleep.world, 'moon');
});

test('帰還ロケット：無料でいつでも地球に帰れ、地球は打ち上げた階層から。また打ち上げると月面は前の階層から', () => {
  const ctx = makeCtx(constRng(0.1));
  const s = newGame(7);
  buildRocket(s);
  s.adventure.floor = 77;
  assert.equal(returnToEarth(s, ctx).ok, false, '地球にいるときは帰れない');
  launchRocket(s, ctx);
  s.adventure.floor = 12;
  s.gold = 0;
  assert.deepEqual(returnToEarth(s, ctx), { ok: true, floor: 77 });
  assert.equal(onMoon(s), false);
  assert.equal(s.adventure.moonFloor, 12);
  assert.equal(s.adventure.earthFloor, null);
  assert.equal(currentStage(s, stages).background, stageFor(77, stages).background);
  launchRocket(s, ctx);
  assert.equal(s.adventure.floor, 12);
  assert.equal(s.adventure.earthFloor, 77);
});

test('月面で寿命が来ると、地球の1階層に生まれ変わる。ロケットの工程は残るので、次の人生でも打ち上げられる', () => {
  const ctx = makeCtx(constRng(0.1));
  const s = newGame(7);
  buildRocket(s);
  launchRocket(s, ctx);
  s.adventure.floor = 30;
  s.life.moonMaxFloor = 31;
  const prev = reincarnate(s, ctx);
  assert.equal(prev.moonFloor, 31);
  assert.equal(onMoon(s), false);
  assert.equal(s.adventure.floor, 1);
  assert.equal(s.adventure.moonFloor, 1, '月面も1階層から');
  assert.equal(s.life.moonMaxFloor, 0);
  assert.equal(launchInfo(s, ctx).ok, true);
});

test('前のセーブ（世界の項目が無い）は地球として読める。月面にいるセーブもそのまま読める', () => {
  const ctx = makeCtx(constRng(0.1));
  const s = newGame(7);
  delete s.adventure.world;
  delete s.adventure.earthFloor;
  delete s.adventure.moonFloor;
  delete s.life.moonMaxFloor;
  let loaded = deserialize(serialize(s), balance);
  assert.equal(loaded.adventure.world, 'earth');
  assert.equal(loaded.adventure.moonFloor, 1);
  assert.equal(loaded.life.moonMaxFloor, 0);
  buildRocket(loaded);
  launchRocket(loaded, ctx);
  loaded.adventure.floor = 5;
  loaded = deserialize(serialize(loaded), balance);
  assert.equal(onMoon(loaded), true);
  assert.equal(loaded.adventure.floor, 5);
});

/* ================= 月面のボス ================= */

const moonBosses = monsters.filter((m) => m.kind === 'boss' && m.world === 'moon');
const byId = (id) => monsters.find((m) => m.id === id);

/** 月面の floor 階層にいる強い主人公（ボスが出る前） */
function onMoonFloor(floor, ctx, { level = 3000 } = {}) {
  const s = newGame(7);
  buildRocket(s);
  launchRocket(s, makeCtx(constRng(0.1)));
  s.adventure.floor = floor;
  s.hero.level = level;
  s.hero.hp = 1e15;
  return s;
}
const ofBoss = (s, id) => s.adventure.enemies.find((e) => e.monsterId === id && e.kind === 'boss');
const knowTruth = (s, ids) => { for (const id of ids) s.knowledge.zukan[id] = { stage: 2, fooled: 0 }; };

test('データ：月面のボスは設計ページの6体で、月面10〜60階層に1体ずつ。手下は月面のザコ。図鑑の項目と仕掛けの説明がある', () => {
  assert.deepEqual(moonBosses.map((m) => [m.name, m.floor]), [
    ['カンペキキュウ', 10], ['ガリレオチョウセキ', 20], ['ツキジンセツ', 30], ['ツキノウミセツ', 40], ['チリノウミセツ', 50], ['ブンレツセツ', 60]]);
  for (const b of moonBosses) {
    for (const k of ['myth', 'truth', 'whyBelieved', 'overturnedBy', 'gimmick', 'gimmickNote']) assert.ok(b[k], `${b.name} の ${k}`);
    assert.ok(b.minions.length && b.minions.every((id) => byId(id) && byId(id).world === 'moon' && byId(id).kind === 'monster'), `${b.name} の手下`);
  }
  assert.deepEqual(moonBosses.map((m) => m.gimmick), ['smooth', 'tide', 'newspaper', 'splash', 'dust', 'split']);
  const last = moonBosses.at(-1);
  assert.ok(last.clear && last.clear.title && last.clear.page.title && last.clear.page.lines.length);
});

test('月面10階層：月面のボスが手下を連れて出る（手下が手前）。地球の10階層は今までどおり地球のボス', () => {
  const ctx = makeCtx(constRng(0.3));
  const s = onMoonFloor(10, ctx);
  const ev = [];
  const group = spawnGroup(s, ctx, ev);
  assert.deepEqual(group.map((e) => e.monsterId), ['jibundehikaru', 'kazanguchi', 'kanpekikyuu']);
  assert.deepEqual(group.slice(0, 2).map((e) => e.slot), [20, 21], '手下の場所（ボスは右に1体で描く）');
  assert.ok(group[0].minion && group[1].minion && !group[2].minion);
  assert.deepEqual(ev.find((e) => e.type === 'minions').called, ['ジブンデヒカル', 'カザングチ']);
  const earth = newGame(7);
  earth.adventure.floor = 10;
  assert.deepEqual(spawnGroup(earth, ctx, []).map((e) => e.monsterId), ['tendousetsu']);
});

test('図鑑で正体を開いている手下は呼べない（図鑑を埋めるほどボス戦が楽になる）', () => {
  const ctx = makeCtx(constRng(0.3));
  const s = onMoonFloor(10, ctx);
  knowTruth(s, ['kazanguchi']);
  const ev = [];
  assert.deepEqual(spawnGroup(s, ctx, ev).map((e) => e.monsterId), ['jibundehikaru', 'kanpekikyuu']);
  knowTruth(s, ['jibundehikaru']);
  const ev2 = [];
  assert.deepEqual(spawnGroup(s, ctx, ev2).map((e) => e.monsterId), ['kanpekikyuu']);
  assert.deepEqual(ev2.find((e) => e.type === 'minions'), { type: 'minions', monsterId: 'kanpekikyuu', name: 'カンペキキュウ', called: [], known: 2 });
});

test('月面のボスを倒すと、残った手下は逃げ、次の月面の階層へ進む。手下を倒しても階層の撃破数には数えない', () => {
  const ctx = makeCtx(constRng(0.3));
  const s = onMoonFloor(20, ctx);
  spawnGroup(s, ctx, []);
  const ev = [];
  damageEnemy(s, 1e12, ctx, ev, 'quiz', s.adventure.enemies[0]);   // 手下を1体
  assert.equal(s.adventure.kills, 0);
  damageEnemy(s, 1e12, ctx, ev, 'quiz', ofBoss(s, 'garireochouseki'));
  assert.ok(ev.some((e) => e.type === 'bossDefeated' && e.monsterId === 'garireochouseki' && e.world === 'moon'));
  assert.deepEqual(ev.find((e) => e.type === 'minionsFled').names, ['ジュウロクヤ']);
  assert.equal(s.adventure.enemies.length, 0);
  assert.equal(s.adventure.floor, 21);
  assert.equal(s.life.moonMaxFloor, 21);
});

test('カンペキキュウ：つるつるで攻撃が半減。勉強で正解するたびに山と影が描き足され、2回で半減が解ける', () => {
  const ctx = makeCtx(constRng(0.5));
  const s = onMoonFloor(10, ctx);
  knowTruth(s, byId('kanpekikyuu').minions);
  spawnGroup(s, ctx, []);
  const e = ofBoss(s, 'kanpekikyuu');
  const hit = () => { const before = e.hp; damageEnemy(s, 1000, ctx, [], 'hero', e); return before - e.hp; };
  assert.equal(hit(), 500);
  const ev = [];
  markSmooth(s, ctx, ev);
  assert.equal(e.marks, 1);
  assert.equal(ev[0].type, 'smoothMarked');
  assert.equal(hit(), 750);
  markSmooth(s, ctx, []);
  assert.equal(hit(), 1000);
  markSmooth(s, ctx, []);
  assert.equal(e.marks, 2, '描き足すのは2回まで');
});

test('カンペキキュウ：勉強の正解で山と影が描き足される（正解のダメージもそのあとで入る）', () => {
  const ctx = makeCtx(constRng(0.5));
  const s = onMoonFloor(10, ctx);
  knowTruth(s, byId('kanpekikyuu').minions);
  spawnGroup(s, ctx, []);
  const e = ofBoss(s, 'kanpekikyuu');
  const q = questions.find((x) => !x.monster);
  const session = createSession(s, 'quiz', ctx);
  presentQuestion(session, q, ctx);
  const right = session.current.choices.findIndex((c) => c.kind === 'answer');
  const res = answer(s, session, right, ctx);
  assert.equal(e.marks, 1);
  assert.equal(res.damage, Math.round(Math.ceil(e.maxHp * balance.quiz.correctDamageRatio) * balance.moon.smoothDamage[1]));
});

test('ガリレオチョウセキ：満ち潮の盾で先頭への1体攻撃を弾く。全体攻撃（ひらめき・全体を叩く仲間）と勉強の正解は弾けず、敵が1体でもひらめきを使う', () => {
  const ctx = makeCtx(constRng(0.5));
  const s = onMoonFloor(20, ctx);
  knowTruth(s, byId('garireochouseki').minions);
  spawnGroup(s, ctx, []);
  const e = ofBoss(s, 'garireochouseki');
  let ev = [];
  damageEnemy(s, 1000, ctx, ev, 'hero', e);
  assert.equal(ev[0].dmg, 0);
  assert.equal(ev[0].deflected, true);
  ev = [];
  damageEnemy(s, 1000, ctx, ev, 'quiz', e);
  assert.equal(ev[0].dmg, 1000);
  // 主人公の番：敵は1体だがひらめきを使う
  s.hero.mp = 100;
  s.adventure.heroCd = 0.01;
  ev = tick(s, 0.05, ctx);
  assert.ok(ev.some((x) => x.type === 'spell'), 'ひらめきを使う');
  assert.ok(ev.some((x) => x.type === 'attack' && x.by === 'spell' && x.dmg > 0));
});

test('ツキジンセツ：いる間は新聞のビラで問題文の一部が隠れる（隠す場所は問題ごとに決まり、文の中に収まる）', () => {
  const ctx = makeCtx(constRng(0.5));
  const s = onMoonFloor(30, ctx);
  assert.equal(newspaperActive(s), false);
  spawnGroup(s, ctx, []);
  assert.equal(newspaperActive(s), true);
  for (const q of questions) {
    const sp = flyerSpan(q);
    assert.ok(sp.length >= 2 && sp.start >= 0 && sp.start + sp.length <= q.question.length, q.id);
    assert.deepEqual(flyerSpan(q), sp, '何度出しても同じ場所');
  }
  damageEnemy(s, 1e12, ctx, [], 'quiz', ofBoss(s, 'tsukijinsetsu'));
  assert.equal(newspaperActive(s), false);
});

test('ツキノウミセツ：いる間は水しぶきで主人公のすばやさが下がる。倒すと元に戻る', () => {
  const ctx = makeCtx(constRng(0.5));
  const s = onMoonFloor(40, ctx);
  const agi = heroStats(s, ctx).agi;
  spawnGroup(s, ctx, []);
  assert.equal(heroStats(s, ctx).agi, Math.floor(agi * balance.moon.splashAgiMultiplier));
  damageEnemy(s, 1e12, ctx, [], 'quiz', ofBoss(s, 'tsukinoumisetsu'));
  assert.equal(heroStats(s, ctx).agi, agi);
});

test('チリノウミセツ：仲間を1人ずつ塵に沈めて動けなくする。航空宇宙工学を専攻にしていれば沈まない。ボスがいなくなると出てくる', () => {
  const ctx = makeCtx(constRng(0.5));
  const s = onMoonFloor(50, ctx);
  knowTruth(s, byId('chirinoumisetsu').minions);
  s.allies.push({ id: 'a', name: 'A', atk: 10, maxHp: 10, hp: 10, cd: 1.5 }, { id: 'b', name: 'B', atk: 10, maxHp: 10, hp: 10, cd: 1.5 });
  spawnGroup(s, ctx, []);
  ofBoss(s, 'chirinoumisetsu').hp = ofBoss(s, 'chirinoumisetsu').maxHp = 1e15;
  s.hero.level = 1;                       // 主人公の攻撃では倒れないように
  const sunk = [];
  for (let t = 0; t < balance.moon.sinkIntervalSec * 2 + 0.5; t += 0.5) sunk.push(...tick(s, 0.5, ctx).filter((e) => e.type === 'allySunk').map((e) => e.name));
  assert.deepEqual(sunk, ['A', 'B']);
  const acts = [];
  for (let t = 0; t < 5; t += 0.5) acts.push(...tick(s, 0.5, ctx).filter((e) => e.type === 'attack' && e.by === 'ally'));
  assert.equal(acts.length, 0, '沈んだ仲間は動かない');
  // 航空宇宙工学を専攻にすると、沈まない（沈んでいた仲間も出てくる）
  major(s, ctx, 'aerospace');
  const ev = tick(s, 0.5, ctx);
  assert.ok(ev.some((e) => e.type === 'alliesFreed'));
  assert.ok(s.allies.every((a) => !a.sunk));
  for (let t = 0; t < 10; t += 0.5) assert.ok(!tick(s, 0.5, ctx).some((e) => e.type === 'allySunk'));
});

test('ブンレツセツ：HPが半分になると地球と月に分かれる。片方だけ倒すと吸収されて元に戻り、両方をほぼ同時に倒すと倒せる', () => {
  const ctx = makeCtx(constRng(0.5));
  const s = onMoonFloor(60, ctx);
  knowTruth(s, byId('bunretsusetsu').minions);
  s.hero.level = 1;
  spawnGroup(s, ctx, []);
  const boss = ofBoss(s, 'bunretsusetsu');
  const max = boss.maxHp;
  let ev = [];
  damageEnemy(s, Math.ceil(max * 0.6), ctx, ev, 'quiz', boss);
  assert.ok(ev.some((e) => e.type === 'split'));
  const parts = s.adventure.enemies;
  assert.deepEqual(parts.map((e) => [e.part, e.slot]), [['earth', 30], ['moon', 31]]);
  assert.equal(parts[0].maxHp, Math.ceil(max / 2));
  // 片方だけ倒す → 残った片方が absorbSec 秒で吸収して元の1体に戻る
  ev = [];
  damageEnemy(s, 1e12, ctx, ev, 'quiz', parts[0]);
  assert.ok(ev.some((e) => e.type === 'partDown'));
  assert.ok(!ev.some((e) => e.type === 'bossDefeated'));
  assert.equal(s.adventure.enemies.length, 1);
  const survivor = s.adventure.enemies[0];
  const hp = survivor.hp;
  s.adventure.heroCd = 1e9;               // 吸収されるまで、主人公は攻撃しない（攻撃するとすぐまた分かれる）
  ev = [];
  for (let t = 0; t < balance.moon.absorbSec + 0.2; t += 0.1) ev.push(...tick(s, 0.1, ctx));
  assert.ok(ev.some((e) => e.type === 'merged'));
  assert.equal(survivor.part, undefined);
  assert.equal(survivor.maxHp, max);
  assert.ok(survivor.hp >= hp && survivor.hp <= hp * 2);
  // また分かれる。両方をすぐに倒すと、ボスを1回だけ倒したことになる
  ev = [];
  damageEnemy(s, 1, ctx, ev, 'quiz', survivor);
  assert.ok(ev.some((e) => e.type === 'split'));
  const gold = s.gold;
  ev = [];
  const [a, b] = s.adventure.enemies;
  damageEnemy(s, 1e12, ctx, ev, 'quiz', a);
  damageEnemy(s, 1e12, ctx, ev, 'quiz', b);
  assert.equal(ev.filter((e) => e.type === 'bossDefeated').length, 1);
  assert.equal(ev.filter((e) => e.type === 'defeat').length, 1, '報酬は1回');
  assert.ok(s.gold > gold);
  assert.equal(s.adventure.floor, 61);
});

test('ブンレツセツを倒すと月面の踏破：称号と図鑑の頁「月はどこから来たか」。知識なので生まれ変わっても残る', () => {
  const ctx = makeCtx(constRng(0.5));
  const s = onMoonFloor(60, ctx);
  knowTruth(s, byId('bunretsusetsu').minions);
  spawnGroup(s, ctx, []);
  const ev = [];
  const boss = ofBoss(s, 'bunretsusetsu');
  // 分かれないように一気に倒す
  boss.hp = 1;
  damageEnemy(s, 1e12, ctx, ev, 'quiz', boss);
  const c = ev.find((e) => e.type === 'moonCleared');
  assert.deepEqual([c.title, c.page, c.first], ['月面踏破者', '月はどこから来たか', true]);
  assert.equal(s.knowledge.moonCleared, true);
  assert.ok(heroTitles(s, ctx).includes('月面踏破者'));
  reincarnate(s, ctx);
  assert.equal(s.knowledge.moonCleared, true);
  assert.ok(heroTitles(s, ctx).includes('月面踏破者'));
});

test('前の版のセーブの読み込み（前世で倒したボスを戻す）は、月面のボスには触らない', () => {
  const ctx = makeCtx();
  const s = newGame(0);
  s.life.generation = 2;
  s.life.maxFloor = 5;
  for (const m of moonBosses) s.bosses[m.id] = { status: 'defeated' };
  assert.deepEqual(forgetPastLifeBosses(s, ctx).filter((id) => moonBosses.some((m) => m.id === id)), []);
  assert.ok(moonBosses.every((m) => s.bosses[m.id].status === 'defeated'));
});

/**
 * ブンレツセツと戦う主人公：世代・レベル・累計正解数を決め、買える装備をすべて買い、仲間4人（戦士・格闘家・魔法使い・僧侶）と契約する。
 * 月面60階層で、1分に1問くらい正解しながら戦う。勝てば true
 */
function fightBunretsu(gen, level, totalCorrect, seed) {
  const ctx = makeCtx(seededRng(seed));
  const s = onMoonFloor(60, ctx, { level });
  s.life.generation = gen;
  s.knowledge.totalCorrect = totalCorrect;
  knowTruth(s, byId('bunretsusetsu').minions);
  s.gold = 1e15;
  for (const it of shopList(s, ctx)) if (it.unlocked && !it.owned) buyItem(s, it.id, ctx);
  for (const r of recruitList(s, ctx).filter((x) => x.role !== 'staff')) hireRecruit(s, r.id, ctx);
  const hs = heroStats(s, ctx);
  s.hero.hp = hs.maxHp; s.hero.mp = hs.maxMp;
  const quiz = seededRng(seed * 7 + 1);
  let next = quiz() * 60;
  for (let t = 0; t < 600; t += 0.5) {
    const ev = tick(s, 0.5, ctx);
    if (ev.some((e) => e.type === 'bossDefeated')) return true;
    if (ev.some((e) => e.type === 'heroDefeated')) return false;
    if (t >= next) {
      next += 60 * (0.5 + quiz());
      const f = s.adventure.enemies[0];
      if (f) damageEnemy(s, Math.ceil(f.maxHp * balance.quiz.correctDamageRatio), ctx, [], 'quiz', f);
    }
  }
  return false;
}

test('ブンレツセツ（月面60階層）は10世代目でやっと倒せる強さ（月面の倍率 rampTo で決まる。40HzP の依頼）', () => {
  assert.equal(byId('bunretsusetsu').stats, undefined, '強さは月面の階層の倍率で決まる（決まった stats は持たない）');
  // 1分に1問正解しながら遊ぶ人の、9世代目・10世代目の80歳（レベルと累計正解数は計算で再現したもの）
  const gen9 = [1, 2, 3, 4, 5].filter((seed) => fightBunretsu(9, 13600, 1800, seed)).length;
  const gen10 = [1, 2, 3, 4, 5].filter((seed) => fightBunretsu(10, 20600, 2000, seed)).length;
  assert.equal(gen9, 0, '9世代目は80歳になっても勝てない');
  assert.ok(gen10 >= 1, '10世代目の80歳なら、勝てたり負けたりする（何度か挑めば勝てる）');
});
