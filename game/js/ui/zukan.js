// 図鑑：未遭遇はシルエット、遭遇で名前と俗説、撃破か関連する問題に正解で正体
import { spriteCanvas } from '../sprites.js';
import { el } from './dom.js';

let root = null;
let key = '';

export function init() {
  root = document.getElementById('screen-zukan');
  root.classList.add('pad');
}

export function reset() { key = ''; }

function card(app, m) {
  const z = app.state.knowledge.zukan[m.id] || { stage: 0, fooled: 0 };
  const sprite = (app.monsterSprites[m.id] || {}).idle || null;
  const pic = el('div', { class: 'pic' }, spriteCanvas(sprite, 3, app.palette, { silhouette: z.stage === 0 }));
  if (z.stage === 0) {
    return el('div', { class: 'zcard unknown' }, pic, el('div', { class: 'zname' }, '？？？'), el('div', { class: 'muted' }, 'まだ出会っていない'));
  }
  if (m.kind === 'midboss') {
    return el('div', { class: 'zcard' }, pic,
      el('div', { class: 'zname' }, m.name, el('span', { class: 'muted' }, '（中ボス）')),
      el('div', {}, m.intro || ''),
      z.stage >= 2 ? el('div', { class: 'good' }, '倒した。仲間になった') : el('div', { class: 'muted' }, 'まだ倒していない'));
  }
  const mythLabel = m.wordType ? 'よく言われる意味' : '俗説';
  const truthLabel = m.wordType ? '本来の意味' : '正体';
  let truth;
  if (z.stage < 2) truth = el('div', { class: 'muted' }, '倒すか、関連する問題に正解すると分かる');
  else if (m.debated) truth = el('div', {}, '研究が割れている');
  else truth = el('div', {}, m.truth);
  return el('div', { class: 'zcard' }, pic,
    el('div', { class: 'zname' }, m.name),
    el('span', { class: 'label' }, mythLabel), el('div', {}, m.myth),
    el('span', { class: 'label' }, truthLabel), truth,
    z.stage >= 2 ? el('div', { class: z.fooled ? 'bad' : 'muted', style: { marginTop: '4px' } }, `この${m.wordType ? '言い方' : '俗説'}に${z.fooled}回騙された`) : null);
}

export function update(app, force) {
  const zk = app.state.knowledge.zukan;
  const k = JSON.stringify(zk);
  if (!force && k === key) return;
  key = k;
  const list = app.ctx.monsters;
  const met = list.filter((m) => (zk[m.id] || {}).stage >= 1).length;
  const known = list.filter((m) => (zk[m.id] || {}).stage >= 2).length;
  root.replaceChildren(
    el('div', { class: 'section' },
      el('h2', {}, '図鑑'),
      el('div', { class: 'muted', style: { marginBottom: '10px' } }, `出会った ${met}/${list.length}　正体が分かった ${known}/${list.length}`),
      el('div', { class: 'zukan' }, list.map((m) => card(app, m)))),
  );
}
