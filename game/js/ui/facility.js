// 施設画面＝街。bg_town の上に施設の外観を並べ（並べる位置は data/town.json）、建物をタップするとその施設に入る。
// 入れる施設：店・仲間が集まる場所・寝床。会社・ロケット発射場・専攻の付け替え・拠点は準備中。
// 広場に立っている主人公をタップすると、主人公のステータスと名前の変更
import {
  shopList, buyItem, bedFloor, heroTitles, inParty, setInParty, formatDate, heroStats, renameHero, HERO_NAME_MAX, critChance, heroAttackInterval, expMultiplier,
  recruitList, hireRecruit, dismissRecruit, monthlyContractCost, HOURS_PER_MONTH,
} from '../sim.js';
import { drawSprite, drawPlaceholder, frameAt, spriteCanvas, cssColor } from '../sprites.js';
import { el, fmt } from './dom.js';

const TOWN_W = 90;
const TOWN_H = 160;

let root = null;
let view = 'town'; // 'town'（街）か、入っている施設の id（主人公は 'hero'）
let key = '';
let live = null;   // 毎回作り直さずに書き換える部分（所持金・HP・買うボタンなど）
let town = null;   // 街の部品 { box, canvas, g, scale, gold, heroLabel, spots }

export function init(app) {
  root = document.getElementById('screen-facility');
  window.addEventListener('resize', () => { if (view === 'town' && town && !root.hidden) layoutTown(); });
}

export function reset() { key = ''; view = 'town'; }

/** 施設の中に入っているか（知らせを下に出すため） */
export const insideFacility = () => view !== 'town';

function enter(app, id) {
  view = id;
  key = '';
  root.scrollTop = 0;
  update(app, true);
  app.placeNotices();
}

/* ================= 街 ================= */

function buildTown(app) {
  const t = app.town;
  const canvas = el('canvas', { class: 'pixel', width: TOWN_W, height: TOWN_H });
  const g = canvas.getContext('2d');
  g.imageSmoothingEnabled = false;
  const gold = el('span');
  const spots = t.facilities.map((f) => {
    const soon = !PANELS[f.id];
    const btn = el('button', {
      class: 'spot' + (soon ? ' soon' : ''),
      'aria-label': f.name + (soon ? '（準備中）' : ''),
      onclick: () => enter(app, f.id),
    }, el('span', { class: 'label' }, f.name, soon ? el('small', {}, '準備中') : null));
    const sp = t.sprites[f.id];
    return { btn, x: f.x, y: f.y, w: sp ? sp.w : 32, h: sp ? sp.h : 32 };
  });
  const heroLabel = el('span', { class: 'label' });
  const heroSprite = app.heroSprites.idle;
  spots.push({
    btn: el('button', { class: 'spot hero', 'aria-label': '主人公のステータス', onclick: () => enter(app, 'hero') }, heroLabel),
    x: t.hero.x, y: t.hero.y, w: heroSprite ? heroSprite.w : 16, h: heroSprite ? heroSprite.h : 16,
  });
  const box = el('div', { class: 'town' },
    canvas,
    el('div', { class: 'town-bar' }, el('span', {}, '所持金 ', gold, 'G'), el('span', { class: 'muted' }, `版：${app.version}`)),
    spots.map((s) => s.btn));
  root.className = 'screen town-screen';
  root.replaceChildren(box);
  town = { box, canvas, g, scale: 0, gold, heroLabel, spots };
  layoutTown();
}

/** 街を画面に収まる整数倍で表示し、建物の上にタップできるボタンを重ねる */
function layoutTown() {
  if (!town) return;
  const w = root.clientWidth - 8, h = root.clientHeight - 8;
  if (w <= 0 || h <= 0) return;
  const s = Math.max(1, Math.floor(Math.min(w / TOWN_W, h / TOWN_H)));
  town.scale = s;
  town.box.style.width = TOWN_W * s + 'px';
  town.box.style.height = TOWN_H * s + 'px';
  town.box.style.setProperty('--s', s);
  town.box.classList.toggle('small', s < 4);
  for (const p of town.spots) {
    Object.assign(p.btn.style, { left: p.x * s + 'px', top: p.y * s + 'px', width: p.w * s + 'px', height: p.h * s + 'px' });
  }
}

function drawTown(app, now) {
  const t = app.town;
  const g = town.g;
  g.clearRect(0, 0, TOWN_W, TOWN_H);
  if (t.bg) drawSprite(g, t.bg, 0, 0, 0);
  else { g.fillStyle = cssColor(app.palette, 'j', '#6fb042'); g.fillRect(0, 0, TOWN_W, TOWN_H); }
  for (const f of t.facilities) {
    const sp = t.sprites[f.id];
    if (sp) drawSprite(g, sp, frameAt(sp, now), f.x, f.y);
    else drawPlaceholder(g, f.x, f.y, 32, 32, app.palette);
  }
  const hero = app.heroSprites.idle;
  if (hero) drawSprite(g, hero, frameAt(hero, now), t.hero.x, t.hero.y);
  else drawPlaceholder(g, t.hero.x, t.hero.y, 16, 16, app.palette);
}

