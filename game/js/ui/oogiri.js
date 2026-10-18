// テストに大喜利（フリースペース）を書いて提出したときのミニムービー（40HzP の依頼）：
// 教室の教壇で、主人公の年齢の学校の先生が答案を持って、3つのセリフのどれかを言う。言われたあと、主人公が赤面する（湯気が出る）。
// 流れている間はゲームの時間を止める（main.js の runOverlay）。タップで進む（セリフの途中なら全部出して赤面、赤面したあとは戻る）
import { drawSprite, frameAt } from '../sprites.js';
import { el } from './dom.js';
import { SCENE } from './tear.js';

/**
 * 先生のセリフ（40HzP の依頼）と、そのときの先生の顔（<先生>_oogiri_<顔>）。{name} に主人公の名前が入る。
 * 提出するたびに、どれか1つを言う（足すときはここに足す。顔は puzzled・smile・stern のどれか）
 */
export const OOGIRI_LINES = [
  { mood: 'puzzled', text: '{name}君、これはどういう意味でしょうか？' },
  { mood: 'smile', text: '{name}君、採点の際にこちらの回答、笑わせていただきました。次は間違えないようにしてください。' },
  { mood: 'stern', text: '{name}、職員室で話がありますので、放課後来るように。' },
];
export const OOGIRI_MOODS = ['puzzled', 'smile', 'stern'];
export const pickOogiriLine = (rng = Math.random) => OOGIRI_LINES[Math.floor(rng() * OOGIRI_LINES.length) % OOGIRI_LINES.length];
export const oogiriText = (line, name) => line.text.replaceAll('{name}', name);

const FADE_MS = 300;      // 暗転して始まり、暗転して終わる
const TYPE_MS = 60;       // セリフの字が1つずつ出る間隔
const BLUSH_MS = 700;     // セリフを言い終わってから赤面するまで

/** 大喜利のミニムービーを流す。閉じると解決する Promise を返す */
export function playOogiri(app, teacherId) {
  return new Promise((resolve) => {
    const m = app.ctx.monsters.find((x) => x.id === teacherId);
    const line = pickOogiriLine();
    const all = app.monsterSprites[teacherId] || {};
    const teacher = (all.oogiri || {})[line.mood] || all.idle || null; // 正面を向いて答案を持つ絵（無ければいつもの絵）
    const { classroom, lectern } = app.sceneSprites || {};
    const hero = app.heroSprites.blush || null; // 1枚目はふつうに立つ姿、2枚目から赤面
    const text = oogiriText(line, app.state.hero.name);

    const scale = Math.max(2, Math.min(5, Math.floor((window.innerWidth - 32) / SCENE.w)));
    const cv = el('canvas', { class: 'pixel', width: SCENE.w, height: SCENE.h });
    Object.assign(cv.style, { width: SCENE.w * scale + 'px', height: SCENE.h * scale + 'px' });
    const g = cv.getContext('2d');
    g.imageSmoothingEnabled = false;
    const said = el('span');
    const bubble = el('div', { class: 'oogiri-bubble' }, said, el('span', { class: 'rest', 'aria-hidden': 'true' }, text));
    const hint = el('div', { class: 'oogiri-hint' }, 'タップで戻る');
    const overlay = el('div', { class: `overlay oogiri mood-${line.mood}`, role: 'dialog', 'aria-label': '大喜利の答えを提出した', tabindex: '-1' },
      bubble, cv, el('div', { class: 'scold-name' }, m ? m.name : '先生'), hint);
    document.getElementById('app').append(overlay);

    let raf = 0;
    let closing = false;
    let shown = 0;          // 出した字の数
    let blushAt = null;     // 赤面し始めた時刻（秒）
    const timers = [];
    const at = (ms, fn) => timers.push(setTimeout(fn, ms));
    const draw = () => {
      const now = performance.now() / 1000;
      g.clearRect(0, 0, SCENE.w, SCENE.h);
      if (classroom) drawSprite(g, classroom, 0, 0, 0);
      else { g.fillStyle = '#1f4a3a'; g.fillRect(0, 0, SCENE.w, SCENE.h); }
      if (teacher) {
        const [tx, ty] = teacher.w > 16 ? SCENE.teacher : [24, 20];
        drawSprite(g, teacher, frameAt(teacher, now), tx, ty);
      }
      if (lectern) drawSprite(g, lectern, 0, SCENE.lectern[0], SCENE.lectern[1]);
      if (hero) {
        const n = hero.frames.length;
        const i = blushAt == null || n < 2 ? 0 : 1 + Math.floor((now - blushAt) * hero.fps) % (n - 1);
        drawSprite(g, hero, i, SCENE.hero[0], SCENE.hero[1]);
      }
      raf = requestAnimationFrame(draw);
    };
    const showText = (n) => {
      shown = n;
      said.textContent = text.slice(0, n);
      bubble.lastChild.textContent = text.slice(n); // まだ出していない字は見えない形で置いておく（吹き出しの大きさを変えない）
    };
    const blush = () => {
      for (const t of timers.splice(0)) clearTimeout(t);
      showText(text.length);
      if (blushAt == null) blushAt = performance.now() / 1000;
      overlay.classList.add('blush');
    };
    const type = () => {
      if (shown >= text.length) { at(BLUSH_MS, blush); return; }
      showText(shown + 1);
      at(TYPE_MS, type);
    };
    showText(0);
    at(FADE_MS, () => { overlay.classList.add('talk'); type(); });

    function close() {
      if (closing) return;
      closing = true;
      for (const t of timers) clearTimeout(t);
      overlay.classList.remove('show');
      setTimeout(() => { cancelAnimationFrame(raf); overlay.remove(); resolve(); }, FADE_MS);
    }
    function advance() {
      if (closing) return;
      if (blushAt == null) blush(); // 途中なら、すぐ言い終えて赤面する
      else close();
    }
    overlay.addEventListener('click', advance);
    overlay.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      advance();
    });

    draw();
    requestAnimationFrame(() => { overlay.classList.add('show'); overlay.focus(); });
  });
}
