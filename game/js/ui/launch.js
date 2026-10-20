// ロケットのミニムービー（90×160）：3・2・1で火がつき、打ち上げ場から飛び立って、行き先の発着場に降りる。
// 地球→月面（打ち上げ）・月面→地球（帰還ロケット）・打ち上げの失敗（少し浮いて落ちる）。
// 絵は scene_launchpad（地球の打ち上げ場）・bg_moon_town（月面の街）と rocket_flight（16×48。1枚目は炎なし、2・3枚目は炎）。
// 流れている間はゲームの時間を止め、知らせは終わってから出す（main.js の runOverlay）
import { drawSprite, cssColor } from '../sprites.js';
import { el } from './dom.js';

const W = 90;
const H = 160;
const FADE_MS = 500;      // 暗転して始まり、暗転して終わる
const COUNT_SEC = 0.6;    // 「3」「2」「1」の間隔
const SHAKE_SEC = 0.6;    // 火がついてから浮き上がるまで（ぶるぶる震える）
const RISE_ACCEL = 70;    // 上がっていく加速度（ドット/秒²）
const SWITCH_SEC = 0.5;   // 画面の外へ出てから、行き先に切り替わるまでの暗転
const LAND_SEC = 2.2;     // 行き先に降りるまで
const FAIL_SEC = 1.6;     // 失敗：少し浮いて、火が消えて落ちるまで
const CHAR_SEC = 0.06;    // 文を1文字ずつ出す間隔
const FLAME_FPS = 10;

/** 発着場の上のロケット（16×48）の左上。地球は打ち上げ場、月面は月面の街の帰還ロケットの場所 */
export const PADS = { earth: { x: 37, y: 98 }, moon: { x: 61, y: 38 } };

/**
 * ロケットのミニムービーを流す。from：飛び立つ世界（earth・moon）、to：行き先（失敗なら null）、
 * lines：降りたあと（失敗したあと）に出す文。閉じると解決する Promise を返す
 */
