import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tick, spawnEnemy, heroStats, genreState, buyItem, shopList, monsterStats, setHeroLevel, expMultiplier, expToNext } from '../js/sim.js';
import { balance, makeCtx, newGame, seededRng, constRng } from './helpers.js';

test('冒険が自動で進み、5体倒すと次の階層。9階層で止まらず先へ進む', () => {
  const s = newGame(0);
  const ctx = makeCtx(seededRng(42));
  s.hero.level = 60; // 負けないくらい強くする
  s.hero.hp = heroStats(s, ctx).maxHp;
  const events = [];
  for (let i = 0; i < 2000 && s.adventure.floor < 9; i++) events.push(...tick(s, 1, ctx));
  assert.equal(s.adventure.floor, 9);
  assert.equal(events.filter((e) => e.type === 'floorUp').length, 8);
  for (let i = 0; i < 2000 && s.adventure.floor < 12; i++) events.push(...tick(s, 1, ctx));
  assert.equal(s.adventure.floor, 12, '10階層（小ボス）を越えて進める');
  assert.ok(!events.some((e) => e.type === 'heroDefeated'));
  assert.ok(s.gold > 0 && s.hero.totalExp > 0);
});

test('倒すと経験値とゴールドが入り、レベルが上がるとステータスが伸びる', () => {
  const s = newGame(0);
  const ctx = makeCtx(constRng(0.5));
  const before = heroStats(s, ctx);
  const events = [];
  for (let i = 0; i < 300 && s.hero.level < 3; i++) events.push(...tick(s, 1, ctx));
  assert.ok(s.hero.level >= 3, 'レベルが上がる');
  const after = heroStats(s, ctx);
  assert.ok(after.maxHp > before.maxHp && after.atk > before.atk);
  assert.ok(events.some((e) => e.type === 'levelUp'));
  assert.ok(events.some((e) => e.type === 'defeat' && e.exp > 0 && e.gold > 0));
});

test('やられたら階層だけ1に戻る。Lv・装備・仲間はそのまま。睡眠の処理が走る', () => {
  const s = newGame(0);
  const ctx = makeCtx(constRng(0.01));
  Object.assign(s.adventure, { floor: 4, kills: 3 });
  s.hero.level = 6;
  s.equipment.weapon = 'wood_sword';
  s.allies.push({ id: 'teacher_elementary', name: '小学校教師', atk: 3, maxHp: 30, hp: 5, cd: 99 });
  Object.assign(genreState(s, '生物'), { level: 1, studied: true });
  const e = spawnEnemy(s, ctx, []);
  e.cd = 0.05;
  assert.equal(s.adventure.enemies.length, 1);
  s.adventure.heroCd = 99;
  s.allies[0].cd = 99;
  s.hero.hp = 1;
  const hoursBefore = s.life.gameHours;
  const events = tick(s, 0.1, ctx);
  const dead = events.find((x) => x.type === 'heroDefeated');
  assert.ok(dead, 'やられた');
  assert.equal(s.adventure.floor, 1);
  assert.equal(s.adventure.kills, 0);
  assert.deepEqual(s.adventure.enemies, []);
  assert.equal(s.hero.level, 6);
  assert.equal(s.equipment.weapon, 'wood_sword');
  assert.equal(s.allies.length, 1);
  assert.equal(s.hero.hp, heroStats(s, ctx).maxHp, '全回復');
  assert.equal(s.allies[0].hp, 30, '仲間も全回復');
  assert.ok(s.life.gameHours - hoursBefore >= balance.sleep.gameHours, '10時間進む');
  assert.deepEqual(dead.sleep.up, ['生物'], '熟練の判定が走る');
  assert.equal(s.lastSleep.reason, 'defeated');
});

test('階層が上がるほど魔物が強くなる', () => {
  const f1 = monsterStats(1, balance), f5 = monsterStats(5, balance);
  const b = balance.monster.base;
  assert.deepEqual(f1, { maxHp: b.hp, atk: b.atk, def: b.def, exp: b.exp, gold: b.gold });
  assert.ok(f5.maxHp > f1.maxHp && f5.atk > f1.atk && f5.gold > f1.gold);
});

test('魔物は1階層ごとに一定の量ずつ強くなる（掛け算では増えない）', () => {
  const d = (a, b) => {
    const x = monsterStats(a, balance), y = monsterStats(b, balance);
    return [y.maxHp - x.maxHp, y.atk - x.atk, y.exp - x.exp];
  };
  assert.equal(d(1, 11)[0], Math.round(10 * balance.monster.perFloor.hp));
  assert.deepEqual(d(1, 11), d(51, 61), '1〜11階層と51〜61階層で、増える量が同じ');
});

