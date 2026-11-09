// 店（月面の補給所も同じ画面）。2026-11-09 に ui/facility.js から分けた
import { shopList, buyItem, equipItem, EQUIP_SLOTS, onMoon } from '../../sim.js';
import { fieldById, fieldActive } from '../../fields.js';
import { spriteCanvas } from '../../sprites.js';
import { el, fmt } from '../dom.js';
import { live, say, update, note, pct } from './common.js';

const STAT_LABEL = { atk: '攻撃', def: '防御', hp: 'HP', mp: 'MP', wis: '賢さ' };
const SLOT_LABEL = { weapon: '武器', armor: '防具', accessory: '装飾品' };
const SLOT_NOTE = {
  weapon: '攻撃が上がる',
  armor: '防御が上がる',
  accessory: '1つだけ付けられる。HP・MP・賢さ（ひらめき）が上がる',
};

// 月面だけの品の割合の効き目（items.json の effects）
const EFFECT_LABEL = { damageCut: (v) => `受けるダメージ−${pct(v)}`, atkRate: (v) => `攻撃+${pct(v)}`, hpRate: (v) => `HP+${pct(v)}` };

function itemStat(it) {
  return [
    ...Object.keys(STAT_LABEL).filter((k) => it[k]).map((k) => `${STAT_LABEL[k]}+${it[k]}`),
    ...Object.entries(it.effects || {}).map(([k, v]) => (EFFECT_LABEL[k] ? EFFECT_LABEL[k](v) : k)),
  ].join(' ');
}
/** 重さ（月面の補給所の輸送費になる） */
const kg = (w) => (w >= 1 ? `${+w.toFixed(1)}kg` : `${Math.round(w * 1000)}g`);

/**
 * 店：装備を買う。武器・防具・装飾品の枠ごとに並べる。
 * まだ入荷していない品は、枠ごとに次の1品だけ影絵で見せる。持っている品は「装備する」で付け替えられる。
 * 月面の補給所も同じ画面：値段を「本体＋輸送費」に分けて見せ、月面だけの品（割合で効く）も並ぶ
 */
export function shopPanel(app) {
  const s = app.state;
  const ctx = app.ctx;
  const byId = Object.fromEntries(ctx.items.map((i) => [i.id, i]));
  const icon = (it, silhouette = false) => spriteCanvas(app.itemSprites[it.id] || null, 2, app.palette, { silhouette });
  const row = (it) => {
    if (!it.unlocked) {
      return el('div', { class: 'item locked' }, icon(it, true),
        el('div', { class: 'name' }, '？？？', el('small', {}, `勉強で正解 あと${it.unlockCorrect - s.knowledge.totalCorrect}回で入荷`)));
    }
    let btn;
    if (it.equipped) btn = el('button', { disabled: true }, '装備中');
    else if (it.owned) {
      btn = el('button', {
        onclick: () => {
          const r = equipItem(app.state, it.id, ctx);
          if (!r.ok) { say(app, r.reason, 'bad'); return; }
          say(app, `${it.name}を装備した`, 'good');
          app.save();
          update(app, true);
        },
      }, '装備する');
    } else {
      btn = el('button', {
        onclick: () => {
          const r = buyItem(app.state, it.id, ctx);
          if (!r.ok) { say(app, r.reason, 'bad'); return; }
          say(app, `${it.name}を買った${r.equipped ? '。装備した' : '（「装備する」で付け替えられる）'}`, 'good');
          app.save();
          update(app, true);
        },
      }, `${fmt(it.price)}G`);
      live.buttons.push({ btn, price: it.price });
    }
    const off = !it.owned && it.body < it.listPrice ? el('small', { style: { color: 'var(--good)' } }, `値引き（本体の定価 ${fmt(it.listPrice)}G）`) : null;
    const fare = !it.owned && it.transport ? el('small', {}, `本体 ${fmt(it.body)}G＋輸送費 ${fmt(it.transport)}G（${kg(it.weight)}）`) : null;
    return el('div', { class: 'item' + (it.equipped ? ' on' : '') }, icon(it),
      el('div', { class: 'name' }, it.name, it.moon ? el('span', { class: 'moon-tag' }, '月面だけ') : null, el('small', {}, itemStat(it)), fare, off), btn);
  };
  const list = shopList(s, ctx);
  const sections = EQUIP_SLOTS.map((slot) => {
    const inSlot = list.filter((it) => it.slot === slot);
    const shown = inSlot.filter((it) => it.unlocked);
    const next = inSlot.find((it) => !it.unlocked);
    const cur = byId[s.equipment[slot]];
    return [
      el('h3', { class: 'subhead shop-slot' }, SLOT_LABEL[slot], el('small', {}, cur ? `装備中：${cur.name}` : '装備中：なし')),
      note(SLOT_NOTE[slot]),
      el('div', { class: 'list' }, [...shown, ...(next ? [next] : [])].map(row)),
    ];
  });
  const be = fieldById(ctx, 'behavioral_economics');
  const moon = onMoon(s);
  return [
    el('div', { style: { marginBottom: '6px' } }, '所持金 ', live.gold, 'G'),
    note('買うと、今の装備より強ければ自動で付ける。持っている品は「装備する」で付け替えられる'),
    moon ? note(`輸送費は品物の重さで決まる（1kgあたり ${fmt(ctx.balance.moon.transportPerKg)}G）。月面だけの品は割合で効くので、地球のどの品より強いとみなして付け替える。買った品は地球に持ち帰れる`) : null,
    be && fieldActive(s, ctx, be.id) ? note(`${be.name}で値引き交渉ができる（${pct(ctx.balance.fields.shopDiscount)}引き${moon ? '。値引きは本体だけ（重さは値切れない）' : ''}）`) : null,
    ...sections.flat(),
  ];
}
