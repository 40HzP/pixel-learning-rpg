// 誕生日の熟練判定と階層の移動（設計ページ「誕生日の熟練判定と階層の移動（2026-11-07）」）。
// 睡眠（寝床・月面基地）と拠点（拠点・前線基地）はやめた。熟練の判定は誕生日、やられたら1つ手前の階層から、到達した階層へはいつでも移動できる
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  birthday, genreState, heroStats, spawnGroup, spawnEnemy, challengeMidboss, challengeableMidboss, tick, reincarnate, ageYears,
  moveToFloor, floorAreas, reachedFloor, logProficiency, PROF_LOG_MAX, HOURS_PER_YEAR,
} from '../js/sim.js';
import { createSession, presentQuestion, answer } from '../js/quiz.js';
import { balance, questions, makeCtx, newGame, seqRng, constRng } from './helpers.js';

const B = balance.birthday;

function setup() {
  const s = newGame(0);
  Object.assign(genreState(s, '生物'), { level: 2, studied: true });                       // この1年に勉強した
  Object.assign(genreState(s, '数学'), { level: 3, studied: false, idle: B.idleYears - 1 }); // この誕生日で、勉強していない年数が idleYears に届く
  Object.assign(genreState(s, '法学'), { level: 0, studied: false, idle: 99 });             // Lv0 は下がらない
  return s;
}

test('数値：誕生日の判定は、勉強したら15%で+1・10年勉強していなければ5%で−1（設計ページの案）', () => {
  assert.deepEqual(B, { upChance: 0.15, downChance: 0.05, idleYears: 10 });
  assert.equal(balance.sleep, undefined, '睡眠はやめた');
});

test('誕生日：勉強したジャンルは上がり、idleYears 年以上勉強していないジャンルは下がる（乱数を固定）。熟練の記録に残る', () => {
  const s = setup();
  // GENRES の並びで 数学 → 生物 の順に判定される
  const changes = birthday(s, makeCtx(seqRng([0.01, 0.01])));
  assert.equal(genreState(s, '生物').level, 3);
  assert.equal(genreState(s, '数学').level, 2);
  assert.equal(genreState(s, '法学').level, 0);
  assert.deepEqual(changes, [
    { genre: '数学', from: 3, to: 2, reason: 'idle', years: B.idleYears },
    { genre: '生物', from: 2, to: 3, reason: 'year' },
  ]);
  assert.deepEqual(s.knowledge.profLog.map((c) => [c.genre, c.from, c.to, c.reason, c.gen, c.age]), [
    ['生物', 2, 3, 'year', 1, 0], ['数学', 3, 2, 'idle', 1, 0]], '新しい順。世代と年齢つき');
  assert.equal(genreState(s, '生物').idle, 0, '勉強したので数え直し');
});

test('誕生日：勉強していない年数が idleYears に届かないうちは下がらない（乱数も使わない）', () => {
  const s = setup();
  genreState(s, '数学').idle = 0;
  const changes = birthday(s, makeCtx(seqRng([0.01, 0.99])));
  assert.equal(genreState(s, '数学').level, 3);
  assert.equal(genreState(s, '数学').idle, 1, '勉強していない年数を数える');
  assert.deepEqual(changes, [{ genre: '生物', from: 2, to: 3, reason: 'year' }], '1つ目の乱数は生物に使う');
});

test('誕生日：確率に外れたら変わらない。ちょうど境目（15%・5%）も外れ', () => {
  for (const rolls of [[0.99, 0.99], [B.downChance, B.upChance]]) {
    const s = setup();
    assert.deepEqual(birthday(s, makeCtx(seqRng(rolls))), []);
    assert.deepEqual([genreState(s, '生物').level, genreState(s, '数学').level], [2, 3]);
  }
});

test('誕生日：上限に届いているジャンルは上がらず「上限に届いている」と残す。全回復・要出典が戻る・「勉強した」が消える・時間は進まない', () => {
  const s = setup();
  genreState(s, '生物').level = 5;
  s.hero.hp = 1; s.hero.mp = 0;
  s.citationsUsed = 3;
  const before = s.life.gameHours;
  const changes = birthday(s, makeCtx(seqRng([0.99, 0.0])));
  assert.deepEqual(changes, [{ genre: '生物', from: 5, to: 5, reason: 'cap' }]);
  assert.equal(genreState(s, '生物').level, 5);
  const hs = heroStats(s, makeCtx());
  assert.deepEqual([s.hero.hp, s.hero.mp], [hs.maxHp, hs.maxMp]);
  assert.equal(s.citationsUsed, 0);
  assert.equal(genreState(s, '生物').studied, false);
  assert.equal(s.life.gameHours, before);
});