test('次のLvまでの経験値は base × Lv^power', () => {
  const { base, power } = balance.levelExp;
  for (const L of [1, 10, 50]) assert.equal(expToNext(L, balance), Math.max(1, Math.floor(base * L ** power)));
  assert.ok(expToNext(50, balance) > expToNext(10, balance));
});

test('仲間も勉強もなしで遊び続けても頭打ちにならず、1時間で20階層を越える', () => {
  const s = newGame(0);
  const ctx = makeCtx(seededRng(1));
  let max = 1, at30 = 0;
  for (let t = 1; t <= 3600; t++) {
    for (const e of tick(s, 1, ctx)) if (e.type === 'floorUp') max = Math.max(max, e.floor);
    for (const it of shopList(s, ctx)) if (it.unlocked && !it.owned && s.gold >= it.price) buyItem(s, it.id, ctx);
    if (t === 1800) at30 = max;
  }
  assert.ok(max >= 20, `1時間で ${max} 階層`);
  assert.ok(max - at30 >= 3, `30分〜1時間でも進む：${at30} → ${max} 階層`);
});

test('店：正解数で品揃えが増え、ゴールドで買うと強ければ自動で装備する', () => {
  const s = newGame(0);
  const ctx = makeCtx();
  const unlocked = () => shopList(s, ctx).filter((i) => i.unlocked).map((i) => i.id);
  assert.deepEqual(unlocked(), ['wood_sword', 'cloth']);
  s.knowledge.totalCorrect = 5;
  assert.deepEqual(unlocked(), ['wood_sword', 'cloth', 'copper_sword', 'leather']);
  assert.equal(buyItem(s, 'wood_sword', ctx).reason, 'ゴールドが足りません');
  s.gold = 1000;
  const atk0 = heroStats(s, ctx).atk;
  assert.deepEqual(buyItem(s, 'copper_sword', ctx), { ok: true, equipped: true });
  assert.equal(heroStats(s, ctx).atk, atk0 + 5);
  assert.deepEqual(buyItem(s, 'wood_sword', ctx), { ok: true, equipped: false }, '弱い剣は装備しない');
  assert.equal(s.equipment.weapon, 'copper_sword');
  assert.equal(s.gold, 1000 - 150 - 30);
  assert.equal(buyItem(s, 'iron_sword', ctx).reason, 'まだ入荷していません');
  assert.equal(buyItem(s, 'copper_sword', ctx).reason, 'もう持っています');
});

test('デバッグ用：レベルを直接決めると、経験値は0からでHP・MPは満タン', () => {
  const s = newGame(0);
  const ctx = makeCtx(constRng(0.5));
  s.hero.exp = 7;
  s.hero.hp = 1;
  assert.equal(setHeroLevel(s, 30, ctx), 30);
  const hs = heroStats(s, ctx);
  assert.equal(s.hero.level, 30);
  assert.equal(s.hero.exp, 0);
  assert.equal(s.hero.hp, hs.maxHp);
  assert.equal(s.hero.mp, hs.maxMp);
  assert.ok(hs.atk > heroStats(newGame(0), ctx).atk);
  // 下げることもできる。1より下にはならない
  assert.equal(setHeroLevel(s, 5, ctx), 5);
  assert.equal(s.hero.hp, heroStats(s, ctx).maxHp);
  assert.equal(setHeroLevel(s, 0, ctx), 1);
  assert.equal(setHeroLevel(s, 'abc', ctx), 1);
});

test('勉強で正解するたびに経験値の倍率が上がり、敵を倒したときの経験値に掛かる', () => {
  const ctx = makeCtx(constRng(0.5));
  const per = balance.hero.expBonusPerCorrect;
  assert.ok(per > 0);
  const gained = (correct) => {
    const s = newGame(0);
    s.knowledge.totalCorrect = correct;
    assert.equal(expMultiplier(s, balance), 1 + correct * per);
    const e = spawnEnemy(s, ctx, [], 'sanbyoukingyo');
    const ev = [];
    while (s.adventure.enemies.includes(e)) ev.push(...tick(s, 0.5, ctx));
    return ev.find((x) => x.type === 'defeat').exp;
  };
  const base = gained(0);
  const fifty = gained(50);
  assert.equal(fifty, Math.round(base * (1 + 50 * per)));
  assert.ok(fifty > base);
});
