// テストの結果をツイートする（40HzP の依頼）。採点した答案を落書きごと1枚の画像（PNG）に描き、
// 共有の画面（スマホ。画像と文を渡し、X を選ぶとツイートになる）か、X の投稿の画面（文だけ。共有で画像を渡せないパソコンなど）を開く。
// ゲームそのものは通信しない（作問フォームと同じく、ブラウザで別のページを開くだけ）
import { el } from './dom.js';

const SCALE = 2;         // 画像は画面の2倍の細かさ
const MAX_PIXELS = 12e6; // 大きすぎる canvas は描けない端末がある（iPhone はおよそ1670万ドットまで）
const MARGIN = 16;       // 用紙のまわりの余白
const FOOTER = 26;       // 下の余白（ゲームの名前を書く）

const shown = (c) => c && c !== 'transparent' && !/^rgba\(.*,\s*0\)$/.test(c);

/** 回して描いた字（赤ペンの点数）の角度。用紙の中で transform の付いた要素をさかのぼって探す */
function rotationOf(e, root) {
  for (let n = e; n && n !== root; n = n.parentElement) {
    const t = getComputedStyle(n).transform;
    const m = t && t !== 'none' && t.match(/^matrix\(([^,]+),\s*([^,]+)/);
    if (m) return Math.atan2(parseFloat(m[2]), parseFloat(m[1]));
  }
  return 0;
}

const SIDES = [
  ['Top', (r, w) => [r.left, r.top + w / 2, r.right, r.top + w / 2]],
  ['Bottom', (r, w) => [r.left, r.bottom - w / 2, r.right, r.bottom - w / 2]],
  ['Left', (r, w) => [r.left + w / 2, r.top, r.left + w / 2, r.bottom]],
  ['Right', (r, w) => [r.right - w / 2, r.top, r.right - w / 2, r.bottom]],
];

/** 要素の背景・枠線・箇条書きの点 */
function paintBox(g, e) {
  const cs = getComputedStyle(e);
  for (const r of e.getClientRects()) {
    if (shown(cs.backgroundColor)) { g.fillStyle = cs.backgroundColor; g.fillRect(r.left, r.top, r.width, r.height); }
    for (const [side, line] of SIDES) {
      const w = parseFloat(cs[`border${side}Width`]);
      const style = cs[`border${side}Style`];
      const color = cs[`border${side}Color`];
      if (!w || style === 'none' || style === 'hidden' || !shown(color)) continue;
      g.strokeStyle = color;
      g.lineWidth = w;
      g.setLineDash(style === 'dashed' ? [w * 3, w * 2] : style === 'dotted' ? [w, w] : []);
      const [x1, y1, x2, y2] = line(r, w);
      g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
    }
    g.setLineDash([]);
  }
  if (cs.display === 'list-item' && cs.listStyleType !== 'none') {
    const r = e.getClientRects()[0];
    const size = parseFloat(cs.fontSize);
    if (r) { g.fillStyle = cs.color; g.beginPath(); g.arc(r.left - size * 0.75, r.top + size * 0.75, size * 0.17, 0, Math.PI * 2); g.fill(); }
  }
}

/** 字を1文字ずつ、画面に出ている場所に描く（折り返しも画面のとおりになる） */
function paintText(g, node, root) {
  if (!node.data.trim()) return;
  const parent = node.parentElement;
  const cs = getComputedStyle(parent);
  if (!shown(cs.color)) return; // 新聞のビラで隠した字など
  g.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  g.fillStyle = cs.color;
  const angle = rotationOf(parent, root);
  const ascent = g.measureText('あ').fontBoundingBoxAscent;
  const range = document.createRange();
  let i = 0;
  for (const ch of node.data) {
    if (/\S/.test(ch)) {
      range.setStart(node, i);
      range.setEnd(node, i + ch.length);
      const r = [...range.getClientRects()].find((x) => x.width > 0);
      if (r && (angle || !ascent)) {
        g.save();
        g.translate(r.left + r.width / 2, r.top + r.height / 2);
        g.rotate(angle);
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(ch, 0, 0);
        g.restore();
      } else if (r) {
        g.textAlign = 'left'; g.textBaseline = 'alphabetic';
        g.fillText(ch, r.left, r.top + ascent);
      }
    }
    i += ch.length;
  }
}

/** 答案（.paper）を画面に見えているとおりに描いた canvas。pad は落書き（doodle.js）、footer は下に書く文 */
export function paperCanvas(paper, pad, footer = '') {
  const box = paper.getBoundingClientRect();
  const W = box.width + MARGIN * 2;
  const H = box.height + MARGIN + FOOTER;
  const scale = Math.min(SCALE, Math.sqrt(MAX_PIXELS / (W * H)));
  const cv = document.createElement('canvas');
  cv.width = Math.round(W * scale);
  cv.height = Math.round(H * scale);
  const g = cv.getContext('2d');
  g.scale(scale, scale);
  g.fillStyle = getComputedStyle(document.body).backgroundColor || '#1a1626';
  g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(0, 0, 0, .45)'; // 用紙の影（画面と同じ）
  g.fillRect(MARGIN + 4, MARGIN + 4, box.width, box.height);
  g.save();
  g.translate(MARGIN - box.left, MARGIN - box.top); // ここからは画面の位置のまま描ける
  paintBox(g, paper);
  const walker = document.createTreeWalker(paper, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      if (n.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT;
      if (/^(CANVAS|TEXTAREA|INPUT|SELECT)$/.test(n.tagName)) return NodeFilter.FILTER_REJECT;
      const cs = getComputedStyle(n);
      return cs.display === 'none' || cs.visibility === 'hidden' ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    },
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) paintText(g, n, paper);
    else paintBox(g, n);
  }
  if (pad) { const r = pad.canvas.getBoundingClientRect(); pad.paint(g, r.left, r.top); }
  g.restore();
  if (footer) {
    g.fillStyle = '#9a96ad';
    g.font = `13px ${getComputedStyle(document.body).fontFamily}`;
    g.textAlign = 'right'; g.textBaseline = 'middle';
    g.fillText(footer, W - MARGIN, H - FOOTER / 2);
  }
  return cv;
}

