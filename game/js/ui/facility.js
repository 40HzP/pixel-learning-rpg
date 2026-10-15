// 施設画面＝街。bg_town の上に施設の外観を並べ（並べる位置は data/town.json）、建物をタップするとその施設に入る。
// 入れる施設：店・仲間が集まる場所・寝床・会社・ロケット発射場・専攻の付け替え・拠点（構造工学を解放するまで準備中）。
// 広場に立っている主人公をタップすると、主人公のステータスと名前の変更
import {
  shopList, buyItem, bedFloor, heroTitles, inParty, setInParty, partyAllies, partyMax, partyFull, formatDate, heroStats, renameHero, HERO_NAME_MAX, critChance, evadeChance, expMultiplier,
  recruitList, hireRecruit, dismissRecruit, monthlyContractCost, HOURS_PER_MONTH, HOURS_PER_YEAR,
  canFound, foundCompany, closeCompany, companiesProfit, industryList, industryOutlook, generationMultiplier, ageYears, payRocketBuildCost, rocketSteps,
  hireStaff, dismissStaff, bestStaffGrade, staffCost, staffBonus, buildBase, baseActive,
} from '../sim.js';
import { fieldList, fieldById, fieldActive, isUnlocked, setMajor, MAJOR_SLOTS } from '../fields.js';
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
  // 拠点：構造工学（学際分野）を解放するまで準備中
  base: (app) => {
    const f = fieldById(app.ctx, STRUCTURAL);
    if (!f || isUnlocked(app.state, f.id)) return null;
    return `今の熟練レベル：${f.genres.map((g) => `${g} Lv${genreLv(app.state, g)}`).join('・')}（どちらもLv${app.ctx.balance.fields.unlockLevel}で${f.name}が解放される）`;
  },
};
const STRUCTURAL = 'structural_engineering';
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
    const off = !it.owned && it.price < it.listPrice ? el('small', { style: { color: 'var(--good)' } }, `値引き（定価 ${fmt(it.listPrice)}G）`) : null;
    return el('div', { class: 'item' }, el('div', { class: 'name' }, it.name, el('small', {}, itemStat(it)), off), btn);
  });
  const be = fieldById(ctx, 'behavioral_economics');
  return [
    el('div', { style: { marginBottom: '6px' } }, '所持金 ', live.gold, 'G'),
    note(`武器：${eq('weapon')}　防具：${eq('armor')}`),
    be && fieldActive(s, ctx, be.id) ? note(`${be.name}で値引き交渉ができる（${pct(ctx.balance.fields.shopDiscount)}引き）`) : null,
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
      outlookLine(ind),
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
    cards.length && econ ? note(`${econ.name}：起業できる業種ごとに、収益の期待値（社員を雇ったときの1か月の手取りと、元手を取り戻すまでの期間）を出している`) : null,
    cards.length ? el('div', { class: 'list' }, cards) : null,
  ];
}

/**
 * ロケット発射場：ロケット計画の工程（設計ページ「ロケット計画」）。建造費はゴールドで払い、
 * ほかの工程（機体設計・エンジン・軌道計算・打ち上げ許可）は、工程の学際分野を専攻にしている間に進む。
 * 工程は生まれ変わっても残る。ゴールドは生まれ変わると無くなるので、建造費は1つの人生のうちに貯める
 */
