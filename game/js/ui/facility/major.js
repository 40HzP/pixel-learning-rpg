// 学校・研究室（専攻の付け替えと、学校・研究室の顧問。大学教授の予習）。月面の裏側の電波望遠鏡も同じ画面を使う（moon.js）。
// 2026-11-09 に ui/facility.js から分けた
import { advisorActive, nextBoss } from '../../sim.js';
import { fieldList, setMajor, MAJOR_SLOTS } from '../../fields.js';
import { el } from '../dom.js';
import { say, update, note } from './common.js';
import { advisorSection } from './advisor.js';

/**
 * 学校・研究室：専攻の付け替えと、学校・研究室の顧問。
 * 専攻の付け替え：解放した学際分野を主専攻・副専攻の2枠に入れる。効果が出るのは専攻に入れたものだけ。
 * 未解放の学際分野は名前を伏せ、片方のジャンルだけ見せる（隠しの学際分野は解放するまで出さない）。
 * 高校教師が学校の顧問なら、解放にいちばん近い未解放の学際分野の、もう片方のジャンルも見せる（進路指導）
 */
export function majorPanel(app, { telescope = false } = {}) {
  const s = app.state;
  const ctx = app.ctx;
  const need = ctx.balance.fields.unlockLevel;
  const guide = advisorActive(s, ctx, 'teacher_high');
  const list = fieldList(s, ctx, guide);
  const byId = Object.fromEntries(list.map((f) => [f.id, f]));
  const change = (slot, id, msg) => () => {
    const r = setMajor(app.state, slot, id, ctx);
    if (!r.ok) { say(app, r.reason, 'bad'); return; }
    say(app, msg, 'good');
    app.save();
    update(app, true);
  };
  const dormantText = (f) => `休眠中（${f.low.map((x) => `${x.genre} Lv${x.level}`).join('・')}。Lv${need}に戻すと復活する）`;
  const slots = MAJOR_SLOTS.map((label, i) => {
    const f = byId[s.knowledge.majors[i]];
    return el('div', { class: 'item field-slot' },
      el('div', { class: 'name' }, el('span', { class: 'muted' }, `${label}　`), f ? f.name : '—',
        el('small', {}, f ? f.desc : '下の一覧から選ぶ'),
        f && f.dormant ? el('small', { class: 'bad' }, dormantText(f)) : null),
      f ? el('button', { onclick: change(i, null, `${label}の${f.name}を外した`) }, '外す') : null);
  });
  const row = (f) => {
    if (!f.unlocked) {
      const o = f.hint.other;
      return el('div', { class: 'item field locked' + (o ? ' guided' : '') },
        el('div', { class: 'name' }, '？？？',
          el('small', {}, o ? `${f.hint.genre}＋${o.genre}（今 ${f.hint.genre} Lv${f.hint.level}・${o.genre} Lv${o.level}）` : `${f.hint.genre}＋？（今 ${f.hint.genre} Lv${f.hint.level}）`),
          o ? el('small', { class: 'good' }, `進路指導（高校教師）：あと少しで解放できる。どちらもLv${need}にしよう`) : null,
          el('small', {}, f.desc)));
    }
    const btns = [];
    if (f.group !== 'hidden') {
      if (f.slot >= 0) btns.push(el('button', { onclick: change(f.slot, null, `${MAJOR_SLOTS[f.slot]}の${f.name}を外した`) }, '外す'));
      else MAJOR_SLOTS.forEach((label, i) => btns.push(el('button', { class: i === 0 ? 'primary' : '', onclick: change(i, f.id, `${f.name}を${label}にした`) }, `${label}に`)));
    }
    let status = null;
    if (f.dormant) status = el('small', { class: 'bad' }, dormantText(f));
    else if (f.slot >= 0) status = el('small', { style: { color: 'var(--good)' } }, `${MAJOR_SLOTS[f.slot]}にしている（効果が出ている）`);
    return el('div', { class: 'item field' + (f.slot >= 0 ? ' on' : '') },
      el('div', { class: 'name' }, f.name, el('small', {}, `${f.genres.join('＋')}　称号「${f.title}」`), el('small', {}, f.desc), status),
      btns.length ? el('div', { class: 'btns' }, btns) : null);
  };
  const got = list.filter((f) => f.unlocked).length;
  // 大学教授が研究室の顧問なら、次に戦うボスの「当時の根拠」を先に教えてくれる（予習）。
  // 月面の裏側の電波望遠鏡では、大学教授がいなくても次の月面のボスを予習できる（設計ページ「月面の街」）
  const professor = advisorActive(s, ctx, 'professor');
  const boss = professor || telescope ? nextBoss(s, ctx) : null;
  return [
    boss ? el('div', { class: 'prep' },
      el('div', {}, el('b', {}, professor ? '予習（大学教授）' : '予習（裏側の電波望遠鏡）'), `：次に戦うボスは${boss.world === 'moon' ? '月面' : ''}${boss.floor}階層の${boss.name}（${boss.myth}）`),
      el('div', {}, `当時の根拠：${boss.whyBelieved}`),
      el('small', { class: 'muted' }, 'このボスと戦うときは、この根拠を書いた選択肢が誤答に混ざってくる')) : null,
    ...advisorSection(app, ['school', 'lab']),
    el('h3', { class: 'subhead' }, '専攻の付け替え'),
    note(`2つのジャンルの熟練がどちらもLv${need}以上になると、その組み合わせの学際分野が解放され、称号がもらえる。効果が出るのは主専攻・副専攻に入れた2つだけ（いつでも付け替えられる）。熟練がLv${need}より下がると休眠して止まり、戻すと復活する`),
    el('div', { class: 'list' }, slots),
    el('h3', { class: 'subhead' }, `学際分野（解放 ${got}／${list.length}）`),
    ...ctx.fields.groups.flatMap((g) => {
      const fs = list.filter((f) => f.group === g.id);
      return fs.length ? [el('div', { class: 'field-group muted' }, g.name), el('div', { class: 'list' }, fs.map(row))] : [];
    }),
  ];
}
