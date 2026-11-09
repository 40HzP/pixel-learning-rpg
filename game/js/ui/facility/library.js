// 図書館（月面は月面の書庫も同じ画面）。2026-11-09 に ui/facility.js から分けた
import { el } from '../dom.js';
import { profLogList, profLogNote } from '../proflog.js';
import { note } from './common.js';

/**
 * 図書館（寝床の跡。月面は月面の書庫）：熟練の記録（誕生日の判定・勉強で上がった分・学際分野の休眠と復活。ui/proflog.js）。
 * 設計ページの「放置で眺める暗記資料」はまだ無い（準備中）
 */
export function libraryPanel(app) {
  return [
    el('h3', { class: 'subhead' }, '熟練の記録'),
    note(profLogNote(app)),
    profLogList(app),
    el('h3', { class: 'subhead' }, '暗記資料'),
    note('放置で眺める暗記資料は準備中'),
  ];
}
