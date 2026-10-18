// テスト用紙を破りすてたときのミニモーション（40HzP の依頼）：用紙が不規則に破れて左右に落ちていき、
// 教室の教壇で、正面を向いた先生が破れた用紙を両手で持って見ながら「な に を や っ て い る ！ ！ ？」などと怒る。
// 主人公は教室の左で汗をかいて立っている。「あやまる」を押すと、汗を飛ばしながらぺこぺことおじぎをして、終わると戻る（40HzP の依頼）。
// 流れている間はゲームの時間を止める（main.js の runOverlay）。途中でタップすると、すぐ怒っているところまで進む
import { drawSprite, frameAt } from '../sprites.js';
import { el } from './dom.js';

/** 先生のセリフ。破りすてるたびに、どれか1つを言う（40HzP の依頼。足すときはここに足す）。顔とは別に選ぶ */
export const SCOLDS = ['な に を や っ て い る ！ ！ ？', 'な ん だ こ れ は ！ ！ ？'];
export const pickScold = (rng = Math.random) => SCOLDS[Math.floor(rng() * SCOLDS.length) % SCOLDS.length];

/**
 * 先生の顔。破りすてるたびに、どちらか（40HzP の依頼）。
 * scold：怒り顔（赤い怒りの印。画面が赤く光る）／puzzled：困惑顔（困り眉で目を見開き、汗と「！」。光らない）。吹き出しの字はどちらも赤
 */
export const MOODS = ['scold', 'puzzled'];
export const pickMood = (rng = Math.random) => MOODS[Math.floor(rng() * MOODS.length) % MOODS.length];

const GRIP_MS = 350;    // 用紙を両手でつかんで、ぶるぶるさせる
const FALL_MS = 900;    // 破れて、左右に分かれて落ちていく
const FADE_MS = 300;    // 暗転して始まり、暗転して終わる
const BOW_MS = 2000;    // あやまる（ぺこぺこおじぎを4回）
// 教室の絵（scene_classroom 64×48）の上に、先生（<先生>_scold 32×32）と、その前に教卓（scene_lectern）を重ねる
// 主人公（hero_bow 24×16。1枚目は汗をかいて立っている姿、2〜4枚目でおじぎ）は教室の左、教壇の手前に立つ
export const SCENE = { w: 64, h: 48, teacher: [16, 6], lectern: [19, 34], hero: [0, 31] }; // 大喜利のミニムービー（oogiri.js）も同じ並び

/** 主人公の年齢の学校の先生（7歳より前と7〜12歳は小学校、13歳から中学校、16歳から高校、19歳から大学教授） */
const TEACHERS = [[19, 'professor'], [16, 'teacher_high'], [13, 'teacher_junior'], [0, 'teacher_elementary']];
export const teacherForAge = (age) => TEACHERS.find(([from]) => age >= from)[1];

/**
 * 破れ目の線（上の端から下の端まで、[x%, y%] の並び）。決まった形のぎざぎざではなく、毎回ちがう不規則な線にする：
 * 少しずつ斜めにずれながら細かく揺れ、ときどき大きく裂ける。用紙の左右の端には寄りすぎない
 */
export function tearLine(rng = Math.random) {
  let x = 40 + rng() * 20;
  let y = 0;
  const drift = (rng() - 0.5) * 0.6; // 全体の傾き（斜めに破れる）
  const pts = [[+x.toFixed(1), 0]];
  while (y < 100) {
    const step = 1.5 + rng() * 6;
    y = Math.min(100, y + step);
    const jolt = rng() < 0.18 ? (rng() - 0.5) * 16 : (rng() - 0.5) * 4;
    x = Math.max(22, Math.min(78, x + drift * step + jolt));
    pts.push([+x.toFixed(1), +y.toFixed(1)]);
  }
  return pts;
}

/** 破れ目の線で切り分けた左右の形（CSS の clip-path） */
export function tearClips(pts) {
  const path = pts.map(([x, y]) => `${x}% ${y}%`).join(', ');
  return { left: `polygon(0% 0%, ${path}, 0% 100%)`, right: `polygon(${path}, 100% 100%, 100% 0%)` };
}

