// 最初の3分（設計ページ「最初の3分」）：前世の記憶をたどる（前の名前は常識チェック）・前世で魔物に吹き込まれた噂のザコ・図鑑の1体目・起動から3分の比較・寿命の帯
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  spawnGroup, tick, rememberedZako, zakoZukanCount, lifeBar, heroSnapshot, compareSnapshots, reincarnate, FIRST_LIFE_FLOORS, HOURS_PER_YEAR,
} from '../js/sim.js';
import {
  FIRST_CHECK_SIZE, firstCheckCandidates, pickFirstCheck, beginFirstRun, firstCheckProgress, nextFirstCheck, answerFirstCheck,
} from '../js/quiz.js';
import { serialize, deserialize } from '../js/save.js';
import { balance, monsters, questions, firstCheck, makeCtx, newGame, seededRng, constRng } from './helpers.js';
import { createState, startGame } from '../js/sim.js';

const byName = (name) => monsters.find((m) => m.name === name);
const grassland = monsters.filter((m) => m.kind === 'monster' && (m.areas || []).includes('はじまりの草原'));

/** 前世の記憶をたどる5問を決めた新しいゲーム（問題の並びは ids で決める） */
function firstRunGame(ids = null, rng = seededRng(3)) {
  const ctx = makeCtx(rng);
  const s = newGame(0);
  beginFirstRun(s, ctx);
  if (ids) s.firstRun.check.questions = ids;
  return { s, ctx };
}

/** 次の問題に kind（answer・myth・wrong・timeout）で答える */
function reply(s, ctx, kind) {
  const session = nextFirstCheck(s, ctx);
  const i = kind === 'timeout' ? null : session.current.choices.findIndex((c) => c.kind === kind);
  return answerFirstCheck(s, session, i, ctx);
}

const idOf = (monsterName) => firstCheck.find((c) => c.monster === monsterName).id;

test('データ：前世の記憶をたどる問題の候補は10〜15問。どれも今の問題にあり、☆で、地球のザコ（⚠でない）とつながっている', () => {
  assert.ok(firstCheck.length >= 10 && firstCheck.length <= 15, `候補は${firstCheck.length}問`);
  assert.equal(new Set(firstCheck.map((c) => c.id)).size, firstCheck.length, '同じ問題は1回だけ');
  for (const c of firstCheck) {
    const q = questions.find((x) => x.id === c.id);
    assert.ok(q, `${c.monster} の問題が questions.json にある`);
    assert.equal(q.difficulty, 1, `${c.monster} は☆`);
    assert.equal(q.monster, c.monster, '控えの魔物の名前が合っている');
    assert.equal(q.genre, c.genre, '控えのジャンルが合っている');
    const m = byName(q.monster);
    assert.ok(m && m.kind === 'monster' && (m.world || 'earth') === 'earth' && !m.debated, `${c.monster} は地球のザコで⚠でない`);
  }
  assert.equal(firstCheckCandidates(makeCtx()).length, firstCheck.length, 'ゲームもすべて候補にする');
  assert.ok(new Set(firstCheck.map((c) => c.genre)).size >= FIRST_CHECK_SIZE, 'ジャンルを散らせるだけの数がある');
});

test('前世の記憶をたどる5問：ジャンルを散らして選び、毎回同じにはならない', () => {
  const sets = new Set();
  for (let seed = 1; seed <= 20; seed++) {
    const ids = pickFirstCheck(makeCtx(seededRng(seed)));
    assert.equal(ids.length, FIRST_CHECK_SIZE);
    assert.equal(new Set(ids).size, FIRST_CHECK_SIZE);
    const genres = ids.map((id) => questions.find((q) => q.id === id).genre);
    assert.equal(new Set(genres).size, FIRST_CHECK_SIZE, `ジャンルが重ならない（${genres.join('・')}）`);
    sets.add([...ids].sort().join());
  }
  assert.ok(sets.size >= 10, '選び方が毎回ちがう');
  // 候補が少ないとき（ジャンルが足りない）は、同じジャンルからも取って5問にする
  const few = makeCtx(seededRng(1));
  few.firstCheck = firstCheck.filter((c) => ['生物', '勉強法'].includes(c.genre));
  assert.equal(pickFirstCheck(few).length, FIRST_CHECK_SIZE);
});

