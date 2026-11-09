// ゲームの計算：会社（起業・社員・利益・法人化と法人税）

import { fieldActive, fieldById } from '../fields.js';
import { HOURS_PER_MONTH } from './core.js';
import { ageYears } from './time.js';
import { generationMultiplier } from './life.js';
import { recruitById, isStaff, genreLevel } from './allies.js';
import { advisorActive, hrFactor } from './advisor.js';

export const industryById = (ctx, id) => ((ctx.business && ctx.business.industries) || []).find((x) => x.id === id) || null;
export const companyByUid = (state, uid) => state.companies.find((c) => c.uid === uid) || null;

/** 起業できるようになっているか（business.json の unlock：経営学の熟練 Lv1 から） */
export function canFound(state, ctx) {
  const u = ctx.business && ctx.business.unlock;
  return !!u && genreLevel(state, u.genre) >= u.level;
}

/**
 * 起業できる業種の一覧。業種の level（経営学の熟練Lv）に届いていれば解放。同じ業種の会社は1つまで
 */
export function industryList(state, ctx) {
  const lv = genreLevel(state, ctx.business.unlock.genre);
  return ctx.business.industries.map((ind) => ({
    ...ind, unlocked: lv >= ind.level, founded: state.companies.some((c) => c.industry === ind.id),
  }));
}

/** 起業する。業種を選び、元手（cost）を払う。会社はいくつでも持てる（同じ業種は1つまで） */
export function foundCompany(state, industryId, ctx) {
  const ind = industryById(ctx, industryId);
  if (!ind) return { ok: false, reason: 'ない業種です' };
  const u = ctx.business.unlock;
  if (genreLevel(state, u.genre) < Math.max(u.level, ind.level)) return { ok: false, reason: `${u.genre}の熟練レベルが${Math.max(u.level, ind.level)}以上で起業できる` };
  if (state.companies.some((c) => c.industry === ind.id)) return { ok: false, reason: `${ind.name}はもうある` };
  if (state.gold < ind.cost) return { ok: false, reason: 'ゴールドが足りません' };
  state.gold -= ind.cost;
  state.companies.push({ uid: state.nextCompanyUid++, industry: ind.id, foundedAt: state.life.gameHours, staff: [] });
  return { ok: true };
}

/** 会社をたたむ（元手は戻らない。その会社の社員との契約も終わる） */
export function closeCompany(state, uid) {
  const i = state.companies.findIndex((c) => c.uid === uid);
  if (i < 0) return { ok: false, reason: '会社がありません' };
  state.companies.splice(i, 1);
  return { ok: true };
}

/* ---------- 社員（会社ごと。質は心理学の熟練で上がる） ---------- */

/** 心理学（business.json の staffGenre）の熟練レベルで雇える、いちばん優秀な社員の質（staffGrades の番号） */
export function bestStaffGrade(state, ctx) {
  const lv = genreLevel(state, ctx.business.staffGenre);
  let best = 0;
  ctx.business.staffGrades.forEach((g, i) => { if (lv >= g.psychLevel) best = i; });
  return best;
}
export const gradeOf = (ctx, i) => ctx.business.staffGrades[Math.max(0, Math.min(i, ctx.business.staffGrades.length - 1))];

/** 社員の1か月の契約料（基本×質の costMultiplier） */
export const staffCost = (ctx, id, grade) => Math.round((recruitById(ctx, id) || { monthlyCost: 0 }).monthlyCost * gradeOf(ctx, grade).costMultiplier);

/** 社員1人がその会社の利益を増やす割合（基本×質の bonusMultiplier×業種のよく効く社員なら specialtyMultiplier×人事の倍率 hr（hrFactor）） */
export function staffBonus(ctx, ind, id, grade, hr = 1) {
  const r = recruitById(ctx, id);
  const special = ind && ind.specialty === id;
  return (r ? r.profitBonus || 0 : 0) * gradeOf(ctx, grade).bonusMultiplier * (special ? ind.specialtyMultiplier : 1) * hr;
}

/**
 * 会社に社員を雇う（会計士・営業・企画・事務員を1人ずつ）。いま雇えるいちばん優秀な質で雇う。
 * もういる役なら、より優秀な社員に入れ替える（前の社員との契約は終わる。払った分は戻らない）
 */
