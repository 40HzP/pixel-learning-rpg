// 前世の最期（設計ページ「最初の3分」）：初めて起動したときだけ、80歳の前世の主人公が息を引き取る場面から始まる。
// その人の「熟練の記録」が数行だけ流れて、主人公が光になって消え、生まれ変わる（10秒ほど。画面を触れば飛ばせる）。説明はしない。
// 前世は世代に数えず（遊ぶ人の最初の人生が1世代目）、本物の熟練の記録（knowledge.profLog）にも入れない
import { drawSprite } from '../sprites.js';
import { el } from './dom.js';

/** 前世の熟練の記録（設計ページの案。書き方は熟練の記録と同じ）。最後の行は記録が途切れたところ */
export const PROLOGUE_LOG = [
  { when: '12歳', what: '生物', how: 'Lv0→1（この1年に勉強した）', kind: 'up' },
  { when: '34歳', what: '化学', how: 'Lv4→5（この1年に勉強した）', kind: 'up' },
  { when: '61歳', what: '世界史', how: 'Lv6→5（10年勉強していない）', kind: 'down' },
  { when: '79歳', what: '地学', how: 'Lv8→9（この1年に勉強した）', kind: 'up' },
  { when: '80歳', what: '', how: 'ここで記録が途切れている', kind: 'end' },
];

const W = 48, H = 36;      // 絵の大きさ（ドット）
const FEET = 30;           // 足元の行
const FADE_IN = 0.8;       // 暗闇から浮かび上がる
const LINE_AT = [1.2, 2.5, 3.8, 5.1, 6.6]; // 記録の行が出る時刻（秒）
const GONE_FROM = 7.0, GONE_TO = 8.8;      // 主人公が光になって消えていく
const WHITE_FROM = 8.8, WHITE_TO = 9.8;    // 白くなって生まれ変わる
const END = 10.2;
const SKIP_SEC = 0.5;      // 触ったときは、白くなるところまで飛ばす

/** 流す。閉じると解決する Promise を返す */
export function playPrologue(app) {
  return new Promise((resolve) => {
    const cv = el('canvas', { class: 'pixel', width: W, height: H });
    const g = cv.getContext('2d');
    g.imageSmoothingEnabled = false;
    const scale = Math.max(3, Math.min(6, Math.floor((window.innerWidth - 32) / W), Math.floor((window.innerHeight * 0.4) / H)));
    Object.assign(cv.style, { width: W * scale + 'px', height: H * scale + 'px' });
    const items = PROLOGUE_LOG.map((c) => el('li', { class: c.kind, hidden: true },
      el('span', { class: 'when' }, c.when), el('span', { class: 'what' }, c.what), el('span', { class: 'how' }, c.how)));
    const log = el('ol', { class: 'prof-log prologue-log', 'aria-live': 'polite' }, items);
    const white = el('div', { class: 'prologue-white' });
    const overlay = el('div', { class: 'overlay movie prologue', role: 'dialog', 'aria-label': '前世の最期', tabindex: '-1' },
      cv, el('div', { class: 'prologue-head' }, '熟練の記録'), log, el('div', { class: 'movie-hint' }, 'タップで飛ばす'), white);
    document.getElementById('app').append(overlay);

    // 男の子の主人公の年を取った姿（前世の人。性別はまだ選んでいない）。動かさず、立ったまま
    const hero = (app.heroSets.male || {}).old || null;
    // 光の粒（決まった並び。主人公の体から昇っていく）
    const motes = Array.from({ length: 14 }, (_, i) => ({ x: 18 + ((i * 7) % 12), y: FEET - 2 - ((i * 5) % 13), d: (i % 4) * 0.25, s: 6 + (i % 3) * 2 }));
    let start = performance.now() / 1000;
    let raf = 0;
    let closing = false;

    function draw() {
      const t = performance.now() / 1000 - start;
      g.fillStyle = '#000';
      g.fillRect(0, 0, W, H);
      const lit = Math.min(1, t / FADE_IN);
      // 足元の薄い光（夕暮れの地面）
      g.globalAlpha = 0.35 * lit;
      g.fillStyle = '#6e6b80';
      g.fillRect(8, FEET, W - 16, 1);
      g.globalAlpha = 0.15 * lit;
      g.fillRect(4, FEET + 1, W - 8, 1);
      // 主人公：記録が途切れたあと、少しずつ光になって消える
      const gone = Math.max(0, Math.min(1, (t - GONE_FROM) / (GONE_TO - GONE_FROM)));
      if (hero) {
        g.globalAlpha = lit * (1 - gone);
        drawSprite(g, hero, 0, (W - hero.w) / 2, FEET - hero.h);
      }
      g.fillStyle = '#fbe57a';
      for (const m of motes) {
        const p = gone - m.d;
        if (p <= 0 || p >= 1) continue;
        g.globalAlpha = 1 - p;
        g.fillRect(m.x, Math.round(m.y - p * m.s * 2), 1, 1);
      }
      g.globalAlpha = 1;
      items.forEach((li, i) => { li.hidden = t < LINE_AT[i]; });
      white.style.opacity = String(Math.max(0, Math.min(1, (t - WHITE_FROM) / (WHITE_TO - WHITE_FROM))));
      if (t >= END && !closing) finish();
      else raf = requestAnimationFrame(draw);
    }

    function finish() {
      closing = true;
      cancelAnimationFrame(raf);
      overlay.classList.remove('show');
      setTimeout(() => { overlay.remove(); resolve(); }, 500);
    }
    // 触ったら飛ばす：記録を全部出して、すぐ白くなる
    function skip() {
      if (closing) return;
      const t = performance.now() / 1000 - start;
      if (t < WHITE_FROM - SKIP_SEC) start = performance.now() / 1000 - (WHITE_FROM - SKIP_SEC);
    }
    overlay.addEventListener('click', skip);
    overlay.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') { e.preventDefault(); skip(); } });

    draw();
    requestAnimationFrame(() => { overlay.classList.add('show'); overlay.focus(); });
  });
}