test('前世の記憶をたどる問題の答えはふつうの勉強と同じに数え、どう答えたか（正解・誤解・誤答2と3・時間切れ）を覚える', () => {
  const ids = ['ジュッパーノウ', 'イチヤヅケ', 'ニドオチズ', 'カゼコウセイ', 'ラクダミズブクロ'].map(idOf);
  const { s, ctx } = firstRunGame(ids);
  assert.deepEqual(firstCheckProgress(s), { index: 0, total: 5, done: false });
  const first = nextFirstCheck(s, ctx);
  assert.equal(first.current.question.id, ids[0]);
  assert.equal(first.current.choices.length, 4);
  assert.ok(first.current.choices.some((c) => c.kind === 'myth'), '誤答1（誤解）は必ず選択肢にある');
  assert.equal(first.current.timeLimit, balance.quiz.timeLimitSec[0], '☆の制限時間');
  const r1 = answerFirstCheck(s, first, first.current.choices.findIndex((c) => c.kind === 'myth'), ctx);
  assert.deepEqual([r1.correct, r1.check], [false, { kind: 'myth', monsterId: byName('ジュッパーノウ').id }]);
  reply(s, ctx, 'wrong');
  reply(s, ctx, 'timeout');
  const r4 = reply(s, ctx, 'answer');
  assert.equal(r4.correct, true);
  assert.equal(s.knowledge.totalCorrect, 1, '正解は累計の正解数に入る');
  reply(s, ctx, 'answer');
  assert.deepEqual(firstCheckProgress(s), { index: 5, total: 5, done: true });
  assert.equal(nextFirstCheck(s, ctx), null, '5問で終わり');
  assert.deepEqual(s.firstRun.check.answers.map((a) => a.kind), ['myth', 'wrong', 'timeout', 'correct', 'correct']);
  assert.equal(s.knowledge.history.length, 5, '過去問復習の最近解いた問題にも入る');
  assert.ok(s.knowledge.review.includes(ids[0]), '間違えた問題は間違えたままの問題に');
  // 覚えたザコ：正解しなかった3問のザコ（答えた順）。誤解を選んだものだけ believed
  assert.deepEqual(rememberedZako(s, ctx).map((r) => [r.monster.name, r.believed]),
    [['ジュッパーノウ', true], ['イチヤヅケ', false], ['ニドオチズ', false]]);
});

test('間違えた問題のザコ（前世で魔物に吹き込まれた噂）は、最初の人生の1〜10階層で群れの先頭に1回ずつ優先して出る', () => {
  const ids = ['ジュッパーノウ', 'ニドオチズ', 'キンジツナツ', 'カゼコウセイ', 'ラクダミズブクロ'].map(idOf);
  const { s, ctx } = firstRunGame(ids);
  reply(s, ctx, 'myth');    // ジュッパーノウ（草原）
  reply(s, ctx, 'wrong');   // ニドオチズ（火山・天空の神殿）
  reply(s, ctx, 'myth');    // キンジツナツ（氷の大地）
  reply(s, ctx, 'answer');
  reply(s, ctx, 'answer');
  s.adventure.enemies = [];
  const ev = [];
  spawnGroup(s, ctx, ev);
  assert.deepEqual(s.adventure.enemies.slice(0, 3).map((e) => e.name), ['ジュッパーノウ', 'ニドオチズ', 'キンジツナツ'], '先頭に並ぶ（ほかのエリアのザコも1階層に出る）');
  assert.equal(s.adventure.enemies.length, balance.floor.monstersPerFloor, '残りは草原のザコなどで埋める');
  const mis = ev.filter((e) => e.type === 'misbelief');
  assert.deepEqual(mis.map((e) => [e.name, e.believed, e.myth]), [
    ['ジュッパーノウ', true, byName('ジュッパーノウ').myth], ['ニドオチズ', false, byName('ニドオチズ').myth], ['キンジツナツ', true, byName('キンジツナツ').myth]]);
  assert.ok(mis.every((e) => s.adventure.enemies.some((x) => x.uid === e.uid)));
  // 強さは階層で決まる（1階層の強さ）
  const plain = s.adventure.enemies[3];
  assert.equal(s.adventure.enemies[2].maxHp, plain.maxHp);
  // 2回目の群れからは、印を付けて出し直さない（1〜10階層では、ほかのザコと一緒に出ることはある）
  for (let k = 0; k < 20; k++) {
    s.adventure.enemies = []; s.adventure.kills = 0;
    const ev2 = [];
    spawnGroup(s, ctx, ev2);
    assert.ok(!ev2.some((e) => e.type === 'misbelief'));
    const allowed = new Set([...grassland.map((m) => m.name), 'ジュッパーノウ', 'ニドオチズ', 'キンジツナツ']);
    for (const e of s.adventure.enemies) assert.ok(allowed.has(e.name), `1階層の群れに ${e.name}`);
  }
  // 11階層からは覚えたザコを優先しない（その世界のザコだけ）
  s.adventure.floor = FIRST_LIFE_FLOORS + 1;
  for (let k = 0; k < 20; k++) {
    s.adventure.enemies = []; s.adventure.kills = 0;
    spawnGroup(s, ctx, []);
    for (const e of s.adventure.enemies) assert.ok(byName(e.name).areas.includes('生き物の森'), `11階層に ${e.name}`);
  }
});

