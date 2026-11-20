// 色の見え方が違う人生（設計ページ「色の見え方が違う人生（2026-11-20）」）の画面のフィルタ。
// その人生の色の見え方（state.life.vision。sim/vision.js）が決まっていれば、画面全体（html 要素）に型ごとの色のフィルタをかける。
// 遊ぶ人自身の色の見え方にかかわらず一律でかけ、外す設定は作らない（40HzP の判断）。
// html 要素にかけるのは、ほかの要素にかけると、その中の位置を固定した部品（下の切り替えバー・知らせ）の置き場所が変わるため（一番上の要素だけは変わらない）。
// フィルタの行列は colorsim.js（Brettel 1997・Viénot 1999）。開発用の画面（?debug=1）では、白黒と型ごとのフィルタを試せる（preview）
import { VISION_TYPES, visionFilter } from '../colorsim.js';

const NS = 'http://www.w3.org/2000/svg';
let applied = null; // 今かけているフィルタ（'protan' など・'gray'・null）
let defs = false;

/** SVG のフィルタを1回だけ作って、ページに置く（見えない大きさ0の svg） */
function ensureDefs() {
  if (defs) return;
  defs = true;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  Object.assign(svg.style, { position: 'absolute', width: '0', height: '0', overflow: 'hidden' });
  const node = (tag, attrs) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    return n;
  };
  // 3×3 の行列を feColorMatrix の 4×5 に（透明度はそのまま）
  const values = (m) => [...m.map((r) => [...r.map((v) => v.toFixed(6)), 0, 0].join(' ')), '0 0 0 1 0'].join('  ');
  for (const type of VISION_TYPES) {
    const f = visionFilter(type);
    const filter = node('filter', { id: `vision-${type}`, 'color-interpolation-filters': 'linearRGB', x: '0', y: '0', width: '1', height: '1' });
    if (f.matrices.length === 1) {
      filter.append(node('feColorMatrix', { type: 'matrix', in: 'SourceGraphic', values: values(f.matrices[0]) }));
    } else {
      // 3型：2枚の面を、色がどちら側にあるか（normal との内積の符号）で使い分ける。側は透明度に 0 か 1 で書き、in と out で切り分けて足す
      const K = 1e5;
      filter.append(
        node('feColorMatrix', { type: 'matrix', in: 'SourceGraphic', values: values(f.matrices[0]), result: 'wing1' }),
        node('feColorMatrix', { type: 'matrix', in: 'SourceGraphic', values: values(f.matrices[1]), result: 'wing2' }),
        node('feColorMatrix', { type: 'matrix', in: 'SourceGraphic', result: 'side', values: `0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  ${f.normal.map((v) => (v * K).toFixed(3)).join(' ')} 0 0` }),
        node('feComposite', { in: 'wing1', in2: 'side', operator: 'in', result: 'part1' }),
        node('feComposite', { in: 'wing2', in2: 'side', operator: 'out', result: 'part2' }),
        node('feComposite', { in: 'part1', in2: 'part2', operator: 'arithmetic', k1: '0', k2: '1', k3: '1', k4: '0' }),
      );
    }
    svg.append(filter);
  }
  document.body.append(svg);
}

/** 今かけるフィルタ：開発用の画面で試しているもの（preview。'none' はフィルタなしで見比べる）か、その人生の色の見え方 */
function wanted(app) {
  if (app.visionPreview) return app.visionPreview === 'none' ? null : app.visionPreview;
  return (app.state && app.state.life.vision) || null;
}

/** 画面のフィルタを合わせる（毎フレーム呼ぶ。変わったときだけ書き換える） */
export function syncVision(app) {
  const want = wanted(app);
  if (want === applied) return;
  applied = want;
  const root = document.documentElement;
  if (!want) { root.style.removeProperty('filter'); delete root.dataset.vision; return; }
  if (want !== 'gray') ensureDefs();
  root.style.filter = want === 'gray' ? 'grayscale(1)' : `url(#vision-${want})`;
  root.dataset.vision = want;
}