export function playLaunch(app, { from, to, lines }) {
  return new Promise((resolve) => {
    const cv = el('canvas', { class: 'pixel', width: W, height: H });
    const g = cv.getContext('2d');
    g.imageSmoothingEnabled = false;
    const scale = Math.max(1, Math.floor(Math.min((window.innerWidth - 24) / W, (window.innerHeight - 160) / H)));
    Object.assign(cv.style, { width: W * scale + 'px', height: H * scale + 'px' });
    const text = el('span');
    const next = el('span', { class: 'next', hidden: true }, '▼');
    const box = el('div', { class: 'movie-text', 'aria-live': 'polite' }, text, next);
    const hint = el('div', { class: 'movie-hint' }, 'タップで飛ばす');
    const overlay = el('div', { class: 'overlay movie launch', role: 'dialog', 'aria-label': 'ロケット', tabindex: '-1' }, cv, box, hint);
    document.getElementById('app').append(overlay);

    const rocket = app.sceneSprites.rocket;
    const scenes = {
      earth: { bg: app.sceneSprites.launchpad, extra: [] },
      moon: { bg: app.moonTown.bg, extra: app.moonTown.facilities.filter((f) => f.id !== 'moon_rocket').map((f) => ({ sp: app.moonTown.sprites[f.id], x: f.x, y: f.y })) },
    };
    const T0 = 3 * COUNT_SEC;            // 火がつく
    const T1 = T0 + SHAKE_SEC;           // 浮き上がる
    const T2 = T1 + Math.sqrt((2 * (PADS[from].y + 48)) / RISE_ACCEL);  // 画面の外へ出る
    const T3 = T2 + SWITCH_SEC;          // 行き先が見え始める
    const end = to ? T3 + LAND_SEC : T1 + FAIL_SEC;
    let start = performance.now() / 1000 + FADE_MS / 1000;
    let lineIndex = -1;                  // 降りたあとの文（-1＝まだ）
    let lineAt = 0;
    let closing = false;
    let raf = 0;

    const col = (k) => cssColor(app.palette, k, '#a9a7b8');
    function puff(x, y, r, k) {
      g.fillStyle = col(k);
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
    function drawScene(world) {
      const sc = scenes[world];
      if (sc.bg) drawSprite(g, sc.bg, 0, 0, 0);
      for (const e of sc.extra) if (e.sp) drawSprite(g, e.sp, 0, e.x, e.y);
    }
    function drawRocket(x, y, fire, now) {
      if (!rocket) return;
      const f = fire ? 1 + (Math.floor(now * FLAME_FPS) % 2) : 0;
      drawSprite(g, rocket, f, Math.round(x), Math.round(y));
    }
    /** 発着場の煙（火がついてからの秒数 s に合わせて広がる） */
    function smoke(world, s, big = false) {
      const p = PADS[world];
      const n = big ? 7 : 5;
      for (let i = 0; i < n; i++) {
        const side = i % 2 ? 1 : -1;
        const spread = Math.min(1, s / 1.5);
        const x = p.x + 8 + side * (2 + i * 3) * spread * (big ? 1.4 : 1);
        const y = p.y + 30 - i * 0.5 - spread * (big ? 6 : 2);
        puff(x, y, 2 + spread * (big ? 4 : 3) - i * 0.2, i % 3 ? '3' : '4');
      }
    }

    function draw() {
      const now = performance.now() / 1000;
      const t = now - start;
      g.clearRect(0, 0, W, H);
      const p = PADS[from];
      let label = '';
      if (t < T0) {
        drawScene(from);
        drawRocket(p.x, p.y, false, now);
        label = t < 0 ? '' : String(3 - Math.floor(t / COUNT_SEC));
      } else if (!to) {
        // 失敗：少し浮いて、炎がとぎれ、落ちて煙に包まれる
        drawScene(from);
        const s = t - T1;
        let dy = 0;
        if (s > 0) dy = s < 0.6 ? -8 * (1 - (1 - s / 0.6) ** 2) : s < 0.9 ? -8 * (1 - (s - 0.6) / 0.3) : 0;
        const shake = t < T1 + 0.9 ? (Math.floor(now * 30) % 2 ? 1 : -1) : 0;
        const fire = s < 0.6 && Math.floor(now * 14) % 3 !== 0;
        if (t >= T0) smoke(from, t - T0, s > 0.9);
        drawRocket(p.x + shake, p.y + dy, fire, now);
        label = s > 0.9 ? 'ぷすん…' : '発射！';
      } else if (t < T2) {
        drawScene(from);
        const s = Math.max(0, t - T1);
        const shake = t < T1 ? (Math.floor(now * 30) % 2 ? 1 : -1) : 0;
        smoke(from, t - T0);
        drawRocket(p.x + shake, p.y - 0.5 * RISE_ACCEL * s * s, true, now);
        label = '発射！';
      } else {
        // 行き先：上から降りてきて、発着場に着く
        const q = PADS[to];
        const s = Math.min(1, Math.max(0, (t - T3) / LAND_SEC));
        drawScene(to);
        const y = -48 + (q.y + 48) * (1 - (1 - s) ** 2);
        if (s >= 1) smoke(to, Math.min(1.2, t - (T3 + LAND_SEC)) + 0.3);
        drawRocket(q.x, y, s < 1, now);
        if (t < T3) { g.fillStyle = '#000'; g.fillRect(0, 0, W, H); }
        else if (t < T3 + SWITCH_SEC / 2) { g.globalAlpha = 1 - (t - T3) / (SWITCH_SEC / 2); g.fillStyle = '#000'; g.fillRect(0, 0, W, H); g.globalAlpha = 1; }
      }
      // 終わったら、文を1つずつ出す（タップで進む）
      if (t >= end && lineIndex < 0) { lineIndex = 0; lineAt = now; hint.textContent = 'タップで進む'; }
      if (lineIndex >= 0) {
        const line = lines[lineIndex] || '';
        const n = Math.min(line.length, Math.floor((now - lineAt) / CHAR_SEC));
        label = line.slice(0, n);
        next.hidden = n < line.length;
      }
      if (text.textContent !== label) text.textContent = label;
      raf = requestAnimationFrame(draw);
    }

    function advance() {
      if (closing) return;
      const now = performance.now() / 1000;
      if (lineIndex < 0) { start = now - end; return; }                 // 動いている途中なら最後まで飛ばす
      const line = lines[lineIndex] || '';
      if (Math.floor((now - lineAt) / CHAR_SEC) < line.length) { lineAt = now - line.length * CHAR_SEC; return; }
      if (lineIndex < lines.length - 1) { lineIndex++; lineAt = now; return; }
      closing = true;
      overlay.classList.remove('show');
      setTimeout(() => { cancelAnimationFrame(raf); overlay.remove(); resolve(); }, FADE_MS);
    }
    overlay.addEventListener('click', advance);
    overlay.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); advance(); } });

    draw();
    requestAnimationFrame(() => { overlay.classList.add('show'); overlay.focus(); });
  });
}