test('間違えた問題のザコは、答えてすぐ今の群れの後ろのザコと入れ替わって現れる（もう群れにいれば印だけ。入れ替える相手がいなければ次の群れ）', () => {
  const { s, ctx } = firstRunGame(['キンジツナツ', 'ジュッパーノウ', 'デカグリーンランド', 'ニドオチズ', 'ラクダミズブクロ'].map(idOf), constRng(0.5));
  s.adventure.enemies = [];
  spawnGroup(s, ctx, []);
  const before = s.adventure.enemies.map((e) => ({ ...e }));
  for (const e of s.adventure.enemies) e.hp -= 1; // 先頭と戦っている最中（ひらめきで全体が傷ついていても入れ替える）
  const r1 = reply(s, ctx, 'myth'); // キンジツナツ（氷の大地のザコ）
  const mis = r1.events.filter((e) => e.type === 'misbelief');
  assert.equal(mis.length, 1);
  assert.equal(mis[0].name, 'キンジツナツ');
  assert.equal(mis[0].swapped, true);
  const last = s.adventure.enemies[s.adventure.enemies.length - 1];
  assert.equal(last.name, 'キンジツナツ', '群れのいちばん後ろと入れ替わる');
  assert.deepEqual([last.slot, last.maxHp, last.hp], [before[before.length - 1].slot, before[before.length - 1].maxHp, last.maxHp], '同じ場所に、同じ階層の強さ（HPは満タン）で');
  assert.equal(mis[0].uid, last.uid);
  assert.equal(s.adventure.enemies.length, before.length, '群れの数は変わらない');
  assert.ok(r1.events.some((e) => e.type === 'zukan' && e.monsterId === last.monsterId && e.stage === 1), '図鑑に載る');
  // もう群れにいるザコなら、入れ替えずに印だけ付ける
  const here = s.adventure.enemies.find((e) => e.monsterId === s.adventure.enemies[1].monsterId); // 同じザコが何体かいれば最初の1体
  s.firstRun.check.questions[1] = questions.find((q) => q.monster === here.name && q.wrong.length).id;
  const r2 = reply(s, ctx, 'wrong');
  assert.deepEqual(r2.events.filter((e) => e.type === 'misbelief').map((e) => [e.uid, e.swapped, e.believed]), [[here.uid, false, false]]);
  // 正解ではザコは出ない
  assert.ok(!reply(s, ctx, 'answer').events.some((e) => e.type === 'misbelief'));
  // 入れ替えられる相手がいない（先頭の1体だけ）ときは、次の群れで出る
  s.adventure.enemies = s.adventure.enemies.slice(0, 1);
  const r4 = reply(s, ctx, 'timeout'); // ニドオチズ
  assert.ok(!r4.events.some((e) => e.type === 'misbelief'));
  s.adventure.enemies = []; s.adventure.kills = 0;
  const ev = [];
  spawnGroup(s, ctx, ev);
  assert.equal(s.adventure.enemies[0].name, 'ニドオチズ');
  assert.deepEqual(ev.filter((e) => e.type === 'misbelief').map((e) => [e.name, e.believed, e.swapped]), [['ニドオチズ', false, undefined]]);
});

