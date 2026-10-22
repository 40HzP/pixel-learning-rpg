import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  tick, spawnGroup, damageEnemy, heroStats, heroAttackInterval, evadeChance, critChance, goldWithLuck,
  sanitizeName, renameHero, startGame, createState, genreState,
} from '../js/sim.js';
import { createSession, presentQuestion, answer } from '../js/quiz.js';
import { balance, makeCtx, newGame, constRng, seededRng, questionFor } from './helpers.js';

test('ひとつの階層のザコは、まとめて出てくる', () => {
  const s = newGame(0);
  const ctx = makeCtx(seededRng(4));
  const events = tick(s, 0.2, ctx);
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

test('主人公の攻撃は秒間2回で決まっている（すばやさでは変わらない）', () => {
  assert.equal(heroAttackInterval(balance), 0.5);
  const s = newGame(0);
  const ctx = makeCtx(constRng(0.5));
  s.hero.level = 80;
  const e = spawnGroup(s, ctx, [], ['sanbyoukingyo'])[0];
  e.maxHp = e.hp = 1e9; e.cd = 1e9; // 倒れず、攻撃もしてこない的
  s.adventure.heroCd = 0;
  const hits = tick(s, 10, ctx).filter((x) => x.type === 'attack' && x.by === 'hero').length;
  assert.equal(hits, 20, '10秒で20回');
});

test('攻撃のテンポは一定：群れを倒して次の群れが出るときも、主人公の攻撃は0.5秒ごとに途切れない。次の群れは攻撃の0.35秒前に出る', () => {
  const s = newGame(0);
  const ctx = makeCtx(seededRng(3));
  s.hero.level = 120; // 1階層のザコを一撃で倒せる強さ（群れがどんどん入れ替わる）
  const hits = [], spawns = [];
  let floors = 0;
  const dt = 0.05;
  for (let i = 1; i <= 400; i++) {
    const t = i * dt;
    for (const e of tick(s, dt, ctx)) {
      if (e.type === 'spell' || (e.type === 'attack' && e.by === 'hero')) { if (hits[hits.length - 1] !== t) hits.push(t); }
      if (e.type === 'spawn' && e.slot === 0) spawns.push(t);
      if (e.type === 'floorUp') floors++;
    }
  }
  assert.ok(floors >= 5, `群れが何度も入れ替わる（${floors}階層進んだ）`);
  for (let i = 1; i < hits.length; i++) assert.ok(Math.abs(hits[i] - hits[i - 1] - balance.hero.attackIntervalSec) < 1e-6, `${hits[i - 1].toFixed(2)}秒 → ${hits[i].toFixed(2)}秒`);
  for (const t of spawns.slice(1)) {
    const next = hits.find((h) => h > t);
    assert.ok(Math.abs(next - t - balance.floor.spawnLeadSec) < 1e-6, `${t.toFixed(2)}秒に出て ${next.toFixed(2)}秒に攻撃`);
  }
});

test(`すばやさ：回避率（すばやさ×${balance.stats.evadePerAgi}、上限${balance.stats.evadeMax * 100}%）が上がり、敵の攻撃をその割合でかわす（運でぶれない）`, () => {
  const ctx = makeCtx(constRng(0.5));
  const at = (lv) => { const s = newGame(0); s.hero.level = lv; return heroStats(s, ctx); };
  assert.ok(evadeChance(at(30), balance) > evadeChance(at(1), balance));
  assert.equal(evadeChance(at(1), balance), at(1).agi * balance.stats.evadePerAgi);
  assert.equal(evadeChance(at(1000), balance), balance.stats.evadeMax, '上限で止まる');
  // 100回攻撃されると、回避率の分だけちょうどかわす
  const s = newGame(0);
  s.hero.level = 40;
  const p = evadeChance(heroStats(s, ctx), balance);
  const e = spawnGroup(s, ctx, [], ['sanbyoukingyo'])[0];
  e.maxHp = e.hp = 1e9; e.atk = 1;
  s.adventure.heroCd = 1e9; // 主人公は攻撃しない
  const ev = [];
  for (let i = 0; i < 100; i++) { e.cd = 0.05; s.hero.hp = 1e9; ev.push(...tick(s, 0.1, ctx).filter((x) => x.type === 'attack' && x.target === 'hero')); }
  assert.equal(ev.length, 100);
  assert.equal(ev.filter((x) => x.evaded).length, Math.floor(100 * p + 1e-9), `回避率 ${(p * 100).toFixed(1)}%`);
  assert.ok(ev.filter((x) => x.evaded).every((x) => x.dmg === 0));
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

test('干渉：関連する魔物が群れの先頭でなくても口を挟む。正解しても敵にダメージは入らない（40HzP の依頼）', () => {
  const s = newGame(0);
  const ctx = makeCtx();
  spawnGroup(s, ctx, [], ['nidoochizu', 'tsugihakuro', 'ichiwari']);
  const front = s.adventure.enemies[0];
  const sess = createSession(s, 'quiz', ctx);
  const cur = presentQuestion(sess, questionFor('ツギハクロ'), ctx);
  const r = answer(s, sess, cur.choices.findIndex((c) => c.kind === 'answer'), ctx);
  assert.equal(r.interfered, true);
  assert.equal(r.targetName, 'ツギハクロ');
  assert.deepEqual(s.adventure.enemies.map((e) => e.monsterId), ['nidoochizu', 'tsugihakuro', 'ichiwari']);
  assert.ok(s.adventure.enemies.every((e) => e.hp === e.maxHp), 'どの敵も無傷');
  assert.ok(!r.events.some((e) => e.type === 'attack' || e.type === 'defeat'));
  genreState(s, '統計学');
});
