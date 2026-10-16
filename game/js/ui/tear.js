// テスト用紙を破りすてたときのミニモーション（40HzP の依頼）：用紙がまん中から破れて落ちていき、
// 先生が出てきて「な に を や っ て い る ！ ！ ？」と怒る。流れている間はゲームの時間を止める（main.js の runOverlay）。
// 怒り終わったらタップで戻る（途中でタップすると、すぐ怒っているところまで進む）
import { drawSprite, frameAt } from '../sprites.js';
import { el } from './dom.js';

export const SCOLD = 'な に を や っ て い る ！ ！ ？';

const GRIP_MS = 350;    // 用紙を両手でつかんで、ぶるぶるさせる
const FALL_MS = 900;    // 破れて、左右に分かれて落ちていく
const SCOLD_MS = 250;   // 先生が下から出てくる
const FADE_MS = 300;    // 暗転して始まり、暗転して終わる
const SCALE = 7;        // 先生の絵の倍率（16×16 → 112px）

/** 主人公の年齢の学校の先生（7歳より前と7〜12歳は小学校、13歳から中学校、16歳から高校、19歳から大学教授） */
const TEACHERS = [[19, 'professor'], [16, 'teacher_high'], [13, 'teacher_junior'], [0, 'teacher_elementary']];
export const teacherForAge = (age) => TEACHERS.find(([from]) => age >= from)[1];

/** 破りすてるミニモーションを流す。閉じると解決する Promise を返す */
export function playTear(app, teacherId) {
  return new Promise((resolve) => {
    const m = app.ctx.monsters.find((x) => x.id === teacherId);
    const sprites = app.monsterSprites[teacherId] || {};
    const sp = sprites.attack || sprites.idle || null; // 攻撃の2枚（赤ペンを振り上げる）をくり返して、怒っている様子にする
    const cv = el('canvas', { class: 'pixel', width: sp ? sp.w : 16, height: sp ? sp.h : 16 });
    Object.assign(cv.style, { width: (sp ? sp.w : 16) * SCALE + 'px', height: (sp ? sp.h : 16) * SCALE + 'px' });
    const g = cv.getContext('2d');
    g.imageSmoothingEnabled = false;

    // 用紙は同じものを2枚重ね、ぎざぎざの線で左右に切り分けておく（破れると左右に分かれて落ちる）
    const half = (side) => el('div', { class: `tear-paper ${side}` },
      el('div', { class: 'tear-title' }, 'テスト', el('span', {}, `名前　${app.state.hero.name}`)),
      el('div', { class: 'tear-lines' }));
    const teacher = el('div', { class: 'tear-teacher' },
      el('div', { class: 'scold-bubble' }, SCOLD), cv, el('div', { class: 'scold-name' }, m ? m.name : '先生'));
    const stage = el('div', { class: 'tear-stage' }, half('left'), half('right'), teacher);
    const hint = el('div', { class: 'movie-hint' }, 'タップで戻る');
    const overlay = el('div', { class: 'overlay tear', role: 'dialog', 'aria-label': 'テスト用紙を破りすてた', tabindex: '-1' }, stage, hint);
    document.getElementById('app').append(overlay);

    let raf = 0;
    let closing = false;
    const timers = [];
    const at = (ms, fn) => timers.push(setTimeout(fn, ms));
    const draw = () => {
      g.clearRect(0, 0, cv.width, cv.height);
      if (sp) drawSprite(g, sp, frameAt(sp, performance.now() / 1000), 0, 0);
      raf = requestAnimationFrame(draw);
    };
    const scolding = () => overlay.classList.contains('scold');
    const scold = () => { for (const c of ['grip', 'torn', 'scold']) overlay.classList.add(c); };

    at(FADE_MS, () => overlay.classList.add('grip'));
    at(FADE_MS + GRIP_MS, () => overlay.classList.add('torn'));
    at(FADE_MS + GRIP_MS + FALL_MS - SCOLD_MS, scold);

    function advance() {
      if (closing) return;
      if (!scolding()) { for (const t of timers) clearTimeout(t); scold(); return; } // 途中なら、すぐ怒っているところへ
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
