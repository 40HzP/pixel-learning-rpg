import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  tick, hireRecruit, dismissRecruit, recruitList, monthlyContractCost, monthlyNetGold, payContracts, partyAllies, partyFull,
  canFound, foundCompany, closeCompany, companyProfit, genreState, HOURS_PER_MONTH,
} from '../js/sim.js';
import { GENRES } from '../js/genres.js';
import { business, recruits, makeCtx, newGame } from './helpers.js';

const STAFF = ['accountant', 'sales', 'planner', 'clerk'];
const cost = (id) => recruits.find((r) => r.id === id).monthlyCost;
const ind = (id) => business.industries.find((x) => x.id === id);
/** 経営学の熟練 Lv1・お金持ちの主人公 */
function ready() {
  const s = newGame(0);
  genreState(s, '経営学').level = 1;
  s.gold = 1e6;
  return s;
}

test('データ：社員は会計士・営業・企画・事務員。業種は3つで、よく効く社員と関係するジャンルがある', () => {
  assert.deepEqual(recruits.filter((r) => r.role === 'staff').map((r) => r.name), ['会計士', '営業', '企画', '事務員']);
  for (const id of STAFF) {
    const r = recruits.find((x) => x.id === id);
    assert.deepEqual(r.unlock, { genre: '経営学', level: 1 });
    assert.ok(r.profitBonus > 0 && r.monthlyCost > 0);
  }
  assert.deepEqual(business.unlock, { genre: '経営学', level: 1 });
  assert.equal(business.industries.length, 3);
  for (const i of business.industries) {
    assert.ok(STAFF.includes(i.specialty), `${i.name} のよく効く社員`);
    for (const g of i.genres) assert.ok(GENRES.includes(g), `${i.name} のジャンル ${g}`);
    assert.ok(i.cost > 0 && i.monthlyProfit > 0);
  }
});

test('社員は経営学の熟練が Lv1 になると契約できる。戦わず、パーティーの人数にも入らない', () => {
  const s = newGame(0);
  const ctx = makeCtx();
  s.gold = 1e6;
  assert.ok(recruitList(s, ctx).filter((r) => STAFF.includes(r.id)).every((r) => !r.unlocked));
  const no = hireRecruit(s, 'sales', ctx);
  assert.equal(no.ok, false);
  assert.match(no.reason, /経営学の熟練が Lv1/);
  genreState(s, '経営学').level = 1;
  // パーティーがいっぱいでも社員は契約できる
  for (let i = 0; i < 5; i++) s.allies.push({ id: `mb${i}`, name: '中ボス', atk: 1, maxHp: 1, hp: 1, cd: 1 });
  assert.ok(partyFull(s, ctx));
  for (const id of STAFF) assert.equal(hireRecruit(s, id, ctx).ok, true, id);
  assert.equal(hireRecruit(s, 'sales', ctx).ok, false, '二重に契約できない');
  assert.deepEqual(s.staff.map((a) => a.id), STAFF);
  assert.equal(partyAllies(s).length, 5, '社員はパーティーに入らない');
  assert.equal(monthlyContractCost(s, ctx), STAFF.reduce((sum, id) => sum + cost(id), 0));
  assert.equal(dismissRecruit(s, 'clerk').ok, true);
  assert.deepEqual(s.staff.map((a) => a.id), ['accountant', 'sales', 'planner']);
});

test('社員の契約料も1か月ごとに払う。払えないと社員は去る', () => {
  const s = ready();
  const ctx = makeCtx();
  hireRecruit(s, 'sales', ctx);
  s.gold = cost('sales');
  s.life.gameHours += HOURS_PER_MONTH;
  payContracts(s, ctx, []);
  assert.equal(s.gold, 0);
  assert.equal(s.staff.length, 1);
  s.life.gameHours += HOURS_PER_MONTH;
  const ev = [];
  payContracts(s, ctx, ev);
  assert.equal(s.staff.length, 0);
  assert.ok(ev.some((e) => e.type === 'contractEnded' && e.id === 'sales'));
});

test('起業：経営学の熟練 Lv1 から。業種を選んで元手を払う。会社は1つ。たたむと選び直せる', () => {
  const s = newGame(0);
  const ctx = makeCtx();
  s.gold = 1e6;
  assert.equal(canFound(s, ctx), false);
  assert.match(foundCompany(s, 'restaurant', ctx).reason, /経営学の熟練が Lv1/);
  genreState(s, '経営学').level = 1;
  s.gold = ind('pharma').cost - 1;
  assert.equal(foundCompany(s, 'pharma', ctx).reason, 'ゴールドが足りません');
  assert.equal(foundCompany(s, 'publishing', ctx).ok, true);
  assert.equal(s.gold, ind('pharma').cost - 1 - ind('publishing').cost);
  assert.equal(s.company.industry, 'publishing');
  assert.equal(foundCompany(s, 'restaurant', ctx).reason, 'もう会社があります');
  assert.equal(closeCompany(s).ok, true);
  assert.equal(s.company, null);
  assert.equal(foundCompany(s, 'restaurant', ctx).ok, true);
});

test('利益：業種の利益×（1＋社員の効果）×（1＋関係するジャンルの熟練）。よく効く社員は2倍', () => {
  const s = ready();
  const ctx = makeCtx();
  assert.equal(companyProfit(s, ctx), null);
  foundCompany(s, 'restaurant', ctx);
  const r = ind('restaurant');
  assert.equal(companyProfit(s, ctx).total, r.monthlyProfit);
  hireRecruit(s, 'sales', ctx);   // 飲食店では営業がよく効く
  hireRecruit(s, 'clerk', ctx);
  const sales = recruits.find((x) => x.id === 'sales').profitBonus * r.specialtyMultiplier;
  const clerk = recruits.find((x) => x.id === 'clerk').profitBonus;
  let p = companyProfit(s, ctx);
  assert.ok(p.staff.find((x) => x.id === 'sales').special);
  assert.equal(p.total, Math.round(r.monthlyProfit * (1 + sales + clerk)));
  genreState(s, r.genres[0]).level = 2;
  genreState(s, r.genres[1]).level = 1;
  p = companyProfit(s, ctx);
  assert.equal(p.total, Math.round(r.monthlyProfit * (1 + sales + clerk) * (1 + 3 * business.genreBonusPerLevel)));
  // 手取りには会社の利益が入る
  assert.equal(monthlyNetGold(100, s, ctx), 100 + p.total - cost('sales') - cost('clerk'));
});

test('会社の利益は時間がたつと入る（ゲーム内1か月でちょうど1か月分）', () => {
  const s = ready();
  const ctx = makeCtx();
  s.adventure.spawnTimer = 1e9; // 戦いのゴールドが混ざらないように敵を出さない
  foundCompany(s, 'pharma', ctx);
  const before = s.gold;
  const month = HOURS_PER_MONTH / ctx.balance.time.gameHoursPerRealSecond;
  for (let t = 0; t < month; t += 0.5) tick(s, Math.min(0.5, month - t), ctx);
  assert.ok(Math.abs(s.gold - before - ind('pharma').monthlyProfit) < 1e-6, `${s.gold - before}`);
});