test('まだ出していない覚えたザコは、10階層までのどこで答えても次の群れで出る。生まれ変わると優先しない', () => {
  const { s, ctx } = firstRunGame(['キンジツナツ', 'ナミダツブ', 'ツギハクロ', 'カゼコウセイ', 'ラクダミズブクロ'].map(idOf));
  s.adventure.floor = 7;
  reply(s, ctx, 'myth');
  s.adventure.enemies = [];
  const ev = [];
  spawnGroup(s, ctx, ev);
  assert.equal(s.adventure.enemies[0].name, 'キンジツナツ');
  // 2世代目は優先しない（覚えたザコが残っていても）
  reply(s, ctx, 'wrong');
  s.life.generation = 2;
  s.adventure.floor = 1;
  for (let k = 0; k < 20; k++) {
    s.adventure.enemies = []; s.adventure.kills = 0;
    const ev2 = [];
    spawnGroup(s, ctx, ev2);
    assert.ok(!ev2.some((e) => e.type === 'misbelief'));
    for (const e of s.adventure.enemies) assert.ok(grassland.some((m) => m.name === e.name), `2世代目の1階層に ${e.name}`);
  }
});

test('前世の最期のすぐあと（最初の案内の前）に答えた5問：間違えた問題のザコは、冒険を始めた最初の群れの先頭に出る', () => {
  const ctx = makeCtx(seededRng(9));
  const s = createState(balance);
  beginFirstRun(s, ctx); // 前世の最期が終わったところ（まだ年齢を選んでいない）
  s.firstRun.check.questions = ['ジュッパーノウ', 'キンジツナツ', 'ニドオチズ', 'カゼコウセイ', 'ラクダミズブクロ'].map(idOf);
  const r = reply(s, ctx, 'myth');
  assert.ok(!r.events.some((e) => e.type === 'misbelief'), 'まだ冒険が始まっていないので、その場には出ない');
  reply(s, ctx, 'wrong');
  reply(s, ctx, 'timeout');
  reply(s, ctx, 'answer');
  reply(s, ctx, 'answer');
  assert.equal(s.knowledge.totalCorrect, 2, '答えは数える（生まれ変わった最初の人生に持ち越す）');
  startGame(s, 0, '主人公', 80, 'male'); // 最初の案内で年齢を選んだ
  const ev = tick(s, 0.05, ctx);
  assert.deepEqual(s.adventure.enemies.slice(0, 3).map((e) => e.name), ['ジュッパーノウ', 'キンジツナツ', 'ニドオチズ']);
  assert.deepEqual(ev.filter((e) => e.type === 'misbelief').map((e) => e.name), ['ジュッパーノウ', 'キンジツナツ', 'ニドオチズ'], '3つとも「前世で魔物に吹き込まれた噂」として出る');
});

test('全問正解なら、覚えたザコは無く、いつもの草原のザコが出る', () => {
  const { s, ctx } = firstRunGame();
  for (let i = 0; i < FIRST_CHECK_SIZE; i++) reply(s, ctx, 'answer');
  assert.deepEqual(rememberedZako(s, ctx), []);
  for (let k = 0; k < 20; k++) {
    s.adventure.enemies = []; s.adventure.kills = 0;
    const ev = [];
    spawnGroup(s, ctx, ev);
    assert.ok(!ev.some((e) => e.type === 'misbelief'));
    for (const e of s.adventure.enemies) assert.ok(grassland.some((m) => m.name === e.name), e.name);
  }
});

test('図鑑の1体目：初めてザコを倒した瞬間に一度だけ「1／ザコの全数」を知らせる', () => {
  const total = monsters.filter((m) => m.kind === 'monster').length;
  assert.equal(total, 171, '設計ページの例（1／171）と同じ数');
  const { s, ctx } = firstRunGame(null, constRng(0.5));
  s.hero.level = 50;
  s.adventure.enemies = [];
  spawnGroup(s, ctx, []);
  const ev = [];
  for (let i = 0; i < 40 && !ev.some((e) => e.type === 'defeat'); i++) ev.push(...tick(s, 0.1, ctx));
  const first = ev.filter((e) => e.type === 'firstZukan');
  assert.equal(first.length, 1);
  const killed = ev.find((e) => e.type === 'defeat');
  assert.deepEqual(first[0], { type: 'firstZukan', monsterId: killed.monsterId, opened: 1, total });
  assert.deepEqual(zakoZukanCount(s, ctx), { opened: 1, total });
  const more = [];
  for (let i = 0; i < 100; i++) more.push(...tick(s, 0.1, ctx));
  assert.ok(more.some((e) => e.type === 'defeat'));
  assert.ok(!more.some((e) => e.type === 'firstZukan'), '2体目からは出さない');
});

