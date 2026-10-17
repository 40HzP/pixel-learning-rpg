import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tick, spawnGroup, chooseNextMonster, pendingBoss, bossState, monsterStats, damageEnemy, heroStats, zukanEntry, reincarnate, startGame, forgetPastLifeBosses } from '../js/sim.js';
import { serialize, deserialize } from '../js/save.js';
import { GENRES } from '../js/genres.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { balance, monsters, makeCtx, newGame, seededRng, constRng } from './helpers.js';

const boss = monsters.find((m) => m.kind === 'boss' && m.floor === 10);

/** 今いる敵を全部倒す（勉強の正解と同じ扱いで大きなダメージを入れる） */
function clearEnemies(s, ctx, events) {
  while (s.adventure.enemies.length) damageEnemy(s, 1e9, ctx, events);
}

test('10階層のボスが monsters.json にあり、スプライトと図鑑の項目がそろっている', () => {
  assert.ok(boss, 'floor: 10 のボス');
  for (const k of ['name', 'myth', 'truth', 'whyBelieved', 'overturnedBy']) assert.ok(boss[k], k);
  assert.ok(boss.sprites.idle);
});

test('ボスは設計ページの21個（かつての学説）。10階層ごとに1体ずつ（10〜210階層）。図鑑の項目と、待機・攻撃2枚ずつのスプライトがある', () => {
  const bosses = monsters.filter((m) => m.kind === 'boss');
  assert.equal(bosses.length, 21);
  assert.deepEqual(bosses.map((m) => m.floor).sort((a, b) => a - b), Array.from({ length: 21 }, (_, i) => (i + 1) * 10));
  assert.equal(new Set(bosses.map((m) => m.name)).size, 21, '名前が重ならない');
  const sprite = (name) => JSON.parse(readFileSync(fileURLToPath(new URL(`../../pixel/sprites/${name}.json`, import.meta.url)), 'utf8'));
  for (const b of bosses) {
    for (const k of ['name', 'myth', 'truth', 'whyBelieved', 'overturnedBy']) assert.ok(b[k], `${b.name} の ${k}`);
    assert.ok(b.genres.length && b.genres.every((g) => GENRES.includes(g)), `${b.name} のジャンル`);
    assert.equal(sprite(b.sprites.idle).frames.length, 2, `${b.name} の待機`);
    assert.equal(sprite(b.sprites.attack).frames.length, 2, `${b.name} の攻撃`);
  }
});

test('ボスはそれぞれ自分の階層だけに出て、倒すと次の階層へ進む（20〜210階層）', () => {
  const ctx = makeCtx(constRng(0.3));
  for (const b of monsters.filter((m) => m.kind === 'boss' && m.floor > 10)) {
    const s = newGame(0);
    s.adventure.floor = b.floor - 1;
    assert.notEqual((pendingBoss(s, ctx) || {}).id, b.id);
    s.adventure.floor = b.floor;
    const ev = [];
    const group = spawnGroup(s, ctx, ev);
    assert.deepEqual(group.map((e) => e.monsterId), [b.id], `${b.floor}階層は${b.name}だけ`);
    clearEnemies(s, ctx, ev);
    assert.ok(ev.some((x) => x.type === 'bossDefeated' && x.monsterId === b.id));
    assert.equal(s.adventure.floor, b.floor + 1);
  }
});

