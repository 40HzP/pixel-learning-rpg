// 施設画面＝街。bg_town の上に施設の外観を並べ（並べる位置は data/town.json）、建物をタップするとその施設に入る。
// 入れる施設：店・仲間が集まる場所・図書館（熟練の記録）・会社・ロケット発射場（と試作機）・学校・研究室（専攻の付け替えと顧問）・病院・飼育小屋。
// 寝床と拠点は2026-11-07にやめた（設計ページ「誕生日の熟練判定と階層の移動」）。寝床の跡は図書館、拠点の跡は飼育小屋（なついたザコが歩き回る）。
// 仲間にした中ボスは、学校・研究室・会社・ロケット発射場に顧問として置ける（facility/advisor.js の advisorSection）。
// 月面にいる間は、地球の街の代わりに月面の街（town.json の moon）が出る。月面の街でも地球の街と同じことができる
// （設計ページ「月面の街」の①）：通信基地＝仲間が集まる場所と会社、裏側の電波望遠鏡＝学校・研究室、
// 補給所＝店（本体＋輸送費）、月面の書庫＝図書館、医務室＝病院、帰還ロケット、掲示板。中身は地球の画面を使い回し、月の一言（note）を付ける。
// 前線基地の跡は月面の飼育ドーム（月面のザコ）。飼育小屋のザコは、ロケット発射場で試作機に乗せて飛ばせる（設計ページ「飼育小屋と試作機」）。
// 小さな広場に立っている主人公をタップすると、主人公のステータスと名前の変更
//
// このファイルは街（建物を並べる・タップで入る）と、施設の中の枠（見出し・「← 街へ」・毎回の更新）だけ。
// 施設ごとの中身は ui/facility/ に分けている（2026-11-09）：
//   common.js（共通：今の画面・知らせ・解放の条件）・shop.js（店）・guild.js（仲間が集まる場所）・library.js（図書館）・
//   company.js（会社）・rocket.js（ロケット発射場と試作機）・major.js（学校・研究室）・hospital.js（病院）・hero.js（主人公）・
//   barn.js（飼育小屋）・moon.js（月面の街だけの施設）・advisor.js（顧問の欄）
import {
  heroTitles, heroStats, HOURS_PER_YEAR, canFound, companiesProfit, ageYears, rocketSteps, bestStaffGrade,
  lifespanOf, onMoon, nextBoss, corporateTax,
} from '../sim.js';
import { fieldList } from '../fields.js';
import { drawSprite, drawPlaceholder, frameAt, spriteCanvas, cssColor } from '../sprites.js';
import { el, fmt } from './dom.js';
import { root, view, live, setRoot, setView, setLive, setUpdater, note, genreLv, lockText } from './facility/common.js';
import { shopPanel } from './facility/shop.js';
import { guildPanel } from './facility/guild.js';
import { libraryPanel } from './facility/library.js';
import { companyPanel } from './facility/company.js';
import { rocketPanel } from './facility/rocket.js';
import { majorPanel } from './facility/major.js';
import { hospitalPanel } from './facility/hospital.js';
import { heroPanel } from './facility/hero.js';
import { barnPanel } from './facility/barn.js';
import { moonRocketPanel, commPanel, telescopePanel } from './facility/moon.js';

const TOWN_W = 90;
const TOWN_H = 160;

// 今の画面（root）・入っている施設（view：'town'（街）か施設の id。主人公は 'hero'）・書き換える部分（live）は
// 施設の中身のファイルからも見るので facility/common.js に置く
let key = '';
let town = null;   // 街の部品 { box, canvas, g, scale, gold, heroLabel, spots }

export function init(app) {
  setRoot(document.getElementById('screen-facility'));
  setUpdater(update);
  window.addEventListener('resize', () => { if (view === 'town' && town && !root.hidden) layoutTown(); });
}

export function reset() { key = ''; setView('town'); }

/** 施設の中に入っているか（知らせを下に出すため） */
export const insideFacility = () => view !== 'town';

/** 街に戻る（施設の中の「← 街へ」と同じ。街を開いているときに下のバーの「街」をもう一度押したとき。40HzP の依頼） */
export function backToTown(app) {
  if (view !== 'town') enter(app, 'town');
}

/** 今いる世界の街（月面にいる間は月面の街） */
const activeTown = (app) => (onMoon(app.state) ? app.moonTown : app.town);

function enter(app, id) {
  setView(id);
  key = '';
  root.scrollTop = 0;
  update(app, true);
  app.placeNotices();
}

/* ================= 街 ================= */

