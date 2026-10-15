import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  tick, recruitList, monthlyContractCost, monthlyNetGold, payContracts, partyAllies, partyFull,
  canFound, industryList, foundCompany, closeCompany, companiesProfit, companyProfit,
  hireStaff, dismissStaff, bestStaffGrade, staffCost, staffBonus, industryById, genreState, HOURS_PER_MONTH,
} from '../js/sim.js';
import { GENRES } from '../js/genres.js';
import { business, recruits, makeCtx, newGame } from './helpers.js';

const STAFF = ['accountant', 'sales', 'planner', 'clerk'];
const base = (id) => recruits.find((r) => r.id === id);
const ind = (id) => business.industries.find((x) => x.id === id);
const grades = business.staffGrades;
/** 経営学の熟練が lv・お金持ちの主人公 */
function ready(lv = 1) {
  const s = newGame(0);
  genreState(s, '経営学').level = lv;
  s.gold = 1e12;
  return s;
}

test('データ：社員は4人。業種は経営学の熟練Lv1〜5で解放され、Lv1では3つから選べる。Lvが上がるほど利益が大きい', () => {
  assert.deepEqual(recruits.filter((r) => r.role === 'staff').map((r) => r.name), ['会計士', '営業', '企画', '事務員']);
  for (const id of STAFF) assert.ok(base(id).profitBonus > 0 && base(id).monthlyCost > 0);
  assert.deepEqual(business.unlock, { genre: '経営学', level: 1 });
  const byLv = (lv) => business.industries.filter((i) => i.level === lv);
  assert.equal(byLv(1).length, 3, 'Lv1 は3つ');
  for (let lv = 2; lv <= 5; lv++) {
    assert.ok(byLv(lv).length >= 1, `Lv${lv} の業種がある`);
    const best = (l) => Math.max(...byLv(l).map((i) => i.monthlyProfit));
    assert.ok(Math.min(...byLv(lv).map((i) => i.monthlyProfit)) > best(lv - 1), `Lv${lv} の業種は Lv${lv - 1} より利益が大きい`);
  }
  for (const i of business.industries) {
    assert.ok(STAFF.includes(i.specialty), `${i.name} のよく効く社員`);
    for (const g of i.genres) assert.ok(GENRES.includes(g), `${i.name} のジャンル ${g}`);
  }
  assert.equal(business.staffGenre, '心理学');
  assert.deepEqual(grades.map((g) => g.psychLevel), [0, 1, 2, 3, 4, 5]);
  for (let i = 1; i < grades.length; i++) {
    assert.ok(grades[i].bonusMultiplier > grades[i - 1].bonusMultiplier, `${grades[i].name} はより優秀`);
    assert.ok(grades[i].costMultiplier > grades[i - 1].costMultiplier, `${grades[i].name} は契約料も高い`);
  }
});

test('起業：経営学 Lv1 から。会社はいくつでも持てるが、同じ業種は1つまで。Lvが上がると大きい業種が解放される', () => {
  const s = ready(0);
  const ctx = makeCtx();
  assert.equal(canFound(s, ctx), false);
  assert.match(foundCompany(s, 'restaurant', ctx).reason, /経営学の熟練レベルが1以上/);
  genreState(s, '経営学').level = 1;
  assert.deepEqual(industryList(s, ctx).filter((i) => i.unlocked).map((i) => i.id), ['restaurant', 'publishing', 'cram_school']);
  assert.equal(foundCompany(s, 'restaurant', ctx).ok, true);
  assert.equal(foundCompany(s, 'publishing', ctx).ok, true, '2つ目の会社');
  assert.equal(foundCompany(s, 'restaurant', ctx).reason, '飲食店はもうある');
  assert.match(foundCompany(s, 'pharma', ctx).reason, /経営学の熟練レベルが3以上/);
  genreState(s, '経営学').level = 3;
  assert.equal(foundCompany(s, 'pharma', ctx).ok, true);
  assert.deepEqual(s.companies.map((c) => c.industry), ['restaurant', 'publishing', 'pharma']);
  assert.deepEqual(s.companies.map((c) => c.uid), [1, 2, 3]);
  assert.equal(s.gold, 1e12 - ind('restaurant').cost - ind('publishing').cost - ind('pharma').cost);
  // たたむと、その会社の社員との契約も終わり、同じ業種をまた起業できる
  hireStaff(s, 2, 'planner', ctx);
  assert.equal(closeCompany(s, 2).ok, true);
  assert.deepEqual(s.companies.map((c) => c.industry), ['restaurant', 'pharma']);
  assert.equal(monthlyContractCost(s, ctx), 0);
  assert.equal(foundCompany(s, 'publishing', ctx).ok, true);
  s.gold = ind('it').cost - 1;
  genreState(s, '経営学').level = 5;
  assert.equal(foundCompany(s, 'it', ctx).reason, 'ゴールドが足りません');
});

