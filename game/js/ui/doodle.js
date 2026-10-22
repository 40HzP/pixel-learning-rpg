// テスト用紙の落書き（40HzP の依頼）。用紙（.paper）の上に透明な canvas を重ね、ペンを出している間だけ指やマウスで描ける。
// 線は「どこの上に描いたか」と「そこの上端から何ドット下か」で覚える。採点した答案は○×や解説が増えて長くなるが、
// 問題ごとの位置に合わせて描き直すので、選択肢に付けた丸は採点した答案でも同じ選択肢の上に残る。
// 位置の基準は data-doodle を付けた要素（study.js：問題ごと・問題の文・選択肢）。最初の問題より上は用紙の上端が基準
import { el } from './dom.js';

/** 鉛筆の色と太さ */
export const PEN = { color: '#2b2838', width: 2.5 };
const MAX_DPR = 2; // 細かすぎる canvas は重いので、画面の2倍まで

/** 落書きの中身。strokes：線の並び（{ r: 区切り, pts: [[横の位置（用紙の幅に対する割合）, 区切りの上端からのドット数], …] }） */
export const createDoodle = () => ({ strokes: [], pen: false });

/** y（用紙の上端からのドット数）がどの区切りに入るか。regions は上端の小さい順（最初は用紙の上端 'head'） */
export function regionAt(regions, y) {
  let found = regions[0];
  for (const r of regions) if (y >= r.top) found = r;
  return found;
}

/** 用紙に落書きの canvas を重ねる。onChange は線が増えたり消えたりしたとき（道具のボタンの表示を合わせる） */
export function attachDoodle(paper, doodle, onChange = () => {}) {
  const canvas = el('canvas', { class: 'doodle', 'aria-hidden': 'true' });
  paper.prepend(canvas);
  const ctx = canvas.getContext('2d');
  let dpr = 1;
  const regions = (root = paper) => [{ key: 'head', top: 0 },
    ...[...root.querySelectorAll('[data-doodle]')].map((e) => ({ key: e.dataset.doodle, top: e.offsetTop })).sort((a, b) => a.top - b.top)];

  /**
   * 線を描く。g は描く先（この canvas か、答案の画像）。ox・oy は落書きの canvas の左上の位置。
   * root は位置の基準を探す用紙（答案の画像は、要らない行を消した写しに描く。ui/share.js）
   */
  function paint(g, ox = 0, oy = 0, root = paper) {
    const w = root.clientWidth;
    const tops = Object.fromEntries(regions(root).map((r) => [r.key, r.top]));
    g.save();
    g.translate(ox, oy);
    g.beginPath(); g.rect(0, 0, w, root.clientHeight); g.clip(); // 用紙からはみ出した線は描かない（画面と同じ）
    g.strokeStyle = g.fillStyle = PEN.color;
    g.lineWidth = PEN.width;
    g.lineCap = g.lineJoin = 'round';
    for (const s of doodle.strokes) {
      const top = tops[s.r];
      if (top == null || !s.pts.length) continue;
      const pts = s.pts.map(([fx, dy]) => [fx * w, top + dy]);
      g.beginPath();
      if (pts.length === 1) { g.arc(pts[0][0], pts[0][1], PEN.width / 2, 0, Math.PI * 2); g.fill(); continue; }
      pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.stroke();
    }
    g.restore();
  }

  function redraw() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    paint(ctx);
  }

  // 用紙の大きさが変わったら（大喜利の欄が開いた、画面を回した）合わせて描き直す
  const resize = () => {
    if (!paper.isConnected) { ro.disconnect(); return; }
    dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
    canvas.width = Math.round(paper.clientWidth * dpr);
    canvas.height = Math.round(paper.clientHeight * dpr);
    redraw();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(paper);

  // 描く（指は1本だけ。2本目は見ない）
  let active = null;
  const at = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const add = (p) => {
    const w = paper.clientWidth;
    const pt = [Math.round((p.x / w) * 1e4) / 1e4, Math.round((p.y - active.top) * 10) / 10];
    const last = active.last;
    if (last && Math.hypot(p.x - last.x, p.y - last.y) < 1) return;
    active.stroke.pts.push(pt);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.strokeStyle = ctx.fillStyle = PEN.color;
    ctx.lineWidth = PEN.width;
    ctx.lineCap = ctx.lineJoin = 'round';
    ctx.beginPath();
    if (last) { ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke(); } else { ctx.arc(p.x, p.y, PEN.width / 2, 0, Math.PI * 2); ctx.fill(); }
    active.last = p;
  };
  canvas.addEventListener('pointerdown', (e) => {
    if (!doodle.pen || active) return;
    e.preventDefault();
    try { canvas.setPointerCapture(e.pointerId); } catch { /* 取れなくても描ける */ }
    const p = at(e);
    const r = regionAt(regions(), p.y);
    const stroke = { r: r.key, pts: [] };
    doodle.strokes.push(stroke);
    active = { id: e.pointerId, stroke, top: r.top, last: null };
    add(p);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!active || e.pointerId !== active.id) return;
    e.preventDefault();
    const list = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
    for (const ev of list.length ? list : [e]) add(at(ev));
  });
  const end = (e) => {
    if (!active || e.pointerId !== active.id) return;
    active = null;
    onChange();
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  const setPen = (on) => { doodle.pen = on; canvas.classList.toggle('on', on); };
  setPen(doodle.pen);
  return {
    canvas,
    paint,
    setPen,
    undo: () => { doodle.strokes.pop(); redraw(); onChange(); },
    clear: () => { doodle.strokes.length = 0; redraw(); onChange(); },
  };
}
