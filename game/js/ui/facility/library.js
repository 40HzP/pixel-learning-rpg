// 図書館（月面は月面の書庫も同じ画面）。2026-11-09 に ui/facility.js から分けた
import { walkBookPages } from '../../sim.js';
import { spriteCanvas } from '../../sprites.js';
import { el } from '../dom.js';
import { profLogList, profLogNote } from '../proflog.js';
import { note } from './common.js';

/**
 * 図書館（寝床の跡。月面は月面の書庫）：熟練の記録（誕生日の判定・勉強で上がった分・学際分野の休眠と復活。ui/proflog.js）と散歩帳。
 * 設計ページの「放置で眺める暗記資料」はまだ無い（準備中）
 */
export function libraryPanel(app) {
  return [
    el('h3', { class: 'subhead' }, '熟練の記録'),
    note(profLogNote(app)),
    profLogList(app),
    ...walkBook(app),
    el('h3', { class: 'subhead' }, '暗記資料'),
    note('放置で眺める暗記資料は準備中'),
  ];
}

/**
 * 散歩帳（設計ページ「散歩の要素」）：冒険の道端の物の問題に正解すると載る（絵・名前・見つけた世界・解説）。
 * 図鑑とは別の帳面。まだ載っていない物は影絵と、出る世界だけを見せる。知識なので生まれ変わっても残る
 */
function walkBook(app) {
  const pages = walkBookPages(app.state, app.ctx);
  if (!pages.length) return [];
  const found = pages.filter((p) => p.found).length;
  const rows = pages.map((p) => {
    const sp = (app.walkSprites.items || {})[p.name] || null;
    if (!p.found) {
      return el('div', { class: 'item walk-page locked' },
        spriteCanvas(sp, 2, app.palette, { silhouette: true }),
        el('div', { class: 'name' }, '？？？', el('small', {}, `${p.world}の道端`)));
    }
    return el('div', { class: 'item walk-page' },
      spriteCanvas(sp, 2, app.palette),
      el('div', { class: 'name' }, p.name,
        el('small', { class: 'muted' }, `${p.world}で見つけた（${p.found.generation}世代目）`),
        el('small', {}, p.question.explanation)));
  });
  return [
    el('h3', { class: 'subhead' }, `散歩帳（${found}／${pages.length}）`),
    note('冒険の道端に、ときどき物が出る（上に「？」）。冒険の絵をタップして、その物の問題に正解すると載る。間違えても罰は無く、また道端で会える'),
    el('div', { class: 'list walk-book' }, rows),
  ];
}
