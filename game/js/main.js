// 起動・画面切り替え・ループ・セーブ。
// 絵の読み込みは ui/assets.js、知らせは ui/notices.js、札は ui/cards.js、最初の案内は ui/intro.js、
// ミニムービーは ui/scenes.js、起きたことの知らせは ui/events.js（2026-11-09 にここから分けた）
import {
  createState, tick, clockFrame, createClock, HOURS_PER_YEAR,
  createRateTracker, trackTime, moveToFloor, birthday, fitParty, heroStats, forgetPastLifeBosses,
  gameDay, diaryVisit, diaryTick, todayNotice,
} from './sim.js';
import { SAVE_KEY, serialize, deserialize } from './save.js';
import { forgetMissingQuestions, ensureAuthorCode, takeNewAdoptions, refreshDaily, beginRecall } from './quiz.js';
import { createRenderer, SCENE_W, SCENE_H } from './render.js';
import * as adventure from './ui/adventure.js';
import * as study from './ui/study.js';
import * as facility from './ui/facility.js';
import * as zukan from './ui/zukan.js';
import * as debug from './ui/debug.js';
import * as settings from './ui/settings.js';
import { loadAssets } from './ui/assets.js';
import { createNotices } from './ui/notices.js';
import { createCards } from './ui/cards.js';
import { createIntro } from './ui/intro.js';
import { createScenes } from './ui/scenes.js';
import { createEventHandler } from './ui/events.js';
import { askNande } from './ui/nande.js';
import { openDaily } from './ui/daily.js';
import { playTear } from './ui/tear.js';
import { playOogiri } from './ui/oogiri.js';
import { openFloors } from './ui/floors.js';
import { playPrologue } from './ui/prologue.js';
import { syncVision } from './ui/vision.js';

