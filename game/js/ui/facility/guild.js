// 仲間が集まる場所（契約と、中ボスだった仲間のパーティー・顧問）。2026-11-09 に ui/facility.js から分けた
import {
  inParty, setInParty, partyAllies, partyMax, partyFull, formatDate, recruitList, hireRecruit, dismissRecruit, monthlyContractCost, HOURS_PER_MONTH,
  canFound, ADVISOR_PLACES, advisorDef, advisorSlots, advisorsAt,
} from '../../sim.js';
import { el, fmt } from '../dom.js';
import { live, view, say, update, note } from './common.js';
import { advisorButton } from './advisor.js';

/** 契約できる仲間の1行（契約する・解約する） */
function contractRow(app, r) {
  const s = app.state;
  const ctx = app.ctx;
  const btn = r.hired
    ? el('button', {
      onclick: () => {
        if (!confirm(`${r.name}との契約をやめますか？（払った契約料は戻りません）`)) return;
        dismissRecruit(app.state, r.id);
        say(app, `${r.name}との契約をやめた`);
        app.save();
        update(app, true);
      },
    }, '解約する')
    : el('button', {
      disabled: !r.unlocked,
      onclick: () => {
        const res = hireRecruit(app.state, r.id, ctx);
        if (!res.ok) { say(app, res.reason, 'bad'); return; }
        say(app, `${r.name}と契約した！（1か月 ${fmt(r.monthlyCost)}G）`, 'good');
        app.save();
        update(app, true);
      },
    }, '契約する');
  if (!r.hired && r.unlocked) live.buttons.push({ btn, price: r.monthlyCost });
  let status = null;
  if (r.hired) status = el('small', { style: { color: 'var(--good)' } }, `契約中（次の支払い：${formatDate(r.paidUntil)}）`);
  else if (!r.unlocked) status = el('small', {}, `${r.unlock.genre}の熟練が Lv${r.unlock.level} になると契約できる`);
  else if (partyFull(s, ctx)) status = el('small', {}, 'パーティーがいっぱい（中ボスだった仲間を外すと契約できる）');
  return el('div', { class: 'item' + (r.unlocked ? '' : ' locked') },
    el('div', { class: 'name' }, r.name, el('small', {}, `${r.desc}　1か月 ${fmt(r.monthlyCost)}G`), status),
    btn);
}

export function guildPanel(app) {
  const s = app.state;
  const ctx = app.ctx;
  const monthSec = HOURS_PER_MONTH / ctx.balance.time.gameHoursPerRealSecond;
  const others = s.allies.filter((a) => !a.hired);
  const total = monthlyContractCost(s, ctx);
  return [
    el('div', { style: { marginBottom: '6px' } }, '所持金 ', live.gold, 'G'),
    note(`契約料はゲーム内の1か月ごとに払う（今の速さで現実の約${Math.round(monthSec)}秒ごと）。払えなくなると契約が切れる`),
    el('div', { class: 'list' }, recruitList(s, ctx).map((r) => contractRow(app, r))),
    total ? el('div', { style: { marginTop: '6px', fontSize: '14px' } }, `契約料の合計（会社の社員も含む）　1か月 ${fmt(total)}G`) : null,
    s.companies.length || canFound(s, ctx)
      ? note(`会社で働く専門職（会計士・営業・企画・事務員）は、${view === 'moon_comm' ? '下の「会社」' : '街の「会社」'}で会社ごとに雇う`)
      : null,
    others.length ? el('h3', { class: 'subhead' }, '中ボスだった仲間（契約料なし）') : null,
    others.length ? note(`パーティーに入れるか控えに回すかを、いつでも選べる。パーティーは契約した仲間と合わせて${partyMax(ctx)}人まで。控えの仲間は戦わず、冒険画面にも出ない`) : null,
    others.length ? note('街の施設に「顧問」として置くこともできる（1人1つの役目で、置いている間は戦わない。学校・研究室・会社・ロケット発射場に1人ずつ）') : null,
    others.length ? el('div', { style: { marginBottom: '6px' } }, 'パーティー ', el('b', {}, `${partyAllies(s).length}/${partyMax(ctx)}人`)) : null,
    others.length
      ? el('div', { class: 'list' }, others.map((a) => {
        const on = inParty(a);
        const full = !on && partyFull(s, ctx);
        const d = advisorDef(ctx, a.id);
        const place = d && ADVISOR_PLACES[d.place];
        const placeFull = d && !a.advisor && advisorsAt(s, ctx, d.place).length >= advisorSlots(ctx, d.place);
        let status;
        if (on) status = el('small', { style: { color: 'var(--good)' } }, 'パーティーにいる');
        else if (a.advisor) status = el('small', { style: { color: 'var(--good)' } }, `${place}の顧問（${d.role}）`);
        else status = el('small', { style: { color: 'var(--muted)' } }, full ? '控え（パーティーがいっぱい）' : '控え（戦わない）');
        const btns = [el('button', {
          class: on || full ? '' : 'primary',
          disabled: full,
          'aria-pressed': on ? 'true' : 'false',
          onclick: () => {
            const res = setInParty(app.state, a.id, !on, ctx);
            if (!res.ok) { say(app, res.reason, 'bad'); return; }
            say(app, on ? `${a.name}を控えに回した` : `${a.name}をパーティーに入れた`);
            app.save();
            update(app, true);
          },
        }, on ? '外す' : '入れる')];
        if (d && !d.soon) btns.push(advisorButton(app, a, d, placeFull));
        return el('div', { class: 'item' + (on ? '' : a.advisor ? ' on' : ' benched') },
          el('div', { class: 'name' }, a.name,
            el('small', {}, `攻撃 ${fmt(a.atk)}　HP ${fmt(a.maxHp)}`),
            status,
            d ? el('small', {}, `顧問にすると：${place}で${d.role}${d.soon ? `（${d.soon}）` : ''}`) : null),
          el('div', { class: 'btns' }, btns));
      }))
      : null,
  ];
}