test('前のセーブ（firstRun が無い）は、前世の記憶をたどる問題も覚えたザコも図鑑の札も無いものとして読む', () => {
  const ctx = makeCtx(seededRng(5));
  const old = newGame(7);
  delete old.firstRun;
  const s = deserialize(serialize(old, 0), balance);
  assert.equal(s.firstRun, null);
  assert.deepEqual(firstCheckProgress(s), { index: 0, total: 0, done: true });
  assert.equal(nextFirstCheck(s, ctx), null);
  assert.deepEqual(rememberedZako(s, ctx), []);
  s.hero.level = 50;
  const ev = [];
  for (let i = 0; i < 100; i++) ev.push(...tick(s, 0.1, ctx));
  assert.ok(ev.some((e) => e.type === 'defeat'));
  assert.ok(!ev.some((e) => e.type === 'firstZukan' || e.type === 'misbelief'));
  // 始めた後のセーブも、そのまま読める
  const { s: fresh } = firstRunGame();
  reply(fresh, makeCtx(seededRng(2)), 'myth');
  assert.deepEqual(deserialize(serialize(fresh, 0), balance).firstRun, fresh.firstRun);
});

test('起動から3分の比較：伸びたものだけを並べ、図鑑に加わった数と正解した数を添える。生まれ変わっていたら比べない', () => {
  const ctx = makeCtx();
  const s = newGame(0);
  const before = heroSnapshot(s, ctx);
  s.hero.level = 12;
  s.life.maxFloor = 4;
  s.knowledge.totalCorrect = 3;
  s.knowledge.zukan = { a: { stage: 1, fooled: 0 }, b: { stage: 2, fooled: 0 } };
  const after = heroSnapshot(s, ctx);
  const cmp = compareSnapshots(before, after);
  assert.deepEqual(cmp.rows.map((r) => r.key), ['level', 'maxHp', 'maxMp', 'atk', 'def', 'wis', 'agi', 'luck', 'floor'].filter((k) => after[k] > before[k]));
  assert.deepEqual(cmp.rows[0], { key: 'level', label: 'Lv', from: 1, to: 12 });
  assert.ok(cmp.rows.some((r) => r.key === 'floor' && r.from === 1 && r.to === 4));
  assert.ok(!cmp.rows.some((r) => r.key === 'moonFloor'), '伸びていないものは出さない');
  assert.deepEqual([cmp.zukan, cmp.correct], [2, 3]);
  assert.deepEqual(compareSnapshots(after, after), { rows: [], zukan: 0, correct: 0 }, '何も伸びていなければ空');
  reincarnate(s, ctx);
  assert.equal(compareSnapshots(before, heroSnapshot(s, ctx)), null);
});

test('寿命の帯：誕生日ごとに1目盛り進み、寿命は病院の治療で延びた分も入れる', () => {
  const s = newGame(0);
  s.life.lifespan = 80;
  assert.deepEqual(lifeBar(s, balance), { age: 0, lifespan: 80 });
  s.life.gameHours = 2.99 * HOURS_PER_YEAR;
  assert.deepEqual(lifeBar(s, balance), { age: 2, lifespan: 80 }, '次の誕生日までは進まない');
  s.life.gameHours = 3 * HOURS_PER_YEAR;
  assert.equal(lifeBar(s, balance).age, 3);
  s.life.treatments = 2;
  assert.equal(lifeBar(s, balance).lifespan, 80 + 2 * balance.hospital.extendYears);
  s.life.gameHours = 200 * HOURS_PER_YEAR;
  assert.equal(lifeBar(s, balance).age, lifeBar(s, balance).lifespan, '帯からはみ出さない');
});