function rocketPanel(app) {
  const s = app.state;
  const ctx = app.ctx;
  const cost = app.ctx.balance.rocket.buildCost;
  const paid = s.legacy.rocket.buildCostPaid;
  const ratio = Math.min(1, s.gold / cost);
  const btn = el('button', {
    class: 'primary', disabled: paid,
    onclick: () => {
      if (!confirm(`${fmt(cost)}G を払ってロケットの建造費にしますか？`)) return;
      const res = payRocketBuildCost(app.state, app.ctx);
      if (!res.ok) { app.notify(res.reason, 'bad'); return; }
      app.notify('ロケットの建造費を払った！（生まれ変わっても残る）', 'good');
      app.save();
      update(app, true);
    },
  }, paid ? '払った' : `建造費を払う（${fmt(cost)}G）`);
  if (!paid) live.buttons.push({ btn, price: cost });
  const steps = rocketSteps(s, ctx);
  const rows = steps.map((st) => {
    const f = st.fieldDef;
    const bar = el('i');
    const text = el('small');
    live.rocket.push({ id: st.id, bar, text });
    let how;
    if (st.done) how = '';
    else if (st.active) how = '専攻にしているので進んでいる';
    else if (!isUnlocked(s, f.id)) how = `${f.name}を解放すると進められる`;
    else if (s.knowledge.majors.includes(f.id)) how = `${f.name}が休眠しているので止まっている`;
    else how = `${f.name}を専攻にすると進む（専攻の付け替え）`;
    return el('div', { class: 'item rocket-step' + (st.done ? '' : st.active ? '' : ' locked') },
      el('div', { class: 'name' }, st.name, el('small', {}, `${f.name}（${f.genres.join('＋')}）`),
        el('div', { class: 'timebar' }, bar), text, how ? el('small', { class: st.active ? 'good' : '' }, how) : null),
      el('span', { class: st.done ? 'good' : 'muted' }, st.done ? '済' : st.active ? '進行中' : '未'));
  });
  const allDone = paid && steps.every((st) => st.done);
  return [
    note('ロケットができると、月面の階層に行ける。工程は生まれ変わっても残る。ゴールドは生まれ変わると無くなるので、建造費は1つの人生のうちに貯めて払う'),
    el('h3', { class: 'subhead' }, '建造費'),
    el('div', { class: 'profit' }, '所持金 ', live.gold, `G ／ ${fmt(cost)}G`),
    el('div', { class: 'timebar' }, el('i', { style: { width: `${(paid ? 1 : ratio) * 100}%` } })),
    el('div', { class: 'btnrow' }, btn),
    el('h3', { class: 'subhead' }, '工程（学際分野を専攻にしている間に進む）'),
    note(`1つの工程に ゲーム内で${ctx.balance.rocket.stepYears}年かかる。専攻は2枠なので、同時に進むのは2つまで。工程ごとに専攻を付け替える`),
    el('div', { class: 'list' }, rows),
    el('h3', { class: 'subhead' }, '打ち上げ'),
    note(allDone ? '建造費とすべての工程が終わった！　打ち上げと月面の階層はこれから作る' : '建造費とすべての工程が終わると打ち上げられる（打ち上げと月面の階層はこれから作る）'),
  ];
}

/** 年数の表示（ロケットの工程） */
const years = (hours) => `${(hours / HOURS_PER_YEAR).toFixed(1)}年`;
/** 現実の時間の表示 */
const realSpan = (sec) => (sec >= 5400 ? `${(sec / 3600).toFixed(1)}時間` : sec >= 90 ? `${Math.round(sec / 60)}分` : `${Math.max(1, Math.round(sec))}秒`);

/**
 * 専攻の付け替え：解放した学際分野を主専攻・副専攻の2枠に入れる。効果が出るのは専攻に入れたものだけ。
 * 未解放の学際分野は名前を伏せ、片方のジャンルだけ見せる（隠しの学際分野は解放するまで出さない）
 */
