// 月面の街（設計ページ「月面の街」の①）：地球の街と同じことができる施設。
// 補給所の輸送費と月面だけの品、裏側の電波望遠鏡の「宇宙からの電波」、拠点（前線基地）は moon.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  launchRocket, returnToEarth, onMoon, shopList, buyItem, equipItem, heroStats, itemPrice, itemBodyPrice,
  transportCost, isMoonItem, hearRadio, radioInfo, reincarnate, spawnEnemy, tick, genreState, HOURS_PER_YEAR,
} from '../js/sim.js';
import { createSession, presentQuestion, answer } from '../js/quiz.js';
import { setMajor, fieldById } from '../js/fields.js';
import { serialize, deserialize } from '../js/save.js';
import { balance, items, fields, questions, radio, makeCtx, newGame, constRng } from './helpers.js';

const byId = (id) => items.find((i) => i.id === id);
const MOON_ITEMS = ['spacesuit', 'gold_visor', 'rover_wheel'];

function toMoon(s) {
  s.legacy.rocket.buildCostPaid = true;
  for (const st of fields.rocketSteps) s.legacy.rocket.steps[st.id] = balance.rocket.stepYears * HOURS_PER_YEAR;
  launchRocket(s, makeCtx(constRng(0.1)));
  assert.equal(onMoon(s), true);
}

test('月面だけの品：宇宙服（防具）・金のバイザー・月面車の車輪（装飾品）。割合で効き、重さがある', () => {
  assert.deepEqual(items.filter(isMoonItem).map((i) => [i.id, i.slot, i.price]), [
    ['spacesuit', 'armor', 3e9], ['gold_visor', 'accessory', 1e9], ['rover_wheel', 'accessory', 2e9]]);
  assert.deepEqual(MOON_ITEMS.map((id) => byId(id).effects), [{ damageCut: 0.2 }, { atkRate: 0.1 }, { hpRate: 0.15 }]);
});

test('補給所：値段は本体＋輸送費（重さ×transportPerKg）。地球の店には輸送費が無い。行動経済学の値引きは本体にだけ効く', () => {
  const ctx = makeCtx();
  const s = newGame(7);
  const iron = byId('iron_sword');
  assert.equal(transportCost(s, iron, ctx), 0, '地球の店');
  assert.equal(itemPrice(s, iron, ctx), iron.price);
  toMoon(s);
  const fare = iron.weight * balance.moon.transportPerKg;
  assert.equal(transportCost(s, iron, ctx), fare);
  assert.equal(itemPrice(s, iron, ctx), iron.price + fare);
  const row = shopList(s, ctx).find((i) => i.id === iron.id);
  assert.deepEqual([row.body, row.transport, row.price, row.listPrice], [iron.price, fare, iron.price + fare, iron.price]);
  // 行動経済学を専攻にすると、本体だけ2割引き（重さは値切れない）
  for (const g of fieldById(ctx, 'behavioral_economics').genres) genreState(s, g).level = balance.fields.unlockLevel;
  tick(s, 0.01, ctx); // 解放の判定
  assert.equal(setMajor(s, 0, 'behavioral_economics', ctx).ok, true);
  const body = Math.round(iron.price * (1 - balance.fields.shopDiscount));
  assert.equal(itemBodyPrice(s, iron, ctx), body);
  assert.equal(itemPrice(s, iron, ctx), body + fare);
  // 払うのは本体＋輸送費
  s.knowledge.totalCorrect = 1000;
  s.gold = body + fare;
  assert.equal(buyItem(s, iron.id, ctx).ok, true);
  assert.equal(s.gold, 0);
});

test('月面だけの品は月面の補給所でだけ買える。買えば地球に持ち帰れ、地球の店でも「装備する」で付け替えられる', () => {
  const ctx = makeCtx();
  const s = newGame(7);
  s.gold = 1e12;
  assert.ok(!shopList(s, ctx).some((i) => isMoonItem(i)), '地球の店には並ばない');
  assert.match(buyItem(s, 'spacesuit', ctx).reason, /月面の補給所でだけ/);
  toMoon(s);
  assert.deepEqual(shopList(s, ctx).filter(isMoonItem).map((i) => [i.id, i.unlocked]), MOON_ITEMS.map((id) => [id, true]), '月面に来ればすぐ買える');
  s.knowledge.totalCorrect = 1000;
  buyItem(s, 'orichalcum_armor', ctx);
  buyItem(s, 'philosophers_stone', ctx);
  const suit = byId('spacesuit');
  const before = s.gold;
  assert.deepEqual(buyItem(s, 'spacesuit', ctx), { ok: true, equipped: true }, '割合で効く品は、地球のいちばん強い品より強いとみなして付け替える');
  assert.equal(before - s.gold, suit.price + suit.weight * balance.moon.transportPerKg);
  assert.deepEqual(buyItem(s, 'gold_visor', ctx), { ok: true, equipped: true });
  assert.deepEqual(buyItem(s, 'rover_wheel', ctx), { ok: true, equipped: false }, '月面だけの品どうしは付け替えない（同じ強さとみなす）');
  returnToEarth(s, ctx);
  const earthShop = shopList(s, ctx);
  assert.deepEqual(earthShop.filter(isMoonItem).map((i) => i.id), MOON_ITEMS, '持っている月面の品は地球の店にも並ぶ');
  assert.ok(earthShop.every((i) => i.transport === 0));
  assert.deepEqual(equipItem(s, 'rover_wheel', ctx), { ok: true });
  assert.deepEqual(s.equipment, { weapon: null, armor: 'spacesuit', accessory: 'rover_wheel' });
  // 生まれ変わると装備と一緒に無くなる
  reincarnate(s, ctx);
  assert.deepEqual(s.owned, []);
});