/* ================= 施設の中 ================= */

function itemStat(it) {
  const parts = [];
  if (it.atk) parts.push(`攻撃+${it.atk}`);
  if (it.def) parts.push(`防御+${it.def}`);
  return parts.join(' ');
}

const note = (text) => el('div', { class: 'muted', style: { fontSize: '14px', marginBottom: '8px' } }, text);

/** 店：装備を買う */
function shopPanel(app) {
  const s = app.state;
  const ctx = app.ctx;
  const byId = Object.fromEntries(ctx.items.map((i) => [i.id, i]));
  const eq = (slot) => (s.equipment[slot] ? `${byId[s.equipment[slot]].name}（${itemStat(byId[s.equipment[slot]])}）` : 'なし');
  const rows = shopList(s, ctx).map((it) => {
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
  return [
    el('div', { style: { marginBottom: '6px' } }, '所持金 ', live.gold, 'G'),
    note(`武器：${eq('weapon')}　防具：${eq('armor')}`),
    el('div', { class: 'list' }, rows),
  ];
}

/** 寝床（テント）：眠ると1つ手前の階層に戻って全回復する */
function homePanel(app) {
  const ls = app.state.lastSleep;
  return [
    el('div', { style: { marginBottom: '8px' } }, 'HP ', live.hp, '　MP ', live.mp),
    el('div', { style: { marginBottom: '8px' } }, live.bed),
    el('button', { class: 'primary', onclick: () => { app.sleepNow(); update(app, true); } }, '眠る'),
    ls
      ? el('div', { class: 'muted', style: { fontSize: '14px', marginTop: '8px', whiteSpace: 'pre-line' } },
        `前回：${formatDate(ls.at)}（${ls.reason === 'defeated' ? 'やられて眠った' : 'テントで眠った'}）\n`
        + `上がった熟練：${ls.up.length ? ls.up.join('・') : 'なし'}\n下がった熟練：${ls.down.length ? ls.down.join('・') : 'なし'}`)
      : null,
  ];
}

/** 仲間が集まる場所：ゲーム内の1か月ごとに契約料を払って仲間にする */
function guildPanel(app) {
  const s = app.state;
  const ctx = app.ctx;
  const monthSec = HOURS_PER_MONTH / ctx.balance.time.gameHoursPerRealSecond;
  const rows = recruitList(s, ctx).map((r) => {
    const btn = r.hired
      ? el('button', {
        onclick: () => {
          if (!confirm(`${r.name}との契約をやめますか？（払った契約料は戻りません）`)) return;
          dismissRecruit(app.state, r.id);
          app.notify(`${r.name}との契約をやめた`);
          app.save();
          update(app, true);
        },
      }, '解約する')
      : el('button', {
        onclick: () => {
          const res = hireRecruit(app.state, r.id, ctx);
          if (!res.ok) { app.notify(res.reason, 'bad'); return; }
          app.notify(`${r.name}と契約した！（1か月 ${fmt(r.monthlyCost)}G）`, 'good');
          app.save();
          update(app, true);
        },
      }, '契約する');
    if (!r.hired) live.buttons.push({ btn, price: r.monthlyCost });
    return el('div', { class: 'item' },
      el('div', { class: 'name' }, r.name,
        el('small', {}, `${r.desc}　1か月 ${fmt(r.monthlyCost)}G`),
        r.hired ? el('small', { style: { color: 'var(--good)' } }, `契約中（次の支払い：${formatDate(r.paidUntil)}）`) : null),
      btn);
  });
  const others = s.allies.filter((a) => !a.hired);
  const total = monthlyContractCost(s, ctx);
  return [
    el('div', { style: { marginBottom: '6px' } }, '所持金 ', live.gold, 'G'),
    note(`契約料はゲーム内の1か月ごとに払う（今の速さで現実の約${Math.round(monthSec)}秒ごと）。払えなくなると契約が切れる`),
    el('div', { class: 'list' }, rows),
    total ? el('div', { style: { marginTop: '6px', fontSize: '14px' } }, `契約料の合計　1か月 ${fmt(total)}G`) : null,
    others.length ? el('h3', { class: 'subhead' }, '中ボスだった仲間（契約料なし）') : null,
    others.length ? note('パーティーに入れるか控えに回すかを、いつでも選べる。控えの仲間は戦わず、冒険画面にも出ない') : null,
    others.length
      ? el('div', { class: 'list' }, others.map((a) => {
        const on = inParty(a);
        return el('div', { class: 'item' + (on ? '' : ' benched') },
          el('div', { class: 'name' }, a.name,
            el('small', {}, `攻撃 ${fmt(a.atk)}　HP ${fmt(a.maxHp)}`),
            el('small', { style: { color: on ? 'var(--good)' : 'var(--muted)' } }, on ? 'パーティーにいる' : '控え（戦わない）')),
          el('button', {
            class: on ? '' : 'primary',
            'aria-pressed': on ? 'true' : 'false',
            onclick: () => {
              setInParty(app.state, a.id, !on);
              app.notify(on ? `${a.name}を控えに回した` : `${a.name}をパーティーに入れた`);
              app.save();
              update(app, true);
            },
          }, on ? '外す' : '入れる'));
      }))
      : null,
  ];
}

/** 主人公：名前とステータス */
function heroPanel(app) {
  const s = app.state;
  const b = app.ctx.balance;
  const hs = heroStats(s, app.ctx);
  const titles = heroTitles(s, app.ctx);
  const nameInput = el('input', { type: 'text', value: s.hero.name, maxLength: HERO_NAME_MAX, autocomplete: 'off', 'aria-label': '主人公の名前' });
  const rename = () => {
    const name = renameHero(app.state, nameInput.value);
    app.save();
    app.notify(`名前を「${name}」にした`, 'good');
    update(app, true);
  };
  const stat = (label, value, text) => el('div', { class: 'stat' }, el('span', {}, label), value instanceof Node ? value : el('b', {}, value), el('small', {}, text));
  return [
    el('div', { class: 'rename' }, nameInput, el('button', { onclick: rename }, '名前を変える')),
    el('div', { class: 'stats' },
      stat('HP', live.hp, '0になるとやられて1階層に戻る'),
      stat('MP', live.mp, `敵が2体以上いると「${b.spell.name}」（MP${b.spell.mpCost}・敵全体）を使う`),
      stat('攻撃', hs.atk, '1体を叩く強さ'),
      stat('防御', hs.def, '受けるダメージが減る'),
      stat('賢さ', hs.wis, `「${b.spell.name}」の強さ。勉強で正解するほど上がる`),
      stat('すばやさ', hs.agi, `攻撃の速さ（${heroAttackInterval(hs, b).toFixed(2)}秒に1回）`),
      stat('運の良さ', hs.luck, `会心の一撃 ${(critChance(hs, b) * 100).toFixed(1)}%・ゴールドが増える`),
      stat('経験値倍率', `×${expMultiplier(s, b).toFixed(2)}`, `勉強で正解するたびに +${Math.round((b.hero.expBonusPerCorrect || 0) * 100)}%`),
      titles.length ? stat('称号', titles.join('・'), '中ボスを倒してもらった') : null),
  ];
}

// 中に入れる施設（town.json の id → 中身）。ここに無い施設は「準備中」
const PANELS = { shop: shopPanel, guild: guildPanel, home: homePanel };

function buildPanel(app) {
  const t = app.town;
  live = { gold: el('span'), hp: el('b'), mp: el('b'), bed: el('span'), buttons: [] };
  const f = t.facilities.find((x) => x.id === view);
  let title, sprite, body;
  if (view === 'hero') {
    title = app.state.hero.name;
    sprite = app.heroSprites.idle;
    body = heroPanel(app);
  } else if (f && PANELS[f.id]) {
    title = f.name;
    sprite = t.sprites[f.id];
    body = [note(f.desc || ''), ...PANELS[f.id](app)];
  } else {
    title = f ? f.name : '準備中';
    sprite = f ? t.sprites[f.id] : null;
    body = [el('div', { class: 'soon-box' }, el('b', {}, '準備中'), el('div', {}, f ? f.desc || '' : ''))];
  }
  root.className = 'screen pad';
  root.replaceChildren(
    el('div', { class: 'fhead' },
      el('button', { class: 'back', onclick: () => enter(app, 'town') }, '← 街へ'),
      spriteCanvas(sprite, sprite && sprite.w > 16 ? 2 : 3, app.palette),
      el('h2', {}, title)),
    el('div', { class: 'section' }, body),
  );
}

/* ================= 毎回の更新 ================= */

export function update(app, force) {
  const s = app.state;
  if (view === 'town') {
    if (force || key !== 'town' || !town) { key = 'town'; live = null; buildTown(app); }
    if (!town.scale) layoutTown();
    drawTown(app, performance.now() / 1000);
    town.gold.textContent = fmt(s.gold);
    town.heroLabel.textContent = s.hero.name;
    return;
  }
  town = null;
  const k = JSON.stringify([view, s.owned, s.equipment, s.knowledge.totalCorrect, s.hero.level, s.hero.name, s.allies.map((a) => [a.id, a.hired ? a.paidUntil : 0, !!a.benched]), s.lastSleep && s.lastSleep.at, heroTitles(s, app.ctx)]);
  // 名前を入力している途中は作り直さない（入力が消えないように）
  const typing = root.contains(document.activeElement) && document.activeElement.tagName === 'INPUT';
  if (force || ((k !== key || !live) && !typing)) { key = k; buildPanel(app); }
  const hs = heroStats(s, app.ctx);
  live.gold.textContent = fmt(s.gold);
  live.hp.textContent = `${Math.ceil(s.hero.hp)}/${hs.maxHp}`;
  live.mp.textContent = `${Math.floor(s.hero.mp)}/${hs.maxMp}`;
  for (const b of live.buttons) b.btn.disabled = s.gold < b.price;
  const now = s.adventure.floor, back = bedFloor(s);
  live.bed.textContent = now > back ? `今は${now}階層。眠ると${back}階層に戻る` : '今は1階層。眠ると1階層の最初から';
}
