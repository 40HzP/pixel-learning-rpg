// 図鑑：未遭遇はシルエット、遭遇で名前と俗説、撃破か関連する問題に正解で正体
// ボス（かつての学説）は、正体に加えて「なぜ信じられたか」「誰がどう覆したか」を載せる
// 中ボスには顧問にしたときの役目、大学教授が研究室の顧問なら次に戦うボスの「当時の根拠」（予習）も載せる
import { spriteCanvas } from '../sprites.js';
import { ADVISOR_PLACES, advisorActive, nextBoss } from '../sim.js';
import { el } from './dom.js';

let root = null;
let key = '';

/** ボスのいる階層（月面のボスは「月面◯階層」） */
const where = (m) => `${m.world === 'moon' ? '月面' : ''}${m.floor}階層`;

/** 月面を踏破すると開く頁（monsters.json の clear.page）。踏破するまでは題だけ伏せて見せる */
function pageCard(app, m) {
  const p = m.clear.page;
  if (!app.state.knowledge.moonCleared) {
    return el('div', { class: 'zcard wide unknown' }, el('div', { class: 'zname' }, '？？？の頁'),
      el('div', { class: 'muted' }, `月面を踏破する（${where(m)}の${m.name}を倒す）と開く`));
  }
  return el('div', { class: 'zcard wide page' },
    el('div', { class: 'zname' }, p.title, el('span', { class: 'muted' }, `（称号「${m.clear.title}」）`)),
    p.lines.map((line) => el('p', {}, line)));
}

export function init() {
  root = document.getElementById('screen-zukan');
  root.classList.add('pad');
}

export function reset() { key = ''; }

/** 予習（大学教授が研究室の顧問）：次に戦うボスなら、戦う前でも「当時の根拠」を見せる */
const prepFor = (app, m) => {
  if (!advisorActive(app.state, app.ctx, 'professor')) return null;
  const b = nextBoss(app.state, app.ctx);
  return b && b.id === m.id ? el('div', { class: 'prep' }, el('b', {}, '予習（大学教授）'), `：当時の根拠「${m.whyBelieved}」`) : null;
};

function card(app, m) {
  const z = app.state.knowledge.zukan[m.id] || { stage: 0, fooled: 0 };
  const sprite = (app.monsterSprites[m.id] || {}).idle || null;
  const pic = el('div', { class: 'pic' }, spriteCanvas(sprite, 3, app.palette, { silhouette: z.stage === 0 }));
  if (z.stage === 0) {
    return el('div', { class: 'zcard unknown' + (m.kind === 'boss' ? ' wide' : '') }, pic, el('div', { class: 'zname' }, '？？？'),
      el('div', { class: 'muted' }, m.kind === 'boss' ? `${where(m)}で待っているボス` : m.world === 'moon' ? '月面で待っている' : 'まだ出会っていない'),
      m.kind === 'boss' ? prepFor(app, m) : null);
  }
  if (m.kind === 'boss') {
    const label = (t) => el('span', { class: 'label' }, t);
    const known = z.stage >= 2;
    return el('div', { class: 'zcard wide' }, pic,
      el('div', { class: 'zname' }, m.name, el('span', { class: 'muted' }, `（ボス・${where(m)}）`)),
      label('かつての学説'), el('div', {}, m.myth),
      // 月面のボスの仕掛け（会えば分かる）
      ...(m.gimmickNote ? [label('仕掛け'), el('div', {}, m.gimmickNote)] : []),
      ...(known
        ? [label('正体'), el('div', {}, m.debated ? '研究が割れている' : m.truth),
          label('なぜ信じられたか'), el('div', {}, m.whyBelieved || ''),
          label('誰がどう覆したか'), el('div', {}, m.overturnedBy || ''),
          el('div', { class: z.fooled ? 'bad' : 'muted', style: { marginTop: '4px' } }, `この学説に${z.fooled}回騙された`)]
        : [prepFor(app, m), el('div', { class: 'muted', style: { marginTop: '4px' } }, '倒すか、関連する問題に正解すると、正体と「なぜ信じられたか」「誰がどう覆したか」が分かる')]));
  }
  if (m.kind === 'midboss') {
    return el('div', { class: 'zcard' }, pic,
      el('div', { class: 'zname' }, m.name, el('span', { class: 'muted' }, '（中ボス）')),
      el('div', {}, m.intro || ''),
      z.stage >= 2
        ? el('div', { class: 'good' }, m.ally === false ? `倒した。称号「${m.title}」をもらった` : '倒した。仲間になった')
        : el('div', { class: 'muted' }, `まだ倒していない（${m.appearAge}歳から挑戦できる）`),
      m.advisor ? el('div', { class: 'muted', style: { marginTop: '4px' } },
        `顧問にすると：${ADVISOR_PLACES[m.advisor.place]}で${m.advisor.role}${m.advisor.soon ? `（${m.advisor.soon}）` : ''}`) : null);
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
  const prep = advisorActive(app.state, app.ctx, 'professor') ? (nextBoss(app.state, app.ctx) || {}).id : null;
  const k = JSON.stringify([zk, app.state.knowledge.moonCleared, prep]);
  if (!force && k === key) return;
  key = k;
  const list = app.ctx.monsters;
  const met = list.filter((m) => (zk[m.id] || {}).stage >= 1).length;
  const known = list.filter((m) => (zk[m.id] || {}).stage >= 2).length;
  root.replaceChildren(
    el('div', { class: 'section' },
      el('h2', {}, '図鑑'),
      el('div', { class: 'muted', style: { marginBottom: '10px' } }, `出会った ${met}/${list.length}　正体が分かった ${known}/${list.length}`),
      el('div', { class: 'zukan' }, list.map((m) => card(app, m)), list.filter((m) => m.clear && m.clear.page).map((m) => pageCard(app, m)))),
  );
}