/** 破りすてるミニモーションを流す。閉じると解決する Promise を返す */
export function playTear(app, teacherId) {
  return new Promise((resolve) => {
    const m = app.ctx.monsters.find((x) => x.id === teacherId);
    const sprites = app.monsterSprites[teacherId] || {};
    const mood = pickMood();
    const teacher = sprites[mood] || sprites.scold || sprites.idle || null; // 正面を向いて破れた用紙を持つ絵（無ければいつもの絵）
    const { classroom, lectern } = app.sceneSprites || {};
    const hero = app.heroSprites.bow || null;

    // 用紙は同じものを2枚重ね、毎回ちがう破れ目の線で左右に切り分けておく（破れると左右に分かれて落ちる）
    const clips = tearClips(tearLine());
    const half = (side) => el('div', { class: `tear-half ${side}` },
      el('div', { class: 'tear-paper', style: { clipPath: clips[side], webkitClipPath: clips[side] } },
        el('div', { class: 'tear-title' }, 'テスト', el('span', {}, `名前　${app.state.hero.name}`)),
        el('div', { class: 'tear-lines' })));
    const paper = el('div', { class: 'tear-sheet' }, half('left'), half('right'));

    // 教室：教壇で先生が破れた用紙を見ながら怒る
    const scale = Math.max(2, Math.min(5, Math.floor((window.innerWidth - 32) / SCENE.w)));
    const cv = el('canvas', { class: 'pixel', width: SCENE.w, height: SCENE.h });
    Object.assign(cv.style, { width: SCENE.w * scale + 'px', height: SCENE.h * scale + 'px' });
    const g = cv.getContext('2d');
    g.imageSmoothingEnabled = false;
    const scene = el('div', { class: 'scold-scene' },
      el('div', { class: 'scold-bubble' }, pickScold()), cv, el('div', { class: 'scold-name' }, m ? m.name : '先生'));

    const sorryBtn = el('button', { class: 'primary sorry', onclick: (e) => { e.stopPropagation(); apologize(); } }, 'あやまる');
    // 顔の種類は mood-◯◯ の印で付ける（scold は「怒っている場面に進んだ」の印なので、名前を分ける）
    const overlay = el('div', { class: `overlay tear mood-${mood}`, role: 'dialog', 'aria-label': 'テスト用紙を破りすてた', tabindex: '-1' },
      el('div', { class: 'tear-box' }, paper, scene), sorryBtn);
    document.getElementById('app').append(overlay);

    let raf = 0;
    let closing = false;
    let sorryAt = null; // あやまり始めた時刻（秒）
    const timers = [];
    const at = (ms, fn) => timers.push(setTimeout(fn, ms));
    const draw = () => {
      const now = performance.now() / 1000;
      g.clearRect(0, 0, SCENE.w, SCENE.h);
      if (classroom) drawSprite(g, classroom, 0, 0, 0);
      else { g.fillStyle = '#1f4a3a'; g.fillRect(0, 0, SCENE.w, SCENE.h); }
      if (teacher) {
        // 32×32 の正面の絵はそのまま。16×16 のいつもの絵（予備）は教卓の上に見えるように置く
        const [tx, ty] = teacher.w > 16 ? SCENE.teacher : [24, 20];
        drawSprite(g, teacher, frameAt(teacher, now), tx, ty);
      }
      if (lectern) drawSprite(g, lectern, 0, SCENE.lectern[0], SCENE.lectern[1]);
      if (hero) {
        // あやまるまでは1枚目（汗をかいて立っている）。あやまったら、おじぎの絵をくり返す
        const i = sorryAt == null ? 0 : Math.floor((now - sorryAt) * hero.fps) % hero.frames.length;
        drawSprite(g, hero, i, SCENE.hero[0], SCENE.hero[1]);
      }
      raf = requestAnimationFrame(draw);
    };
    const scolding = () => overlay.classList.contains('scold');
    const scold = () => { for (const c of ['grip', 'torn', 'scold']) overlay.classList.add(c); };

    at(FADE_MS, () => overlay.classList.add('grip'));
    at(FADE_MS + GRIP_MS, () => overlay.classList.add('torn'));
    at(FADE_MS + GRIP_MS + FALL_MS, scold);

    function close() {
      if (closing) return;
      closing = true;
      overlay.classList.remove('show');
      setTimeout(() => { cancelAnimationFrame(raf); overlay.remove(); resolve(); }, FADE_MS);
    }
    /** 「あやまる」：汗を飛ばしながら、ぺこぺことおじぎをする。終わったら戻る */
    function apologize() {
      if (closing || sorryAt != null) return;
      if (!scolding()) { for (const t of timers) clearTimeout(t); scold(); }
      sorryAt = performance.now() / 1000;
      overlay.classList.add('sorry');
      setTimeout(close, BOW_MS);
    }
    function advance() {
      if (closing) return;
      if (!scolding()) { for (const t of timers) clearTimeout(t); scold(); return; } // 途中なら、すぐ怒っているところへ
      if (sorryAt != null) close(); // おじぎの途中でタップしたら、すぐ戻る
    }
    overlay.addEventListener('click', advance);
    overlay.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      if (scolding() && sorryAt == null) apologize(); else advance();
    });

    draw();
    requestAnimationFrame(() => { overlay.classList.add('show'); overlay.focus(); });
  });
}
