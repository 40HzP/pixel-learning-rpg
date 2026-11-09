// 顧問（仲間にした中ボス。設計ページ「仲間にした後の役目（顧問）」）：顧問にするボタンと、施設ごとの顧問の欄。
// 2026-11-09 に ui/facility.js から分けた
import { inParty, ADVISOR_PLACES, advisorSlots, advisorsAt, setAdvisor, citationsLeft } from '../../sim.js';
import { el, fmt } from '../dom.js';
import { say, update, pct } from './common.js';

/** 顧問にする・やめさせるボタン（仲間が集まる場所と、置く施設の顧問の欄で同じもの） */
export function advisorButton(app, a, d, placeFull) {
  const on = !!a.advisor;
  return el('button', {
    class: on || placeFull ? '' : 'primary',
    disabled: !on && placeFull,
    'aria-pressed': on ? 'true' : 'false',
    onclick: () => {
      const r = setAdvisor(app.state, a.id, !on, app.ctx);
      if (!r.ok) { say(app, r.reason, 'bad'); return; }
      say(app, on ? `${a.name}の顧問をやめさせた（${r.benched ? '控え' : 'パーティー'}に戻った）` : `${a.name}を${r.place}の顧問にした（${d.role}）`, 'good');
      app.save();
      update(app, true);
    },
  }, on ? '顧問をやめる' : '顧問にする');
}

/** 顧問の役目の説明に、今の数字を足したもの */
function advisorText(app, m) {
  const s = app.state;
  const a = app.ctx.balance.advisor;
  const extra = {
    teacher_elementary: () => `（破りすてた問題：${s.knowledge.torn.length}問）`,
    teacher_junior: () => `（${a.periodicTestProgress}問分）`,
    reviewer: () => `（誕生日までに${a.citationsPerYear}回。今はあと${citationsLeft(s, app.ctx)}回）`,
    interviewer: () => `（社員の効果 +${pct(a.hrStaffBonus)}）`,
    politician: () => `（建造費の${pct(a.rocketSubsidy)}：${fmt(Math.round(app.ctx.balance.rocket.buildCost * a.rocketSubsidy))}G）`,
  }[m.id];
  return m.advisor.desc + (extra ? extra() : '');
}

/**
 * 顧問の欄：places の場所ごとに、置ける中ボスとその役目を並べ、顧問にする・やめさせるを選ぶ。
 * まだ仲間にしていない中ボスは、名前と役目だけ見せる（倒すと仲間になって置ける）
 */
export function advisorSection(app, places) {
  const s = app.state;
  const ctx = app.ctx;
  return places.flatMap((place) => {
    const slots = advisorSlots(ctx, place);
    const now = advisorsAt(s, ctx, place);
    const full = now.length >= slots;
    const rows = ctx.monsters.filter((m) => m.advisor && m.advisor.place === place).map((m) => {
      const d = m.advisor;
      const a = s.allies.find((x) => x.id === m.id && !x.hired);
      let status;
      let btn = null;
      if (!a) status = el('small', {}, `まだ仲間にしていない（${m.appearAge}歳から挑戦できる中ボス。倒すと仲間になる）`);
      else if (d.soon) status = el('small', {}, `準備中（${d.soon}置ける）`);
      else {
        status = a.advisor ? el('small', { style: { color: 'var(--good)' } }, '顧問にいる（効果が出ている。戦わない）')
          : el('small', {}, full ? `${inParty(a) ? 'パーティー' : '控え'}にいる（顧問の枠がいっぱい。今の顧問をやめさせると置ける）` : `${inParty(a) ? 'パーティー' : '控え'}にいる`);
        btn = advisorButton(app, a, d, full);
      }
      return el('div', { class: 'item' + (a && a.advisor ? ' on' : !a || d.soon ? ' locked' : '') },
        el('div', { class: 'name' }, `${m.name}：${d.role}`, el('small', {}, advisorText(app, m)), status), btn);
    });
    return [
      el('h3', { class: 'subhead' }, `${ADVISOR_PLACES[place]}の顧問（${now.length}/${slots}人）`),
      el('div', { class: 'list' }, rows),
    ];
  });
}
