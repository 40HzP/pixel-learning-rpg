// 起動・画面切り替え・ループ・セーブ
import {
  createState, startGame, tick, clockFrame, createClock, HOURS_PER_YEAR,
  createRateTracker, trackTime, trackGain, sleepAtBed, stageFor, fitParty, lifespanFor, generationMultiplier, heroStats, forgetPastLifeBosses,
} from './sim.js';
import { SAVE_KEY, serialize, deserialize } from './save.js';
import { forgetMissingQuestions } from './quiz.js';
import { MAJOR_SLOTS } from './fields.js';
import { loadPalette, loadSprite } from './sprites.js';
import { createRenderer, SCENE_W, SCENE_H } from './render.js';
import * as adventure from './ui/adventure.js';
import * as study from './ui/study.js';
import * as facility from './ui/facility.js';
import * as zukan from './ui/zukan.js';
import * as debug from './ui/debug.js';
import { el, fmt } from './ui/dom.js';
import { playMovie } from './ui/movie.js';
import { askNande } from './ui/nande.js';
import { playTear } from './ui/tear.js';

const PIXEL = '../pixel/';
const SPRITES = PIXEL + 'sprites/';
const AUTOSAVE_MS = 10_000;
const UI_MS = 200;
const UPDATE_CHECK_MS = 3 * 60_000;
const FONT_WAIT_MS = 3000;

const screens = { adventure, study, facility, zukan, debug };

