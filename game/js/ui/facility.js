// 施設画面：店・寝床・仲間（会社・ロケット発射場・専攻の付け替え・拠点は準備中）
import { shopList, buyItem, formatDate } from '../sim.js';
import { el, fmt } from './dom.js';

let root = null;
let key = '';
let live = null; // 毎回作り直さずに書き換える部分（所持金・買うボタン）

export function init() {
  root = document.getElementById('screen-facility');
  root.classList.add('pad');
}

export function reset() { key = ''; }

function itemStat(it) {
  const parts = [];
  if (it.atk) parts.push(`攻撃+${it.atk}`);
  if (it.def) parts.push(`防御+${it.def}`);
  return parts.join(' ');
}

function build(app) {
  const s = app.state;
  const ctx = app.ctx;
  const items = shopList(s, ctx);
  const byId = Object.fromEntries(ctx.items.map((i) => [i.id, i]));
  const eq = (slot) => (s.equipment[slot] ? `${byId[s.equipment[slot]].name}（${itemStat(byId[s.equipment[slot]])}）` : 'なし');
  live = { gold: el('span'), buttons: [] };

  const shop = items.map((it) => {
    if (!it.unlocked) {
      return el('div', { class: 'item locked' },
        el('div', { class: 'name' }, '？？？', el('small', {}, `勉強で正解 あと${it.unlockCorrect - s.knowledge.totalCorrect}回で入荷`)));
    }
    const btn = el('button', {
      disabled: it.owned,
      onclick: () => {
        const r = buyItem(app.state, it.id, ctx);
        if (!r.ok) { app.notify(r.reason, 'bad'); return; }
        app.notify(`${it.name}を買った${r.equipped ? '。装備した' : ''}`, 'good');
        app.save();
        update(app, true);
      },
    }, it.owned ? (it.equipped ? '装備中' : '持っている') : `${fmt(it.price)}G`);
    if (!it.owned) live.buttons.push({ btn, price: it.price });
    return el('div', { class: 'item' }, el('div', { class: 'name' }, it.name, el('small', {}, itemStat(it))), btn);
  });

  const ls = s.lastSleep;
  const sleepInfo = ls
    ? el('div', { class: 'muted', style: { fontSize: '14px', marginTop: '6px', whiteSpace: 'pre-line' } },
      `前回：${formatDate(ls.at)}（${ls.reason === 'defeated' ? 'やられて眠った' : '寝床で眠った'}）\n`
      + `上がった熟練：${ls.up.length ? ls.up.join('・') : 'なし'}\n下がった熟練：${ls.down.length ? ls.down.join('・') : 'なし'}`)
    : null;

  root.replaceChildren(
    el('div', { class: 'section' },
      el('h2', {}, '店'),
      el('div', { style: { marginBottom: '6px' } }, '所持金 ', live.gold, 'G'),
      el('div', { class: 'muted', style: { fontSize: '14px', marginBottom: '8px' } }, `武器：${eq('weapon')}　防具：${eq('armor')}`),
      el('div', { class: 'list' }, shop)),
    el('div', { class: 'section' },
      el('h2', {}, '寝床'),
      el('button', { class: 'primary', onclick: () => { app.sleepNow('bed'); update(app, true); } }, `眠る（${ctx.balance.sleep.gameHours}時間）`),
      sleepInfo),
    el('div', { class: 'section' },
      el('h2', {}, '仲間'),
      s.allies.length
        ? el('div', { class: 'list' }, s.allies.map((a) => el('div', { class: 'item' },
          el('div', { class: 'name' }, a.name, el('small', {}, `攻撃 ${a.atk}　HP ${Math.ceil(a.hp)}/${a.maxHp}`)))))
        : el('div', { class: 'muted' }, 'まだいない')),
    el('div', { class: 'section' },
      el('h2', {}, '準備中'),
      el('div', { class: 'soon' }, ['会社', 'ロケット発射場', '専攻の付け替え', '拠点'].map((n) => el('div', {}, `${n}（準備中）`)))),
  );
}

export function update(app, force) {
  const s = app.state;
  const k = JSON.stringify([s.owned, s.equipment, s.knowledge.totalCorrect, s.allies.map((a) => [a.id, Math.ceil(a.hp)]), s.lastSleep && s.lastSleep.at]);
  if (force || k !== key || !live) { key = k; build(app); }
  live.gold.textContent = fmt(s.gold);
  for (const b of live.buttons) b.btn.disabled = s.gold < b.price;
}