test('月面だけの品の効き目：宇宙服は受けるダメージ−20%、金のバイザーは攻撃+10%、月面車の車輪はHP+15%', () => {
  const ctx = makeCtx(constRng(0.5));
  const s = newGame(7);
  s.hero.level = 200;
  const h0 = heroStats(s, ctx);
  assert.equal(h0.damageCut, 0);
  s.owned.push(...MOON_ITEMS);
  s.equipment.armor = 'spacesuit';
  s.equipment.accessory = 'gold_visor';
  const h1 = heroStats(s, ctx);
  assert.equal(h1.damageCut, 0.2);
  assert.equal(h1.atk, Math.floor(h0.atk * 1.1));
  assert.equal(h1.def, h0.def, '宇宙服は防御の数値は足さない');
  s.equipment.accessory = 'rover_wheel';
  assert.equal(heroStats(s, ctx).maxHp, Math.floor(h0.maxHp * 1.15));

  // 敵の攻撃を受けたときのダメージ
  const hit = (armor) => {
    const t = newGame(7);
    t.hero.level = 200;
    t.owned.push('spacesuit');
    t.equipment.armor = armor;
    t.adventure.floor = 30;
    const e = spawnEnemy(t, ctx, []);
    t.adventure.enemies = [e];
    e.cd = 0.01;
    t.adventure.heroCd = 99;
    t.hero.hp = 1e9;
    tick(t, 0.05, ctx);
    return 1e9 - t.hero.hp;
  };
  const plain = hit(null);
  const suit = hit('spacesuit');
  assert.ok(plain > 0);
  assert.equal(suit, Math.max(1, Math.round(plain * 0.8)));
});

test('裏側の電波望遠鏡：月面で正解すると「宇宙からの電波」がたまり、radioCharge でいっぱいになると図鑑の頁が1つ開く', () => {
  const ctx = makeCtx();
  const s = newGame(7);
  assert.ok(radio.title && radio.pages.length >= 5 && radio.pages.every((p) => p.name && p.lines.length), '頁の題と文');
  const ev = [];
  hearRadio(s, ctx, ev);
  assert.deepEqual(s.knowledge.radio, { charge: 0, pages: 0 }, '地球ではたまらない');
  toMoon(s);
  for (let i = 1; i < balance.moon.radioCharge; i++) hearRadio(s, ctx, ev);
  assert.deepEqual([s.knowledge.radio, ev], [{ charge: balance.moon.radioCharge - 1, pages: 0 }, []]);
  hearRadio(s, ctx, ev);
  assert.deepEqual(ev, [{ type: 'radioPage', index: 0, name: radio.pages[0].name, opened: 1, total: radio.pages.length }]);
  assert.deepEqual(radioInfo(s, ctx), { charge: 0, need: balance.moon.radioCharge, opened: 1, total: radio.pages.length, done: false });
  // 全部開いたら、もうためない
  for (let i = 0; i < 1000; i++) hearRadio(s, ctx, []);
  assert.deepEqual(s.knowledge.radio, { charge: 0, pages: radio.pages.length });
  assert.equal(radioInfo(s, ctx).done, true);
  // 知識なので生まれ変わっても残る
  reincarnate(s, ctx);
  assert.equal(s.knowledge.radio.pages, radio.pages.length);
});

test('裏側の電波望遠鏡：勉強で正解したときにたまる（間違いではたまらない）', () => {
  const ctx = makeCtx();
  const s = newGame(7);
  toMoon(s);
  const q = questions[0];
  const ask = (right) => {
    const session = createSession(s, 'quiz', ctx);
    presentQuestion(session, q, ctx);
    const pick = session.current.choices.findIndex((c) => (c.kind === 'answer') === right);
    return answer(s, session, pick, ctx);
  };
  assert.equal(ask(false).correct, false);
  assert.equal(s.knowledge.radio.charge, 0);
  assert.equal(ask(true).correct, true);
  assert.equal(s.knowledge.radio.charge, 1);
});

test('セーブ：前のセーブ（電波が無い）は既定値で読める', () => {
  const s = newGame(7);
  delete s.knowledge.radio;
  const back = deserialize(serialize(s, 0), balance);
  assert.deepEqual(back.knowledge.radio, { charge: 0, pages: 0 });
});