export function hireStaff(state, uid, id, ctx) {
  const c = companyByUid(state, uid);
  const r = recruitById(ctx, id);
  if (!c) return { ok: false, reason: '会社がありません' };
  if (!isStaff(r)) return { ok: false, reason: 'いない社員です' };
  const grade = bestStaffGrade(state, ctx);
  const cur = c.staff.find((x) => x.id === id);
  if (cur && cur.grade >= grade) return { ok: false, reason: 'これより優秀な社員はまだ雇えない（心理学の熟練が上がると雇える）' };
  const cost = staffCost(ctx, id, grade);
  if (state.gold < cost) return { ok: false, reason: 'ゴールドが足りません' };
  state.gold -= cost;
  if (cur) c.staff.splice(c.staff.indexOf(cur), 1);
  c.staff.push({ id, grade, paidUntil: state.life.gameHours + HOURS_PER_MONTH });
  const order = (x) => (ctx.recruits || []).findIndex((rr) => rr.id === x.id);
  c.staff.sort((a, b) => order(a) - order(b));
  return { ok: true, grade, upgraded: !!cur };
}

/** 社員との契約をやめる（払った分は戻らない） */
export function dismissStaff(state, uid, id) {
  const c = companyByUid(state, uid);
  const i = c ? c.staff.findIndex((x) => x.id === id) : -1;
  if (i < 0) return { ok: false, reason: '雇っていません' };
  c.staff.splice(i, 1);
  return { ok: true };
}

/* ---------- 利益 ---------- */

/**
 * 会社1つの1か月あたりの利益（社員の契約料を引く前）と内訳。
 * 利益＝業種の monthlyProfit ×（1＋社員の staffBonus の合計）×（1＋関係するジャンルの熟練Lvの合計×genreBonusPerLevel）×世代の倍率。
 * 就職面接官を会社の顧問に置いていると、社員の効果が人事の倍率（hrFactor）だけ大きくなる。
 * 法人化した会社（法と経済学）は、さらに ×（1＋balance.corporation.profitBonus）。そのかわり毎年の決算で法人税を払う（settleTaxes）
 */
export function companyProfit(state, company, ctx) {
  const ind = industryById(ctx, company.industry);
  if (!ind) return null;
  const hr = hrFactor(state, ctx);
  const staff = company.staff.map((st) => {
    const r = recruitById(ctx, st.id);
    if (!r) return null;
    return { id: r.id, name: r.name, grade: st.grade, gradeName: gradeOf(ctx, st.grade).name, bonus: staffBonus(ctx, ind, st.id, st.grade, hr), special: ind.specialty === r.id };
  }).filter(Boolean);
  const bonus = staff.reduce((sum, x) => sum + x.bonus, 0);
  const genreLevels = ind.genres.reduce((sum, g) => sum + genreLevel(state, g), 0);
  const genreBonus = genreLevels * ctx.business.genreBonusPerLevel;
  const gm = generationMultiplier(state, ctx.balance);
  const corpBonus = company.corp ? ctx.balance.corporation.profitBonus : 0;
  return { company, industry: ind, base: ind.monthlyProfit, staff, staffBonus: bonus, genreLevels, genreBonus, corpBonus, generation: gm, total: Math.round(ind.monthlyProfit * (1 + bonus) * (1 + genreBonus) * (1 + corpBonus) * gm) };
}

/**
 * 計量経済学：その業種を今起業したときの収益の期待値（1か月あたり）。
 * 社員は、いま雇えるいちばん優秀な質で、雇うと契約料より利益が増える役だけ雇う前提。
 * profit＝利益、cost＝社員の契約料、net＝手取り、paybackMonths＝元手を取り戻すまでの月数（手取りが0以下なら null）
 */
export function industryOutlook(state, ind, ctx) {
  const grade = bestStaffGrade(state, ctx);
  const plain = companyProfit(state, { industry: ind.id, staff: [] }, ctx);
  const perBonus = plain.base * (1 + plain.genreBonus) * plain.generation; // 社員の効果1あたりの利益
  const staff = (ctx.recruits || []).filter((r) => isStaff(r) && perBonus * staffBonus(ctx, ind, r.id, grade, hrFactor(state, ctx)) > staffCost(ctx, r.id, grade));
  const p = companyProfit(state, { industry: ind.id, staff: staff.map((r) => ({ id: r.id, grade })) }, ctx);
  const cost = staff.reduce((sum, r) => sum + staffCost(ctx, r.id, grade), 0);
  const net = p.total - cost;
  return { grade, staff: staff.map((r) => r.name), profit: p.total, cost, net, paybackMonths: net > 0 ? ind.cost / net : null };
}