/** X の投稿の画面を開く（文だけ） */
const openTweet = (text) => window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`, '_blank', 'noopener');

/**
 * 「結果をツイートする」：答案の画像を見せて、ツイートする・画像を保存する・閉じるを選ぶ。
 * 画像を作るのに少し時間がかかるので、共有（navigator.share）は画像ができてから押す2つ目のボタンで呼ぶ（押した直後でないと共有できない端末がある）
 */
export async function shareTest({ paper, pad, text, filename, footer }) {
  let url = null;
  const box = el('div', { class: 'dialog share-box' }, el('div', { class: 'muted' }, '答案を画像にしています…'));
  const overlay = el('div', { class: 'overlay share', role: 'dialog', 'aria-label': 'テストの結果をツイートする' }, box);
  const close = () => { overlay.remove(); if (url) URL.revokeObjectURL(url); };
  document.getElementById('app').append(overlay);
  try { await document.fonts.ready; } catch { /* 字が読めなくても、ある字で描く */ }
  let blob = null;
  try {
    const cv = paperCanvas(paper, pad, footer);
    blob = await new Promise((res) => cv.toBlob(res, 'image/png'));
  } catch { /* 描けない端末では文だけ */ }
  const file = blob && typeof File === 'function' ? new File([blob], filename, { type: 'image/png' }) : null;
  url = blob ? URL.createObjectURL(blob) : null;
  let canFiles = false;
  try { canFiles = !!(file && navigator.canShare && navigator.canShare({ files: [file] })); } catch { canFiles = false; }
  const tweet = () => {
    if (!canFiles) { openTweet(text); return; }
    navigator.share({ files: [file], text }).catch((e) => { if (!e || e.name !== 'AbortError') openTweet(text); });
  };
  box.replaceChildren(
    el('h3', { class: 'subhead' }, 'テストの結果をツイートする'),
    url ? el('div', { class: 'share-preview' }, el('img', { src: url, alt: '採点した答案' })) : el('div', { class: 'bad' }, '答案を画像にできなかった（文だけツイートできる）'),
    el('div', { class: 'share-text' }, text),
    el('div', { class: 'share-buttons' },
      el('button', { class: 'share-x', onclick: tweet }, 'ツイートする'),
      el('div', { class: 'btnrow' },
        url ? el('a', { class: 'button', href: url, download: filename }, '画像を保存') : null,
        el('button', { onclick: close }, '閉じる'))),
    el('div', { class: 'muted share-note' }, canFiles
      ? '共有の画面で X を選ぶと、答案の画像を付けてツイートできる'
      : 'X の投稿の画面が開く（文だけ）。答案の画像は「画像を保存」で保存して、ツイートに付けられる'));
}