test('10階層ではボスだけが1体で出る。強さはその階層のザコに倍率をかけたもの', () => {
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

test('ボスを倒すと次の階層に進み、図鑑に正体が載る。一度倒したボスは、その人生ではもう出ない', () => {
  const s = newGame(0);
  const ctx = makeCtx(seededRng(3));
  s.adventure.floor = 10;
  const ev = [];
  spawnGroup(s, ctx, ev);
  const gold = s.gold;
  clearEnemies(s, ctx, ev);
  assert.ok(ev.some((x) => x.type === 'bossDefeated' && x.monsterId === boss.id && x.learned), '図鑑に初めて正体が載った');
  assert.ok(ev.some((x) => x.type === 'floorUp' && x.floor === 11));
  assert.equal(s.adventure.floor, 11);
  assert.equal(s.adventure.kills, 0);
  assert.ok(s.gold > gold);
  assert.equal(zukanEntry(s, boss.id).stage, 2);
  assert.equal(bossState(s, boss.id).status, 'defeated');
  assert.ok(!s.allies.some((a) => a.id === boss.id), 'ボスは仲間にならない');

  // やられて1階層に戻り、また10階層まで来てもボスはもう出ない（ザコが5体）
  s.adventure.floor = 10;
  assert.equal(pendingBoss(s, ctx), null);
  const again = spawnGroup(s, ctx, []);
  assert.equal(again.length, balance.floor.monstersPerFloor);
  assert.ok(again.every((x) => x.kind === 'monster'));
});

test('生まれ変わると、前世で倒したボスにまた会える（40HzP の依頼）。図鑑の正体は残る', () => {
  const s = newGame(0);
  const ctx = makeCtx(seededRng(3));
  s.adventure.floor = 10;
  const ev = [];
  spawnGroup(s, ctx, ev);
  clearEnemies(s, ctx, ev);
  assert.equal(bossState(s, boss.id).status, 'defeated');
  reincarnate(s, ctx);
  startGame(s, 0, undefined, 80);
  assert.equal(zukanEntry(s, boss.id).stage, 2, '図鑑は残る');
  s.adventure.floor = 10;
  const ev2 = [];
  const group = spawnGroup(s, ctx, ev2);
  assert.deepEqual(group.map((e) => e.monsterId), [boss.id], '10階層にまたボスが出る');
  assert.equal(ev2.find((x) => x.type === 'spawn').first, true);
  clearEnemies(s, ctx, ev2);
  const d = ev2.find((x) => x.type === 'bossDefeated');
  assert.ok(d && d.learned === false, 'もう図鑑に載っているので「図鑑に載った」は出さない');
  assert.equal(s.adventure.floor, 11);
});

test('前の版のセーブ：2世代目以降で、この人生の最高階層かそれより先にいる「倒した」ボスは、前世で倒したものなので、また出るようにする', () => {
  const ctx = makeCtx(constRng(0.5));
  const bosses = monsters.filter((m) => m.kind === 'boss');
  const setup = (generation, maxFloor) => {
    const s = newGame(0);
    s.life.generation = generation;
    s.life.maxFloor = maxFloor;
    for (const m of bosses) bossState(s, m.id).status = 'defeated';
    return s;
  };
  // 2世代目で25階層まで来た：10・20階層のボスはこの人生で倒した。30階層から先は前世で倒した
  const s = setup(2, 25);
  const back = forgetPastLifeBosses(s, ctx);
  assert.deepEqual(back, bosses.filter((m) => m.floor >= 25).map((m) => m.id));
  assert.deepEqual(Object.keys(s.bosses).sort(), bosses.filter((m) => m.floor < 25).map((m) => m.id).sort());
  // 最高階層がちょうどボスの階層（まだ倒していない）なら、また出る
  const t = setup(2, 30);
  forgetPastLifeBosses(t, ctx);
  assert.equal(bossState(t, bosses.find((m) => m.floor === 30).id).status, 'waiting');
  assert.equal(bossState(t, bosses.find((m) => m.floor === 20).id).status, 'defeated');
  // 1世代目は何もしない（倒したボスはこの人生で倒したもの）
  const u = setup(1, 1);
  assert.deepEqual(forgetPastLifeBosses(u, ctx), []);
  assert.equal(Object.keys(u.bosses).length, bosses.length);
});

test('ボスに負けると1階層に戻り、10階層に戻ってくるとまたボスが出る', () => {
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

test('中ボスに挑戦できる年齢でも、10階層ではボスが出る（中ボスは挑戦したときだけ）', () => {
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

test('ボスの項目が無い古いセーブ（版2）も読み込める', () => {
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
