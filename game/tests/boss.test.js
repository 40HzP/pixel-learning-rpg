import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tick, spawnGroup, chooseNextMonster, pendingBoss, bossState, monsterStats, damageEnemy, heroStats, zukanEntry } from '../js/sim.js';
import { serialize, deserialize } from '../js/save.js';
import { balance, monsters, makeCtx, newGame, seededRng, constRng } from './helpers.js';

const boss = monsters.find((m) => m.kind === 'boss' && m.floor === 10);

/** 今いる敵を全部倒す（勉強の正解と同じ扱いで大きなダメージを入れる） */
function clearEnemies(s, ctx, events) {
  while (s.adventure.enemies.length) damageEnemy(s, 1e9, ctx, events);
}

test('10階層の小ボスが monsters.json にあり、スプライトと図鑑の項目がそろっている', () => {
  assert.ok(boss, 'floor: 10 の小ボス');
  for (const k of ['name', 'myth', 'truth', 'whyBelieved', 'overturnedBy']) assert.ok(boss[k], k);
  assert.ok(boss.sprites.idle);
});

test('10階層では小ボスだけが1体で出る。強さはその階層のザコに倍率をかけたもの', () => {
  const s = newGame(0);
  const ctx = makeCtx(constRng(0.3));
  s.adventure.floor = 9;
  assert.equal(pendingBoss(s, ctx), null);
  s.adventure.floor = 10;
  assert.equal(chooseNextMonster(s, ctx).id, boss.id);
  const ev = [];
  const group = spawnGroup(s, ctx, ev);
  assert.equal(group.length, 1);
  const e = group[0];
  assert.equal(e.kind, 'boss');
  const z = monsterStats(10, balance);
  assert.equal(e.maxHp, Math.round(z.maxHp * balance.boss.hpMultiplier));
  assert.equal(e.atk, Math.round(z.atk * balance.boss.atkMultiplier));
  assert.equal(e.exp, Math.round(z.exp * balance.boss.expMultiplier));
  const sp = ev.find((x) => x.type === 'spawn');
  assert.equal(sp.first, true);
  assert.equal(sp.floor, 10);
  assert.equal(bossState(s, boss.id).status, 'appeared');
});

test('小ボスを倒すと次の階層に進み、図鑑に正体が載る。一度倒した小ボスは復活しない', () => {
  const s = newGame(0);
  const ctx = makeCtx(seededRng(3));
  s.adventure.floor = 10;
  const ev = [];
  spawnGroup(s, ctx, ev);
  const gold = s.gold;
  clearEnemies(s, ctx, ev);
  assert.ok(ev.some((x) => x.type === 'bossDefeated' && x.monsterId === boss.id));
  assert.ok(ev.some((x) => x.type === 'floorUp' && x.floor === 11));
  assert.equal(s.adventure.floor, 11);
  assert.equal(s.adventure.kills, 0);
  assert.ok(s.gold > gold);
  assert.equal(zukanEntry(s, boss.id).stage, 2);
  assert.equal(bossState(s, boss.id).status, 'defeated');
  assert.ok(!s.allies.some((a) => a.id === boss.id), '小ボスは仲間にならない');

  // やられて1階層に戻り、また10階層まで来ても小ボスはもう出ない（ザコが5体）
  s.adventure.floor = 10;
  assert.equal(pendingBoss(s, ctx), null);
  const again = spawnGroup(s, ctx, []);
  assert.equal(again.length, balance.floor.monstersPerFloor);
  assert.ok(again.every((x) => x.kind === 'monster'));
});

test('小ボスに負けると1階層に戻り、10階層に戻ってくるとまた小ボスが出る', () => {
  const s = newGame(0);
  const ctx = makeCtx(constRng(0.5));
  s.adventure.floor = 10;
  s.hero.hp = 1;
  const ev = [];
  for (let i = 0; i < 60 && !ev.some((x) => x.type === 'heroDefeated'); i++) ev.push(...tick(s, 1, ctx));
  assert.ok(ev.some((x) => x.type === 'spawn' && x.kind === 'boss'));
  assert.ok(ev.some((x) => x.type === 'heroDefeated'));
  assert.equal(s.adventure.floor, 1);
  assert.equal(bossState(s, boss.id).status, 'appeared');
  s.adventure.floor = 10;
  s.adventure.enemies = [];
  const ev2 = [];
  spawnGroup(s, ctx, ev2);
  const sp = ev2.find((x) => x.type === 'spawn');
  assert.equal(sp.kind, 'boss');
  assert.equal(sp.first, false, '2回目からは first にならない');
});

test('中ボスに挑戦できる年齢でも、10階層では小ボスが出る（中ボスは挑戦したときだけ）', () => {
  const s = newGame(7);
  const ctx = makeCtx(constRng(0.5));
  s.adventure.floor = 10;
  assert.equal(chooseNextMonster(s, ctx).kind, 'boss');
});

test('9階層を越えても、敵は階層ごとに強くなり続ける', () => {
  const a = monsterStats(9, balance), b = monsterStats(11, balance), c = monsterStats(20, balance);
  assert.ok(a.maxHp < b.maxHp && b.maxHp < c.maxHp);
  assert.ok(a.exp < b.exp && b.exp < c.exp);
});

test('小ボスの項目が無い古いセーブ（版2）も読み込める', () => {
  const s = newGame(0);
  const ctx = makeCtx(seededRng(9));
  for (let i = 0; i < 30; i++) tick(s, 1, ctx);
  const old = JSON.parse(serialize(s, 1));
  delete old.state.bosses;
  old.version = 2;
  const loaded = deserialize(JSON.stringify(old), balance);
  assert.deepEqual(loaded.bosses, {});
  loaded.adventure.floor = 10;
  loaded.adventure.enemies = [];
  assert.equal(chooseNextMonster(loaded, ctx).id, boss.id);
  assert.ok(heroStats(loaded, ctx).maxHp > 0);
});
