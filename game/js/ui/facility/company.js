// 会社（起業・社員・法人化と、会社の顧問）。2026-11-09 に ui/facility.js から分けた
import {
  formatDate, HOURS_PER_MONTH, foundCompany, closeCompany, companiesProfit, industryList, industryOutlook,
  hireStaff, dismissStaff, bestStaffGrade, staffCost, staffBonus, hrFactor, canIncorporate, incorporate, LAW_ECONOMICS,
} from '../../sim.js';
import { fieldById, fieldActive } from '../../fields.js';
import { el, fmt } from '../dom.js';
import { live, say, update, note, pct, genreLv } from './common.js';
import { advisorSection } from './advisor.js';

/** 社員の質の名前 */
const gradeName = (ctx, i) => ctx.business.staffGrades[i].name;
/** 現実の時間の表示 */
const realSpan = (sec) => (sec >= 5400 ? `${(sec / 3600).toFixed(1)}時間` : sec >= 90 ? `${Math.round(sec / 60)}分` : `${Math.max(1, Math.round(sec))}秒`);

/** 会社1つのカード：利益と内訳、社員4人の枠（雇う・より優秀な社員に替える・やめる）、たたむ */
function companyCard(app, p) {
  const s = app.state;
  const ctx = app.ctx;
  const c = p.company;
  const ind = p.industry;
  const best = bestStaffGrade(s, ctx);
  const hr = hrFactor(s, ctx);
  const act = (fn, msg) => () => {
    const res = fn();
    if (!res.ok) { say(app, res.reason, 'bad'); return; }
    if (msg) say(app, msg(res), 'good');
    app.save();
    update(app, true);
  };
  const rows = ctx.recruits.filter((r) => r.role === 'staff').map((r) => {
    const st = c.staff.find((x) => x.id === r.id);
    const special = ind.specialty === r.id;
    const btns = [];
    let info;
    if (st) {
      info = [el('span', {}, `${r.name}（${gradeName(ctx, st.grade)}）`),
        el('small', { style: { color: 'var(--good)' } }, `利益 +${pct(staffBonus(ctx, ind, r.id, st.grade, hr))}${special ? '（よく効く）' : ''}　1か月 ${fmt(staffCost(ctx, r.id, st.grade))}G`)];
      if (best > st.grade) {
        const b = el('button', { class: 'primary', onclick: act(() => hireStaff(app.state, c.uid, r.id, ctx), () => `${ind.name}の${r.name}を「${gradeName(ctx, best)}」に替えた`) },
          `${gradeName(ctx, best)}に替える`, el('small', {}, `1か月 ${fmt(staffCost(ctx, r.id, best))}G`));
        live.buttons.push({ btn: b, price: staffCost(ctx, r.id, best) });
        btns.push(b);
      }
      btns.push(el('button', {
        onclick: () => {
          if (!confirm(`${ind.name}の${r.name}との契約をやめますか？（払った契約料は戻りません）`)) return;
          act(() => dismissStaff(app.state, c.uid, r.id), () => `${ind.name}の${r.name}との契約をやめた`)();
        },
      }, 'やめる'));
    } else {
      info = [el('span', { class: 'muted' }, `${r.name}：空き`),
        el('small', {}, `${r.desc}。雇うと利益 +${pct(staffBonus(ctx, ind, r.id, best, hr))}${special ? '（よく効く）' : ''}`)];
      const b = el('button', { onclick: act(() => hireStaff(app.state, c.uid, r.id, ctx), () => `${ind.name}に${r.name}（${gradeName(ctx, best)}）を雇った`) },
        `雇う（${gradeName(ctx, best)}）`, el('small', {}, `1か月 ${fmt(staffCost(ctx, r.id, best))}G`));
      live.buttons.push({ btn: b, price: staffCost(ctx, r.id, best) });
      btns.push(b);
    }
    return el('div', { class: 'staff-row' }, el('div', { class: 'name' }, ...info), el('div', { class: 'btns' }, btns));
  });
  const genreText = ind.genres.map((g) => `${g} Lv${genreLv(s, g)}`).join('・');
  // 法人化（法と経済学）：利益が増えるかわりに、毎年の決算で法人税を払う
  const law = fieldById(ctx, LAW_ECONOMICS);
  const corpBtn = c.corp || !canIncorporate(s, ctx) ? null : el('button', {
    class: 'primary',
    onclick: () => {
      if (!confirm(`${ind.name}を法人化しますか？\n利益が${pct(ctx.balance.corporation.profitBonus)}増えるかわりに、毎年の決算で法人税（利益の${pct(ctx.balance.corporation.taxRate)}）を払う。法人化はやめられない`)) return;
      act(() => incorporate(app.state, c.uid, ctx), () => `${ind.name}を法人化した！（株式会社${ind.name}）`)();
    },
  }, '法人化する', el('small', {}, `利益 +${pct(ctx.balance.corporation.profitBonus)}・法人税 ${pct(ctx.balance.corporation.taxRate)}`));
  return el('div', { class: 'company' + (c.corp ? ' corp' : '') },
    el('div', { class: 'zname' }, c.corp ? `株式会社${ind.name}` : ind.name, el('span', { class: 'muted' }, `（${formatDate(c.foundedAt)}に起業${c.corp ? `・${formatDate(c.incorporatedAt)}に法人化` : ''}）`)),
    el('div', { class: 'profit' }, '1か月の利益 ', el('b', {}, `${fmt(p.total)}G`)),
    el('small', {}, `${ind.name}の利益 ${fmt(p.base)}G × 社員 +${pct(p.staffBonus)} × ジャンルの熟練 +${pct(p.genreBonus)}（${genreText}）${c.corp ? ` × 法人化 +${pct(p.corpBonus)}` : ''}`),
    hr > 1 ? el('small', { class: 'good' }, `人事（就職面接官）：社員の効果 +${pct(hr - 1)}`) : null,
    c.corp ? el('small', {}, `法人なので、毎年の決算で法人税（利益の${pct(ctx.balance.corporation.taxRate)}）を払う`)
      : corpBtn ? el('div', { class: 'btnrow' }, corpBtn)
        : el('small', {}, `${law.name}（${law.genres.join('＋')}）を専攻にすると法人化できる（利益が増えるかわりに法人税を払う）`),
    el('div', { class: 'staff-list' }, rows),
    el('button', {
      class: 'close-company',
      onclick: () => {
        if (!confirm(`${ind.name}をたたみますか？（元手は戻りません。この会社の社員との契約も終わります）`)) return;
        act(() => closeCompany(app.state, c.uid), () => `${ind.name}をたたんだ`)();
      },
    }, 'この会社をたたむ'));
}