// 条件を満たすまで「準備中」にする施設は facility/common.js の lockText
const isSoon = (app, id) => !PANELS[id] || !!lockText(app, id);
// 街を作り直す目印：どちらの世界の街か＋準備中の施設
const soonKey = (app) => `${app.state.adventure.world}:` + activeTown(app).facilities.filter((f) => isSoon(app, f.id)).map((f) => f.id).join(',');

function buildTown(app) {
  const t = activeTown(app);
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
  // 今日の1問の掲示板（地球の街と月面の街に同じもの）。札を開いて閉じると、今日の1問がここに残る（40HzP の依頼）
  if (t.board) {
    const sp = t.sprites.board;
    spots.push({
      btn: el('button', { class: 'spot board', 'aria-label': `${t.board.name}（今日の1問）`, onclick: () => app.openDaily() }, el('span', { class: 'label' }, t.board.name)),
      x: t.board.x, y: t.board.y, w: sp ? sp.w : 16, h: sp ? sp.h : 16,
    });
  }
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
  const t = activeTown(app);
  const g = town.g;
  g.clearRect(0, 0, TOWN_W, TOWN_H);
  if (t.bg) drawSprite(g, t.bg, 0, 0, 0);
  else { g.fillStyle = cssColor(app.palette, 'j', '#6fb042'); g.fillRect(0, 0, TOWN_W, TOWN_H); }
  for (const f of t.facilities) {
    const sp = t.sprites[f.id];
    if (sp) drawSprite(g, sp, frameAt(sp, now), f.x, f.y);
    else drawPlaceholder(g, f.x, f.y, 32, 32, app.palette);
  }
  // 掲示板の絵は今日の1問の様子で変える（1枚目：何も貼っていない・2枚目：今日の1問が貼ってある・3枚目：答えた印）
  const board = t.board && t.sprites.board;
  if (board) {
    const d = app.state.legacy.daily;
    const frame = d.result ? 2 : d.opened ? 1 : 0;
    drawSprite(g, board, Math.min(frame, board.frames.length - 1), t.board.x, t.board.y);
  }
  const hero = app.heroSprites.idle;
  if (hero) drawSprite(g, hero, frameAt(hero, now), t.hero.x, t.hero.y);
  else drawPlaceholder(g, t.hero.x, t.hero.y, 16, 16, app.palette);
}

/* ================= 施設の中 ================= */

/** 年数の表示（ロケットの工程） */
const years = (hours) => `${(hours / HOURS_PER_YEAR).toFixed(1)}年`;

// 中に入れる施設（town.json の id → 中身）。ここに無い施設は「準備中」
const PANELS = {
  shop: shopPanel, guild: guildPanel, library: libraryPanel, company: companyPanel, rocket: rocketPanel, major: majorPanel, hospital: hospitalPanel,
  // 月面の街（地球の施設と同じ中身。town.json の moon の earth に、代わりになる地球の施設を書いている）
  moon_rocket: moonRocketPanel, moon_archive: libraryPanel, moon_comm: commPanel, moon_telescope: telescopePanel,
  moon_supply: shopPanel, moon_clinic: hospitalPanel,
  barn: barnPanel, moon_barn: barnPanel,
};
// 月の一言（town.json の note）
const moonNote = (f) => (f && f.note ? el('div', { class: 'moon-note' }, el('b', {}, '月のこと'), f.note) : null);