test('誕生日は年を取るたびに1回（tick）。始めた年齢ではすぐには起きない', () => {
  const s = newGame(7);
  const ctx = makeCtx(constRng(0.99));
  assert.equal(s.life.birthday, 7);
  assert.equal(tick(s, 0.1, ctx).filter((e) => e.type === 'birthday').length, 0);
  s.life.gameHours = 8 * HOURS_PER_YEAR - 1;
  s.hero.hp = 1;
  const ev = tick(s, 1, ctx);
  assert.deepEqual(ev.filter((e) => e.type === 'birthday').map((e) => e.age), [8]);
  assert.ok(s.hero.hp > 1, '全回復');
  // 1年は現実で約2.5分
  assert.ok(Math.abs(HOURS_PER_YEAR / balance.time.gameHoursPerRealSecond / 60 - 2.5) < 0.01);
  // 何歳か飛んだらその数だけ
  s.life.gameHours = 11 * HOURS_PER_YEAR + 5;
  assert.deepEqual(tick(s, 0.01, ctx).filter((e) => e.type === 'birthday').map((e) => e.age), [11, 11, 11]);
  assert.equal(s.life.birthday, 11);
});

test('やられたら：1つ手前の階層の最初からやり直して全回復する。熟練の判定はしない・時間も進まない。強さ・装備・仲間はそのまま', () => {
  const s = newGame(0);
  const ctx = makeCtx(constRng(0.01));
  Object.assign(s.adventure, { floor: 5, kills: 3 });
  s.hero.level = 6;
  s.equipment.weapon = 'wood_sword';
  s.allies.push({ id: 'teacher_elementary', name: '小学校教師', atk: 3, maxHp: 30, hp: 5, cd: 99 });
  Object.assign(genreState(s, '生物'), { level: 1, studied: true });
  const e = spawnEnemy(s, ctx, []);
  e.cd = 0.05;
  s.adventure.heroCd = 99;
  s.allies[0].cd = 99;
  s.hero.hp = 1;
  const hours = s.life.gameHours;
  const dead = tick(s, 0.1, ctx).find((x) => x.type === 'heroDefeated');
  assert.deepEqual(dead, { type: 'heroDefeated', from: 5, floor: 4, world: 'earth' });
  assert.deepEqual([s.adventure.floor, s.adventure.kills, s.adventure.enemies], [4, 0, []]);
  assert.deepEqual([s.hero.level, s.equipment.weapon, s.allies.length], [6, 'wood_sword', 1]);
  assert.equal(s.hero.hp, heroStats(s, ctx).maxHp);
  assert.equal(s.allies[0].hp, 30, '仲間も全回復');
  assert.equal(genreState(s, '生物').level, 1, '熟練の判定はしない');
  assert.ok(Math.abs(s.life.gameHours - hours - 0.1 * balance.time.gameHoursPerRealSecond) < 1e-6, '時間はふつうに進むだけ（眠った分は進まない）');
  // 1階層でやられたら1階層の最初から
  s.adventure.floor = 1;
  const e2 = spawnEnemy(s, ctx, []);
  e2.cd = 0.01;
  s.hero.hp = 1;
  const dead2 = tick(s, 0.1, ctx).find((x) => x.type === 'heroDefeated');
  assert.equal(dead2.floor, 1);
});

test('中ボスと戦っている途中にやられると、中ボスは退き、また挑戦できる', () => {
  const s = newGame(7);
  const ctx = makeCtx(constRng(0.01));
  s.adventure.floor = 3;
  s.knowledge.totalCorrect = 99;
  const mb = challengeMidboss(s, ctx, []);
  assert.ok(mb, '中ボスに挑戦できる年齢');
  s.hero.hp = 1;
  mb.cd = 0.01;
  s.adventure.heroCd = 99;
  const dead = tick(s, 0.1, ctx).find((x) => x.type === 'heroDefeated');
  assert.ok(dead);
  assert.equal(s.adventure.floor, 2);
  assert.ok(!s.adventure.enemies.some((x) => x.kind === 'midboss'));
  assert.equal(challengeableMidboss(s, ctx).id, mb.monsterId, 'また挑戦できる');
});

