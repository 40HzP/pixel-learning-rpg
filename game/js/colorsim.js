// 色の見え方のフィルタの計算（設計ページ「色の見え方が違う人生」）。ブラウザの機能には触らない（画面にかけるのは ui/vision.js）。
// 2色覚の見え方の再現表示（Brettel, Viénot, Mollon 1997。1型・2型は同じ著者たちが1999年に示した1枚の平面の版）：
// 色を錐体の反応（L・M・S）に直し、はたらかない錐体の値を、その型の人にも同じに見える色の面の上に移す（同じ型の人には、元の色と見分けられない色になる）。
// 3型は面を2枚（485nm と 660nm の色を含む半分の面）に分け、色がどちら側にあるかで使い分ける（Brettel 1997 のとおり）。
// 計算は光の強さに比例する値（線形RGB）で行う。SVG のフィルタは color-interpolation-filters="linearRGB" で同じ値を受け取る。
// フィルタは近似で、実際の見え方は人によって違う（2色覚の強い見え方を再現する。見分けにくさが軽い人の見え方ではない）

/** 型：1型（L錐体）・2型（M錐体）・3型（S錐体） */
export const VISION_TYPES = ['protan', 'deutan', 'tritan'];
/** 型の呼び方（画面に出す名前） */
export const VISION_LABELS = { protan: '1型', deutan: '2型', tritan: '3型' };

// 線形sRGB → XYZ（D65）
const XYZ_FROM_RGB = [
  [0.4124564, 0.3575761, 0.1804375],
  [0.2126729, 0.7151522, 0.0721750],
  [0.0193339, 0.1191920, 0.9503041],
];
// XYZ → 錐体の反応 LMS（Smith & Pokorny 1975 の錐体の感度。Viénot, Brettel, Mollon 1999 で使われたもの）
const LMS_FROM_XYZ = [
  [0.15514, 0.54312, -0.03286],
  [-0.15514, 0.45684, 0.03286],
  [0, 0, 0.00801],
];
// 2色覚の人にも同じに見える単色光の色度（CIE 1931 の x, y）。1型・2型は 475nm と 575nm、3型は 485nm と 660nm（Brettel 1997）
const SPECTRAL_XY = { 475: [0.1096, 0.0868], 485: [0.0687, 0.2007], 575: [0.4788, 0.5202], 660: [0.73, 0.27] };

const mul = (a, b) => a.map((row) => b[0].map((_, j) => row.reduce((s, v, k) => s + v * b[k][j], 0)));
const apply = (m, v) => m.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const transpose = (m) => m[0].map((_, j) => m.map((row) => row[j]));
function inverse(m) {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [
    [A / det, -(b * i - c * h) / det, (b * f - c * e) / det],
    [B / det, (a * i - c * g) / det, -(a * f - c * d) / det],
    [C / det, -(a * h - b * g) / det, (a * e - b * d) / det],
  ];
}
/** 単色光（波長 nm）の色を LMS で（明るさは1。向きだけを使う） */
function spectralLms(nm) {
  const [x, y] = SPECTRAL_XY[nm];
  return apply(LMS_FROM_XYZ, [x / y, 1, (1 - x - y) / y]);
}

/**
 * はたらかない錐体（missing：0＝L、1＝M、2＝S）の値を、白（中立の軸）と anchor を含む面の上に移す行列（LMS → LMS）。
 * 面の上ではほかの2つの錐体の値から決まる：missing = a·（1つめ）＋ b·（2つめ）
 */
function projection(missing, white, anchor) {
  const [p, q] = [0, 1, 2].filter((k) => k !== missing);
  // white と anchor の両方で成り立つ a, b を解く
  const det = white[p] * anchor[q] - white[q] * anchor[p];
  const a = (white[missing] * anchor[q] - anchor[missing] * white[q]) / det;
  const b = (white[p] * anchor[missing] - anchor[p] * white[missing]) / det;
  const m = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  m[missing] = [0, 0, 0];
  m[missing][p] = a;
  m[missing][q] = b;
  return m;
}

/**
 * 型ごとのフィルタ（線形RGB → 線形RGB の 3×3 行列）。
 * 1型・2型：{ matrices: [M] }。3型：{ matrices: [M1, M2], normal }（線形RGB で normal との内積が0以上なら M1、負なら M2）
 */
export function visionFilter(type) {
  const lmsFromRgb = mul(LMS_FROM_XYZ, XYZ_FROM_RGB);
  const rgbFromLms = inverse(lmsFromRgb);
  const white = apply(lmsFromRgb, [1, 1, 1]);
  const toRgb = (p) => mul(rgbFromLms, mul(p, lmsFromRgb));
  if (type === 'protan' || type === 'deutan') {
    // Viénot 1999：白と、画面の青（青い光の原色）を含む1枚の面（475nm と 575nm を含む Brettel の2枚の面にほぼ重なる）
    const blue = apply(lmsFromRgb, [0, 0, 1]);
    return { matrices: [toRgb(projection(type === 'protan' ? 0 : 1, white, blue))] };
  }
  if (type === 'tritan') {
    // Brettel 1997：485nm を含む半分の面と、660nm を含む半分の面。S の向きに移すので、白と S の軸を含む面でどちらの側かを分ける
    const a1 = spectralLms(485), a2 = spectralLms(660);
    let n = cross(white, [0, 0, 1]);
    if (dot(n, a1) < 0) n = n.map((v) => -v); // 内積が0以上の側に 485nm の面
    return { matrices: [toRgb(projection(2, white, a1)), toRgb(projection(2, white, a2))], normal: apply(transpose(lmsFromRgb), n) };
  }
  return null;
}

/** 線形RGB の色（0〜1）にフィルタをかける（テストと、画面に出さない確かめ用。画面は SVG のフィルタでかける） */
export function simulateLinear(type, rgb) {
  const f = visionFilter(type);
  if (!f) return rgb;
  const m = f.matrices.length > 1 && dot(f.normal, rgb) < 0 ? f.matrices[1] : f.matrices[0];
  return apply(m, rgb).map((v) => Math.min(1, Math.max(0, v)));
}
