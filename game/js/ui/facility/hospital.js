// 病院（月面は医務室も同じ画面）。2026-11-09 に ui/facility.js から分けた
import { treatmentInfo, receiveTreatment } from '../../sim.js';
import { el, fmt } from '../dom.js';
import { live, say, update, note } from './common.js';

/**
 * 病院：年を取って体の不調を感じ始めてから（寿命の life.ailmentYearsBefore 年前）、治療を受けると寿命が延びる
 * （設計ページ「寿命は医者や生化学で延びる」）。治療は1つの人生で hospital.treatmentCosts の数まで。生まれ変わると最初から
 */
export function hospitalPanel(app) {
  const s = app.state;
  const ctx = app.ctx;
  const h = ctx.balance.hospital;
  const t = treatmentInfo(s, ctx);
  live.exam = el('div', { style: { marginBottom: '8px' } });
  const btn = el('button', {
    class: 'primary',
    disabled: !t.ok,
    onclick: () => {
      if (!confirm(`${fmt(t.cost)}G を払って治療を受けますか？（寿命が${t.years}年延びる）`)) return;
      const r = receiveTreatment(app.state, ctx);
      if (!r.ok) { say(app, r.reason, 'bad'); return; }
      say(app, `治療を受けた。寿命が${r.years}年延びた`, 'good');
      app.save();
      update(app, true);
    },
  }, t.cost == null ? '治療はすべて受けた' : `治療を受ける（${fmt(t.cost)}G）`);
  if (s.life.ailing && t.cost != null) live.buttons.push({ btn, price: t.cost });
  const rows = h.treatmentCosts.map((cost, i) => {
    const done = i < t.count;
    const nextOne = i === t.count;
    return el('div', { class: 'item' + (done || nextOne ? '' : ' locked') },
      el('div', { class: 'name' }, `${i + 1}回目の治療`, el('small', {}, `${fmt(cost)}G　寿命 +${h.extendYears}年`)),
      el('span', { class: done ? 'good' : 'muted' }, done ? '済' : nextOne ? '次' : '未'));
  });
  return [
    el('div', { style: { marginBottom: '6px' } }, '所持金 ', live.gold, 'G'),
    live.exam,
    el('div', { class: 'btnrow' }, btn),
    s.life.ailing ? null : note(`年を取って体の不調を感じ始めると（${ctx.balance.life.lifespanYears - ctx.balance.life.ailmentYearsBefore}歳前後）、治療を受けられる`),
    el('h3', { class: 'subhead' }, `治療（1つの人生で${t.max}回まで）`),
    el('div', { class: 'list' }, rows),
    note('生まれ変わると、体の不調も治療の回数も最初から'),
  ];
}