test('社員は会社ごとに雇う。心理学の熟練Lvが上がると、より優秀な社員（効果も契約料も大きい）を雇え、入れ替えられる', () => {
  const s = ready(1);
  const ctx = makeCtx();
  foundCompany(s, 'restaurant', ctx);
  foundCompany(s, 'publishing', ctx);
  assert.equal(bestStaffGrade(s, ctx), 0);
  assert.deepEqual(hireStaff(s, 1, 'sales', ctx), { ok: true, grade: 0, upgraded: false });
  assert.match(hireStaff(s, 1, 'sales', ctx).reason, /より優秀な社員はまだ雇えない/);
  assert.equal(hireStaff(s, 2, 'sales', ctx).ok, true, 'ほかの会社にも同じ役を雇える');
  assert.equal(monthlyContractCost(s, ctx), base('sales').monthlyCost * 2);
  genreState(s, '心理学').level = 2;
  assert.equal(bestStaffGrade(s, ctx), 2);
  assert.deepEqual(hireStaff(s, 1, 'sales', ctx), { ok: true, grade: 2, upgraded: true });
  assert.equal(s.companies[0].staff.length, 1, '入れ替えなので人数は同じ');
  assert.equal(staffCost(ctx, 'sales', 2), Math.round(base('sales').monthlyCost * grades[2].costMultiplier));
  assert.equal(monthlyContractCost(s, ctx), staffCost(ctx, 'sales', 2) + staffCost(ctx, 'sales', 0));
  // 社員は戦わず、パーティーにも入らない（パーティーがいっぱいでも雇える）
  for (let i = 0; i < 5; i++) s.allies.push({ id: `mb${i}`, name: '中ボス', atk: 1, maxHp: 1, hp: 1, cd: 1 });
  assert.ok(partyFull(s, ctx));
  assert.equal(hireStaff(s, 1, 'clerk', ctx).ok, true);
  assert.equal(partyAllies(s).length, 5);
  assert.ok(recruitList(s, ctx).every((r) => !STAFF.includes(r.id)), '仲間が集まる場所の一覧には社員は出ない');
  assert.equal(dismissStaff(s, 1, 'clerk').ok, true);
  assert.equal(dismissStaff(s, 1, 'clerk').ok, false);
});

test('利益：業種の利益×（1＋社員の効果）×（1＋関係するジャンルの熟練）。よく効く社員は2倍、優秀な社員は質の倍率', () => {
  const s = ready(1);
  const ctx = makeCtx();
  assert.equal(companiesProfit(s, ctx).total, 0);
  foundCompany(s, 'restaurant', ctx);
  const r = ind('restaurant');
  assert.equal(companiesProfit(s, ctx).total, r.monthlyProfit);
  genreState(s, '心理学').level = 1;            // 中堅
  hireStaff(s, 1, 'sales', ctx);                 // 飲食店では営業がよく効く
  genreState(s, '心理学').level = 0;
  hireStaff(s, 1, 'clerk', ctx);                 // 新人
  const sales = base('sales').profitBonus * grades[1].bonusMultiplier * r.specialtyMultiplier;
  const clerk = base('clerk').profitBonus;
  assert.ok(Math.abs(staffBonus(ctx, r, 'sales', 1) - sales) < 1e-12);
  let p = companyProfit(s, s.companies[0], ctx);
  assert.ok(p.staff.find((x) => x.id === 'sales').special);
  assert.equal(p.staff.find((x) => x.id === 'sales').gradeName, '中堅');
  assert.equal(p.total, Math.round(r.monthlyProfit * (1 + sales + clerk)));
  genreState(s, r.genres[0]).level = 2;
  genreState(s, r.genres[1]).level = 1;
  p = companyProfit(s, s.companies[0], ctx);
  assert.equal(p.total, Math.round(r.monthlyProfit * (1 + sales + clerk) * (1 + 3 * business.genreBonusPerLevel)));
  // 2つ目の会社の利益も合わせる。手取りには会社の利益が入る
  foundCompany(s, 'publishing', ctx);
  const all = companiesProfit(s, ctx);
  assert.equal(all.companies.length, 2);
  assert.equal(all.total, p.total + companyProfit(s, s.companies[1], ctx).total);
  assert.equal(monthlyNetGold(100, s, ctx), 100 + all.total - monthlyContractCost(s, ctx));
});

test('社員の契約料も1か月ごとに払う。払えないと社員は去る', () => {
  const s = ready(1);
  const ctx = makeCtx();
  foundCompany(s, 'restaurant', ctx);
  hireStaff(s, 1, 'sales', ctx);
  s.gold = base('sales').monthlyCost;
  s.life.gameHours += HOURS_PER_MONTH;
  payContracts(s, ctx, []);
  assert.equal(s.gold, 0);
  assert.equal(s.companies[0].staff.length, 1);
  s.life.gameHours += HOURS_PER_MONTH;
  const ev = [];
  payContracts(s, ctx, ev);
  assert.equal(s.companies[0].staff.length, 0);
  assert.ok(ev.some((e) => e.type === 'contractEnded' && e.name === '営業（飲食店）'));
});

test('会社の利益は時間がたつと入る（ゲーム内1か月でちょうど全部の会社の1か月分）', () => {
  const s = ready(3);
  const ctx = makeCtx();
  s.adventure.spawnTimer = 1e9; // 戦いのゴールドが混ざらないように敵を出さない
  foundCompany(s, 'pharma', ctx);
  foundCompany(s, 'restaurant', ctx);
  const before = s.gold;
  const month = HOURS_PER_MONTH / ctx.balance.time.gameHoursPerRealSecond;
  for (let t = 0; t < month; t += 0.5) tick(s, Math.min(0.5, month - t), ctx);
  assert.ok(Math.abs(s.gold - before - ind('pharma').monthlyProfit - ind('restaurant').monthlyProfit) < 1e-6, `${s.gold - before}`);
  assert.ok(industryById(ctx, 'pharma'));
});
