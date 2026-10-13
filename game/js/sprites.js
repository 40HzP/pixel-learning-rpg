// スプライトJSON（pixel/sprites/*.json）を読み込んで描く。
// ゲームはスプライトを読むだけ。コピーや変換はしない（エディタで手直しした瞬間に反映されるように）。

const UNKNOWN = [255, 0, 255]; // パレットに無い文字は赤紫で描く（間違いに気づけるように）

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** palette.json を読む。読めなければ空のパレット（スプライトは仮の図形になる） */
export async function loadPalette(url) {
  const map = new Map();
  try {
    const p = await (await fetch(url, { cache: 'no-cache' })).json();
    for (const c of p.colors) {
      const v = hexToRgb(c.hex);
      if (v && typeof c.key === 'string' && c.key.length === 1) map.set(c.key, v);
    }
  } catch { /* 空のまま */ }
  return map;
}

export const cssColor = (palette, key, fallback = '#000') => {
  const v = palette.get(key);
  return v ? `rgb(${v[0]},${v[1]},${v[2]})` : fallback;
};

/** スプライトを読む。無い・読めないときは null（呼ぶ側で仮の図形を描く） */
export async function loadSprite(name, palette, base) {
  if (!name || !palette.size) return null;
  try {
    const res = await fetch(`${base}${name}.json`, { cache: 'no-cache' });
    if (!res.ok) return null;
    return buildSprite(await res.json(), palette);
  } catch {
    return null;
  }
}

export function buildSprite(d, palette) {
  const w = d.w, h = d.h;
  if (!(w > 0 && h > 0) || !Array.isArray(d.frames) || !d.frames.length) return null;
  const frames = d.frames.map((rows) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      const row = typeof rows[y] === 'string' ? rows[y] : '';
      for (let x = 0; x < w; x++) {
        const ch = row[x];
        if (ch === undefined || ch === '.') continue;
        const v = palette.get(ch) || UNKNOWN;
        const i = (y * w + x) * 4;
        img.data[i] = v[0]; img.data[i + 1] = v[1]; img.data[i + 2] = v[2]; img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return c;
  });
  return { name: d.name, w, h, fps: d.fps > 0 ? d.fps : 4, frames, flipped: [], silhouettes: [], outlineRgb: palette.get('0') || [26, 22, 38] };
}

/** アニメーションのコマ番号（時刻 t 秒） */
export const frameAt = (sprite, t) => Math.floor(t * sprite.fps) % sprite.frames.length;

function flippedFrame(s, i) {
  if (!s.flipped[i]) {
    const c = document.createElement('canvas');
    c.width = s.w; c.height = s.h;
    const ctx = c.getContext('2d');
    ctx.translate(s.w, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(s.frames[i], 0, 0);
    s.flipped[i] = c;
  }
  return s.flipped[i];
}

/** シルエット：不透明な画素をすべて輪郭色（0）で塗る */
function silhouetteFrame(s, i) {
  if (!s.silhouettes[i]) {
    const c = document.createElement('canvas');
    c.width = s.w; c.height = s.h;
    const ctx = c.getContext('2d');
    ctx.drawImage(s.frames[i], 0, 0);
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = `rgb(${s.outlineRgb.join(',')})`;
    ctx.fillRect(0, 0, s.w, s.h);
    s.silhouettes[i] = c;
  }
  return s.silhouettes[i];
}

export function drawSprite(ctx, sprite, i, x, y, opts = {}) {
  let img = sprite.frames[i % sprite.frames.length];
  if (opts.silhouette) img = silhouetteFrame(sprite, i % sprite.frames.length);
  if (opts.flip) {
    if (opts.silhouette) {
      ctx.save(); ctx.translate(Math.round(x) + sprite.w, Math.round(y)); ctx.scale(-1, 1); ctx.drawImage(img, 0, 0); ctx.restore();
      return;
    }
    img = flippedFrame(sprite, i % sprite.frames.length);
  }
  ctx.drawImage(img, Math.round(x), Math.round(y));
}

const QUESTION_MARK = ['.###.', '#...#', '....#', '...#.', '..#..', '.....', '..#..'];

/** スプライトが無いとき：暗色の四角に「？」 */
export function drawPlaceholder(ctx, x, y, w = 16, h = 16, palette = new Map()) {
  x = Math.round(x); y = Math.round(y);
  ctx.fillStyle = cssColor(palette, '0', '#1a1626');
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = cssColor(palette, '1', '#3d3a4f');
  ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
  ctx.fillStyle = cssColor(palette, '3', '#a9a7b8');
  const ox = x + Math.floor((w - 5) / 2), oy = y + Math.floor((h - 7) / 2);
  QUESTION_MARK.forEach((row, ry) => {
    for (let rx = 0; rx < row.length; rx++) if (row[rx] === '#') ctx.fillRect(ox + rx, oy + ry, 1, 1);
  });
}

/** 画面の部品用：スプライト（無ければ仮の図形）を整数倍で描いたキャンバスを返す */
export function spriteCanvas(sprite, scale, palette, opts = {}) {
  const w = sprite ? sprite.w : 16, h = sprite ? sprite.h : 16;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.className = 'pixel';
  c.style.width = w * scale + 'px';
  c.style.height = h * scale + 'px';
  const ctx = c.getContext('2d');
  if (sprite) drawSprite(ctx, sprite, 0, 0, 0, opts);
  else if (opts.silhouette) { ctx.fillStyle = cssColor(palette, '0', '#1a1626'); ctx.fillRect(0, 0, w, h); }
  else drawPlaceholder(ctx, 0, 0, w, h, palette);
  return c;
}