function buildPanel(app) {
  const t = activeTown(app);
  setLive({ gold: el('span'), hp: el('b'), mp: el('b'), buttons: [], rocket: [], exam: null, tax: null });
  const f = t.facilities.find((x) => x.id === view);
  let title, sprite, body;
  if (view === 'hero') {
    title = app.state.hero.name;
    sprite = app.heroSprites.idle;
    body = heroPanel(app);
  } else if (f && PANELS[f.id] && !lockText(app, f.id)) {
    title = f.name;
    sprite = t.sprites[f.id];
    body = [note(f.desc || ''), moonNote(f), ...PANELS[f.id](app)];
  } else {
    // 準備中（中身がまだ無い施設と、解放の条件を満たしていない施設）
    const lock = f ? lockText(app, f.id) : null;
    title = f ? f.name : '準備中';
    sprite = f ? t.sprites[f.id] : null;
    body = [el('div', { class: 'soon-box' }, el('b', {}, '準備中'), el('div', {}, f ? f.desc || '' : ''),
      lock ? el('div', { class: 'unlock' }, lock) : null), moonNote(f)];
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
  // 打ち上げ・帰還で世界が変わったら、もう片方の世界の施設からは街に出る
  if (view !== 'town' && view !== 'hero' && !activeTown(app).facilities.some((f) => f.id === view)) { setView('town'); key = ''; }
  if (view === 'town') {
    if (force || key !== 'town' || !town || town.soon !== soonKey(app)) { key = 'town'; setLive(null); buildTown(app); }
    if (!town.scale) layoutTown();
    drawTown(app, performance.now() / 1000);
    town.gold.textContent = fmt(s.gold);
    town.heroLabel.textContent = s.hero.name;
    return;
  }
  town = null;
  const k = JSON.stringify([view, s.owned, s.equipment, s.knowledge.totalCorrect, s.hero.level, s.hero.name, s.hero.gender, s.allies.map((a) => [a.id, a.hired ? a.paidUntil : 0, !!a.benched, !!a.advisor]), s.citationsUsed, s.knowledge.torn.length, s.tax.owed > 0, (s.knowledge.profLog || []).length && s.knowledge.profLog[0], heroTitles(s, app.ctx), JSON.stringify(s.companies), companiesProfit(s, app.ctx).total, canFound(s, app.ctx), bestStaffGrade(s, app.ctx), genreLv(s, '経営学'), s.legacy.rocket.buildCostPaid, s.life.generation, s.life.ailing, s.life.treatments, s.life.maxFloor, s.life.moonMaxFloor,
    // 学際分野（解放・休眠・専攻・熟練）とロケットの工程（進み具合は作り直さずに書き換える）
    fieldList(s, app.ctx).map((f) => [f.unlocked, f.dormant, f.slot, f.levels]), s.knowledge.radio, rocketSteps(s, app.ctx).map((st) => [st.done, st.active]), (nextBoss(s, app.ctx) || {}).id,
    // 飼育小屋のザコ（懐き度は触るたび・誕生日ごとに変わるので、更生したかだけ）といる部屋、部屋（名前と背景）、試作機の効果
    s.legacy.barn.map((a) => [a.id, !!a.space, (a.affinity || 0) >= app.ctx.balance.barn.affinityMax, a.room || 0]), s.legacy.barnRooms, s.legacy.rocket.flown, s.legacy.rocket.rateBonus]);
  // 名前を入力している途中と、選ぶ欄（飼育小屋の部屋の背景）を開いている間は作り直さない（入力が消えたり、選ぶ欄が閉じたりしないように）
  const typing = root.contains(document.activeElement) && ['INPUT', 'SELECT'].includes(document.activeElement.tagName);
  if (force || ((k !== key || !live) && !typing)) { key = k; buildPanel(app); }
  const hs = heroStats(s, app.ctx);
  live.gold.textContent = fmt(s.gold);
  live.hp.textContent = `${Math.ceil(s.hero.hp)}/${hs.maxHp}`;
  live.mp.textContent = `${Math.floor(s.hero.mp)}/${hs.maxMp}`;
  for (const b of live.buttons) b.btn.disabled = s.gold < b.price;
  if (live.rocket.length) {
    const steps = Object.fromEntries(rocketSteps(s, app.ctx).map((st) => [st.id, st]));
    for (const r of live.rocket) {
      const st = steps[r.id];
      r.bar.style.width = `${(st.hours / st.need) * 100}%`;
      r.text.textContent = `${years(st.hours)}／${years(st.need)}`;
    }
  }
  if (live.tax) {
    // 法人税（決算は年齢が1つ上がるとき）。今年の法人の利益で変わるので、作り直さずに書き換える
    const t = corporateTax(s, app.ctx);
    const saved = t.saved > 0 ? `（税務調査官の税務顧問で ${fmt(t.saved)}G 安い）` : '';
    live.tax.textContent = `法人税：今年の法人の利益 ${fmt(s.tax.earned)}G → ${ageYears(s) + 1}歳になったときの決算で 約${fmt(t.tax)}G${saved}`
      + (s.tax.owed > 0 ? `。払いきれなかった法人税 ${fmt(s.tax.owed)}G を会社の利益から払っている` : '');
  }
  if (live.exam) {
    // 病院の診察（年齢で変わるので、作り直さずに書き換える）
    const left = lifespanOf(s, app.ctx.balance) - ageYears(s);
    live.exam.textContent = s.life.ailing
      ? `診察：年を重ねて、体が弱ってきている。このままだと、あと${left}年ほど（${lifespanOf(s, app.ctx.balance)}歳ごろまで）`
      : `診察：どこも悪くない。今${ageYears(s)}歳。年を取って体の不調を感じたら、また来なさい`;
  }
}