/** 全部の会社の利益（1か月あたり）。companies は会社ごとの内訳、corpTotal は法人化した会社の利益の合計 */
export function companiesProfit(state, ctx) {
  const companies = state.companies.map((c) => companyProfit(state, c, ctx)).filter(Boolean);
  return { companies, total: companies.reduce((sum, p) => sum + p.total, 0), corpTotal: companies.reduce((sum, p) => sum + (p.company.corp ? p.total : 0), 0) };
}

/**
 * 会社の利益は時間がたつと少しずつ入る（1か月で companiesProfit().total）。
 * 法人化した会社の利益は、決算で法人税を計算するために今年の分をためておく。払いきれなかった法人税があれば、会社の利益から先に払う
 */
export function earnCompany(state, dt, ctx) {
  if (!state.companies.length) return;
  const all = companiesProfit(state, ctx);
  const months = (dt * ctx.balance.time.gameHoursPerRealSecond) / HOURS_PER_MONTH;
  let income = all.total * months;
  state.tax.earned += all.corpTotal * months;
  if (state.tax.owed > 0) {
    const pay = Math.min(state.tax.owed, income);
    state.tax.owed -= pay;
    income -= pay;
  }
  state.gold += income;
}

/* ---------- 法人化と法人税（法と経済学。設計ページ「会社を法人化できる。収益が上がる代わりに税金イベントが起きる」） ---------- */

export const LAW_ECONOMICS = 'law_economics';

/** 会社を法人化できるか：法と経済学（学際分野）を専攻にしていて休眠していない */
export const canIncorporate = (state, ctx) => fieldActive(state, ctx, LAW_ECONOMICS);

/**
 * 会社を法人化する（費用なし・やめられない）。法人化した会社は利益が balance.corporation.profitBonus だけ増え、
 * 毎年の決算で法人税を払う。法人化したあとで法と経済学を専攻から外しても、法人のまま
 */
export function incorporate(state, uid, ctx) {
  const c = companyByUid(state, uid);
  if (!c) return { ok: false, reason: '会社がありません' };
  if (c.corp) return { ok: false, reason: 'もう法人化している' };
  if (!canIncorporate(state, ctx)) return { ok: false, reason: `${(fieldById(ctx, LAW_ECONOMICS) || {}).name}を専攻にすると法人化できる` };
  c.corp = true;
  c.incorporatedAt = state.life.gameHours;
  return { ok: true };
}

/**
 * 法人税：今年の法人の利益（earned）× balance.corporation.taxRate。
 * 税務調査官を会社の顧問に置いていると、税務顧問として取られる額が balance.advisor.taxCut だけ減る。{ full, tax, saved }
 */
export function corporateTax(state, ctx, earned = state.tax.earned) {
  const full = Math.round(earned * ctx.balance.corporation.taxRate);
  const cut = advisorActive(state, ctx, 'tax_inspector') ? ctx.balance.advisor.taxCut : 0;
  const tax = Math.round(full * (1 - cut));
  return { full, tax, saved: full - tax };
}

/**
 * 決算（税金イベント）：年齢が1つ上がるたびに、今年の法人の利益にかかる法人税を払う。
 * 足りなければ払えるだけ払い、残りは払いきれなかった法人税（tax.owed）として、このあとの会社の利益から先に払う
 */
export function settleTaxes(state, ctx, events) {
  const year = ageYears(state);
  if (year <= state.tax.year) return;
  state.tax.year = year;
  const earned = state.tax.earned;
  state.tax.earned = 0;
  if (earned <= 0) return;
  const { tax, saved } = corporateTax(state, ctx, earned);
  const paid = Math.min(Math.max(0, state.gold), tax);
  state.gold -= paid;
  state.tax.owed += tax - paid;
  events.push({ type: 'taxPaid', age: year, earned: Math.round(earned), tax, paid, owed: tax - paid, saved });
}
