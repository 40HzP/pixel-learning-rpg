import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  tick, genreState, heroTitles, reincarnate, spawnGroup, spawnEnemy, sleep, buildBase, respawnFloor, baseActive,
  rocketSteps, itemPrice, buyItem, industryOutlook, foundCompany, hireStaff, companiesProfit, monthlyContractCost, HOURS_PER_YEAR,
} from '../js/sim.js';
import { fieldActive, fieldById, fieldList, setMajor, canMajor, MAJOR_SLOTS } from '../js/fields.js';
import { createSession, nextQuestion, presentQuestion, answer, interferingEnemy, blockedInterference, fooledAnalysis } from '../js/quiz.js';
import { serialize, deserialize } from '../js/save.js';
import { GENRES } from '../js/genres.js';
import { balance, fields, items, business, questions, makeCtx, newGame, constRng, questionFor } from './helpers.js';

const LV = balance.fields.unlockLevel;
/** ジャンルの熟練を決め、tick で解放の判定をさせる */
function setLevels(s, ctx, levels) {
  for (const [g, lv] of Object.entries(levels)) genreState(s, g).level = lv;
  return tick(s, 0.01, ctx);
}
const unlock = (s, ctx, ...ids) => setLevels(s, ctx, Object.fromEntries(ids.flatMap((id) => fieldById(ctx, id).genres.map((g) => [g, LV]))));

test('データ：学際分野は29ジャンルのうち2つの組み合わせ（同じ組み合わせは1つまで）。称号と説明がある。ロケットの工程は専攻にできる学際分野につながる', () => {
  const ctx = makeCtx();
  const ids = new Set(), pairs = new Set();
  for (const f of fields.fields) {
    assert.ok(!ids.has(f.id), `${f.id} が重なっている`);
    ids.add(f.id);
    assert.equal(f.genres.length, 2, f.name);
    assert.notEqual(f.genres[0], f.genres[1], f.name);
    for (const g of f.genres) assert.ok(GENRES.includes(g), `${f.name} のジャンル ${g}`);
    const key = [...f.genres].sort().join('+');
    assert.ok(!pairs.has(key), `${f.name} の組み合わせが重なっている`);
    pairs.add(key);
    assert.ok(f.name && f.title && f.desc, f.id);
    assert.ok(fields.groups.some((g) => g.id === f.group), `${f.name} の分類`);
  }
  for (const st of fields.rocketSteps) assert.ok(canMajor(fieldById(ctx, st.field)), st.name);
  assert.equal(LV, 3);
  assert.equal(MAJOR_SLOTS.length, 2);
});

test('解放：2つのジャンルの熟練がどちらもLv3以上で解放され、称号がもらえる。知らせは一度だけ。専攻に入れるまで効果は出ない', () => {
  const ctx = makeCtx();
  const s = newGame(0);
  let ev = setLevels(s, ctx, { 心理学: 3, 経済学: 2 });
  assert.ok(!ev.some((e) => e.type === 'fieldUnlocked'));
  ev = setLevels(s, ctx, { 経済学: 3 });
  assert.deepEqual(ev.filter((e) => e.type === 'fieldUnlocked').map((e) => [e.name, e.title]), [['行動経済学', '行動経済学者']]);
  assert.ok(heroTitles(s, ctx).includes('行動経済学者'));
  assert.ok(!tick(s, 0.01, ctx).some((e) => e.type === 'fieldUnlocked'), '二度は知らせない');
  assert.equal(fieldActive(s, ctx, 'behavioral_economics'), false);
});

test('一覧：未解放は名前を伏せて片方のジャンル（熟練の高いほう）だけ見せる。隠しの学際分野は解放するまで出ず、称号だけで専攻にはできない', () => {
  const ctx = makeCtx();
  const s = newGame(0);
  genreState(s, '経済学').level = 2;
  let list = fieldList(s, ctx);
  const be = list.find((f) => f.id === 'behavioral_economics');
  assert.equal(be.unlocked, false);
  assert.deepEqual(be.hint, { genre: '経済学', level: 2 });
  assert.ok(!list.some((f) => f.group === 'hidden'));
  const ev = unlock(s, ctx, 'phonetics');
  assert.deepEqual(ev.filter((e) => e.type === 'fieldUnlocked').map((e) => [e.name, e.hidden]), [['音声学', true]]);
  list = fieldList(s, ctx);
  assert.ok(list.find((f) => f.id === 'phonetics').unlocked);
  assert.ok(heroTitles(s, ctx).includes('音声学者'));
  assert.match(setMajor(s, 0, 'phonetics', ctx).reason, /称号だけ/);
});

