// 施設画面：店・寝床・仲間（会社・ロケット発射場・専攻の付け替え・拠点は準備中）
import { shopList, buyItem, formatDate, heroStats, renameHero, HERO_NAME_MAX, critChance, heroAttackInterval } from '../sim.js';
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

  const hs = heroStats(s, ctx);
  const nameInput = el('input', { type: 'text', value: s.hero.name, maxLength: HERO_NAME_MAX, autocomplete: 'off', 'aria-label': '主人公の名前' });
  const rename = () => {
    const name = renameHero(app.state, nameInput.value);
    app.save();
    app.notify(`名前を「${name}」にした`, 'good');
    update(app, true);
  };
  const b = ctx.balance;
  const stat = (label, value, note) => el('div', { class: 'stat' }, el('span', {}, label), el('b', {}, value), el('small', {}, note));
  live.hp = el('b');
  live.mp = el('b');

  root.replaceChildren(
    el('div', { class: 'section' },
      el('h2', {}, '主人公'),
      el('div', { class: 'rename' }, nameInput, el('button', { onclick: rename }, '名前を変える')),
      el('div', { class: 'stats' },
        el('div', { class: 'stat' }, el('span', {}, 'HP'), live.hp, el('small', {}, '0になるとやられて1階層に戻る')),
        el('div', { class: 'stat' }, el('span', {}, 'MP'), live.mp, el('small', {}, `敵が2体以上いると「${b.spell.name}」（MP${b.spell.mpCost}・敵全体）を使う`)),
        stat('攻撃', hs.atk, '1体を叩く強さ'),
        stat('防御', hs.def, '受けるダメージが減る'),
        stat('賢さ', hs.wis, `「${b.spell.name}」の強さ。勉強で正解するほど上がる`),
        stat('すばやさ', hs.agi, `攻撃の速さ（${heroAttackInterval(hs, b).toFixed(2)}秒に1回）`),
        stat('運の良さ', hs.luck, `会心の一撃 ${(critChance(hs, b) * 100).toFixed(1)}%・ゴールドが増える`))),
    el('div', { class: 'section' },
      el('h2', {}, '店'),
      el('div', { style: { marginBottom: '6px' } }, '所持金 ', live.gold, 'G'),
      el('div', { class: 'muted', style: { fontSize: '14px', marginBottom: '8px' } }, `武器：${eq('weapon')}　防具：${eq('armor')}`),
      el('div', { class: 'list' }, shop)),
    el('div', { class: 'section' },
      el('h2', {}, '寝床'),
      el('button', { class: 'primary', onclick: () => { app.sleepNow('bed'); update(app, true); } }, '眠る'),
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
    el('div', { class: 'version muted' }, `版：${app.version}`),
  );
}

export function update(app, force) {
  const s = app.state;
  const k = JSON.stringify([s.owned, s.equipment, s.knowledge.totalCorrect, s.hero.level, s.hero.name, s.allies.map((a) => [a.id, Math.ceil(a.hp)]), s.lastSleep && s.lastSleep.at]);
  // 名前を入力している途中は作り直さない（入力が消えないように）
  const typing = root.contains(document.activeElement) && document.activeElement.tagName === 'INPUT';
  if (force || ((k !== key || !live) && !typing)) { key = k; build(app); }
  const hs = heroStats(s, app.ctx);
  live.gold.textContent = fmt(s.gold);
  live.hp.textContent = `${Math.ceil(s.hero.hp)}/${hs.maxHp}`;
  live.mp.textContent = `${Math.floor(s.hero.mp)}/${hs.maxMp}`;
  for (const b of live.buttons) b.btn.disabled = s.gold < b.price;
}