function majorPanel(app) {
  const s = app.state;
  const ctx = app.ctx;
  const need = ctx.balance.fields.unlockLevel;
  const list = fieldList(s, ctx);
  const byId = Object.fromEntries(list.map((f) => [f.id, f]));
  const change = (slot, id, msg) => () => {
    const r = setMajor(app.state, slot, id, ctx);
    if (!r.ok) { app.notify(r.reason, 'bad'); return; }
    app.notify(msg, 'good');
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
      return el('div', { class: 'item field locked' },
        el('div', { class: 'name' }, '？？？', el('small', {}, `${f.hint.genre}＋？（今 ${f.hint.genre} Lv${f.hint.level}）`), el('small', {}, f.desc)));
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
  return [
    note(`2つのジャンルの熟練がどちらもLv${need}以上になると、その組み合わせの学際分野が解放され、称号がもらえる。効果が出るのは主専攻・副専攻に入れた2つだけ（いつでも付け替えられる）。熟練がLv${need}より下がると休眠して止まり、戻すと復活する`),
    el('div', { class: 'list' }, slots),
    el('h3', { class: 'subhead' }, `学際分野（解放 ${got}／${list.length}）`),
    ...ctx.fields.groups.flatMap((g) => {
      const fs = list.filter((f) => f.group === g.id);
      return fs.length ? [el('div', { class: 'field-group muted' }, g.name), el('div', { class: 'list' }, fs.map(row))] : [];
    }),
  ];
}

/** 拠点（構造工学）：今いる階層に拠点を建てる。拠点より深い階層でやられると、拠点の階層から再開する */
function basePanel(app) {
  const s = app.state;
  const ctx = app.ctx;
  const f = fieldById(ctx, STRUCTURAL);
  const on = fieldActive(s, ctx, f.id);
  const btn = el('button', {
    class: 'primary',
    onclick: () => {
      const r = buildBase(app.state, ctx);
      if (!r.ok) { app.notify(r.reason, 'bad'); return; }
      app.notify(`${r.floor}階層に拠点を建てた！`, 'good');
      app.save();
      update(app, true);
    },
  });
  live.base = { btn };
  const bf = s.adventure.baseFloor;
  return [
    el('div', { class: 'profit' }, '拠点 ', el('b', {}, bf ? `${bf}階層` : 'まだない'), bf && !baseActive(s, ctx) ? el('span', { class: 'bad' }, '（働いていない）') : null),
    on ? null : note(`${f.name}が専攻に入っていない（または休眠している）ので、拠点は建てられず、働かない。街の「専攻の付け替え」で主専攻か副専攻にする`),
    el('div', { class: 'btnrow' }, btn),
    note('拠点より深い階層でやられると、拠点の階層の最初から再開する（拠点の階層そのものでやられたときは1階層から）。建て直すと拠点は移る。生まれ変わると拠点は無くなる'),
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
      stat('HP', live.hp, baseActive(s, app.ctx) ? `0になるとやられて1階層（拠点より深い階層なら${s.adventure.baseFloor}階層）に戻る` : '0になるとやられて1階層に戻る'),
      stat('MP', live.mp, `敵が2体以上いると「${b.spell.name}」（MP${b.spell.mpCost}・敵全体）を使う`),
      stat('攻撃', hs.atk, `1体を叩く強さ（秒間${+(1 / b.hero.attackIntervalSec).toFixed(1)}回）`),
      stat('防御', hs.def, '受けるダメージが減る'),
      stat('賢さ', hs.wis, `「${b.spell.name}」の強さ。勉強で正解するほど上がる`),
      stat('すばやさ', hs.agi, `回避率 ${(evadeChance(hs, b) * 100).toFixed(1)}%（敵の攻撃をかわす。上限${Math.round(b.stats.evadeMax * 100)}%）`),
      stat('運の良さ', hs.luck, `会心の一撃 ${(critChance(hs, b) * 100).toFixed(1)}%・ゴールドが増える`),
      stat('経験値倍率', `×${expMultiplier(s, b).toFixed(2)}`, `勉強で正解するたびに +${Math.round((b.hero.expBonusPerCorrect || 0) * 100)}%`),
      // 称号は学際分野でたくさん増えるので、幅いっぱいに並べる
      titles.length ? el('div', { class: 'stat wide' }, el('span', {}, '称号'), el('b', {}, titles.join('・')), el('small', {}, '中ボスを倒したり、学際分野を解放したりするともらえる')) : null,
      stat('世代', `${s.life.generation}世代目`, `ステータスの伸び・経験値・ゴールド ×${generationMultiplier(s, b)}（生まれ変わるたびに ×${b.reincarnation.multiplier}）`),
      stat('寿命', `${b.life.lifespanYears}歳前後`, `今${ageYears(s)}歳。寿命が来ると、前世の記憶（熟練・図鑑・称号）を受け継いで生まれ変わる。Lv・ゴールド・装備・仲間・会社は最初から`)),
    s.legacy.lives.length
      ? note(`前世：${s.legacy.lives.slice(-3).reverse().map((p) => `${p.generation}世代目 ${p.name}（${p.age}歳・Lv${p.level}・最高${p.maxFloor}階層）`).join('　')}`)
      : null,
  ];
}

// 中に入れる施設（town.json の id → 中身）。ここに無い施設は「準備中」
const PANELS = { shop: shopPanel, guild: guildPanel, home: homePanel, company: companyPanel, rocket: rocketPanel, major: majorPanel, base: basePanel };

function buildPanel(app) {
  const t = app.town;
  live = { gold: el('span'), hp: el('b'), mp: el('b'), bed: el('span'), buttons: [], rocket: [], base: null };
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
  const k = JSON.stringify([view, s.owned, s.equipment, s.knowledge.totalCorrect, s.hero.level, s.hero.name, s.allies.map((a) => [a.id, a.hired ? a.paidUntil : 0, !!a.benched]), s.lastSleep && s.lastSleep.at, heroTitles(s, app.ctx), JSON.stringify(s.companies), companiesProfit(s, app.ctx).total, canFound(s, app.ctx), bestStaffGrade(s, app.ctx), genreLv(s, '経営学'), s.legacy.rocket.buildCostPaid, s.life.generation,
    // 学際分野（解放・休眠・専攻・熟練）と拠点・ロケットの工程（進み具合は作り直さずに書き換える）
    fieldList(s, app.ctx).map((f) => [f.unlocked, f.dormant, f.slot, f.levels]), s.adventure.baseFloor, rocketSteps(s, app.ctx).map((st) => [st.done, st.active])]);
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
  if (live.rocket.length) {
    const steps = Object.fromEntries(rocketSteps(s, app.ctx).map((st) => [st.id, st]));
    for (const r of live.rocket) {
      const st = steps[r.id];
      r.bar.style.width = `${(st.hours / st.need) * 100}%`;
      r.text.textContent = `${years(st.hours)}／${years(st.need)}`;
    }
  }
  if (live.base) {
    const on = fieldActive(s, app.ctx, STRUCTURAL);
    live.base.btn.textContent = s.adventure.baseFloor === now ? `${now}階層に拠点がある` : `今いる${now}階層に拠点を建てる`;
    live.base.btn.disabled = !on || s.adventure.baseFloor === now;
  }
}