test('専攻は主専攻・副専攻の2枠。解放したものだけ入れられ、いつでも付け替えられる（もう片方の枠からは移る）', () => {
  const ctx = makeCtx();
  const s = newGame(0);
  unlock(s, ctx, 'behavioral_economics', 'econometrics');
  assert.match(setMajor(s, 0, 'aerospace', ctx).reason, /まだ解放していない/);
  assert.equal(setMajor(s, 0, 'behavioral_economics', ctx).ok, true);
  assert.equal(setMajor(s, 1, 'econometrics', ctx).ok, true);
  assert.deepEqual(s.knowledge.majors, ['behavioral_economics', 'econometrics']);
  assert.ok(fieldActive(s, ctx, 'behavioral_economics') && fieldActive(s, ctx, 'econometrics'));
  setMajor(s, 1, 'behavioral_economics', ctx);
  assert.deepEqual(s.knowledge.majors, [null, 'behavioral_economics'], '副専攻に移った');
  setMajor(s, 1, null, ctx);
  assert.deepEqual(s.knowledge.majors, [null, null]);
  assert.equal(fieldActive(s, ctx, 'behavioral_economics'), false);
});

test('休眠：睡眠で熟練がLv3を下回ると効果が止まり（知らせる）、戻すと復活する。解放と称号はそのまま', () => {
  const ctx = makeCtx(constRng(0.01)); // 睡眠で、解いていないジャンルは必ず下がる
  const s = newGame(0);
  unlock(s, ctx, 'behavioral_economics');
  setMajor(s, 0, 'behavioral_economics', ctx);
  sleep(s, ctx);
  assert.equal(genreState(s, '心理学').level, LV - 1);
  const ev = tick(s, 0.01, ctx);
  const d = ev.find((e) => e.type === 'fieldDormant');
  assert.ok(d, '休眠を知らせる');
  assert.equal(d.slot, 0);
  assert.deepEqual(d.low, [{ genre: '心理学', level: 2 }, { genre: '経済学', level: 2 }]);
  assert.equal(fieldActive(s, ctx, 'behavioral_economics'), false);
  assert.ok(heroTitles(s, ctx).includes('行動経済学者'), '称号は残る');
  assert.equal(fieldList(s, ctx).find((f) => f.id === 'behavioral_economics').dormant, true);
  const awake = setLevels(s, ctx, { 心理学: LV, 経済学: LV });
  assert.ok(awake.some((e) => e.type === 'fieldAwake' && e.id === 'behavioral_economics'));
  assert.equal(fieldActive(s, ctx, 'behavioral_economics'), true);
});

test('生まれ変わっても、解放した学際分野と専攻は残る（知識なので）。拠点は階層と一緒に無くなる', () => {
  const ctx = makeCtx();
  const s = newGame(0);
  unlock(s, ctx, 'structural_engineering');
  setMajor(s, 0, 'structural_engineering', ctx);
  s.adventure.floor = 12;
  buildBase(s, ctx);
  reincarnate(s, ctx);
  assert.deepEqual(s.knowledge.majors, ['structural_engineering', null]);
  assert.ok(s.knowledge.fields.structural_engineering);
  assert.equal(s.adventure.baseFloor, null);
  assert.ok(heroTitles(s, ctx).includes('構造工学者'));
});

