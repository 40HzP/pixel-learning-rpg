// 起動・画面切り替え・ループ・セーブ
import {
  createState, startGame, canStartAt, tick, clockFrame, createClock, HOURS_PER_YEAR,
  createRateTracker, trackTime, trackGain, moveToFloor, birthday, stageFor, fitParty, lifespanFor, generationMultiplier, heroStats, forgetPastLifeBosses,
  launchRocket, returnToEarth, ADVISOR_PLACES, heroSnapshot, compareSnapshots, lifeLogHighlights,
  flyPrototype, launchSuccessRate, launchRateVisible, seeOffFriends,
} from './sim.js';
import { SAVE_KEY, serialize, deserialize } from './save.js';
import { forgetMissingQuestions, ensureAuthorCode, takeNewAdoptions, refreshDaily, dayKey, beginRecall } from './quiz.js';
import { MAJOR_SLOTS } from './fields.js';
import { loadPalette, loadSprite, spriteCanvas, buildSprite } from './sprites.js';
import { outfitOf, outfitKey, dressFrames } from './outfit.js';
import { createRenderer, SCENE_W, SCENE_H } from './render.js';
import * as adventure from './ui/adventure.js';
import * as study from './ui/study.js';
import * as facility from './ui/facility.js';
import * as zukan from './ui/zukan.js';
import * as debug from './ui/debug.js';
import * as settings from './ui/settings.js';
import { el, fmt } from './ui/dom.js';
import { playMovie } from './ui/movie.js';
import { askNande } from './ui/nande.js';
import { openDaily } from './ui/daily.js';
import { playTear } from './ui/tear.js';
import { playOogiri } from './ui/oogiri.js';
import { playLaunch } from './ui/launch.js';
import { profChangeText } from './ui/proflog.js';
import { openFloors } from './ui/floors.js';
import { playPrologue } from './ui/prologue.js';
import { showing as recallShowing } from './ui/recall.js';

const PIXEL = '../pixel/';
const SPRITES = PIXEL + 'sprites/';
const AUTOSAVE_MS = 10_000;
const UI_MS = 200;
const UPDATE_CHECK_MS = 3 * 60_000;
const DAY_CHECK_MS = 30_000; // 日付が変わったか（今日の1問）を見る間隔
const FONT_WAIT_MS = 3000;
// 起動から3分で「起動したとき」と「今」の主人公を比べる（設計ページ「最初の3分」。40HzP の依頼で毎回）。
// 数えるのはゲームの時間が進んでいる間だけ。ほかのアプリなどに切り替えて10分以上たってから戻ってきたときも、起動したことにする
const LAUNCH_COMPARE_SEC = 180;
/** 起動したときとの比較の札を出しておく時間（ミリ秒。40HzP の依頼で12秒から14秒に。タップでも閉じる） */
const LAUNCH_COMPARE_SHOW_MS = 14000;
const AWAY_RELAUNCH_MS = 10 * 60_000;

const screens = { adventure, study, facility, zukan, settings, debug };

