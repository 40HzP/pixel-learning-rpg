// 前世の最期（設計ページ「最初の3分」）：初めて起動したときだけ、80歳の前世の主人公が息を引き取る場面から始まる。
// その人の「熟練の記録」が数行だけ流れて、主人公が光になって消え、生まれ変わる（10秒ほど。画面を触れば飛ばせる）。説明はしない。
// 前世は世代に数えず（遊ぶ人の最初の人生が1世代目）、本物の熟練の記録（knowledge.profLog）にも入れない。
// 寿命で生まれ変わるときも同じ場面で、終わったばかりの人生の本物の熟練の記録から数行を流す（設計ページ「生まれ変わるたびの『前世の記憶をたどる』」の案。main.js）。
// そのとき、懐いた飼育小屋のザコたちが主人公の両側に並んで見送る（設計ページ「懐き度」の③。初回の作り話の前世には出ない）
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

const BASE_W = 48, H = 36; // 絵の大きさ（ドット）。見送るザコがいれば横に広げる（FRIENDS_W）
const FRIENDS_W = 96;
// 見送るザコの立つ場所（絵の真ん中からのずれ。主人公の右・左・右・左の順）
const FRIEND_DX = [10, -26, 28, -44];
const FEET = 30;           // 足元の行
const FADE_IN = 0.8;       // 暗闇から浮かび上がる
const FIRST_LINE = 1.2;    // 記録の1行目が出る時刻（秒）
const LINE_GAP = 1.3;      // 次の行までの間
const LAST_GAP = 1.5;      // 最後の行（記録が途切れている）までの間
const GONE_SEC = 1.8;      // 主人公が光になって消えていく長さ（最後の行の0.4秒あとから）
const WHITE_SEC = 1.0;     // 白くなって生まれ変わる
const SKIP_SEC = 0.5;      // 触ったときは、白くなるところまで飛ばす

/**
 * 流す。閉じると解決する Promise を返す。
 * 生まれ変わるときは log（{ when, what, how, kind } の並び。最後は「ここで記録が途切れている」）・head（見出し）・sub（その人生のまとめ）・
 * gender（年を取った姿の絵。男の子は hero_old_idle、女の子は heroine_old_idle）・friends（見送るザコ { sprite, name } の並び）を渡す。
 * 渡さなければ初めての起動の作り話の前世
 */
export function playPrologue(app, { log = PROLOGUE_LOG, head = '熟練の記録', sub = null, gender = 'male', friends = [] } = {}) {
  const seeOff = friends.filter((f) => f.sprite).slice(0, FRIEND_DX.length);
  const W = seeOff.length ? FRIENDS_W : BASE_W;
  const OX = (W - BASE_W) / 2; // 主人公と光の粒は真ん中
  const n = log.length;
  const LINE_AT = log.map((_, i) => (i < n - 1 ? FIRST_LINE + i * LINE_GAP : FIRST_LINE + Math.max(0, n - 2) * LINE_GAP + (n > 1 ? LAST_GAP : 0)));
  const GONE_FROM = LINE_AT[n - 1] + 0.4, GONE_TO = GONE_FROM + GONE_SEC;
  const WHITE_FROM = GONE_TO, WHITE_TO = WHITE_FROM + WHITE_SEC;
  const END = WHITE_TO + 0.4;
  return new Promise((resolve) => {
    const cv = el('canvas', { class: 'pixel', width: W, height: H });
    const g = cv.getContext('2d');
    g.imageSmoothingEnabled = false;
    const scale = Math.max(3, Math.min(6, Math.floor((window.innerWidth - 32) / W), Math.floor((window.innerHeight * 0.4) / H)));
    Object.assign(cv.style, { width: W * scale + 'px', height: H * scale + 'px' });
    const items = log.map((c) => el('li', { class: c.kind, hidden: true },
      el('span', { class: 'when' }, c.when), el('span', { class: 'what' }, c.what), el('span', { class: 'how' }, c.how)));
    const list = el('ol', { class: 'prof-log prologue-log', 'aria-live': 'polite' }, items);
    const white = el('div', { class: 'prologue-white' });
    const overlay = el('div', { class: 'overlay movie prologue', role: 'dialog', 'aria-label': '前世の最期', tabindex: '-1' },
      cv, el('div', { class: 'prologue-head' }, head), sub ? el('div', { class: 'prologue-sub' }, sub) : null,
      seeOff.length ? el('div', { class: 'prologue-sub' }, `${seeOff.map((f) => f.name).join('・')}が見送っている`) : null,
      list, el('div', { class: 'movie-hint' }, 'タップで飛ばす'), white);
    document.getElementById('app').append(overlay);

    // 年を取った姿（初めての起動は男の子の絵を借りる。性別はまだ選んでいない）。動かさず、立ったまま
    const hero = (app.heroSets[gender] || app.heroSets.male || {}).old || null;
    // 光の粒（決まった並び。主人公の体から昇っていく）
    const motes = Array.from({ length: 14 }, (_, i) => ({ x: OX + 18 + ((i * 7) % 12), y: FEET - 2 - ((i * 5) % 13), d: (i % 4) * 0.25, s: 6 + (i % 3) * 2 }));
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
      // 見送るザコ：主人公のほうを向いて立ち、主人公が光になって消えても残る（左に立つザコは右を向く）
      seeOff.forEach((f, i) => {
        const dx = FRIEND_DX[i];
        g.globalAlpha = lit;
        drawSprite(g, f.sprite, Math.floor(t * 2) % f.sprite.frames.length, W / 2 + dx, FEET - f.sprite.h, { flip: dx < 0 });
      });
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
