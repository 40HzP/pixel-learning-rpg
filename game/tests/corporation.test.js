import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  tick, foundCompany, incorporate, canIncorporate, companyProfit, companiesProfit, corporateTax, settleTaxes, setAdvisor, genreState, reincarnate,
  ageYears, HOURS_PER_YEAR, LAW_ECONOMICS,
} from '../js/sim.js';
import { updateFields, setMajor, fieldById } from '../js/fields.js';
import { serialize, deserialize } from '../js/save.js';
import { balance, monsters, makeCtx, newGame } from './helpers.js';

/** 会社を1つ持った主人公（法と経済学を解放して主専攻にするなら law） */
function withCompany({ law = true } = {}) {
  const ctx = makeCtx();
  const s = newGame(20);
  s.gold = 1e9;
  genreState(s, ctx.business.unlock.genre).level = 1;
  const ind = ctx.business.industries.find((i) => i.level === 1);
  assert.equal(foundCompany(s, ind.id, ctx).ok, true);
  if (law) {
    genreState(s, '法学').level = balance.fields.unlockLevel;
    genreState(s, '経済学').level = balance.fields.unlockLevel;
    updateFields(s, ctx, []);
    assert.equal(setMajor(s, 0, LAW_ECONOMICS, ctx).ok, true);
  }
  return { s, ctx, c: s.companies[0] };
}

/** ゲーム内の時間を years 年すすめる（1秒ずつ）。起きたことを返す */
function passYears(s, ctx, years) {
  const events = [];
  const sec = (years * HOURS_PER_YEAR) / balance.time.gameHoursPerRealSecond;
  for (let t = 0; t < sec; t++) events.push(...tick(s, 1, ctx));
  return events;
}

test('法と経済学（法学＋経済学）：ストラテジーの学際分野。会社を法人化できる', () => {
  const ctx = makeCtx();
  const f = fieldById(ctx, LAW_ECONOMICS);
  assert.deepEqual(f.genres, ['法学', '経済学']);
  assert.equal(f.group, 'strategy');
  assert.match(f.desc, /法人化/);
});

test('法人化は、法と経済学を専攻にしているときにできる。法人化した会社は利益が profitBonus だけ増える。やめられない', () => {
  const plain = withCompany({ law: false });
  assert.equal(canIncorporate(plain.s, plain.ctx), false);
  const no = incorporate(plain.s, plain.c.uid, plain.ctx);
  assert.equal(no.ok, false);
  assert.match(no.reason, /法と経済学を専攻にすると/);

  const { s, ctx, c } = withCompany();
  const before = companyProfit(s, c, ctx).total;
  assert.equal(incorporate(s, c.uid, ctx).ok, true);
  assert.equal(c.corp, true);
  const after = companyProfit(s, c, ctx);
  assert.equal(after.corpBonus, balance.corporation.profitBonus);
  assert.ok(Math.abs(after.total - before * (1 + balance.corporation.profitBonus)) <= 1);
  assert.equal(companiesProfit(s, ctx).corpTotal, after.total);
  assert.equal(incorporate(s, c.uid, ctx).ok, false, 'もう法人');
  // 専攻から外しても法人のまま
  setMajor(s, 0, null, ctx);
  assert.equal(companyProfit(s, c, ctx).total, after.total);
});

test('決算（税金イベント）：年齢が1つ上がるたびに、今年の法人の利益 × taxRate の法人税を払う。法人化していない会社には掛からない', () => {
  const { s, ctx, c } = withCompany();
  // 法人化していない間は、税は掛からない
  let ev = passYears(s, ctx, 1);
  assert.ok(!ev.some((e) => e.type === 'taxPaid'));
  incorporate(s, c.uid, ctx);
  passYears(s, ctx, 0.5); // 年の途中から法人
  const age = ageYears(s);
  ev = [];
  for (let i = 0; ageYears(s) === age; i++) ev.push(...tick(s, 1, ctx));
  const paid = ev.filter((e) => e.type === 'taxPaid');
  assert.equal(paid.length, 1);
  const t = paid[0];
  assert.equal(t.age, age + 1);
  assert.equal(t.tax, Math.round(t.earned * balance.corporation.taxRate));
  assert.equal(t.paid, t.tax);
  assert.equal(t.owed, 0);
  // 1年分の法人の利益（12か月分）くらい
  const yearProfit = companyProfit(s, c, ctx).total * 12;
  assert.ok(t.earned > yearProfit * 0.3 && t.earned <= yearProfit * 1.01, `法人化してからの分（${t.earned} / 1年 ${yearProfit}）`);
  assert.equal(s.tax.earned < yearProfit * 0.1, true, '決算のあとは今年の分が0から');
});

test('税務顧問（税務調査官・会社）：法人税が taxCut だけ減る', () => {
  const { s, ctx } = withCompany();
  s.allies.push({ id: 'tax_inspector', name: '税務調査官', atk: 1, maxHp: 1, hp: 1, cd: 1 });
  const before = corporateTax(s, ctx, 1_000_000);
  assert.deepEqual(before, { full: 300_000, tax: 300_000, saved: 0 });
  assert.equal(setAdvisor(s, 'tax_inspector', true, ctx).ok, true);
  const after = corporateTax(s, ctx, 1_000_000);
  assert.equal(after.full, 300_000);
  assert.equal(after.tax, Math.round(300_000 * (1 - balance.advisor.taxCut)));
  assert.equal(after.saved, after.full - after.tax);
});

test('法人税を払いきれないときは、払えるだけ払い、残りはこのあとの会社の利益から先に払う', () => {
  const { s, ctx, c } = withCompany();
  incorporate(s, c.uid, ctx);
  s.tax.earned = 1_000_000;
  s.gold = 100_000;
  const ev = [];
  s.tax.year = ageYears(s) - 1;
  settleTaxes(s, ctx, ev);
  assert.equal(ev[0].tax, 300_000);
  assert.equal(ev[0].paid, 100_000);
  assert.equal(ev[0].owed, 200_000);
  assert.equal(s.gold, 0);
  assert.equal(s.tax.owed, 200_000);
  // 会社の利益が入ると、まず払いきれなかった分に回る
  tick(s, 1, ctx);
  const perSec = (companiesProfit(s, ctx).total * balance.time.gameHoursPerRealSecond) / (HOURS_PER_YEAR / 12);
  assert.ok(Math.abs(s.tax.owed - (200_000 - perSec)) < 1);
  assert.equal(s.gold, 0);
});

test('法人化と法人税はセーブに残る。前のセーブも読める。生まれ変わると会社と一緒に最初から', () => {
  const { s, ctx, c } = withCompany();
  incorporate(s, c.uid, ctx);
  s.tax.earned = 123;
  s.tax.owed = 45;
  const loaded = deserialize(serialize(s), balance);
  assert.equal(loaded.companies[0].corp, true);
  assert.deepEqual(loaded.tax, s.tax);
  const old = JSON.parse(serialize(s));
  delete old.state.tax;
  assert.deepEqual(deserialize(JSON.stringify(old), balance).tax, { earned: 0, owed: 0, year: 0 });
  reincarnate(s, ctx);
  assert.deepEqual(s.companies, []);
  assert.deepEqual(s.tax, { earned: 0, owed: 0, year: 0 });
});

test('税務調査官は会社の顧問に置ける（法人化ができたので準備中ではない）', () => {
  const m = monsters.find((x) => x.id === 'tax_inspector');
  assert.equal(m.advisor.place, 'company');
  assert.equal(m.advisor.soon, undefined);
});
