// 札の知らせ：前世で魔物に吹き込まれた噂のザコ・倒したときの正体・図鑑の1体目・起動から3分の比較（設計ページ「最初の3分」）。
// 2026-11-09 に main.js から分けた
import { heroSnapshot, compareSnapshots } from '../sim.js';
import { spriteCanvas } from '../sprites.js';
import { el, fmt, affNum } from './dom.js';

// 起動から3分で「起動したとき」と「今」の主人公を比べる（設計ページ「最初の3分」。40HzP の依頼で毎回）。
// 数えるのはゲームの時間が進んでいる間だけ。ほかのアプリなどに切り替えて10分以上たってから戻ってきたときも、起動したことにする（main.js の AWAY_RELAUNCH_MS）
const LAUNCH_COMPARE_SEC = 180;
/** 起動したときとの比較の札を出しておく時間（ミリ秒。40HzP の依頼で12秒から14秒に。タップでも閉じる） */
const LAUNCH_COMPARE_SHOW_MS = 14000;

/** app に結び付けた札の関数を作る（main.js の起動で1回だけ）。notifyCard・showTab は main.js から渡す */
export function createCards(app, { notifyCard, showTab }) {
  const ctx = app.ctx;
  const monsters = ctx.monsters;
  const palette = app.palette;
  const monsterSprites = app.monsterSprites;

  /* ---------- 前世の記憶をたどるで間違えた問題のザコ（前世で魔物に吹き込まれた噂）・図鑑の1体目 ---------- */
  // 誤答1を選んだ問題のザコが出たら、群れの噂を1枚の札に並べる。倒すたびにその行に線を引き、「正体」の札を出す（間違えた問題のザコはどれも）。
  // 正体と図鑑の1体目の札は、続けて倒しても読めるように1枚ずつ順に出す（cardQueue）
  const TRUTH_MS = 4500;
  const rumors = new Map(); // 噂のザコの敵 uid → 魔物
  let rumorCard = null;
  function notifyMisbeliefs(list) {
    for (const e of list) rumors.set(e.uid, monsters.find((m) => m.id === e.monsterId));
    // 「前世で魔物に吹き込まれた噂」と添えるのは誤答1を選んだ問題のザコだけ（誤答2・3と時間切れは、知らなかっただけなので添えない）
    const believed = list.filter((e) => e.believed);
    if (!believed.length) return;
    if (rumorCard) rumorCard.remove();
    rumorCard = notifyCard([
      el('b', { class: 'nt-title' }, '前世で魔物に吹き込まれた噂'),
      ...believed.map((e) => el('span', { class: 'nt-myth', 'data-uid': String(e.uid) }, `「${e.myth}」`, el('small', {}, e.name))),
    ], 'myth', 20000);
  }
  /**
   * 噂のザコを倒した：噂の行に線を引き（全部倒したら札を閉じる）、正しい知識（正体）の札を順に出す。
   * 初めて倒したザコなら、図鑑の1体目の札と1枚にまとめる（firstZukan。まとめたら true）
   */
  function rumorDefeated(uid, firstZukan) {
    const m = rumors.get(uid);
    if (!m) return false;
    rumors.delete(uid);
    const card = rumorCard;
    if (card) {
      const line = card.querySelector(`[data-uid="${uid}"]`);
      if (line) line.classList.add('gone');
      if (![...card.querySelectorAll('.nt-myth')].some((x) => !x.classList.contains('gone'))) setTimeout(() => card.remove(), 1500);
    }
    if (firstZukan && firstZukan.monsterId === m.id) {
      queueCard(() => zukanCard(m, firstZukan, `${m.name}を倒した！`, `正体：${m.truth}`));
      return true;
    }
    queueCard(() => ({ node: [el('b', { class: 'nt-title' }, `${m.name}を倒した！`), el('span', {}, `正体：${m.truth}`)], kind: 'truth', ms: TRUTH_MS }));
    return false;
  }
  const cardQueue = [];
  let queueSeq = 0, queueBusy = 0;
  /** 札を順番待ちに入れる（前の札が閉じてから出す。タップで次へ） */
  function queueCard(make) {
    cardQueue.push(make);
    if (!queueBusy) nextQueued();
  }
  function nextQueued() {
    const make = cardQueue.shift();
    if (!make) { queueBusy = 0; return; }
    const token = queueBusy = ++queueSeq;
    const { node, kind, ms, onTap } = make();
    const advance = () => { if (queueBusy === token) nextQueued(); };
    notifyCard(node, kind, ms, () => { if (onTap) onTap(); advance(); });
    setTimeout(advance, ms);
  }
  /** 初めてザコを倒した：図鑑の札が開いて「1／171」（一度だけ）。タップで図鑑へ */
  function notifyFirstZukan(e) {
    const m = monsters.find((x) => x.id === e.monsterId);
    if (m) queueCard(() => zukanCard(m, e, `${m.name}の正体が載った`, null));
  }
  function zukanCard(m, e, line, sub) {
    const sp = (monsterSprites[m.id] || {}).idle;
    return {
      node: el('div', { class: 'zukan-first' },
        sp ? spriteCanvas(sp, 3, palette) : null,
        el('div', {},
          el('b', { class: 'nt-title' }, `図鑑　${e.opened}／${e.total}`),
          el('span', { class: 'nt-name' }, line),
          sub ? el('small', {}, sub) : null,
          el('small', { class: 'nt-tap' }, 'タップで図鑑へ'))),
      kind: 'zukan-card', ms: 6500, onTap: () => showTab('zukan'),
    };
  }

  /* ---------- 起動から3分で、起動したときの自分と比べる（毎回） ---------- */
  let launchMark = null; // { snap: 起動したときの主人公, sec: ゲームの時間が進んだ秒数, done }
  function countLaunch(realDt) {
    if (!launchMark) launchMark = { snap: heroSnapshot(app.state, ctx), sec: 0, done: false };
    if (launchMark.done) return;
    launchMark.sec += realDt;
    if (launchMark.sec < LAUNCH_COMPARE_SEC) return;
    launchMark.done = true;
    const cmp = compareSnapshots(launchMark.snap, heroSnapshot(app.state, ctx));
    if (!cmp || (!cmp.rows.length && !cmp.zukan && !cmp.correct)) return; // 伸びたものだけを出す
    const extra = [cmp.zukan ? `図鑑 +${cmp.zukan}体` : '', cmp.correct ? `正解 +${cmp.correct}問` : ''].filter(Boolean).join('・');
    // その3分で懐き度が上がった飼育小屋のザコ（いちばん上がったザコと、ほかの数）
    const aff = cmp.affinity || [];
    const top = aff.length ? monsters.find((m) => m.id === aff[0].id) : null;
    const affLine = top ? `懐き度：${top.name} +${affNum(aff[0].gain)}${aff.length > 1 ? `　ほか${aff.length - 1}体` : ''}` : '';
    notifyCard([
      el('b', { class: 'nt-title' }, '起動したときの自分と比べると'),
      el('div', { class: 'cmp-rows' }, cmp.rows.map((r) => {
        const unit = r.key.endsWith('loor') ? '階層' : '';
        return el('span', { class: r.key.endsWith('loor') ? 'wide' : '' }, `${r.label} ${fmt(r.from)}${unit} → `, el('b', {}, `${fmt(r.to)}${unit}`));
      })),
      extra ? el('small', {}, extra) : null,
      affLine ? el('small', {}, affLine) : null,
    ], 'compare', LAUNCH_COMPARE_SHOW_MS);
  }
  /** 起動し直したことにする（しばらく離れて戻ってきたとき・生まれ変わって新しい人生が始まったとき。そこから3分を数え直す） */
  function resetLaunch() {
    launchMark = null;
  }
  /** デバッグ：起動から3分の比較を今出す */
  function launchCompareNow() {
    countLaunch(0);
    Object.assign(launchMark, { sec: LAUNCH_COMPARE_SEC, done: false });
    countLaunch(0);
  }

  return { notifyMisbeliefs, rumorDefeated, notifyFirstZukan, countLaunch, resetLaunch, launchCompareNow };
}