async function fetchJSON(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${url} を読めません（${res.status}）`);
  return res.json();
}

/* ================= セーブ ================= */

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

async function boot() {
  const params = new URLSearchParams(location.search);
  let balance, monsters, items, questions, recruits, town, stages, business, fields;
  try {
    [balance, { monsters }, { items }, { questions }, { recruits }, town, { stages }, business, fields] = await Promise.all([
      fetchJSON('data/balance.json'), fetchJSON('data/monsters.json'),
      fetchJSON('data/items.json'), fetchJSON('data/questions.json'),
      fetchJSON('data/recruits.json'), fetchJSON('data/town.json'),
      fetchJSON('data/stages.json'), fetchJSON('data/business.json'),
      fetchJSON('data/fields.json'),
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
    }),
    ...recruits.filter((r) => r.sprites).map(async (r) => {
      recruitSprites[r.id] = { idle: await load(r.sprites.idle), attack: await load(r.sprites.attack) };
    }),
  ]);
  // hero_old_idle：年を取った主人公（体の不調と寿命のミニムービーに出る）。hero_bow：先生にあやまる主人公（用紙を破りすてたとき）
  const [heroIdle, heroAttack, heroOld, heroBow] = await Promise.all([load('hero_idle'), load('hero_attack'), load('hero_old_idle'), load('hero_bow')]);
  // 用紙を破りすてたときのミニモーションの教室（背景と、先生の前に重ねる教卓）
  const [classroom, lectern] = await Promise.all([load('scene_classroom'), load('scene_lectern')]);
  // 10階層ごとの世界の背景（stages.json に書いた名前だけ読む）
  const stageList = await Promise.all(stages.map(async (st) => ({ ...st, bg: await load(st.background) })));
  // 施設画面の街：背景と施設の外観（town.json に書いた名前だけ読む）
  const townSprites = {};
  const [townBg] = await Promise.all([
    load(town.background),
    ...town.facilities.map(async (f) => { townSprites[f.id] = await load(f.sprite); }),
  ]);

  const ctx = { balance, monsters, items, questions, recruits, business, fields, rng: Math.random };
  const app = {
    ctx, palette, monsterSprites, recruitSprites,
    heroSprites: { idle: heroIdle, attack: heroAttack, old: heroOld, bow: heroBow },
    sceneSprites: { classroom, lectern },
    stages: stageList,
    town: { ...town, bg: townBg, sprites: townSprites },
    state: null,
    speed: 1,
    debug: params.get('debug') === '1',
    rate: createRateTracker(),
    tab: 'adventure',
    noSave: false,
    // 公開した版（GitHub Actions が index.html に書き込む。手元で動かしているときは dev）
    version: (document.querySelector('meta[name="app-version"]') || {}).content || 'dev',
    notify,
    handleEvents,
    save: saveNow,
    replaceState(next) { app.state = next; forgetMissingQuestions(next, ctx); forgetPastLifeBosses(next, ctx); fitParty(next, ctx); app.rate = createRateTracker(); for (const s of Object.values(screens)) s.reset && s.reset(app); refreshActive(true); },
    sleepNow() {
      const from = app.state.adventure.floor;
      const r = sleepAtBed(app.state, ctx);
      notifySleep(r, from);
      saveNow();
      return r;
    },
    showTab,
    placeNotices: () => placeNotices(),
    overlay: false,   // ミニムービー・孫の「なんで？」を出している間は true（ゲームの時間を止め、知らせを後回しにする）
    playMovie: (monsterId) => startMovie(monsters.find((m) => m.id === monsterId)),
    playAilmentMovie: (age) => startAilmentMovie(age),
    askNande: () => runOverlay(() => askNande(app)),
    tearTest: (teacherId) => runOverlay(() => playTear(app, teacherId)), // テスト用紙を破りすてた（先生が怒る）
  };
  app.state = loadSave(balance, notify);
  forgetMissingQuestions(app.state, ctx); // 同期で外した問題が過去問復習に残らないように
  forgetPastLifeBosses(app.state, ctx); // 前の版のセーブで、前世で倒したボスにもまた会えるように
  const benchedOnLoad = fitParty(app.state, ctx); // パーティーは5人まで（前のセーブで超えていたら控えに回す）
  // 伸び率を変えた版では、前のセーブのHP・MPが今の最大を超えていることがある
  const hsOnLoad = heroStats(app.state, ctx);
  app.state.hero.hp = Math.min(app.state.hero.hp, hsOnLoad.maxHp);
  app.state.hero.mp = Math.min(app.state.hero.mp, hsOnLoad.maxMp);
  app.renderer = createRenderer(document.getElementById('scene'), app);

  for (const s of Object.values(screens)) s.init(app);
  if (benchedOnLoad.length) setTimeout(() => notify(`パーティーは${ctx.balance.ally.partyMax}人までになった。${benchedOnLoad.join('・')}を控えに回した（仲間が集まる場所で入れ替えられる）`), 1500);

  /* ---------- 通知 ---------- */
  const heldNotices = []; // ミニムービーなどを出している間に出た知らせ（終わってから出す）
  function notify(text, kind = '') {
    if (app.overlay) { heldNotices.push([text, kind]); return; }
    placeNotices();
    const box = document.getElementById('notices');
    if (box.lastElementChild && box.lastElementChild.textContent === text) return;
    const n = el('div', { class: 'notice ' + kind }, text);
    box.append(n);
    while (box.children.length > 2) box.firstElementChild.remove();
    setTimeout(() => n.remove(), kind === 'bad' ? 6000 : 3500);
  }
  function notifySleep(r, from = null) {
    const name = app.state.hero.name;
    const lines = [r.reason === 'defeated' ? (r.floor > 1 ? `${name}はやられた…　拠点のある${r.floor}階層に戻って眠った` : `${name}はやられた…　1階層に戻って眠った`)
      : from > r.floor ? `${name}はテントで眠った。${r.floor}階層に戻って、HPとMPが全回復した`
        : `${name}はテントで眠った。HPとMPが全回復した`];
    lines.push(r.up.length ? `熟練が上がった：${r.up.join('・')}` : '熟練が上がったジャンルはなかった');
    if (r.down.length) lines.push(`熟練が下がった：${r.down.join('・')}`);
    notify(lines.join('\n'), r.reason === 'defeated' ? 'bad' : 'good');
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
      for (const [text, kind] of heldNotices.splice(0)) notify(text, kind);
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
    const p = e.life;
    const m = generationMultiplier(app.state, balance);
    app.rate = createRateTracker();
    for (const sc of Object.values(screens)) sc.reset && sc.reset(app);
    runOverlay(() => playMovie(app, {
      lines: [
        `${p.name}は${p.age}歳で天寿を全うした。`,
        `Lv${p.level}・最高${p.maxFloor}階層まで進み、${fmt(p.gold)}ゴールドを残した。`,
        `前世の記憶を受け継いで、新しい命に生まれ変わる。${e.generation}世代目は、ステータスの伸び・経験値・ゴールドが${m}倍になる。`,
      ],
      otherId: null,
      hero: 'old',
    }).then(() => { showIntro(); saveNow(); refreshActive(true); }));
  }

  function handleEvents(events) {
    app.renderer.onEvents(events, performance.now() / 1000);
    const met = [];
    const found = []; // 新しく解放した学際分野（まとめて知らせる）
    for (const e of events) {
      if (e.type === 'defeat') {
        trackGain(app.rate, e.exp, e.gold);
        if (e.kind === 'midboss') startMovie(monsters.find((m) => m.id === e.monsterId));
      }
      else if (e.type === 'nande') runOverlay(() => askNande(app));
      else if (e.type === 'reincarnated') onReincarnated(e);
      else if (e.type === 'ailment') startAilmentMovie(e.age);
      else if (e.type === 'levelUp') notify(`${app.state.hero.name}のレベルが上がった！　Lv ${e.level}`, 'good');
      else if (e.type === 'floorUp') {
        // 10階層ごとに世界が変わる。新しい世界の最初の階層では世界の名前を出す
        const st = stageFor(e.floor, app.stages);
        notify(st && st.from === e.floor && e.floor > 1 ? `${e.floor}階層　${st.name}に入った` : `${e.floor}階層に進んだ`);
      }
      else if (e.type === 'heroDefeated') notifySleep(e.sleep);
      else if (e.type === 'retreat') notify(`${e.name}から逃げた。また挑戦できる`);
      else if (e.type === 'midbossReady') notify(`${e.name}に挑戦できるようになった！\n冒険画面の「挑戦する」を押すと戦える`, 'good');
      else if (e.type === 'midbossBroken') notify(`${(monsters.find((m) => m.id === e.monsterId) || {}).name || '中ボス'}の防御が崩れた！`, 'good');
      else if (e.type === 'spawn' && e.kind === 'boss') notify(`ボス「${e.name}」が現れた！`, 'bad');
      else if (e.type === 'bossDefeated') notify(`ボス「${e.name}」を倒した！${e.learned ? '\n図鑑に「なぜ信じられたか」が載った' : ''}`, 'good');
      else if (e.type === 'allyJoined') notify(e.benched ? `${e.name}が仲間になった！\nパーティーがいっぱいなので控えにいる（仲間が集まる場所で入れ替えられる）` : `${e.name}が仲間になった！`, 'good');
      else if (e.type === 'titleGained') notify(`称号「${e.title}」を手に入れた！`, 'good');
      else if (e.type === 'contractEnded') notify(`ゴールドが足りず、${e.name}との契約が切れた`, 'bad');
      else if (e.type === 'fieldUnlocked') found.push(e);
      else if (e.type === 'fieldDormant') notify(`${MAJOR_SLOTS[e.slot]}の${e.name}が休眠した（${e.low.map((x) => `${x.genre} Lv${x.level}`).join('・')}）\n熟練をLv${balance.fields.unlockLevel}に戻すと復活する`, 'bad');
      else if (e.type === 'fieldAwake') notify(`${e.name}が休眠から復活した！`, 'good');
      else if (e.type === 'rocketStepDone') notify(`ロケット計画：「${e.name}」が完了した！\n（生まれ変わっても残る）`, 'good');
      else if (e.type === 'zukan' && e.stage === 1) {
        const m = monsters.find((x) => x.id === e.monsterId);
        if (m && !met.includes(m.name)) met.push(m.name);
      }
    }
    // 群れで初めて会った魔物は1つの知らせにまとめる
    if (met.length) notify(`図鑑に載った：${met.join('・')}`);
    // 学際分野の解放（前のセーブで、もう条件を満たしていたときは一度にいくつも来る）
    if (found.length === 1 && found[0].hidden) notify(`隠しの学際分野「${found[0].name}」を見つけた！\n称号「${found[0].title}」を手に入れた`, 'good');
    else if (found.length === 1) notify(`学際分野「${found[0].name}」を解放した！（${found[0].genres.join('＋')}）\n称号「${found[0].title}」を手に入れた。街の「専攻の付け替え」で専攻にすると効果が出る`, 'good');
    else if (found.length) notify(`学際分野を解放した：${found.map((e) => e.name).join('・')}\n称号も手に入れた。街の「専攻の付け替え」で専攻にすると効果が出る`, 'good');
  }

  /* ---------- セーブ ---------- */
  function saveNow() {
    if (app.noSave) return;
    try { localStorage.setItem(SAVE_KEY, serialize(app.state, Date.now())); } catch { /* 保存できない環境 */ }
  }

  /* ---------- タブ ---------- */
  const tabButtons = [...document.querySelectorAll('#tabs button')];
  if (app.debug) document.querySelector('[data-tab="debug"]').hidden = false;
  for (const b of tabButtons) b.addEventListener('click', () => showTab(b.dataset.tab));
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
    intro.hidden = false;
  }
  if (app.state.meta.startAge == null) showIntro();
  // 7歳まで現実でどのくらいかかるか（balance.json の時間の速さから出す）
  const untilSeven = (7 * HOURS_PER_YEAR) / balance.time.gameHoursPerRealSecond;
  const span = untilSeven >= 90 * 60 ? `約${Math.round(untilSeven / 3600)}時間` : `約${Math.max(1, Math.round(untilSeven / 60))}分`;
  document.getElementById('intro-age0-note').textContent = `準備期間が長い（7歳まで、遊んでいる時間で${span}）`;
  for (const b of intro.querySelectorAll('[data-age]')) {
    b.addEventListener('click', () => {
      startGame(app.state, Number(b.dataset.age), document.getElementById('hero-name').value, lifespanFor(balance, Math.random));
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

  /* ---------- ループ ---------- */
  const clock = createClock();
  let lastUi = 0, lastSave = performance.now();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') {
      clockFrame(clock, performance.now(), false);   // 戻っても止まっていた分を取り戻さない
      saveNow();
    } else {
      checkUpdate();
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
