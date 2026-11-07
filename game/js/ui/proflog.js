// 熟練の記録（設計ページ「誕生日の熟練判定と階層の移動」）。熟練が変わるたびに sim.js の logProficiency が knowledge.profLog に残す。
// 見る場所：勉強画面の熟練の欄の「熟練の記録」、街の図書館・月面の書庫。誕生日に変わったときの知らせ（main.js）も同じ書き方
import { el } from './dom.js';
import { PROF_LOG_MAX } from '../sim.js';

/** 1件の変わり方の文（ジャンル名は含めない） */
export function profChangeText(c) {
  if (c.field) return c.reason === 'dormant' ? '休眠した（熟練が足りなくなった）' : '休眠から復活した';
  if (c.reason === 'cap') return `Lv${c.from}のまま（上限に届いている）`;
  const why = { study: '勉強で正解', year: 'この1年に勉強した', idle: `${c.years}年勉強していない` }[c.reason] || '';
  return `Lv${c.from}→${c.to}${why ? `（${why}）` : ''}`;
}

/** 記録の一覧（新しい順）。genre を渡すとそのジャンルだけ */
export function profLogList(app, genre = null) {
  const log = (app.state.knowledge.profLog || []).filter((c) => !genre || c.genre === genre);
  if (!log.length) return el('div', { class: 'muted prof-log-empty' }, 'まだ記録がない（勉強で熟練が上がったときと、誕生日の判定で変わったときに残る）');
  return el('ol', { class: 'prof-log' }, log.map((c) => el('li', { class: c.field ? 'field' : c.to > c.from ? 'up' : c.to < c.from ? 'down' : 'same' },
    el('span', { class: 'when' }, `${c.gen}世代目 ${c.age}歳`),
    el('span', { class: 'what' }, c.field ? `学際分野「${c.field}」` : c.genre),
    el('span', { class: 'how' }, profChangeText(c)))));
}

/** 熟練の記録の説明（図書館・勉強画面で同じもの） */
export function profLogNote(app) {
  const b = app.ctx.balance.birthday;
  return `誕生日（1歳年を取るたび）に熟練を判定する：その1年に勉強したジャンルは${Math.round(b.upChance * 100)}%で+1。`
    + `${b.idleYears}年以上勉強していないジャンルは${Math.round(b.downChance * 100)}%で−1。勉強で上がった分と、学際分野の休眠・復活も残る（新しい順に${PROF_LOG_MAX}件まで。生まれ変わっても残る）`;
}