test('構造工学：専攻にしている間、今いる階層に拠点を建てられる。拠点より深い階層でやられると拠点の階層から再開する', () => {
  const ctx = makeCtx();
  const s = newGame(0);
  unlock(s, ctx, 'structural_engineering');
  s.adventure.floor = 20;
  assert.match(buildBase(s, ctx).reason, /専攻にすると建てられる/);
  setMajor(s, 1, 'structural_engineering', ctx);
  assert.deepEqual(buildBase(s, ctx), { ok: true, floor: 20 });
  assert.match(buildBase(s, ctx).reason, /もう20階層に拠点がある/);
  s.adventure.floor = 25;
  assert.equal(respawnFloor(s, ctx), 20);
  s.adventure.floor = 20;
  assert.equal(respawnFloor(s, ctx), 1, '拠点の階層そのものでやられたら1階層');
  // 実際にやられる
  s.adventure.floor = 25;
  s.hero.level = 30;
  const e = spawnEnemy(s, ctx, []);
  e.cd = 0.05;
  s.adventure.heroCd = 99;
  s.hero.hp = 1;
  const dead = tick(s, 0.1, ctx).find((x) => x.type === 'heroDefeated');
  assert.ok(dead);
  assert.equal(s.adventure.floor, 20);
  assert.equal(dead.sleep.floor, 20);
  // 専攻から外すと拠点は働かない
  setMajor(s, 1, null, ctx);
  s.adventure.floor = 25;
  assert.equal(baseActive(s, ctx), false);
  assert.equal(respawnFloor(s, ctx), 1);
});

test(`ロケット計画：工程の学際分野を専攻にしている間、ゲーム内の時間で進み、${balance.rocket.stepYears}年で完了する。2枠なので同時に2つまで。進み具合は生まれ変わっても残る`, () => {
  const ctx = makeCtx();
  const s = newGame(0);
  s.adventure.spawnTimer = 1e9; // 戦いを起こさない
  unlock(s, ctx, 'aerospace', 'combustion', 'astrodynamics');
  const secPerYear = HOURS_PER_YEAR / balance.time.gameHoursPerRealSecond;
  tick(s, secPerYear, ctx);
  assert.ok(rocketSteps(s, ctx).every((st) => st.hours === 0), '専攻にしていなければ進まない');
  setMajor(s, 0, 'aerospace', ctx);
  setMajor(s, 1, 'combustion', ctx);
  const done = [];
  for (let t = 0; t < secPerYear * (balance.rocket.stepYears + 1); t += 1) done.push(...tick(s, 1, ctx).filter((e) => e.type === 'rocketStepDone').map((e) => e.name));
  assert.deepEqual(done, ['機体設計', 'エンジン・推進剤']);
  const steps = Object.fromEntries(rocketSteps(s, ctx).map((st) => [st.id, st]));
  assert.ok(steps.airframe.done && steps.engine.done);
  assert.equal(steps.orbit.hours, 0, '専攻にしていない工程は進まない');
  assert.equal(steps.airframe.fieldDef.name, '航空宇宙工学');
  reincarnate(s, ctx);
  assert.ok(rocketSteps(s, ctx).find((st) => st.id === 'airframe').done, '生まれ変わっても残る');
});

test(`行動経済学：店で${balance.fields.shopDiscount * 100}%引き。経済系の俗説の魔物は問題に口を挟めない（ほかの魔物はそのまま）`, () => {
  const ctx = makeCtx();
  const s = newGame(0);
  s.knowledge.totalCorrect = 100;
  s.gold = 10000;
  unlock(s, ctx, 'behavioral_economics');
  const sword = items.find((i) => i.id === 'iron_sword');
  const q = questionFor('ゼロサムショウニン');
  spawnGroup(s, ctx, [], ['zerosamushounin']);
  assert.equal(itemPrice(s, sword, ctx), sword.price, '専攻にするまでは定価');
  assert.ok(interferingEnemy(s, q, ctx), '専攻にするまでは口を挟む');
  setMajor(s, 0, 'behavioral_economics', ctx);
  const price = Math.round(sword.price * (1 - balance.fields.shopDiscount));
  assert.equal(itemPrice(s, sword, ctx), price);
  buyItem(s, sword.id, ctx);
  assert.equal(s.gold, 10000 - price);
  assert.equal(interferingEnemy(s, q, ctx), null);
  assert.equal(blockedInterference(s, q, ctx).monster.name, 'ゼロサムショウニン');
  const sess = createSession(s, 'quiz', ctx);
  const cur = presentQuestion(sess, q, ctx);
  const e = s.adventure.enemies[0];
  e.hp = 1;
  const r = answer(s, sess, cur.choices.findIndex((c) => c.kind === 'myth'), ctx);
  assert.equal(r.fooled, false, '騙されない（回復もしない）');
  assert.equal(e.hp, 1);
  assert.deepEqual(r.blocked, { name: 'ゼロサムショウニン', field: '行動経済学' });
  // 経済系でない魔物はそのまま口を挟む
  spawnGroup(s, ctx, [], ['sanbyoukingyo']);
  assert.ok(interferingEnemy(s, questionFor('サンビョウキンギョ'), ctx));
});