/** 会社：業種を選んで起業する（いくつでも。同じ業種は1つまで）。社員が利益を増やす */
export function companyPanel(app) {
  const s = app.state;
  const ctx = app.ctx;
  const biz = ctx.business;
  const all = companiesProfit(s, ctx);
  const lv = genreLv(s, biz.unlock.genre);
  const psych = genreLv(s, biz.staffGenre);
  const best = bestStaffGrade(s, ctx);
  const next = biz.staffGrades[best + 1];
  // 計量経済学：起業できる業種ごとの収益の期待値（手取りがいちばん大きい・元手をいちばん早く取り戻せる業種に印を付ける）
  const econ = fieldActive(s, ctx, 'econometrics') ? fieldById(ctx, 'econometrics') : null;
  const outlooks = {};
  if (econ) for (const ind of industryList(s, ctx)) if (ind.unlocked && !ind.founded) outlooks[ind.id] = industryOutlook(s, ind, ctx);
  const ols = Object.entries(outlooks);
  const topNet = ols.length ? ols.reduce((a, b) => (b[1].net > a[1].net ? b : a))[0] : null;
  const fastest = ols.filter(([, o]) => o.paybackMonths != null).reduce((a, b) => (!a || b[1].paybackMonths < a[1].paybackMonths ? b : a), null);
  const monthSec = HOURS_PER_MONTH / ctx.balance.time.gameHoursPerRealSecond;
  const outlookLine = (ind) => {
    const o = outlooks[ind.id];
    if (!o) return null;
    const marks = [ind.id === topNet ? '★手取りがいちばん大きい' : '', fastest && ind.id === fastest[0] ? '★元手をいちばん早く取り戻せる' : ''].filter(Boolean).join('　');
    const back = o.paybackMonths == null ? '元手は取り戻せない'
      : `元手は約${o.paybackMonths >= 24 ? `${(o.paybackMonths / 12).toFixed(1)}年` : `${Math.ceil(o.paybackMonths)}か月`}で取り戻せる（現実の約${realSpan(o.paybackMonths * monthSec)}）`;
    return el('div', { class: 'outlook' },
      `期待値：手取り 1か月 ${fmt(o.net)}G（社員${o.staff.length ? `${o.staff.length}人を「${gradeName(ctx, o.grade)}」で雇った場合` : 'なし'}）。${back}`,
      marks ? el('b', {}, marks) : null);
  };
  const cards = industryList(s, ctx).filter((i) => !i.founded).map((ind) => {
    const btn = el('button', {
      class: 'primary', disabled: !ind.unlocked,
      onclick: () => {
        if (!confirm(`${fmt(ind.cost)}G を払って${ind.name}を起業しますか？`)) return;
        const res = foundCompany(app.state, ind.id, ctx);
        if (!res.ok) { say(app, res.reason, 'bad'); return; }
        say(app, `${ind.name}を起業した！`, 'good');
        app.save();
        update(app, true);
      },
    }, ind.unlocked ? `起業する（${fmt(ind.cost)}G）` : `${biz.unlock.genre}の熟練レベル${ind.level}で解放`);
    if (ind.unlocked) live.buttons.push({ btn, price: ind.cost });
    const special = (ctx.recruits.find((r) => r.id === ind.specialty) || {}).name;
    return el('div', { class: 'industry' + (ind.unlocked ? '' : ' locked') },
      el('div', { class: 'zname' }, ind.name, el('span', { class: 'muted' }, `（${biz.unlock.genre} Lv${ind.level}〜）`)),
      el('div', {}, ind.desc),
      el('small', {}, `元手 ${fmt(ind.cost)}G　利益 1か月 ${fmt(ind.monthlyProfit)}G（社員なし）`),
      el('small', {}, `よく効く社員：${special}　関係するジャンル：${ind.genres.join('・')}（熟練Lv1ごとに利益 +${pct(biz.genreBonusPerLevel)}）`),
      outlookLine(ind),
      btn);
  });
  return [
    el('div', { style: { marginBottom: '6px' } }, '所持金 ', live.gold, 'G'),
    all.companies.length
      ? el('div', { class: 'profit' }, `会社 ${all.companies.length}社　1か月の利益 合計 `, el('b', {}, `${fmt(all.total)}G`))
      : null,
    s.companies.some((c) => c.corp) || s.tax.owed > 0 ? (live.tax = el('div', { class: 'tax-box' })) : null,
    note(`社員の質は${biz.staffGenre}の熟練で上がる。今は${biz.staffGenre} Lv${psych}なので「${gradeName(ctx, best)}」まで雇える${next ? `（Lv${next.psychLevel}で「${next.name}」）` : '（いちばん上）'}。優秀な社員ほど利益を増やすが、契約料も高い`),
    ...all.companies.map((p) => companyCard(app, p)),
    ...advisorSection(app, ['company']),
    cards.length ? el('h3', { class: 'subhead' }, '起業する') : null,
    cards.length ? note(`会社はいくつでも持てる（同じ業種は1つまで）。${biz.unlock.genre}の熟練が上がると、利益の大きい業種が解放される（今 Lv${lv}）。利益は時間がたつと少しずつ所持金に入る`) : null,
    cards.length && econ ? note(`${econ.name}：起業できる業種ごとに、収益の期待値（社員を雇ったときの1か月の手取りと、元手を取り戻すまでの期間）を出している`) : null,
    cards.length ? el('div', { class: 'list' }, cards) : null,
  ];
}