async function fetchJSON(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${url} を読めません（${res.status}）`);
  return res.json();
}

/* ================= セーブ ================= */

/** セーブがあるか（無ければ初めての起動。前世の最期から始める） */
function hasSave() {
  try { return !!localStorage.getItem(SAVE_KEY); } catch { return false; }
}

function loadSave(balance, notify) {
  let text = null;
  try { text = localStorage.getItem(SAVE_KEY); } catch { /* 使えない環境 */ }
  if (!text) return createState(balance);
  try {
    return deserialize(text, balance);
  } catch (e) {
    try { localStorage.setItem(SAVE_KEY + '.broken', text); } catch { /* 残せなくても続ける */ }
    notify(`セーブを読めなかったので最初から始めます\n（${e.message}）`, 'bad');
    return createState(balance);
  }
}

/* ================= 起動 ================= */

/** 作問者コード用の乱数（ほかの人と重なりにくいように、ブラウザの暗号用の乱数を使う） */
const cryptoRng = () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;

async function boot() {
  const params = new URLSearchParams(location.search);
  let balance, monsters, items, questions, recruits, town, stages, business, fields, submit, genreGroups, firstCheck;
  try {
    [balance, { monsters }, { items }, { questions }, { recruits }, town, { stages }, business, fields, submit, { groups: genreGroups }, { questions: firstCheck }] = await Promise.all([
      fetchJSON('data/balance.json'), fetchJSON('data/monsters.json'),
      fetchJSON('data/items.json'), fetchJSON('data/questions.json'),
      fetchJSON('data/recruits.json'), fetchJSON('data/town.json'),
      fetchJSON('data/stages.json'), fetchJSON('data/business.json'),
      fetchJSON('data/fields.json'), fetchJSON('data/submit.json'),
      fetchJSON('data/genre-groups.json'),
      fetchJSON('data/first-check.json'), // 前世の記憶をたどる（最初の3分）の問題の候補
    ]);
  } catch (e) {
    document.querySelector('#loading .dialog').textContent = 'ゲームのデータを読めませんでした。\n' + e.message;
    return;
  }

  const palette = await loadPalette(PIXEL + 'palette.json');
  const load = (name) => loadSprite(name, palette, SPRITES);
  const monsterSprites = {};
  const recruitSprites = {};
  await Promise.all([
    ...monsters.map(async (m) => {
      monsterSprites[m.id] = { idle: await load(m.sprites.idle), attack: await load(m.sprites.attack) };
      // 学校の先生：正面を向いて破れたテスト用紙を持つ絵（用紙を破りすてたときのミニモーション。怒り顔と困惑顔）
      if (m.sprites.scold) monsterSprites[m.id].scold = await load(m.sprites.scold);
      if (m.sprites.puzzled) monsterSprites[m.id].puzzled = await load(m.sprites.puzzled);
      // 大喜利の答えを提出したとき：答案を持つ絵（顔ごと）
      if (m.sprites.oogiri) {
        const o = monsterSprites[m.id].oogiri = {};
        await Promise.all(Object.entries(m.sprites.oogiri).map(async ([mood, name]) => { o[mood] = await load(name); }));
      }
      // 月面のボス：正解で山と影を描き足した絵（marked）・分かれた地球と月（parts）・倒したあとに残るもの（remains）
      if (m.sprites.marked) monsterSprites[m.id].marked = await Promise.all(m.sprites.marked.map(load));
      if (m.sprites.parts) {
        const o = monsterSprites[m.id].parts = {};
        await Promise.all(Object.entries(m.sprites.parts).map(async ([part, name]) => { o[part] = await load(name); }));
      }
      if (m.remains) monsterSprites[m.id].remains = await load(m.remains.sprite);
    }),
    ...recruits.filter((r) => r.sprites).map(async (r) => {
      recruitSprites[r.id] = { idle: await load(r.sprites.idle), attack: await load(r.sprites.attack) };
    }),
  ]);
  // 主人公の絵。男の子は hero_*、女の子は heroine_*（同じ形・同じ大きさ。性別は初回起動時と転生時に選ぶ）。
  // old_idle・old_attack：年を取った姿（体の不調を感じ始めてからの冒険画面と、体の不調と寿命のミニムービーに出る）。
  // bow：先生にあやまる（用紙を破りすてたとき）。blush：赤面する（テストに大喜利を書いたとき）
  const heroSet = async (prefix) => {
    const [idle, attack, old, oldAttack, bow, blush] = await Promise.all(
      ['idle', 'attack', 'old_idle', 'old_attack', 'bow', 'blush'].map((k) => load(`${prefix}_${k}`)));
    return { idle, attack, old, oldAttack, bow, blush };
  };
  const heroSets = { male: await heroSet('hero'), female: await heroSet('heroine') };
  // 装備に合わせて塗り替えた主人公の絵（outfit.js）。性別と装備の組み合わせごとに1回だけ作る。
  // 剣を持つのは若い姿の待機と攻撃だけ（年を取った姿は杖のまま、服と装飾品だけ変わる）。あやまる・赤面する絵は変えない
  const dressed = new Map();
  const dressSprite = (sp, outfit, armed) => (sp && sp.rows
    ? buildSprite({ name: sp.name, w: sp.w, h: sp.h, fps: sp.fps, frames: dressFrames(sp.rows, outfit, armed) }, palette) || sp
    : sp);
  function heroLooks(state) {
    const g = state && state.hero.gender === 'female' ? 'female' : 'male';
    const outfit = outfitOf(state || { equipment: {} }, items);
    const key = `${g}|${outfitKey(outfit)}`;
    if (!dressed.has(key)) {
      const set = heroSets[g];
      dressed.set(key, { ...set, idle: dressSprite(set.idle, outfit, true), attack: dressSprite(set.attack, outfit, true), old: dressSprite(set.old, outfit, false), oldAttack: dressSprite(set.oldAttack, outfit, false) });
    }
    return dressed.get(key);
  }
  // 用紙を破りすてたときのミニモーションの教室（背景と、先生の前に重ねる教卓）。ロケットのミニムービーの打ち上げ場と飛ぶロケット。
  // 飼育小屋と月面の飼育ドームの中（ザコが歩き回る）
  const [classroom, lectern, launchpad, rocket, barn, moonBarn] = await Promise.all([load('scene_classroom'), load('scene_lectern'), load('scene_launchpad'), load('rocket_flight'), load('scene_barn'), load('scene_moon_barn')]);
  // 10階層ごとの世界の背景（stages.json に書いた名前だけ読む）
  const stageList = await Promise.all(stages.map(async (st) => ({ ...st, bg: await load(st.background) })));
  // 施設画面の街：背景と施設の外観（town.json に書いた名前だけ読む）
  const townSprites = {};
  const [townBg] = await Promise.all([
    load(town.background),
    ...town.facilities.map(async (f) => { townSprites[f.id] = await load(f.sprite); }),
    town.board ? load(town.board.sprite).then((sp) => { townSprites.board = sp; }) : null, // 今日の1問の掲示板
  ]);
  // 月面の街（town.json の moon。月面にいる間は地球の街の代わりに出る）
  const moonSprites = {};
  const [moonBg] = await Promise.all([
    load(town.moon.background),
    ...town.moon.facilities.map(async (f) => { moonSprites[f.id] = await load(f.sprite); }),
    town.moon.board ? load(town.moon.board.sprite).then((sp) => { moonSprites.board = sp; }) : null, // 月面の街の掲示板（地球と同じ）
  ]);
  // テストのジャンルを選ぶボタンのアイコン（genre-groups.json に書いた名前だけ読む。無ければ仮の図形）
  const genreSprites = {};
  await Promise.all(genreGroups.flatMap((g) => g.genres).map(async (x) => { genreSprites[x.name] = await load(x.icon); }));
  // 店の品物のアイコン（items.json の icon に書いた名前だけ読む。無ければ仮の図形）
  const itemSprites = {};
  await Promise.all(items.map(async (it) => { itemSprites[it.id] = await load(it.icon); }));
  // 勉強のメニューのボタンのアイコン（study.js の MENU_LOOK に書いた名前だけ読む）
  const menuSprites = {};
  await Promise.all(Object.entries(study.MENU_LOOK).map(async ([id, m]) => { menuSprites[id] = await load(m.icon); }));
  // 下の切り替えバーのコルクの板（ui_tabs_cork）。1枚が1つのボタンの板で、ボタンの順に1枚目・2枚目…と使う
  // （板ごとに粒の並びがちがう）。2倍に拡大してボタンの背景にする（CSS の --board）。無ければ CSS のコルク色の地
  const corkSprite = await load('ui_tabs_cork');
  if (corkSprite) {
    const boards = corkSprite.frames.map((img) => {
      const big = document.createElement('canvas');
      big.width = corkSprite.w * 2; big.height = corkSprite.h * 2;
      const g = big.getContext('2d');
      g.imageSmoothingEnabled = false;
      g.drawImage(img, 0, 0, big.width, big.height);
      return `url(${big.toDataURL()})`;
    });
    document.getElementById('tabs').style.setProperty('--board-size', `${corkSprite.w * 2}px ${corkSprite.h * 2}px`);
    [...document.querySelectorAll('#tabs button')].forEach((b, i) => b.style.setProperty('--board', boards[i % boards.length]));
  }
  // 下の切り替えバーのアイコン（index.html のボタンの data-icon に書いた名前だけ読む。無ければ字だけ）
  await Promise.all([...document.querySelectorAll('#tabs button[data-icon]')].map(async (b) => {
    const sp = await load(b.dataset.icon);
    if (sp) b.prepend(spriteCanvas(sp, 2, palette));
  }));

  // radio：月面の街の裏側の電波望遠鏡で開く図鑑の頁（town.json の moon.radio）。firstCheck：前世の記憶をたどる問題の候補（data/first-check.json）
  const ctx = { balance, monsters, items, questions, recruits, business, fields, stages, radio: town.moon.radio, firstCheck, rng: Math.random };
  const app = {
    ctx, palette, monsterSprites, recruitSprites,
    submit,           // 作問フォーム（data/submit.json）
    genreGroups,      // テストのジャンルを選ぶボタンのまとまり・色・アイコン（data/genre-groups.json）
    genreSprites,
    menuSprites,      // 勉強のメニューのボタンのアイコン
    itemSprites,      // 店の品物のアイコン（品物のid → スプライト）
    heroSets,
    // 今の主人公の絵：性別（男の子は hero_*、女の子は heroine_*）と、付けている装備の見た目
    get heroSprites() { return heroLooks(this.state); },
    sceneSprites: { classroom, lectern, launchpad, rocket, barn, moonBarn },
    stages: stageList,
    town: { ...town, bg: townBg, sprites: townSprites },
    moonTown: { ...town.moon, bg: moonBg, sprites: moonSprites },
    state: null,
    speed: 1,
    debug: params.get('debug') === '1',
    settings: settings.loadSettings(), // 設定（画面の色など）。セーブとは別にこの端末に覚える（ui/settings.js）
    rate: createRateTracker(),
    tab: 'adventure',
    noSave: false,
    // 公開した版（GitHub Actions が index.html に書き込む。手元で動かしているときは dev）
    version: (document.querySelector('meta[name="app-version"]') || {}).content || 'dev',
    notify,
    handleEvents,
    save: saveNow,
    replaceState(next) { app.state = next; ensureAuthorCode(next, cryptoRng); refreshDaily(next, ctx, app.today()); forgetMissingQuestions(next, ctx); forgetPastLifeBosses(next, ctx); fitParty(next, ctx); app.rate = createRateTracker(); for (const s of Object.values(screens)) s.reset && s.reset(app); refreshActive(true); },
    // 階層の移動（冒険画面の「階層を移動」）：この人生で到達した階層（今いる世界）へ
    moveFloor(floor) {
      const r = moveToFloor(app.state, ctx, floor);
      if (!r.ok) { notify(r.reason, 'bad'); return r; }
      notify(`${r.world === 'moon' ? '月面' : ''}${r.floor}階層に移動した`);
      saveNow();
      refreshActive(true);
      return r;
    },
    // デバッグ：最初の3分（前世の最期・前世の記憶をたどる・起動から3分の比較）を試す
    playPrologue: () => runOverlay(() => playPrologue(app)),
    // 生まれ変わりの場面を、今の人生の熟練の記録で流す（生まれ変わりはしない）
    playRebirthScene: () => {
      const s = app.state;
      runOverlay(() => playPrologue(app, rebirthScene({
        generation: s.life.generation, name: s.hero.name, age: Math.floor(s.life.gameHours / HOURS_PER_YEAR),
        level: s.hero.level, maxFloor: s.life.maxFloor || 1, moonFloor: s.life.moonMaxFloor || 0, gold: Math.floor(s.gold),
      })));
    },
    restartFirstCheck() {
      beginRecall(app.state, ctx); // この人生の新しい5問（覚えたザコも入れ替える。ザコの群れと戦っていれば、間違えたザコがすぐ現れる）
      adventure.reset();
      showTab('adventure');
    },
    launchCompareNow() {
      countLaunch(0);
      Object.assign(launchMark, { sec: LAUNCH_COMPARE_SEC, done: false });
      countLaunch(0);
    },
    // デバッグ：誕生日の処理（全回復・熟練の判定）を今する
    birthdayNow() { handleEvents((() => { const ev = []; birthday(app.state, ctx, ev); return ev; })()); saveNow(); },
    showTab,
    refresh: () => refreshActive(true),
    placeNotices: () => placeNotices(),
    overlay: false,   // ミニムービー・孫の「なんで？」を出している間は true（ゲームの時間を止め、知らせを後回しにする）
    playMovie: (monsterId) => startMovie(monsters.find((m) => m.id === monsterId)),
    playAilmentMovie: (age) => startAilmentMovie(age),
    askNande: () => runOverlay(() => askNande(app)),
    openDaily: () => runOverlay(() => openDaily(app).then(() => refreshActive(true))), // 今日の1問（冒険画面の札・街の掲示板）
    openFloors: () => runOverlay(() => openFloors(app)), // 階層の移動（冒険画面の「移動」）
    debugDay: null,   // デバッグ画面で選んだ日付（今日の1問をその日の問題で試す）
    today: () => app.debugDay || dayKey(new Date()), // 今日の1問の日付（端末の時計の日付）
    tearTest: (teacherId) => runOverlay(() => playTear(app, teacherId)), // テスト用紙を破りすてた（先生が怒る）
    oogiriTest: (teacherId) => runOverlay(() => playOogiri(app, teacherId)), // テストに大喜利を書いて提出した（主人公が赤面する）
    launch: () => launch(),          // ロケットを打ち上げる（地球 → 月面。失敗することもある）
    returnHome: () => returnHome(),  // 帰還ロケットで地球に帰る（無料）
    flyPrototype: (id) => prototypeFlight(id), // 飼育小屋のザコを試作機に乗せて飛ばす（ロケット発射場）
  };
  const firstLaunch = !hasSave(); // 初めての起動（前世の最期から始める）
  app.state = loadSave(balance, notify);
  ensureAuthorCode(app.state, cryptoRng); // 作問者コード（作った問題が採用されたら知らせるため）
  const adoptedOnLoad = takeNewAdoptions(app.state, ctx); // 採用された問題があれば、起動したときに一度だけ知らせる
  forgetMissingQuestions(app.state, ctx); // 同期で外した問題が過去問復習に残らないように
  refreshDaily(app.state, ctx, app.today()); // その日に初めて起動したら、今日の1問の札を冒険画面に出す
  forgetPastLifeBosses(app.state, ctx); // 前の版のセーブで、前世で倒したボスにもまた会えるように
  const benchedOnLoad = fitParty(app.state, ctx); // パーティーは5人まで（前のセーブで超えていたら控えに回す）
  // 伸び率を変えた版では、前のセーブのHP・MPが今の最大を超えていることがある
  const hsOnLoad = heroStats(app.state, ctx);
  app.state.hero.hp = Math.min(app.state.hero.hp, hsOnLoad.maxHp);
  app.state.hero.mp = Math.min(app.state.hero.mp, hsOnLoad.maxMp);
  app.renderer = createRenderer(document.getElementById('scene'), app);

  settings.applyTheme(app.settings.theme); // 画面の色（index.html の先頭でも先に当てている）
  for (const s of Object.values(screens)) s.init(app);
  if (adoptedOnLoad.length) {
    setTimeout(() => notify(`あなたが作った問題が採用された！（${adoptedOnLoad.length}問）\n${adoptedOnLoad.slice(0, 3).map((q) => `「${q.question.length > 24 ? q.question.slice(0, 24) + '…' : q.question}」`).join('\n')}\n勉強の「作問」で見られる`, 'good'), 1200);
    saveNow();
  }
  if (benchedOnLoad.length) setTimeout(() => notify(`パーティーは${ctx.balance.ally.partyMax}人までになった。${benchedOnLoad.join('・')}を控えに回した（仲間が集まる場所で入れ替えられる）`), 1500);

  /* ---------- 通知 ---------- */
  const heldNotices = []; // ミニムービーなどを出している間に出た知らせ（終わってから出す）
  function notify(text, kind = '') {
    if (app.overlay) { heldNotices.push([text, kind]); return; }
    placeNotices();
    const box = document.getElementById('notices');
    const plain = [...box.children].filter((x) => !x.classList.contains('card'));
    if (plain.length && plain[plain.length - 1].textContent === text) return;
    const n = el('div', { class: 'notice ' + kind }, text);
    box.append(n);
    while (plain.length >= 2) plain.shift().remove(); // ふつうの知らせは2つまで（札は数えない）
    setTimeout(() => n.remove(), kind === 'bad' ? 6000 : 3500);
  }
  /**
   * 札の知らせ（あなたが信じていた誤解・図鑑の1体目・起動から3分の比較）。ふつうの知らせに押し出されず、ms 秒たつかタップで閉じる。
   * onTap を渡すとタップでそれをする（閉じたあとで）
   */
  function notifyCard(node, kind, ms, onTap = null) {
    if (app.overlay) { heldNotices.push([node, kind, ms, onTap]); return; }
    placeNotices();
    const box = document.getElementById('notices');
    const n = el('div', { class: `notice card ${kind}`, role: 'status' }, node);
    const close = () => n.remove();
    n.addEventListener('click', () => { close(); if (onTap) onTap(); });
    const cards = [...box.children].filter((x) => x.classList.contains('card'));
    while (cards.length >= 2) cards.shift().remove(); // 札は2枚まで（古いほうから閉じる）
    box.append(n);
    setTimeout(close, ms);
    return n;
  }
  /** やられたとき：1つ手前の階層の最初からやり直す（全回復。熟練の判定はしない） */
  function notifyDefeat(e) {
    const at = (floor) => `${e.world === 'moon' ? '月面' : ''}${floor}階層`;
    notify(`${app.state.hero.name}はやられた…　${at(e.floor)}の最初からやり直す（HPとMPが全回復した）`, 'bad');
  }
  /** 誕生日：熟練が変わったときだけ知らせる（全回復は毎年。熟練の記録に残る） */
  function notifyBirthday(e) {
    if (!e.changes.length) return;
    const lines = [`${e.age}歳の誕生日！　熟練の判定`];
    for (const c of e.changes) lines.push(`${c.genre} ${profChangeText(c)}`);
    notify(lines.join('\n'), e.changes.some((c) => c.to < c.from) ? '' : 'good');
  }

  /**
   * 画面全体に重ねるもの（ミニムービー・孫の「なんで？」）を1つずつ出す。出している間はゲームの時間が止まり、
   * 知らせは後回しになる。show は閉じると解決する Promise を返す関数
   */
  const overlays = [];
  function runOverlay(show) {
    overlays.push(show);
    if (app.overlay) return;
    app.overlay = true;
    (async () => {
      while (overlays.length) await overlays.shift()();
      app.overlay = false;
      for (const [text, kind, ms, onTap] of heldNotices.splice(0)) {
        if (typeof text === 'string') notify(text, kind);
        else notifyCard(text, kind, ms, onTap);
      }
    })();
  }

  /**
   * ミニムービーは、勉強画面で問題を解いている最中（問題が出ていて、まだ答えていない間）には出さずに取っておき、
   * 答え終わったら出す（40HzP の依頼）。取っておいたものは毎フレーム見て、解き終わったら順に出す（frame）
   */
  const heldMovies = [];
  function afterAnswering(start) {
    if (study.answering(app)) heldMovies.push(start);
    else start();
  }

  /** 魔物の defeatMovie（倒したときのミニムービー）を流す */
  function startMovie(m) {
    if (!m || !m.defeatMovie || !m.defeatMovie.length) return;
    afterAnswering(() => runOverlay(() => playMovie(app, { lines: m.defeatMovie, otherId: m.id })));
  }

  /**
   * 年を取って体の不調を感じ始めた（寿命の life.ailmentYearsBefore 年前）：年老いた主人公のミニムービーを流す。
   * 文は town.json の病院の ailmentMovie（{name}＝主人公の名前、{age}＝年齢）
   */
  function startAilmentMovie(age) {
    const h = town.facilities.find((f) => f.id === 'hospital');
    if (!h || !h.ailmentMovie || !h.ailmentMovie.length) return;
    const fill = (line) => line.replaceAll('{name}', app.state.hero.name).replaceAll('{age}', age);
    afterAnswering(() => runOverlay(() => playMovie(app, { lines: h.ailmentMovie.map(fill), otherId: null, hero: 'old' })
      .then(() => notify(`街に病院がある。治療を受けると、寿命が${balance.hospital.extendYears}年延びる（${balance.hospital.treatmentCosts.length}回まで）`, 'good'))));
  }

  /**
   * 寿命で亡くなった：ムービーで前世をふり返り、生まれ変わりの案内を出す。
   * 問題を解いている最中なら、答え終わってから（年齢を選ぶまでゲームの時間は止まっているので、制限時間も減らない）
   */
  function onReincarnated(e) {
    afterAnswering(() => reincarnationMovie(e));
  }
  function reincarnationMovie(e) {
    launchMark = null; // 新しい人生が始まったら、そこから3分を数え直す
    const p = e.life;
    app.rate = createRateTracker();
    for (const sc of Object.values(screens)) sc.reset && sc.reset(app);
    runOverlay(() => playPrologue(app, rebirthScene(p)).then(() => { showIntro(); saveNow(); refreshActive(true); }));
  }
  /**
   * 生まれ変わりの場面：終わったばかりの人生の本物の熟練の記録から数行を流す（設計ページ「生まれ変わるたびの『前世の記憶をたどる』」の案。
   * 初回の作り話の前世と同じ場面）。p は前世のまとめ（reincarnate の返り値）。その人生のまとめ（Lv・最高到達・残したゴールド）を下に添える
   */
  function rebirthScene(p) {
    const log = lifeLogHighlights(app.state, p.generation).map((c) => ({
      when: `${c.age}歳`, what: c.field ? `学際分野「${c.field}」` : c.genre, how: profChangeText(c),
      kind: c.field ? 'field' : c.to > c.from ? 'up' : c.to < c.from ? 'down' : 'same',
    }));
    log.push({ when: `${p.age}歳`, what: '', how: 'ここで記録が途切れている', kind: 'end' });
    return {
      log,
      head: `${p.name}の熟練の記録`,
      sub: `Lv${p.level}・最高到達${p.maxFloor}階層${p.moonFloor ? `（月面${p.moonFloor}階層）` : ''}・${fmt(p.gold)}ゴールドを残した`,
      gender: app.state.hero.gender,
      // 懐いた飼育小屋のザコが見送る（設計ページ「懐き度」の③。懐き度の高い順に数体）
      friends: seeOffFriends(app.state, ctx).map((f) => ({ ...f, sprite: (monsterSprites[f.id] || {}).idle || null })),
    };
  }

  /**
   * ロケットを打ち上げる（ロケット発射場）。成功すれば月面の1階層へ（前に行っていればその階層へ）、
   * 失敗すればエンジン・推進剤の工程をやり直す。どちらもミニムービーのあとで知らせる
   */
  function launch() {
    const r = launchRocket(app.state, ctx);
    if (!r.ok) { notify(r.reason, 'bad'); return r; }
    saveNow();
    const where = `月面${app.state.adventure.floor}階層`;
    runOverlay(() => playLaunch(app, r.success
      ? { from: 'earth', to: 'moon', lines: ['月面に着いた！', `${where}から冒険を続ける。月面の階層は、地球とは別に数える。`, '地球に帰るときは、月面の街の帰還ロケットに乗る（無料）。'] }
      : { from: 'earth', to: null, lines: ['打ち上げに失敗した…', `${r.redo.join('・')}の工程をやり直す。ロケット発射場で、また専攻にして進めよう。`] })
      .then(() => {
        if (r.success) notify(`月面に着いた！　${where}から`, 'good');
        else notify(`打ち上げに失敗した…　${r.redo.join('・')}をやり直す`, 'bad');
        refreshActive(true);
      }));
    return r;
  }
  /** 帰還ロケットで地球に帰る（無料で、必ず帰れる）。地球は打ち上げた階層から */
  function returnHome() {
    const r = returnToEarth(app.state, ctx);
    if (!r.ok) { notify(r.reason, 'bad'); return r; }
    saveNow();
    runOverlay(() => playLaunch(app, { from: 'moon', to: 'earth', lines: ['地球に帰ってきた！', `${r.floor}階層から冒険を続ける。`] })
      .then(() => { notify(`地球に帰ってきた。${r.floor}階層から`, 'good'); refreshActive(true); }));
    return r;
  }

  /**
   * 飼育小屋のザコを試作機に乗せて飛ばす（設計ページ「飼育小屋と試作機」）。ロケットのミニムービー（地球から飛び立ち、地球の打ち上げ場に戻る。
   * 失敗は少し浮いて落ちる）のあとに、帰ってきたか・効果を知らせる。動物が死ぬ話はしない（犬以外は失敗すると野に戻る）
   */
  function prototypeFlight(id) {
    const before = launchSuccessRate(app.state, ctx);
    const events = [];
    const r = flyPrototype(app.state, ctx, id, events);
    if (!r.ok) { notify(r.reason, 'bad'); return r; }
    saveNow();
    const pct = (x) => `${Math.round(x * 100)}%`;
    const shown = launchRateVisible(app.state, ctx);
    let lines;
    let summary;
    if (r.success) {
      const e = r.effect;
      let effect;
      if (e.kind === 'rate') effect = `本番の打ち上げの成功率が上がった。${shown ? `（${pct(before)}→${pct(launchSuccessRate(app.state, ctx))}）` : ''}`;
      else if (e.kind === 'step') effect = r.stepDone ? `ロケット計画の「${e.stepName}」の工程が進み、終わった！` : `ロケット計画の「${e.stepName}」の工程が進んだ。`;
      else effect = e.capped ? '（本番の打ち上げの成功率は、もう上限まで上がっている）' : `（${r.name}の効果は、もう出ている）`;
      lines = [`試作機が帰ってきた！　${r.name}は元気だ。`, `${r.name}に「宇宙帰り」の印が付いた。`, effect];
      if (r.history && e.kind !== 'none') lines.push(r.history);
      summary = `${r.name}が試作機で宇宙から帰ってきた！\n${effect}`;
    } else if (r.dog) {
      lines = ['試作機はうまく飛べなかった…', `でも${r.name}は元気に戻ってきた。犬は必ず生きて帰ってくる。`];
      summary = `試作機は失敗した。${r.name}は元気に戻ってきた`;
    } else if (r.cameBack) {
      lines = ['試作機はうまく飛べなかった…', `でも${r.name}はよく懐いていたので、ちゃんと帰ってきた。`];
      summary = `試作機は失敗した。${r.name}は懐いていたので帰ってきた`;
    } else {
      lines = ['試作機はうまく飛べなかった…', `${r.name}は驚いて、野に帰っていった。（また倒すと、なつくことがある）`];
      summary = `試作機は失敗した。${r.name}は野に帰っていった`;
    }
    if (r.affinity > 0) lines.push(`${r.name}の懐き度が上がった（+${r.affinity}）。`);
    const sp = (monsterSprites[id] || {}).idle || null;
    runOverlay(() => playLaunch(app, { from: 'earth', to: r.success ? 'earth' : null, lines, passenger: sp ? { sprite: sp, leaves: r.left } : null })
      .then(() => { notify(summary, r.success ? 'good' : r.left ? 'bad' : ''); handleEvents(events); refreshActive(true); }));
    return r;
  }

  /* ---------- 前世の記憶をたどるで間違えた問題のザコ（前世で魔物に吹き込まれた噂）・図鑑の1体目 ---------- */
  // 誤答1を選んだ問題のザコが出たら、群れの噂を1枚の札に並べる。倒すたびにその行に線を引き、「正体」の札を出す（間違えた問題のザコはどれも）。
  // 正体と図鑑の1体目の札は、続けて倒しても読めるように1枚ずつ順に出す（cardQueue）
  const TRUTH_MS = 4500;
  const rumors = new Map(); // 噂のザコの敵 uid → 魔物
  let rumorCard = null;
  function notifyMisbeliefs(list) {
    for (const e of list) rumors.set(e.uid, monsters.find((m) => m.id === e.monsterId));
    // 「前世で魔物に吹き込まれた噂」と添えるのは誤答1を選んだ問題のザコだけ（誤答2・3と時間切れは、知らなかっただけなので添えない）
    const believed = list.filter((e) => e.believed);
    if (!believed.length) return;
    if (rumorCard) rumorCard.remove();
    rumorCard = notifyCard([
      el('b', { class: 'nt-title' }, '前世で魔物に吹き込まれた噂'),
      ...believed.map((e) => el('span', { class: 'nt-myth', 'data-uid': String(e.uid) }, `「${e.myth}」`, el('small', {}, e.name))),
    ], 'myth', 20000);
  }
  /**
   * 噂のザコを倒した：噂の行に線を引き（全部倒したら札を閉じる）、正しい知識（正体）の札を順に出す。
   * 初めて倒したザコなら、図鑑の1体目の札と1枚にまとめる（firstZukan。まとめたら true）
   */
  function rumorDefeated(uid, firstZukan) {
    const m = rumors.get(uid);
    if (!m) return false;
    rumors.delete(uid);
    const card = rumorCard;
    if (card) {
      const line = card.querySelector(`[data-uid="${uid}"]`);
      if (line) line.classList.add('gone');
      if (![...card.querySelectorAll('.nt-myth')].some((x) => !x.classList.contains('gone'))) setTimeout(() => card.remove(), 1500);
    }
    if (firstZukan && firstZukan.monsterId === m.id) {
      queueCard(() => zukanCard(m, firstZukan, `${m.name}を倒した！`, `正体：${m.truth}`));
      return true;
    }
    queueCard(() => ({ node: [el('b', { class: 'nt-title' }, `${m.name}を倒した！`), el('span', {}, `正体：${m.truth}`)], kind: 'truth', ms: TRUTH_MS }));
    return false;
  }
  const cardQueue = [];
  let queueSeq = 0, queueBusy = 0;
  /** 札を順番待ちに入れる（前の札が閉じてから出す。タップで次へ） */
  function queueCard(make) {
    cardQueue.push(make);
    if (!queueBusy) nextQueued();
  }
  function nextQueued() {
    const make = cardQueue.shift();
    if (!make) { queueBusy = 0; return; }
    const token = queueBusy = ++queueSeq;
    const { node, kind, ms, onTap } = make();
    const advance = () => { if (queueBusy === token) nextQueued(); };
    notifyCard(node, kind, ms, () => { if (onTap) onTap(); advance(); });
    setTimeout(advance, ms);
  }
  /** 初めてザコを倒した：図鑑の札が開いて「1／171」（一度だけ）。タップで図鑑へ */
  function notifyFirstZukan(e) {
    const m = monsters.find((x) => x.id === e.monsterId);
    if (m) queueCard(() => zukanCard(m, e, `${m.name}の正体が載った`, null));
  }
  function zukanCard(m, e, line, sub) {
    const sp = (monsterSprites[m.id] || {}).idle;
    return {
      node: el('div', { class: 'zukan-first' },
        sp ? spriteCanvas(sp, 3, palette) : null,
        el('div', {},
          el('b', { class: 'nt-title' }, `図鑑　${e.opened}／${e.total}`),
          el('span', { class: 'nt-name' }, line),
          sub ? el('small', {}, sub) : null,
          el('small', { class: 'nt-tap' }, 'タップで図鑑へ'))),
      kind: 'zukan-card', ms: 6500, onTap: () => showTab('zukan'),
    };
  }

  function handleEvents(events) {
    app.renderer.onEvents(events, performance.now() / 1000);
    const met = [];
    const found = []; // 新しく解放した学際分野（まとめて知らせる）
    const misbelief = [];
    // 初めて倒したザコが噂のザコなら、正体の札と図鑑の1体目の札を1枚にする
    let firstZukan = events.find((e) => e.type === 'firstZukan') || null;
    for (const e of events) {
      if (e.type === 'defeat') {
        trackGain(app.rate, e.exp, e.gold);
        if (e.kind === 'midboss') startMovie(monsters.find((m) => m.id === e.monsterId));
        if (rumorDefeated(e.uid, firstZukan)) firstZukan = null;
      }
      else if (e.type === 'misbelief') misbelief.push(e);
      else if (e.type === 'firstZukan') { if (firstZukan) notifyFirstZukan(e); }
      else if (e.type === 'nande') runOverlay(() => askNande(app));
      else if (e.type === 'reincarnated') onReincarnated(e);
      else if (e.type === 'ailment') startAilmentMovie(e.age);
      // 前世の記憶をたどるを出している間は、レベルアップと「図鑑に載った」は知らせない（最初は次々に来て、問題と戦いの様子を隠すため）
      else if (e.type === 'levelUp') { if (!recallShowing()) notify(`${app.state.hero.name}のレベルが上がった！　Lv ${e.level}`, 'good'); }
      else if (e.type === 'floorUp') {
        // 10階層ごとに世界が変わる。新しい世界の最初の階層では世界の名前を出す（月面の階層は「月面◯階層」）
        const st = stageFor(e.floor, app.stages, e.world);
        if (e.world === 'moon') notify(`月面${e.floor}階層に進んだ`);
        else notify(st && st.from === e.floor && e.floor > 1 ? `${e.floor}階層　${st.name}に入った` : `${e.floor}階層に進んだ`);
      }
      else if (e.type === 'heroDefeated') notifyDefeat(e);
      else if (e.type === 'birthday') notifyBirthday(e);
      else if (e.type === 'scaffold') notify(`足場（構造工学）：ボス「${e.name}」には前の挑戦のダメージが残っている（残りHP ${Math.round(e.left * 100)}%）`, 'good');
      else if (e.type === 'retreat') notify(`${e.name}から逃げた。また挑戦できる`);
      else if (e.type === 'challengeHeal') notify(`HP・MPが全回復した。${e.name}との戦いだ！`, 'good');
      else if (e.type === 'midbossReady') notify(`${e.name}に挑戦できるようになった！\n冒険画面の「挑戦する」を押すと戦える`, 'good');
      else if (e.type === 'midbossBroken') notify(`${(monsters.find((m) => m.id === e.monsterId) || {}).name || '中ボス'}の防御が崩れた！`, 'good');
      else if (e.type === 'spawn' && e.kind === 'boss') {
        // 月面のボスは仕掛けを持つ（monsters.json の gimmickNote）
        const m = monsters.find((x) => x.id === e.monsterId) || {};
        notify(`ボス「${e.name}」が現れた！${m.gimmickNote ? `\n${m.gimmickNote}` : ''}`, 'bad');
      }
      else if (e.type === 'bossDefeated') {
        const m = monsters.find((x) => x.id === e.monsterId) || {};
        notify(`ボス「${e.name}」を倒した！${e.learned ? '\n図鑑に「なぜ信じられたか」が載った' : ''}${m.remains ? `\n${m.remains.note}` : ''}`, 'good');
      }
      else if (e.type === 'minions') notify(e.called.length ? `${e.name}が手下を呼んだ：${e.called.join('・')}` : `${e.name}の手下は来なかった（図鑑で正体を知っているので）`, e.called.length ? 'bad' : 'good');
      else if (e.type === 'minionsFled') notify(`手下の${e.names.join('・')}は逃げていった`);
      else if (e.type === 'smoothMarked') notify(e.marks >= e.max ? `${e.name}に山と影が描き足された！　もう攻撃は滑らない` : `${e.name}に山と影が描き足された！　攻撃が少し効くようになった`, 'good');
      else if (e.type === 'radioPage') notify(`宇宙からの電波を受信した！（月面の街の裏側の電波望遠鏡）\n図鑑「${ctx.radio.title}」に「${e.name}」が載った（${e.opened}/${e.total}）`, 'good');
      else if (e.type === 'split') notify(`${e.name}が地球と月に分かれた！\n両方をほぼ同時に倒そう（片方だけだと元に戻る）`, 'bad');
      else if (e.type === 'partDown') notify(`${e.part === 'earth' ? '地球' : '月'}のほうを倒した！　急いでもう片方も`, 'good');
      else if (e.type === 'merged') notify(`${e.name}が元の1体に戻った…`, 'bad');
      else if (e.type === 'allySunk') notify(`${e.name}が塵に沈んで動けない！`, 'bad');
      else if (e.type === 'alliesFreed') notify(`${e.names.join('・')}が塵から出てきた`, 'good');
      else if (e.type === 'moonCleared') notify(e.first ? `月面を踏破した！　称号「${e.title}」を手に入れた\n図鑑に「${e.page}」の頁が開いた` : `月面をまた踏破した！`, 'good');
      else if (e.type === 'authorRights') {
        notify(e.first ? `作問権を手に入れた！\n${e.genres.join('・')}の問題を作って送れる（勉強の「作問」から）` : `作問できるジャンルが増えた：${e.genres.join('・')}`, 'good');
      }
      else if (e.type === 'taxPaid') {
        // 決算（法人化した会社の法人税）
        const lines = [`決算：法人税 ${fmt(e.tax)}G を納めた（今年の法人の利益 ${fmt(e.earned)}G）`];
        if (e.saved > 0) lines.push(`税務調査官のおかげで ${fmt(e.saved)}G 安くなった`);
        if (e.owed > 0) lines.push(`${fmt(e.owed)}G 足りなかった。このあとの会社の利益から払う`);
        notify(lines.join('\n'), e.owed > 0 ? 'bad' : '');
      }
      else if (e.type === 'allyJoined') {
        // 顧問にもできる中ボスなら、置く場所と役目も知らせる
        const adv = (ctx.monsters.find((m) => m.id === e.id) || {}).advisor;
        const tip = adv && !adv.soon ? `\n${ADVISOR_PLACES[adv.place]}の顧問（${adv.role}）にもできる` : '';
        notify((e.benched ? `${e.name}が仲間になった！\nパーティーがいっぱいなので控えにいる（仲間が集まる場所で入れ替えられる）` : `${e.name}が仲間になった！`) + tip, 'good');
      }
      else if (e.type === 'barnFriendly') notify(`${e.name}がすっかり懐いた！（${e.barn}）\n誕生日に贈り物を持ってきたり、${e.name}の問題で誤答を1つ消してくれたりする`, 'good');
      else if (e.type === 'barnReformed') notify(`${e.name}が自分の誤解に気づいた！（更生）\n${e.barn}で触ると、本当のことを話してくれる`, 'good');
      else if (e.type === 'barnGift') notify(`${e.age}歳の誕生日。${e.name}から贈り物：${e.itemName ? `${e.itemName}（装備した）` : `${fmt(e.gold)}G`}`, 'good');
      else if (e.type === 'barnJoin') notify(`${e.name}がなついて、${e.barn}に入った！\n${e.world === 'moon' ? '月面の街' : '街'}の${e.world === 'moon' ? '飼育ドーム' : '飼育小屋'}で見られる`, 'good');
      else if (e.type === 'titleGained') notify(`称号「${e.title}」を手に入れた！`, 'good');
      else if (e.type === 'contractEnded') notify(`ゴールドが足りず、${e.name}との契約が切れた`, 'bad');
      else if (e.type === 'fieldUnlocked') found.push(e);
      else if (e.type === 'fieldDormant' && e.slot >= 0) notify(`${MAJOR_SLOTS[e.slot]}の${e.name}が休眠した（${e.low.map((x) => `${x.genre} Lv${x.level}`).join('・')}）\n熟練をLv${balance.fields.unlockLevel}に戻すと復活する`, 'bad');
      else if (e.type === 'fieldAwake' && e.slot >= 0) notify(`${e.name}が休眠から復活した！`, 'good');
      else if (e.type === 'rocketStepDone') notify(`ロケット計画：「${e.name}」が完了した！\n（生まれ変わっても残る）`, 'good');
      else if (e.type === 'zukan' && e.stage === 1) {
        const m = monsters.find((x) => x.id === e.monsterId);
        if (m && !met.includes(m.name)) met.push(m.name);
      }
    }
    if (misbelief.length) notifyMisbeliefs(misbelief);
    // 群れで初めて会った魔物は1つの知らせにまとめる（噂のザコは噂の札で出すので、ここには入れない）
    const metOthers = met.filter((name) => !misbelief.some((e) => e.believed && e.name === name));
    if (metOthers.length && !recallShowing()) notify(`図鑑に載った：${metOthers.join('・')}`);
    // 学際分野の解放（前のセーブで、もう条件を満たしていたときは一度にいくつも来る）
    if (found.length === 1 && found[0].hidden) notify(`隠しの学際分野「${found[0].name}」を見つけた！\n称号「${found[0].title}」を手に入れた`, 'good');
    else if (found.length === 1) notify(`学際分野「${found[0].name}」を解放した！（${found[0].genres.join('＋')}）\n称号「${found[0].title}」を手に入れた。街の「学校・研究室」で専攻にすると効果が出る`, 'good');
    else if (found.length) notify(`学際分野を解放した：${found.map((e) => e.name).join('・')}\n称号も手に入れた。街の「学校・研究室」で専攻にすると効果が出る`, 'good');
  }

  /* ---------- セーブ ---------- */
  function saveNow() {
    if (app.noSave) return;
    try { localStorage.setItem(SAVE_KEY, serialize(app.state, Date.now())); } catch { /* 保存できない環境 */ }
  }

  /* ---------- タブ ---------- */
  const tabButtons = [...document.querySelectorAll('#tabs button')];
  if (app.debug) document.querySelector('[data-tab="debug"]').hidden = false;
  for (const b of tabButtons) b.addEventListener('click', () => {
    // 街の施設の中にいるときに「街」をもう一度押すと、施設の並ぶ街に戻る（40HzP の依頼）
    if (b.dataset.tab === 'facility' && app.tab === 'facility') facility.backToTown(app);
    showTab(b.dataset.tab);
  });
  function showTab(name) {
    app.tab = name;
    for (const b of tabButtons) b.classList.toggle('active', b.dataset.tab === name);
    for (const [k] of Object.entries(screens)) document.getElementById('screen-' + k).hidden = k !== name;
    refreshActive(true);
    if (name === 'adventure') layoutStage();
    placeNotices();
  }
  /**
   * 知らせの位置：冒険では空と地面の間（山の辺り）、ほかの画面では上。解答ボタンやキャラクターに重ねない。
   * 冒険画面のステータスが長いとき（挑戦・逃げるボタンが出ているときなど）は、その下に出してボタンを隠さない。
   * 施設の中に入っているときは下に出す（上の「街へ」ボタンを隠さない）
   */
  function placeNotices() {
    const box = document.getElementById('notices');
    const cv = document.getElementById('scene');
    box.classList.toggle('bottom', app.tab === 'facility' && facility.insideFacility());
    if (app.tab === 'adventure' && cv.clientHeight) {
      const r = cv.getBoundingClientRect();
      const hud = document.getElementById('hud').getBoundingClientRect();
      box.style.top = Math.round(Math.max(r.top + r.height * (64 / SCENE_H), hud.bottom + 4)) + 'px';
    } else {
      box.style.top = '';
    }
  }
  function refreshActive(force) {
    const s = screens[app.tab];
    if (s && s.update) s.update(app, force);
  }

  /* ---------- 冒険画面の大きさ（90×160 を整数倍） ---------- */
  function layoutStage() {
    const box = document.getElementById('screen-adventure');
    const w = box.clientWidth, h = box.clientHeight;
    if (!w || !h) return;
    const scale = Math.max(1, Math.floor(Math.min(w / SCENE_W, h / SCENE_H)));
    const cv = document.getElementById('scene');
    cv.style.width = SCENE_W * scale + 'px';
    cv.style.height = SCENE_H * scale + 'px';
    adventure.setScale(app, scale);
    placeNotices();
  }
  window.addEventListener('resize', layoutStage);
  layoutStage();

  /* ---------- 最初の案内 ---------- */
  const intro = document.getElementById('intro');
  /** 最初の案内（年齢と名前を選ぶ）。生まれ変わったあとも出す（世代と、受け継いだものを書く） */
  function showIntro() {
    const s = app.state;
    const gen = document.getElementById('intro-gen');
    gen.hidden = s.life.generation <= 1;
    if (s.life.generation > 1) {
      gen.textContent = `${s.life.generation}世代目。前世の記憶（熟練・図鑑・称号）を受け継いだ。`
        + `ステータスの伸び・経験値・ゴールドが ${generationMultiplier(s, balance)}倍`;
    }
    document.getElementById('hero-name').value = s.hero.name === '主人公' ? '' : s.hero.name;
    // 性別は前に選んだもの（初めては男の子）を選んでおく
    pickGender(s.hero.gender);
    // 初めて始めるとき（1世代目）は7歳からを選べない。生まれ変わったあとは選べる
    for (const b of intro.querySelectorAll('[data-age]')) b.disabled = !canStartAt(s, Number(b.dataset.age));
    document.getElementById('intro-age7-note').textContent = canStartAt(s, 7) ? 'すぐ戦えるが弱い' : '生まれ変わると選べる';
    intro.hidden = false;
  }
  // 性別のボタン（男の子・女の子）。それぞれの主人公の絵を付ける
  let gender = 'male';
  const genderButtons = [...intro.querySelectorAll('[data-gender]')];
  function pickGender(g) {
    gender = g === 'female' ? 'female' : 'male';
    for (const b of genderButtons) {
      const on = b.dataset.gender === gender;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
    }
  }
  for (const b of genderButtons) {
    // 生まれたばかりは何も装備していないので、素手でいつもの服の姿
    const sp = heroLooks({ hero: { gender: b.dataset.gender }, equipment: {} }).idle;
    if (sp) b.prepend(spriteCanvas(sp, 2, palette));
    b.addEventListener('click', () => pickGender(b.dataset.gender));
  }
  // 7歳まで現実でどのくらいかかるか（balance.json の時間の速さから出す）
  const untilSeven = (7 * HOURS_PER_YEAR) / balance.time.gameHoursPerRealSecond;
  const span = untilSeven >= 90 * 60 ? `約${Math.round(untilSeven / 3600)}時間` : `約${Math.max(1, Math.round(untilSeven / 60))}分`;
  document.getElementById('intro-age0-note').textContent = `準備期間が長い（7歳まで、遊んでいる時間で${span}）`;
  for (const b of intro.querySelectorAll('[data-age]')) {
    b.addEventListener('click', () => {
      if (!canStartAt(app.state, Number(b.dataset.age))) return;
      startGame(app.state, Number(b.dataset.age), document.getElementById('hero-name').value, lifespanFor(balance, Math.random), gender);
      // 前世の記憶をたどる5問を決める：初めて遊ぶ人の最初の人生と、生まれ変わるたび（前のセーブの1世代目は出さない）。
      // 出すのは冒険画面の横（ui/recall.js。冒険が始まると出る）
      if (app.state.life.generation > 1 || !app.state.firstRun) beginRecall(app.state, ctx);
      intro.hidden = true;
      saveNow();
      refreshActive(true);
    });
  }
  // ドット文字のフォントが届くまで少し待つ（後から届いて文字の幅が変わり、ボタンが動くのを防ぐ）
  try {
    await Promise.race([document.fonts.load('16px "DotGothic16"'), new Promise((ok) => setTimeout(ok, FONT_WAIT_MS))]);
  } catch { /* 標準のフォントで続ける */ }
  document.getElementById('loading').hidden = true;
  // 初めての起動は、前世の最期（10秒ほど）から始めて、最初の案内へ。前世の記憶をたどる5問は、年齢を選んで冒険が始まってから出す
  if (app.state.meta.startAge == null) {
    if (firstLaunch) runOverlay(() => playPrologue(app).then(showIntro));
    else showIntro();
  }

  /* ---------- 新しい版が公開されたら知らせる ---------- */
  // 開きっぱなしのタブや、ブラウザに残った古い版のままにならないように
  async function checkUpdate() {
    if (app.version === 'dev') return;
    try {
      const res = await fetch('version.json', { cache: 'no-store' });
      if (!res.ok) return;
      const { version } = await res.json();
      if (version && version !== app.version) document.getElementById('update-bar').hidden = false;
    } catch { /* 通信できないときは何もしない */ }
  }
  document.getElementById('update-reload').addEventListener('click', () => { saveNow(); app.noSave = true; location.reload(); });
  setInterval(checkUpdate, UPDATE_CHECK_MS);
  checkUpdate();

  /* ---------- 今日の1問：遊んでいる途中で日付が変わったら、次の日の札を出す ---------- */
  function checkDay() {
    if (!refreshDaily(app.state, ctx, app.today())) return;
    notify('日付が変わった。今日の1問が届いた（冒険画面の札）', 'good');
    saveNow();
    refreshActive(true);
  }
  setInterval(checkDay, DAY_CHECK_MS);

  /* ---------- ループ ---------- */
  const clock = createClock();
  let lastUi = 0, lastSave = performance.now();
  /* ---------- 起動から3分で、起動したときの自分と比べる（毎回） ---------- */
  let launchMark = null; // { snap: 起動したときの主人公, sec: ゲームの時間が進んだ秒数, done }
  let hiddenAt = 0;
  function countLaunch(realDt) {
    if (!launchMark) launchMark = { snap: heroSnapshot(app.state, ctx), sec: 0, done: false };
    if (launchMark.done) return;
    launchMark.sec += realDt;
    if (launchMark.sec < LAUNCH_COMPARE_SEC) return;
    launchMark.done = true;
    const cmp = compareSnapshots(launchMark.snap, heroSnapshot(app.state, ctx));
    if (!cmp || (!cmp.rows.length && !cmp.zukan && !cmp.correct)) return; // 伸びたものだけを出す
    const extra = [cmp.zukan ? `図鑑 +${cmp.zukan}体` : '', cmp.correct ? `正解 +${cmp.correct}問` : ''].filter(Boolean).join('・');
    // その3分で懐き度が上がった飼育小屋のザコ（いちばん上がったザコと、ほかの数）
    const aff = cmp.affinity || [];
    const top = aff.length ? monsters.find((m) => m.id === aff[0].id) : null;
    const affLine = top ? `懐き度：${top.name} +${aff[0].gain}${aff.length > 1 ? `　ほか${aff.length - 1}体` : ''}` : '';
    notifyCard([
      el('b', { class: 'nt-title' }, '起動したときの自分と比べると'),
      el('div', { class: 'cmp-rows' }, cmp.rows.map((r) => {
        const unit = r.key.endsWith('loor') ? '階層' : '';
        return el('span', { class: r.key.endsWith('loor') ? 'wide' : '' }, `${r.label} ${fmt(r.from)}${unit} → `, el('b', {}, `${fmt(r.to)}${unit}`));
      })),
      extra ? el('small', {}, extra) : null,
      affLine ? el('small', {}, affLine) : null,
    ], 'compare', LAUNCH_COMPARE_SHOW_MS);
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') {
      clockFrame(clock, performance.now(), false);   // 戻っても止まっていた分を取り戻さない
      hiddenAt = Date.now();
      saveNow();
    } else {
      if (hiddenAt && Date.now() - hiddenAt >= AWAY_RELAUNCH_MS) launchMark = null; // しばらく離れていたら、起動し直したことにする
      checkUpdate();
      checkDay();
    }
  });
  window.addEventListener('pagehide', saveNow);

  function frame(nowMs) {
    const visible = document.visibilityState === 'visible';
    const realDt = clockFrame(clock, nowMs, visible, balance.time.maxFrameSeconds);
    if (app.state.meta.startAge != null && !app.overlay) {
      const dt = realDt * app.speed;
      trackTime(app.rate, dt);
      const events = tick(app.state, dt, ctx);
      if (events.length) handleEvents(events);
      study.frame(app, realDt);
      adventure.frame(app, realDt); // 前世の記憶をたどるの制限時間
      if (visible) countLaunch(realDt);
    }
    const now = nowMs / 1000;
    app.renderer.draw(app.state, now);
    if (app.tab === 'study') study.drawMini(app);
    // 問題を解いている間に取っておいたミニムービー：答え終わったら（勉強画面を離れても）出す
    if (heldMovies.length && !study.answering(app)) for (const start of heldMovies.splice(0)) start();
    if (nowMs - lastUi > UI_MS) { lastUi = nowMs; refreshActive(false); }
    if (nowMs - lastSave > AUTOSAVE_MS) { lastSave = nowMs; saveNow(); }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  window.__app = app; // 画面確認（Playwright）とデバッグ用
}

boot();
