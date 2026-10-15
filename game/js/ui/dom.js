// 画面の部品を作る小さな道具
export function el(tag, props, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k in e) e[k] = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) {
    if (k == null || k === false) continue;
    e.append(k instanceof Node ? k : String(k));
  }
  return e;
}

/** 数の表示。1億以上は「◯億」「◯兆」にする（会社で大きく稼いでも画面からはみ出さないように） */
export function fmt(n) {
  const v = Math.floor(n);
  const abs = Math.abs(v);
  const unit = (x, u) => {
    const d = x >= 100 ? 0 : x >= 10 ? 1 : 2;
    return `${v < 0 ? '-' : ''}${Math.floor(x * 10 ** d) / 10 ** d}${u}`;
  };
  if (abs >= 1e12) return unit(abs / 1e12, '兆');
  if (abs >= 1e8) return unit(abs / 1e8, '億');
  return v.toLocaleString('ja-JP');
}
export const stars = (n) => '☆'.repeat(n);
