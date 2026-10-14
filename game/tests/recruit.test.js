import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  tick, spawnEnemy, spawnGroup, heroStats, hireRecruit, dismissRecruit, recruitList, monthlyContractCost,
  payContracts, HOURS_PER_MONTH, monthlyNetGold,
} from '../js/sim.js';
import { serialize, deserialize } from '../js/save.js';
import { balance, recruits, makeCtx, newGame, constRng, seededRng } from './helpers.js';

const cost = (id) => recruits.find((r) => r.id === id).monthlyCost;

test('仲間が集まる場所は最初から使える：戦士・格闘家・魔法使い・僧侶と契約できる', () => {
  const s = newGame(0);
  const ctx = makeCtx();
  const list = recruitList(s, ctx);
  assert.deepEqual(list.map((r) => r.name), ['戦士', '格闘家', '魔法使い', '僧侶']);
  assert.ok(list.every((r) => !r.hired && r.monthlyCost > 0));
  for (const r of recruits) assert.ok(r.sprites.idle, `${r.id} のスプライト`);
});

test('契約すると最初の1か月分を払う。同じ仲間とは二重に契約できない。ゴールドが足りなければ契約できない', () => {
  const s = newGame(0);
  const ctx = makeCtx();
  s.gold = cost('warrior') - 1;
  assert.equal(hireRecruit(s, 'warrior', ctx).ok, false);
  s.gold = 100;
  assert.equal(hireRecruit(s, 'warrior', ctx).ok, true);
  assert.equal(s.gold, 100 - cost('warrior'));
  assert.equal(s.allies.length, 1);
  assert.equal(s.allies[0].paidUntil, s.life.gameHours + HOURS_PER_MONTH);
  assert.equal(hireRecruit(s, 'warrior', ctx).ok, false);
  assert.equal(recruitList(s, ctx).find((r) => r.id === 'warrior').hired, true);
  assert.equal(monthlyContractCost(s, ctx), cost('warrior'));
});

test('ゲーム内の1か月ごとに契約料を払う。払えないと契約が切れる', () => {
  const s = newGame(0);
  const ctx = makeCtx();
  s.gold = cost('mage') * 3;
  hireRecruit(s, 'mage', ctx);
  const start = s.life.gameHours;
  // 1か月の少し手前：まだ払わない
  s.life.gameHours = start + HOURS_PER_MONTH - 1;
  payContracts(s, ctx, []);
  assert.equal(s.gold, cost('mage') * 2);
  // 1か月たった：1か月分払う
  s.life.gameHours = start + HOURS_PER_MONTH;
  const ev = [];
  payContracts(s, ctx, ev);
  assert.equal(s.gold, cost('mage'));
  assert.ok(ev.some((e) => e.type === 'contractPaid'));
  // 2か月目も払える。3か月目は払えないので契約が切れる
  s.life.gameHours = start + HOURS_PER_MONTH * 3;
  const ev2 = [];
  payContracts(s, ctx, ev2);
  assert.equal(s.gold, 0);
  assert.equal(s.allies.length, 0);
  assert.ok(ev2.some((e) => e.type === 'contractEnded' && e.name === '魔法使い'));
});

test('時間が進むと tick の中で契約料を払う', () => {
  const s = newGame(0);
  const ctx = makeCtx(constRng(0.5));
  s.gold = 1000;
  hireRecruit(s, 'fighter', ctx);
  const secPerMonth = HOURS_PER_MONTH / balance.time.gameHoursPerRealSecond;
  let paid = 0;
  s.hero.hp = 1e9;
  for (let t = 0; t < secPerMonth * 2 + 1; t += 1) paid += tick(s, 1, ctx).filter((e) => e.type === 'contractPaid').length;
  assert.equal(paid, 2);
});

test('解約すると仲間は去る（払った分は戻らない）', () => {
  const s = newGame(0);
  const ctx = makeCtx();
  s.gold = 100;
  hireRecruit(s, 'priest', ctx);
  const gold = s.gold;
  assert.equal(dismissRecruit(s, 'priest').ok, true);
  assert.equal(s.allies.length, 0);
  assert.equal(s.gold, gold);
  assert.equal(dismissRecruit(s, 'priest').ok, false);
});

test('戦士は先頭を攻撃し、主人公が強いほど強い', () => {
  const ctx = makeCtx(constRng(0.5));
  const dmgAt = (level) => {
    const s = newGame(0);
    s.hero.level = level; s.hero.hp = 1e9; s.gold = 100;
    hireRecruit(s, 'warrior', ctx);
    spawnEnemy(s, ctx, [], 'sanbyoukingyo').hp = 1e9;
    const hits = tick(s, 3, ctx).filter((e) => e.type === 'attack' && e.by === 'ally' && e.allyId === 'warrior');
    assert.ok(hits.length >= 1);
    return hits[0].dmg;
  };
  assert.ok(dmgAt(30) > dmgAt(1));
});

test('魔法使いは敵全体を攻撃する', () => {
  const s = newGame(0);
  const ctx = makeCtx(constRng(0.5));
  s.hero.hp = 1e9; s.gold = 100;
  hireRecruit(s, 'mage', ctx);
  const group = spawnGroup(s, ctx, [], ['sanbyoukingyo', 'juppanou', 'mienaikoumori']);
  for (const e of group) e.hp = e.maxHp = 1e9;
  const hits = tick(s, 3, ctx).filter((e) => e.type === 'attack' && e.allyId === 'mage');
  assert.deepEqual(new Set(hits.map((h) => h.uid)), new Set(group.map((e) => e.uid)));
});

test('僧侶は主人公のHPを回復する（満タンのときは何もしない）', () => {
  const s = newGame(0);
  const ctx = makeCtx(constRng(0.5));
  s.gold = 100;
  hireRecruit(s, 'priest', ctx);
  spawnEnemy(s, ctx, [], 'sanbyoukingyo').hp = 1e9;
  const max = heroStats(s, ctx).maxHp;
  s.hero.hp = Math.floor(max / 2);
  const ev = tick(s, 3.5, ctx);
  assert.ok(!ev.some((e) => e.type === 'heroDefeated'));
  const heals = ev.filter((e) => e.type === 'heal' && e.target === 'hero');
  assert.ok(heals.length >= 1 && heals[0].amount > 0);
  assert.ok(s.hero.hp <= max);
  // 満タンなら回復しない
  s.hero.hp = max;
  s.adventure.enemies[0].atk = 0;
  s.adventure.enemies[0].cd = 1e9;
  assert.ok(!tick(s, 6, ctx).some((e) => e.type === 'heal' && e.target === 'hero'));
});

test('契約した仲間はセーブして読み込んでも残る', () => {
  const s = newGame(0);
  const ctx = makeCtx(seededRng(2));
  s.gold = 100;
  hireRecruit(s, 'warrior', ctx);
  hireRecruit(s, 'priest', ctx);
  const loaded = deserialize(serialize(s, 1), balance);
  assert.deepEqual(loaded.allies, s.allies);
  assert.equal(monthlyContractCost(loaded, ctx), cost('warrior') + cost('priest'));
});

test('1か月あたりの手取り＝入るゴールド−契約料の合計（足りなければマイナス）', () => {
  const s = newGame(0);
  const ctx = makeCtx();
  assert.equal(monthlyNetGold(50, s, ctx), 50);
  s.gold = 1000;
  hireRecruit(s, 'warrior', ctx);
  hireRecruit(s, 'mage', ctx);
  assert.equal(monthlyNetGold(50, s, ctx), 50 - cost('warrior') - cost('mage'));
  assert.ok(monthlyNetGold(10, s, ctx) < 0);
});
