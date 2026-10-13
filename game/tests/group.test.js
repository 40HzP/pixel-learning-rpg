import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  tick, spawnGroup, damageEnemy, heroStats, heroAttackInterval, critChance, goldWithLuck,
  sanitizeName, renameHero, startGame, createState, genreState,
} from '../js/sim.js';
import { createSession, presentQuestion, answer } from '../js/quiz.js';
import { balance, makeCtx, newGame, constRng, seededRng, questionFor } from './helpers.js';

test('ひとつの階層のザコは、まとめて出てくる', () => {
  const s = newGame(0);
  const ctx = makeCtx(seededRng(4));
  const events = tick(s, balance.floor.spawnDelaySec + 0.2, ctx);
  const spawns = events.filter((e) => e.type === 'spawn');
  assert.equal(spawns.length, balance.floor.monstersPerFloor);
  assert.equal(s.adventure.enemies.length, balance.floor.monstersPerFloor);
  assert.deepEqual(s.adventure.enemies.map((e) => e.slot), [0, 1, 2, 3, 4]);
  assert.equal(new Set(s.adventure.enemies.map((e) => e.uid)).size, 5, '1体ずつ見分けられる');
});

test('群れを全部倒すまで次の階層に進まない', () => {
  const s = newGame(0);
  const ctx = makeCtx(seededRng(9));
  spawnGroup(s, ctx, []);
  for (let i = 1; i <= 4; i++) {
    damageEnemy(s, 9999, ctx, [], 'quiz');
    assert.equal(s.adventure.floor, 1, `${i}体倒した時点ではまだ1階層`);
    assert.equal(s.adventure.kills, i);
    assert.equal(s.adventure.enemies.length, 5 - i);
  }
  const ev = [];
  damageEnemy(s, 9999, ctx, ev, 'quiz');
  assert.equal(s.adventure.floor, 2);
  assert.ok(ev.some((e) => e.type === 'floorUp'));
  assert.equal(s.adventure.kills, 0);
});

test('ひらめき：敵が2体以上いてMPが足りれば、全員にダメージを与えてMPを使う', () => {
  const s = newGame(0);
  const ctx = makeCtx(constRng(0.5));
  spawnGroup(s, ctx, [], ['tsugihakuro', 'nidoochizu', 'ichiwari']);
  s.hero.mp = 10;
  s.adventure.heroCd = 0.01;
  s.adventure.enemies.forEach((e) => { e.cd = 99; });
  const ev = tick(s, 0.05, ctx);
  assert.ok(ev.some((e) => e.type === 'spell' && e.count === 3));
  assert.equal(ev.filter((e) => e.type === 'attack' && e.by === 'spell').length, 3);
  assert.ok(Math.abs(s.hero.mp - (10 - balance.spell.mpCost)) < 0.1);
});

test('ひらめき：敵が1体ならMPがあっても普通に攻撃する', () => {
  const s = newGame(0);
  const ctx = makeCtx(constRng(0.5));
  spawnGroup(s, ctx, [], ['tsugihakuro']);
  s.hero.mp = 10;
  s.adventure.heroCd = 0.01;
  s.adventure.enemies[0].cd = 99;
  const ev = tick(s, 0.05, ctx);
  assert.ok(!ev.some((e) => e.type === 'spell'));
  assert.ok(ev.some((e) => e.type === 'attack' && e.by === 'hero'));
});

test('すばやさが高いほど攻撃の間隔が短い', () => {
  const ctx = makeCtx();
  const slow = heroStats(newGame(0), ctx);
  const fastState = newGame(0);
  fastState.hero.level = 30;
  const fast = heroStats(fastState, ctx);
  assert.ok(fast.agi > slow.agi);
  assert.ok(heroAttackInterval(fast, balance) < heroAttackInterval(slow, balance));
});

test('運の良さ：会心の一撃が出て、もらえるゴールドが増える', () => {
  const s = newGame(0);
  const st = heroStats(s, makeCtx());
  assert.ok(critChance(st, balance) > 0);
  assert.ok(goldWithLuck(100, st, balance) > 100);
  // 乱数0なら必ず会心
  const ctx = makeCtx(constRng(0));
  spawnGroup(s, ctx, [], ['tsugihakuro']);
  s.adventure.heroCd = 0.01;
  s.adventure.enemies[0].cd = 99;
  s.adventure.enemies[0].hp = 999;
  const hit = tick(s, 0.05, ctx).find((e) => e.type === 'attack' && e.by === 'hero');
  assert.equal(hit.crit, true);
});

test('賢さは勉強の正解数でも伸びる', () => {
  const s = newGame(0);
  const ctx = makeCtx();
  const before = heroStats(s, ctx).wis;
  s.knowledge.totalCorrect = 10;
  assert.equal(heroStats(s, ctx).wis, before + Math.floor(10 * balance.hero.wisPerCorrect));
});

test('レベルが上がるとMPも伸びる。眠るとMPも全回復', async () => {
  const s = newGame(0);
  const ctx = makeCtx();
  const l1 = heroStats(s, ctx).maxMp;
  s.hero.level = 5;
  assert.ok(heroStats(s, ctx).maxMp > l1);
  s.hero.mp = 0;
  const { sleep } = await import('../js/sim.js');
  sleep(s, ctx, 'bed');
  assert.equal(s.hero.mp, heroStats(s, ctx).maxMp);
});

test('名前：前後の空白を取り、8文字まで。空なら「主人公」', () => {
  assert.equal(sanitizeName('  ゆうき  '), 'ゆうき');
  assert.equal(sanitizeName('あいうえおかきくけこ'), 'あいうえおかきく');
  assert.equal(sanitizeName(''), '主人公');
  assert.equal(sanitizeName('   '), '主人公');
  assert.equal(sanitizeName('a\nb\tc'), 'abc');
  assert.equal(sanitizeName('😀😀😀😀😀😀😀😀😀'), '😀😀😀😀😀😀😀😀', '絵文字も1文字として数える');
  const s = createState(balance);
  startGame(s, 7, ' タロウ ');
  assert.equal(s.hero.name, 'タロウ');
  renameHero(s, 'ハナコ');
  assert.equal(s.hero.name, 'ハナコ');
});

test('干渉：関連する魔物が群れの先頭でなくても口を挟み、その魔物だけが倒れる', () => {
  const s = newGame(0);
  const ctx = makeCtx();
  spawnGroup(s, ctx, [], ['nidoochizu', 'tsugihakuro', 'ichiwari']);
  const front = s.adventure.enemies[0];
  const sess = createSession(s, 'quiz', ctx);
  const cur = presentQuestion(sess, questionFor('ツギハクロ'), ctx);
  const r = answer(s, sess, cur.choices.findIndex((c) => c.kind === 'answer'), ctx);
  assert.equal(r.interfered, true);
  assert.equal(r.targetName, 'ツギハクロ');
  assert.equal(r.defeated, true);
  assert.deepEqual(s.adventure.enemies.map((e) => e.monsterId), ['nidoochizu', 'ichiwari']);
  assert.equal(front.hp, front.maxHp, '先頭は無傷');
  genreState(s, '統計学');
});