test('階層の移動：この人生で到達した階層（今いる世界）に、エリアを選んで移動できる。その階層の最初から', () => {
  const s = newGame(0);
  const ctx = makeCtx();
  s.life.maxFloor = 23;
  s.adventure.floor = 23;
  s.adventure.kills = 2;
  spawnGroup(s, ctx, []);
  assert.equal(reachedFloor(s), 23);
  const areas = floorAreas(s, ctx);
  assert.deepEqual(areas.map((a) => [a.from, a.last, a.name]), [[1, 10, 'はじまりの草原'], [11, 20, '生き物の森'], [21, 23, '平安京']]);
  // エリアのザコのうち、図鑑でまだ出会っていない数
  const grass = ctx.monsters.filter((m) => m.kind === 'monster' && (m.areas || []).includes('はじまりの草原'));
  assert.equal(areas[0].zako, grass.length);
  assert.equal(areas[0].unmet, grass.length);
  s.knowledge.zukan[grass[0].id] = { stage: 1, fooled: 0 };
  assert.equal(floorAreas(s, ctx)[0].unmet, grass.length - 1);
  // ボスと、倒したかどうか
  assert.deepEqual(areas[0].boss, { id: 'tendousetsu', name: 'テンドウセツ', floor: 10, defeated: false });
  assert.deepEqual(moveToFloor(s, ctx, 8), { ok: true, floor: 8, world: 'earth' });
  assert.deepEqual([s.adventure.floor, s.adventure.kills, s.adventure.enemies], [8, 0, []]);
  assert.match(moveToFloor(s, ctx, 24).reason, /23階層より先には/);
  assert.match(moveToFloor(s, ctx, 8).reason, /もう8階層にいる/);
  assert.equal(s.life.maxFloor, 23, '最高到達は変わらない');
});

test('階層の移動：中ボスと戦っている途中なら中ボスは退く。倒したボスの階層ではザコが出る', () => {
  const s = newGame(7);
  const ctx = makeCtx();
  s.life.maxFloor = 15;
  s.adventure.floor = 12;
  s.knowledge.totalCorrect = 99;
  const mb = challengeMidboss(s, ctx, []);
  assert.equal(moveToFloor(s, ctx, 12).ok, true, '中ボスと戦っていれば同じ階層でも移れる（中ボスが退く）');
  assert.equal(challengeableMidboss(s, ctx).id, mb.monsterId);
  s.bosses.tendousetsu = { status: 'defeated' };
  moveToFloor(s, ctx, 10);
  const group = spawnGroup(s, ctx, []);
  assert.ok(group.length > 1 && group.every((e) => e.kind === 'monster'), 'ボスの代わりにザコの群れ');
});

test('熟練の記録：勉強の正解で上がった分も残る。PROF_LOG_MAX 件まで。生まれ変わっても残る', () => {
  const s = newGame(0);
  const ctx = makeCtx();
  const q = questions[0];
  const g = genreState(s, q.genre);
  g.progress = balance.quiz.correctPerProficiencyLevel - 1;
  const session = createSession(s, 'quiz', ctx);
  presentQuestion(session, q, ctx);
  answer(s, session, session.current.choices.findIndex((c) => c.kind === 'answer'), ctx);
  assert.deepEqual(s.knowledge.profLog[0], { gen: 1, age: 0, genre: q.genre, from: 0, to: 1, reason: 'study' });
  assert.equal(g.studied, true);
  for (let i = 0; i < PROF_LOG_MAX + 30; i++) logProficiency(s, { genre: '数学', from: 1, to: 2, reason: 'year' });
  assert.equal(s.knowledge.profLog.length, PROF_LOG_MAX);
  reincarnate(s, ctx);
  assert.equal(s.knowledge.profLog.length, PROF_LOG_MAX);
  assert.equal(ageYears(s), 0);
});
