// 施設画面＝街。bg_town の上に施設の外観を並べ（並べる位置は data/town.json）、建物をタップするとその施設に入る。
// 入れる施設：店・仲間が集まる場所・寝床・会社。ロケット発射場・専攻の付け替え・拠点は準備中。
// 広場に立っている主人公をタップすると、主人公のステータスと名前の変更
import {
  shopList, buyItem, bedFloor, heroTitles, inParty, setInParty, partyAllies, partyMax, partyFull, formatDate, heroStats, renameHero, HERO_NAME_MAX, critChance, heroAttackInterval, expMultiplier,
  recruitList, hireRecruit, dismissRecruit, monthlyContractCost, HOURS_PER_MONTH,
  canFound, foundCompany, closeCompany, companiesProfit, industryList,
  hireStaff, dismissStaff, bestStaffGrade, staffCost, staffBonus,
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

/**
 * 条件を満たすまで「準備中」にする施設（id → まだなら解放の条件の文、もう入れるなら null）。
 * 会社：経営学の熟練レベルが1以上で解放（town.json の説明にも書く。もう会社があれば、あとで熟練が下がっても入れる）
 */
const LOCKS = {
  company: (app) => {
    const s = app.state;
    const u = app.ctx.business.unlock;
    if (s.companies.length || canFound(s, app.ctx)) return null;
    return `今の${u.genre}の熟練レベル：${genreLv(s, u.genre)}（勉強で${u.genre}の問題に正解すると上がる）`;
  },
};
const lockText = (app, id) => (LOCKS[id] ? LOCKS[id](app) : null);
const isSoon = (app, id) => !PANELS[id] || !!lockText(app, id);
const soonKey = (app) => app.town.facilities.filter((f) => isSoon(app, f.id)).map((f) => f.id).join(',');

function buildTown(app) {
  const t = app.town;
  const canvas = el('canvas', { class: 'pixel', width: TOWN_W, height: TOWN_H });
  const g = canvas.getContext('2d');
  g.imageSmoothingEnabled = false;
  const gold = el('span');
  const spots = t.facilities.map((f) => {
    const soon = isSoon(app, f.id);
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
  town = { box, canvas, g, scale: 0, gold, heroLabel, spots, soon: soonKey(app) };
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
const pct = (x) => `${Math.round(x * 100)}%`;
const genreLv = (s, g) => (s.knowledge.genres[g] || { level: 0 }).level;

/** 契約できる仲間の1行（契約する・解約する） */
function contractRow(app, r) {
  const s = app.state;
  const ctx = app.ctx;
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
      disabled: !r.unlocked,
      onclick: () => {
        const res = hireRecruit(app.state, r.id, ctx);
        if (!res.ok) { app.notify(res.reason, 'bad'); return; }
        app.notify(`${r.name}と契約した！（1か月 ${fmt(r.monthlyCost)}G）`, 'good');
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

function guildPanel(app) {
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
      ? note('会社で働く専門職（会計士・営業・企画・事務員）は、街の「会社」で会社ごとに雇う')
      : null,
    others.length ? el('h3', { class: 'subhead' }, '中ボスだった仲間（契約料なし）') : null,
    others.length ? note(`パーティーに入れるか控えに回すかを、いつでも選べる。パーティーは契約した仲間と合わせて${partyMax(ctx)}人まで。控えの仲間は戦わず、冒険画面にも出ない`) : null,
    others.length ? el('div', { style: { marginBottom: '6px' } }, 'パーティー ', el('b', {}, `${partyAllies(s).length}/${partyMax(ctx)}人`)) : null,
    others.length
      ? el('div', { class: 'list' }, others.map((a) => {
        const on = inParty(a);
        const full = !on && partyFull(s, ctx);
        return el('div', { class: 'item' + (on ? '' : ' benched') },
          el('div', { class: 'name' }, a.name,
            el('small', {}, `攻撃 ${fmt(a.atk)}　HP ${fmt(a.maxHp)}`),
            el('small', { style: { color: on ? 'var(--good)' : 'var(--muted)' } }, on ? 'パーティーにいる' : full ? '控え（パーティーがいっぱい）' : '控え（戦わない）')),
          el('button', {
            class: on || full ? '' : 'primary',
            disabled: full,
            'aria-pressed': on ? 'true' : 'false',
            onclick: () => {
              const res = setInParty(app.state, a.id, !on, ctx);
              if (!res.ok) { app.notify(res.reason, 'bad'); return; }
              app.notify(on ? `${a.name}を控えに回した` : `${a.name}をパーティーに入れた`);
              app.save();
              update(app, true);
            },
          }, on ? '外す' : '入れる'));
      }))
      : null,
  ];
}

/** 社員の質の名前 */
const gradeName = (ctx, i) => ctx.business.staffGrades[i].name;

/** 会社1つのカード：利益と内訳、社員4人の枠（雇う・より優秀な社員に替える・やめる）、たたむ */
function companyCard(app, p) {
  const s = app.state;
  const ctx = app.ctx;
  const c = p.company;
  const ind = p.industry;
  const best = bestStaffGrade(s, ctx);
  const act = (fn, msg) => () => {
    const res = fn();
    if (!res.ok) { app.notify(res.reason, 'bad'); return; }
    if (msg) app.notify(msg(res), 'good');
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
        el('small', { style: { color: 'var(--good)' } }, `利益 +${pct(staffBonus(ctx, ind, r.id, st.grade))}${special ? '（よく効く）' : ''}　1か月 ${fmt(staffCost(ctx, r.id, st.grade))}G`)];
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
        el('small', {}, `${r.desc}。雇うと利益 +${pct(staffBonus(ctx, ind, r.id, best))}${special ? '（よく効く）' : ''}`)];
      const b = el('button', { onclick: act(() => hireStaff(app.state, c.uid, r.id, ctx), () => `${ind.name}に${r.name}（${gradeName(ctx, best)}）を雇った`) },
        `雇う（${gradeName(ctx, best)}）`, el('small', {}, `1か月 ${fmt(staffCost(ctx, r.id, best))}G`));
      live.buttons.push({ btn: b, price: staffCost(ctx, r.id, best) });
      btns.push(b);
    }
    return el('div', { class: 'staff-row' }, el('div', { class: 'name' }, ...info), el('div', { class: 'btns' }, btns));
  });
  const genreText = ind.genres.map((g) => `${g} Lv${genreLv(s, g)}`).join('・');
  return el('div', { class: 'company' },
    el('div', { class: 'zname' }, ind.name, el('span', { class: 'muted' }, `（${formatDate(c.foundedAt)}に起業）`)),
    el('div', { class: 'profit' }, '1か月の利益 ', el('b', {}, `${fmt(p.total)}G`)),
    el('small', {}, `${ind.name}の利益 ${fmt(p.base)}G × 社員 +${pct(p.staffBonus)} × ジャンルの熟練 +${pct(p.genreBonus)}（${genreText}）`),
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
function companyPanel(app) {
  const s = app.state;
  const ctx = app.ctx;
  const biz = ctx.business;
  const all = companiesProfit(s, ctx);
  const lv = genreLv(s, biz.unlock.genre);
  const psych = genreLv(s, biz.staffGenre);
  const best = bestStaffGrade(s, ctx);
  const next = biz.staffGrades[best + 1];
  const cards = industryList(s, ctx).filter((i) => !i.founded).map((ind) => {
    const btn = el('button', {
      class: 'primary', disabled: !ind.unlocked,
      onclick: () => {
        if (!confirm(`${fmt(ind.cost)}G を払って${ind.name}を起業しますか？`)) return;
        const res = foundCompany(app.state, ind.id, ctx);
        if (!res.ok) { app.notify(res.reason, 'bad'); return; }
        app.notify(`${ind.name}を起業した！`, 'good');
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
      btn);
  });
  return [
    el('div', { style: { marginBottom: '6px' } }, '所持金 ', live.gold, 'G'),
    all.companies.length
      ? el('div', { class: 'profit' }, `会社 ${all.companies.length}社　1か月の利益 合計 `, el('b', {}, `${fmt(all.total)}G`))
      : null,
    note(`社員の質は${biz.staffGenre}の熟練で上がる。今は${biz.staffGenre} Lv${psych}なので「${gradeName(ctx, best)}」まで雇える${next ? `（Lv${next.psychLevel}で「${next.name}」）` : '（いちばん上）'}。優秀な社員ほど利益を増やすが、契約料も高い`),
    ...all.companies.map((p) => companyCard(app, p)),
    cards.length ? el('h3', { class: 'subhead' }, '起業する') : null,
    cards.length ? note(`会社はいくつでも持てる（同じ業種は1つまで）。${biz.unlock.genre}の熟練が上がると、利益の大きい業種が解放される（今 Lv${lv}）。利益は時間がたつと少しずつ所持金に入る`) : null,
    cards.length ? el('div', { class: 'list' }, cards) : null,
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
const PANELS = { shop: shopPanel, guild: guildPanel, home: homePanel, company: companyPanel };

function buildPanel(app) {
  const t = app.town;
  live = { gold: el('span'), hp: el('b'), mp: el('b'), bed: el('span'), buttons: [] };
  const f = t.facilities.find((x) => x.id === view);
  let title, sprite, body;
  if (view === 'hero') {
    title = app.state.hero.name;
    sprite = app.heroSprites.idle;
    body = heroPanel(app);
  } else if (f && PANELS[f.id] && !lockText(app, f.id)) {
    title = f.name;
    sprite = t.sprites[f.id];
    body = [note(f.desc || ''), ...PANELS[f.id](app)];
  } else {
    // 準備中（中身がまだ無い施設と、解放の条件を満たしていない施設）
    const lock = f ? lockText(app, f.id) : null;
    title = f ? f.name : '準備中';
    sprite = f ? t.sprites[f.id] : null;
    body = [el('div', { class: 'soon-box' }, el('b', {}, '準備中'), el('div', {}, f ? f.desc || '' : ''),
      lock ? el('div', { class: 'unlock' }, lock) : null)];
    if (lock && f.id === 'company') body.push(el('div', { class: 'muted', style: { fontSize: '14px', marginTop: '8px' } }, `解放されると選べる業種：${app.ctx.business.industries.map((x) => x.name).join('・')}`));
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
    if (force || key !== 'town' || !town || town.soon !== soonKey(app)) { key = 'town'; live = null; buildTown(app); }
    if (!town.scale) layoutTown();
    drawTown(app, performance.now() / 1000);
    town.gold.textContent = fmt(s.gold);
    town.heroLabel.textContent = s.hero.name;
    return;
  }
  town = null;
  const k = JSON.stringify([view, s.owned, s.equipment, s.knowledge.totalCorrect, s.hero.level, s.hero.name, s.allies.map((a) => [a.id, a.hired ? a.paidUntil : 0, !!a.benched]), s.lastSleep && s.lastSleep.at, heroTitles(s, app.ctx), JSON.stringify(s.companies), companiesProfit(s, app.ctx).total, canFound(s, app.ctx), bestStaffGrade(s, app.ctx), genreLv(s, '経営学')]);
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
