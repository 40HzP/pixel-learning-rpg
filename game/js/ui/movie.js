// ミニムービー：中ボスを倒したときなどに、主人公と相手の絵の下に文を1行ずつ出す（タップで進む）。
// 文は monsters.json の defeatMovie（中ボス）・town.json の病院の ailmentMovie（体の不調）に書く。
// 流れている間はゲームの時間を止め、知らせは終わってから出す（main.js）
import { drawSprite, frameAt } from '../sprites.js';
import { stageFor } from '../sim.js';
import { el } from './dom.js';

const W = 60;          // 絵の幅（ドット）。今の世界の背景（90×160）の真ん中を切り抜いて大きく見せる
const H = 48;          // 絵の高さ（ドット）
const BG_X = 15;       // 背景を切り抜く左端
const BG_TOP = 94;     // 背景を切り抜く上端（地平線の少し上から足元の下まで）
const FEET = 42;       // 足元の行（冒険画面の足元 136 − BG_TOP）
const X = { hero: 11, other: 33, alone: 22 }; // 相手がいないときは主人公を真ん中に
const CHAR_SEC = 0.06; // 1文字を出す間隔（秒）
const FADE_MS = 500;   // 暗転して始まり、暗転して終わる

/**
 * ミニムービーを流す。lines：出す文の並び、otherId：主人公と向き合う魔物の id（null なら主人公だけ）、
 * hero：主人公の絵（'idle'＝いつもの姿、'old'＝年を取った姿）。閉じると解決する Promise を返す
 */
export function playMovie(app, { lines, otherId, hero: heroKey = 'idle' }) {
  return new Promise((resolve) => {
    const cv = el('canvas', { class: 'pixel', width: W, height: H });
    const g = cv.getContext('2d');
    g.imageSmoothingEnabled = false;
    const scale = Math.max(2, Math.min(5, Math.floor((window.innerWidth - 32) / W)));
    Object.assign(cv.style, { width: W * scale + 'px', height: H * scale + 'px' });
    const text = el('span');
    const next = el('span', { class: 'next', hidden: true }, '▼');
    const box = el('div', { class: 'movie-text', 'aria-live': 'polite' }, text, next);
    const overlay = el('div', { class: 'overlay movie', role: 'dialog', 'aria-label': 'ムービー', tabindex: '-1' },
      cv, box, el('div', { class: 'movie-hint' }, 'タップで進む'));
    document.getElementById('app').append(overlay);

    const other = (app.monsterSprites[otherId] || {}).idle || null;
    let index = 0;
    let lineAt = performance.now() / 1000 + FADE_MS / 1000; // 暗転が明けてから文字を出し始める
    let closing = false;
    let raf = 0;

    const shown = (now) => Math.max(0, Math.floor((now - lineAt) / CHAR_SEC));
    function draw() {
      const now = performance.now() / 1000;
      g.clearRect(0, 0, W, H);
      const stage = stageFor(app.state.adventure.floor, app.stages);
      if (stage && stage.bg) drawSprite(g, stage.bg, 0, -BG_X, -BG_TOP);
      else { g.fillStyle = '#6fb042'; g.fillRect(0, 0, W, H); }
      const hero = app.heroSprites[heroKey] || app.heroSprites.idle;
      if (hero) drawSprite(g, hero, frameAt(hero, now), other ? X.hero : X.alone, FEET - hero.h);
      if (other) drawSprite(g, other, frameAt(other, now), X.other, FEET - other.h);
      const line = lines[index] || '';
      const n = Math.min(line.length, shown(now));
      const t = line.slice(0, n);
      if (text.textContent !== t) text.textContent = t;
      next.hidden = n < line.length;
      raf = requestAnimationFrame(draw);
    }

    function advance() {
      if (closing) return;
      const now = performance.now() / 1000;
      const line = lines[index] || '';
      if (shown(now) < line.length) { lineAt = now - line.length * CHAR_SEC; return; } // 途中なら全部出す
      if (index < lines.length - 1) { index++; lineAt = now; return; }
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
