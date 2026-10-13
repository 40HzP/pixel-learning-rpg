// 起動・画面切り替え・ループ・セーブ
import {
  createState, startGame, tick, clockFrame, createClock,
  createRateTracker, trackTime, trackGain, sleep,
} from './sim.js';
import { SAVE_KEY, serialize, deserialize } from './save.js';
import { loadPalette, loadSprite } from './sprites.js';
import { createRenderer, SCENE_W, SCENE_H } from './render.js';
import * as adventure from './ui/adventure.js';
import * as study from './ui/study.js';
import * as facility from './ui/facility.js';
import * as zukan from './ui/zukan.js';
import * as debug from './ui/debug.js';
import { el } from './ui/dom.js';

const PIXEL = '../pixel/';
const SPRITES = PIXEL + 'sprites/';
const AUTOSAVE_MS = 10_000;
const UI_MS = 200;

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
  let balance, monsters, items, questions;
  try {
    [balance, { monsters }, { items }, { questions }] = await Promise.all([
      fetchJSON('data/balance.json'), fetchJSON('data/monsters.json'),
      fetchJSON('data/items.json'), fetchJSON('data/questions.json'),
    ]);
  } catch (e) {
    document.querySelector('#loading .dialog').textContent = 'ゲームのデータを読めませんでした。\n' + e.message;
    return;
  }

  const palette = await loadPalette(PIXEL + 'palette.json');
  const load = (name) => loadSprite(name, palette, SPRITES);
  const monsterSprites = {};
  await Promise.all([
    ...monsters.map(async (m) => {
      monsterSprites[m.id] = { idle: await load(m.sprites.idle), attack: await load(m.sprites.attack) };
    }),
  ]);
  const [heroIdle, heroAttack, bg] = await Promise.all([load('hero_idle'), load('hero_attack'), load('bg_floor01')]);

  const ctx = { balance, monsters, items, questions, rng: Math.random };
  const app = {
    ctx, palette, monsterSprites,
    heroSprites: { idle: heroIdle, attack: heroAttack },
    bg,
    state: null,
    speed: 1,
    debug: params.get('debug') === '1',
    rate: createRateTracker(),
    tab: 'adventure',
    noSave: false,
    notify,
    handleEvents,
    save: saveNow,
    replaceState(next) { app.state = next; app.rate = createRateTracker(); for (const s of Object.values(screens)) s.reset && s.reset(app); refreshActive(true); },
    sleepNow(reason = 'bed') {
      const r = sleep(app.state, ctx, reason);
      notifySleep(r);
      saveNow();
      return r;
    },
    showTab,
  };
  app.state = loadSave(balance, notify);
  app.renderer = createRenderer(document.getElementById('scene'), app);

  for (const s of Object.values(screens)) s.init(app);

  /* ---------- 通知 ---------- */
  function notify(text, kind = '') {
    const box = document.getElementById('notices');
    if (box.lastElementChild && box.lastElementChild.textContent === text) return;
    const n = el('div', { class: 'notice ' + kind }, text);
    box.append(n);
    while (box.children.length > 2) box.firstElementChild.remove();
    setTimeout(() => n.remove(), kind === 'bad' ? 6000 : 3500);
  }
  function notifySleep(r) {
    const lines = [r.reason === 'defeated' ? 'やられた…　1階層に戻って眠った' : `${r.hours}時間眠った。HPが全回復した`];
    lines.push(r.up.length ? `熟練が上がった：${r.up.join('・')}` : '熟練が上がったジャンルはなかった');
    if (r.down.length) lines.push(`熟練が下がった：${r.down.join('・')}`);
    notify(lines.join('\n'), r.reason === 'defeated' ? 'bad' : 'good');
  }

  function handleEvents(events) {
    app.renderer.onEvents(events, performance.now() / 1000);
    for (const e of events) {
      if (e.type === 'defeat') trackGain(app.rate, e.exp, e.gold);
      else if (e.type === 'levelUp') notify(`レベルが上がった！　Lv ${e.level}`, 'good');
      else if (e.type === 'floorUp') notify(`${e.floor}階層に進んだ`);
      else if (e.type === 'heroDefeated') notifySleep(e.sleep);
      else if (e.type === 'spawn' && e.kind === 'midboss' && e.first) notify('小学校教師が現れた！\n勉強で5問正解するまで攻撃が効かない', 'bad');
      else if (e.type === 'midbossBroken') notify('小学校教師の防御が崩れた！', 'good');
      else if (e.type === 'allyJoined') notify(`${e.name}が仲間になった！`, 'good');
      else if (e.type === 'zukan' && e.stage === 1) {
        const m = monsters.find((x) => x.id === e.monsterId);
        if (m) notify(`図鑑に${m.name}が載った`);
      }
    }
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
  }
  window.addEventListener('resize', layoutStage);
  layoutStage();

  /* ---------- 最初の案内 ---------- */
  const intro = document.getElementById('intro');
  if (app.state.meta.startAge == null) intro.hidden = false;
  for (const b of intro.querySelectorAll('[data-age]')) {
    b.addEventListener('click', () => {
      startGame(app.state, Number(b.dataset.age));
      intro.hidden = true;
      saveNow();
      refreshActive(true);
    });
  }
  document.getElementById('loading').hidden = true;

  /* ---------- ループ ---------- */
  const clock = createClock();
  let lastUi = 0, lastSave = performance.now();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') {
      clockFrame(clock, performance.now(), false);   // 戻っても止まっていた分を取り戻さない
      saveNow();
    }
  });
  window.addEventListener('pagehide', saveNow);

  function frame(nowMs) {
    const visible = document.visibilityState === 'visible';
    const realDt = clockFrame(clock, nowMs, visible, balance.time.maxFrameSeconds);
    if (app.state.meta.startAge != null) {
      const dt = realDt * app.speed;
      trackTime(app.rate, dt);
      const events = tick(app.state, dt, ctx);
      if (events.length) handleEvents(events);
      study.frame(app, realDt);
    }
    const now = nowMs / 1000;
    app.renderer.draw(app.state, now);
    if (app.tab === 'study') study.drawMini(app);
    if (nowMs - lastUi > UI_MS) { lastUi = nowMs; refreshActive(false); }
    if (nowMs - lastSave > AUTOSAVE_MS) { lastSave = nowMs; saveNow(); }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  window.__app = app; // 画面確認（Playwright）とデバッグ用
}

boot();