const PIXEL = '../pixel/';
const AUTOSAVE_MS = 10_000;
const UI_MS = 200;
const UPDATE_CHECK_MS = 3 * 60_000;
const DAY_CHECK_MS = 30_000; // 日付が変わったか（今日の1問・日記）を見る間隔
const DIARY_TICK_MS = 5_000; // 日記に遊んだ時間を足す間隔
const FONT_WAIT_MS = 3000;
// ほかのアプリなどに切り替えて10分以上たってから戻ってきたら、起動し直したことにする（起動から3分の比較を数え直す。ui/cards.js）
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
  let balance, monsters, items, questions, recruits, town, stages, business, fields, submit, genreGroups, firstCheck, roadside, seasons;
  try {
    [balance, { monsters }, { items }, { questions }, { recruits }, town, { stages }, business, fields, submit, { groups: genreGroups }, { questions: firstCheck }, roadside, seasons] = await Promise.all([
      fetchJSON('data/balance.json'), fetchJSON('data/monsters.json'),
      fetchJSON('data/items.json'), fetchJSON('data/questions.json'),
      fetchJSON('data/recruits.json'), fetchJSON('data/town.json'),
      fetchJSON('data/stages.json'), fetchJSON('data/business.json'),
      fetchJSON('data/fields.json'), fetchJSON('data/submit.json'),
      fetchJSON('data/genre-groups.json'),
      fetchJSON('data/first-check.json'), // 前世の記憶をたどる（最初の3分）の問題の候補
      fetchJSON('data/roadside.json'),    // 散歩の要素：前世の足跡の石碑と、道端の物の絵の名前
      fetchJSON('data/seasons.json'),     // 毎日変わるものと日記：七十二候・二十四節気・散歩道の天気・祝日と行事
    ]);
  } catch (e) {
    document.querySelector('#loading .dialog').textContent = 'ゲームのデータを読めませんでした。\n' + e.message;
    return;
  }

  // 絵（データとコードに名前を書いた絵だけ）。下の切り替えバーの板とアイコンも貼る（ui/assets.js）
  const {
    palette, monsterSprites, recruitSprites, heroSets, heroLooks, sceneSprites,
    stageList, townBg, townSprites, moonBg, moonSprites, genreSprites, itemSprites, menuSprites, roomSprites, walkSprites, seasonSprites,
  } = await loadAssets(PIXEL, { monsters, recruits, items, stages, town, genreGroups, roadside, seasons });

  // radio：月面の街の裏側の電波望遠鏡で開く図鑑の頁（town.json の moon.radio）。firstCheck：前世の記憶をたどる問題の候補（data/first-check.json）
  // barnRooms：飼育小屋の部屋の背景の一覧（town.json の barnRooms）
  // roadside：散歩の要素の絵の名前と、道端の物で一言いうザコ（data/roadside.json の zako。ザコの散歩）
  // seasons：七十二候・二十四節気・散歩道の天気・祝日と行事（data/seasons.json。毎日変わるものと日記は sim/diary.js）
  const ctx = { balance, monsters, items, questions, recruits, business, fields, stages, radio: town.moon.radio, barnRooms: town.barnRooms, firstCheck, roadside, seasons, rng: Math.random };
  const app = {
    ctx, palette, monsterSprites, recruitSprites,
    submit,           // 作問フォーム（data/submit.json）
    genreGroups,      // テストのジャンルを選ぶボタンのまとまり・色・アイコン（data/genre-groups.json）
    genreSprites,
    menuSprites,      // 勉強のメニューのボタンのアイコン
    itemSprites,      // 店の品物のアイコン（品物のid → スプライト）
    roomSprites,      // 飼育小屋の部屋の背景（背景のid → スプライト。生態展示は stages の背景を切り取る）
    walkSprites,      // 散歩の要素：前世の足跡の石碑（stele）と道端の物（items：物の名前 → スプライト）
    seasonSprites,    // 七十二候で変わる景色：四季の花と虫（絵の名前 → スプライト。seasons.json の scenery）
    heroSets,
    // 今の主人公の絵：性別（男の子は hero_*、女の子は heroine_*）と、付けている装備の見た目
    get heroSprites() { return heroLooks(this.state); },
    sceneSprites,
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
    // notify・handleEvents・save は、下で知らせとミニムービーの関数を作ってから入れる
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
      runOverlay(() => playPrologue(app, scenes.rebirthScene({
        generation: s.life.generation, name: s.hero.name, age: Math.floor(s.life.gameHours / HOURS_PER_YEAR),
        level: s.hero.level, maxFloor: s.life.maxFloor || 1, moonFloor: s.life.moonMaxFloor || 0, gold: Math.floor(s.gold), walked: s.life.walkedFloors || 0, vision: s.life.vision || null,
      })));
    },
    restartFirstCheck() {
      beginRecall(app.state, ctx); // この人生の新しい5問（覚えたザコも入れ替える。ザコの群れと戦っていれば、間違えたザコがすぐ現れる）
      adventure.reset(app);
      showTab('adventure');
    },
    launchCompareNow() {
      cards.launchCompareNow();
    },
    // デバッグ：誕生日の処理（全回復・熟練の判定）を今する
    birthdayNow() { handleEvents((() => { const ev = []; birthday(app.state, ctx, ev); return ev; })()); saveNow(); },
    showTab,
    refresh: () => refreshActive(true),
    placeNotices: () => placeNotices(),
    overlay: false,   // ミニムービー・孫の「なんで？」を出している間は true（ゲームの時間を止め、知らせを後回しにする）
    playMovie: (monsterId) => scenes.startMovie(monsters.find((m) => m.id === monsterId)),
    playAilmentMovie: (age) => scenes.startAilmentMovie(age),
    askNande: () => runOverlay(() => askNande(app)),
    openDaily: () => runOverlay(() => openDaily(app).then(() => refreshActive(true))), // 今日の1問（冒険画面の札・街の掲示板）
    openFloors: () => runOverlay(() => openFloors(app)), // 階層の移動（冒険画面の「移動」）
    debugDay: null,   // デバッグ画面で選んだ日付（今日の1問をその日の問題で試す）
    today: () => app.debugDay || gameDay(new Date()), // 今日の日付（日本時間の朝4時で切り替え。今日の1問・日記・今日の道端。40HzP の判断 2026-11-26）
    tearTest: (teacherId) => runOverlay(() => playTear(app, teacherId)), // テスト用紙を破りすてた（先生が怒る）
    oogiriTest: (teacherId) => runOverlay(() => playOogiri(app, teacherId)), // テストに大喜利を書いて提出した（主人公が赤面する）
    launch: () => scenes.launch(),          // ロケットを打ち上げる（地球 → 月面。失敗することもある）
    returnHome: () => scenes.returnHome(),  // 帰還ロケットで地球に帰る（無料）
    flyPrototype: (id) => scenes.prototypeFlight(id), // 飼育小屋のザコを試作機に乗せて飛ばす（ロケット発射場）
  };

  /* ---------- 知らせ・札・最初の案内・ミニムービー・起きたことの知らせ ---------- */
  const { notify, notifyCard, runOverlay, placeNotices } = createNotices(app);
  const cards = createCards(app, { notifyCard, showTab });
  const { showIntro } = createIntro(app, { heroLooks, saveNow, refreshActive });
  const scenes = createScenes(app, { notify, runOverlay, saveNow, refreshActive, showIntro, resetLaunch: cards.resetLaunch, screens });
  const handleEvents = createEventHandler(app, {
    notify, notifyCard, runOverlay,
    startMovie: scenes.startMovie, startAilmentMovie: scenes.startAilmentMovie, onReincarnated: scenes.onReincarnated, visionMovie: scenes.visionMovie,
    rumorDefeated: cards.rumorDefeated, notifyFirstZukan: cards.notifyFirstZukan, notifyMisbeliefs: cards.notifyMisbeliefs,
  });
  Object.assign(app, { notify, handleEvents, save: saveNow });

  const firstLaunch = !hasSave(); // 初めての起動（前世の最期から始める）
  app.state = loadSave(balance, notify);
  ensureAuthorCode(app.state, cryptoRng); // 作問者コード（作った問題が採用されたら知らせるため）
  const adoptedOnLoad = takeNewAdoptions(app.state, ctx); // 採用された問題があれば、起動したときに一度だけ知らせる
  forgetMissingQuestions(app.state, ctx); // 同期で外した問題が過去問復習に残らないように
  refreshDaily(app.state, ctx, app.today()); // その日に初めて起動したら、今日の1問の札を冒険画面に出す
  const freshDay = diaryVisit(app.state, app.today(), new Date()).fresh; // 日記：遊びに来た（その日初めてなら頁ができる）
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
  // その日初めて開いたら、今日の候と散歩道の天気を知らせる（毎日変わるもの。前世の最期から始まる初めての起動では出さない）
  if (freshDay && !firstLaunch) setTimeout(() => notify(todayNotice(ctx, app.today())), 2500);
  if (benchedOnLoad.length) setTimeout(() => notify(`パーティーは${ctx.balance.ally.partyMax}人までになった。${benchedOnLoad.join('・')}を控えに回した（酒場で入れ替えられる）`), 1500);

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
    // 日記：遊びに来た（離れていた後なら別の回）。画面を見ていない間（裏に回している間）は数えない
    const fresh = document.visibilityState === 'visible' && diaryVisit(app.state, app.today(), new Date()).fresh;
    const daily = refreshDaily(app.state, ctx, app.today());
    if (!daily && !fresh) return;
    notify(daily ? `日付が変わった。今日の1問が届いた（冒険画面の札）\n${todayNotice(ctx, app.today())}` : todayNotice(ctx, app.today()), 'good');
    saveNow();
    refreshActive(true);
  }
  setInterval(checkDay, DAY_CHECK_MS);

  /* ---------- ループ ---------- */
  const clock = createClock();
  let lastUi = 0, lastSave = performance.now();
  let diarySec = 0, lastDiary = performance.now(); // 日記に足す、遊んだ秒数（画面を見ている間）
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') {
      clockFrame(clock, performance.now(), false);   // 戻っても止まっていた分を取り戻さない
      hiddenAt = Date.now();
      saveNow();
    } else {
      if (hiddenAt && Date.now() - hiddenAt >= AWAY_RELAUNCH_MS) cards.resetLaunch(); // しばらく離れていたら、起動し直したことにする
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
      if (visible) cards.countLaunch(realDt);
    }
    const now = nowMs / 1000;
    app.renderer.draw(app.state, now);
    if (app.tab === 'study') study.drawMini(app);
    // 問題を解いている間に取っておいたミニムービー：答え終わったら（勉強画面を離れても）出す
    scenes.releaseHeldMovies();
    syncVision(app); // 色の見え方が違う人生：画面全体の色のフィルタ（変わったときだけ書き換える）
    if (nowMs - lastUi > UI_MS) { lastUi = nowMs; refreshActive(false); }
    if (visible && app.state.meta.startAge != null) diarySec += realDt;
    if (nowMs - lastDiary > DIARY_TICK_MS) { lastDiary = nowMs; if (diarySec > 0) { diaryTick(app.state, app.today(), diarySec, new Date()); diarySec = 0; } }
    if (nowMs - lastSave > AUTOSAVE_MS) { lastSave = nowMs; saveNow(); }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  window.__app = app; // 画面確認（Playwright）とデバッグ用
}

boot();