test('計量経済学：業種ごとの期待値は、実際に起業して同じ社員を雇ったときの利益・契約料と一致する（得になる社員だけ雇う前提）', () => {
  const ctx = makeCtx();
  for (const id of ['restaurant', 'pharma', 'trading']) {
    const s = newGame(0);
    s.gold = 1e12;
    Object.assign(genreState(s, '経営学'), { level: 5 });
    genreState(s, '心理学').level = 3;
    const ind = business.industries.find((x) => x.id === id);
    const o = industryOutlook(s, ind, ctx);
    assert.equal(o.net, o.profit - o.cost);
    assert.equal(o.paybackMonths, o.net > 0 ? ind.cost / o.net : null);
    foundCompany(s, id, ctx);
    for (const name of o.staff) hireStaff(s, 1, ctx.recruits.find((r) => r.name === name).id, ctx);
    assert.equal(companiesProfit(s, ctx).total, o.profit, ind.name);
    assert.equal(monthlyContractCost(s, ctx), o.cost, ind.name);
  }
});

test('科学史：ボスと戦っている間は、俗説の枠ではない誤答が1つ消えて3択になる', () => {
  const ctx = makeCtx();
  const s = newGame(0);
  unlock(s, ctx, 'history_of_science');
  const ask = () => nextQuestion(s, createSession(s, 'quiz', ctx), ctx);
  spawnGroup(s, ctx, [], ['tendousetsu']);
  assert.equal(ask().choices.length, 4, '専攻にするまでは4択');
  setMajor(s, 0, 'history_of_science', ctx);
  const cur = ask();
  assert.equal(cur.choices.length, 3);
  assert.equal(cur.trimmedBy, '科学史');
  assert.ok(cur.choices.some((c) => c.kind === 'answer') && cur.choices.some((c) => c.kind === 'myth'));
  spawnGroup(s, ctx, [], ['tsugihakuro']);
  assert.equal(ask().choices.length, 4, 'ザコのときは4択');
});

test('心理統計学：騙された回数の多い俗説と、ジャンルごとの合計、間違えたままの問題のジャンルを出す', () => {
  const ctx = makeCtx();
  const s = newGame(0);
  s.knowledge.zukan.tsugihakuro = { stage: 1, fooled: 3 };
  s.knowledge.zukan.zerosamushounin = { stage: 1, fooled: 1 };
  s.knowledge.review = [questionFor('ツギハクロ').id, questionFor('ゼロサムショウニン').id, questions.find((q) => q.genre === '統計学' && q.monster !== 'ツギハクロ').id];
  const a = fooledAnalysis(s, ctx);
  assert.equal(a.total, 4);
  assert.deepEqual(a.myths.map((x) => [x.monster.name, x.fooled]), [['ツギハクロ', 3], ['ゼロサムショウニン', 1]]);
  assert.deepEqual(a.genres, [{ genre: '統計学', count: 3 }, { genre: '数学', count: 3 }, { genre: '経済学', count: 1 }]);
  assert.deepEqual(a.review, [{ genre: '統計学', count: 2 }, { genre: '経済学', count: 1 }]);
});

test('前のセーブ（学際分野が無い）も読める：解放なし・専攻は空・拠点なし・ロケットの工程は0', () => {
  const ctx = makeCtx();
  const s = newGame(0);
  delete s.knowledge.fields;
  delete s.knowledge.majors;
  delete s.adventure.baseFloor;
  delete s.legacy.rocket.steps;
  const loaded = deserialize(serialize(s), balance);
  assert.deepEqual(loaded.knowledge.fields, {});
  assert.deepEqual(loaded.knowledge.majors, [null, null]);
  assert.equal(loaded.adventure.baseFloor, null);
  assert.ok(rocketSteps(loaded, ctx).every((st) => st.hours === 0));
  assert.deepEqual(tick(loaded, 0.01, ctx).filter((e) => e.type.startsWith('field')), []);
});
