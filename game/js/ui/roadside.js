// 道端のもの（設計ページ「散歩の要素」の③）：階層を歩き切って次の階層に進むと、ときどき（balance.walk.roadsideChance）
// その世界の道端に物が出て、上に「？」が出る（描くのは render.js）。冒険の絵をタップすると、その物にまつわる1問を
// 前世の記憶をたどると同じ白い紙で出す（ゲームは止めない。主人公は後ろで戦い続ける。攻略を遅らせないため）。
// 正解すると散歩帳に載る（図書館・月面の書庫で見る）。間違えても罰は無く、載らないだけ。
// タップしなければ walk.roadsideShowSec 秒で主人公は通り過ぎ、物は消える（取り逃しても損はなく、同じ物はまた道端に出る）。
// 今日の道端のもの（設計ページ「毎日変わるものと日記」。sim/diary.js）：世界ごとに日付で決まる1つ（全員同じ）。
// その日にその世界で初めて次の階層に進んだとき、ふつうの道端の物の代わりに必ず出す（1日1回。印は「今日の」）
import { pickRoadside, walkerNotice, todayRoadsideFor, markTodayRoadside } from '../sim.js';
import { beginRoadside, answerRoadside } from '../quiz.js';
import { el } from './dom.js';

const RESULT_SEC = 12;       // 答えたあと、結果と解説を見せておく時間（タップで閉じる）
const REVEAL_GUARD_MS = 300; // 出してすぐは押せない（「？」をタップしたつもりで答えないように）

let box = null;
// 道端に出ている物：{ question, phase: shown（「？」が出ている）| question（問題を出している）| result, remaining, wait, session, answered, picked, res, shownAt }
let cur = null;

export function init(app, parent) {
  box = el('div', { class: 'first-check recall roadside', hidden: true });
  parent.append(box);
  box.addEventListener('click', () => { if (cur && cur.phase === 'result') close(app); });
  // 冒険の絵をタップすると、道端の物の問題を出す（「？」が出ている間）
  document.getElementById('scene').addEventListener('click', () => open(app));
  // 描く側（render.js）に渡す道端の物：{ sprite, name, t0（出た時刻）, leaveAt（通り過ぎ始めた時刻）, opened（問題を出した） }
  app.walkView = { roadside: null };
}

/** 白い紙を出しているか（出している間はステータスを短くし、今日の1問の札を後にする） */
export const showing = () => !!cur && (cur.phase === 'question' || cur.phase === 'result');

/**
 * 道端に物を出す（question を渡すとその問題。デバッグ用。today：今日の道端のものとして出す）。出したら true。
 * 問題を渡さなければ、今いる世界の今日の道端のもの（今日まだ出していなければ）、無ければふつうの道端の物（確率で）
 */
export function show(app, question = null, today = false) {
  if (cur) return false;
  let q = question;
  if (!q) {
    const todays = todayRoadsideFor(app.state, app.ctx, app.today());
    const allowed = !!pickRoadside(app.state, app.ctx, () => 0); // 石碑の前・前世の記憶をたどるの間・月面では、今日の道端のものも出さない
    if (todays && allowed) { q = todays; today = true; }
    else q = pickRoadside(app.state, app.ctx, app.ctx.rng);
  }
  if (!q) return false;
  if (today) markTodayRoadside(app.state, app.today(), q.roadside.world);
  cur = { question: q, phase: 'shown', remaining: app.ctx.balance.walk.roadsideShowSec, today };
  app.walkView.roadside = { sprite: (app.walkSprites.items || {})[q.roadside.name] || null, name: q.roadside.name, t0: performance.now() / 1000, leaveAt: null, opened: false, today };
  app.notify(today ? `今日の道端に「${q.roadside.name}」（タップで1問）` : `道端に「${q.roadside.name}」（タップで1問）`, today ? 'good' : '');
  // ザコの散歩：連れているザコが先に駆け寄る（絵は render.js）。その物が自分の俗説に関わるなら、着いたところで一言（誤解か、更生していれば本当のこと）
  const r = walkerNotice(app.state, app.ctx, q.roadside.name);
  if (r && r.kind === 'say') setTimeout(() => app.notify(`${r.monster.name}「${r.line}」`, r.reformed ? 'good' : ''), 600);
  if (r) app.handleEvents([{ type: 'walkerNoticed', name: r.monster.name, road: q.roadside.name }]); // 日記に「◯◯が先に気づいた」
  return true;
}

/** 起きたこと：階層を歩き切って次の階層に進んだら、ときどき道端に物を出す（冒険画面を見ているときだけ） */
export function onEvents(app, events) {
  if (app.tab !== 'adventure' || app.overlay || cur) return;
  if (events.some((e) => e.type === 'floorUp' && e.world !== 'moon')) show(app);
}

/** 主人公が道端の物を通り過ぎる（絵は render.js が左へ流して消す） */
function passBy(app) {
  const v = app.walkView.roadside;
  if (v && v.leaveAt == null) v.leaveAt = performance.now() / 1000;
}

/** 「？」をタップした：問題を出す */
function open(app) {
  if (!cur || cur.phase !== 'shown' || app.overlay) return;
  const session = beginRoadside(app.state, app.ctx, cur.question.id);
  if (!session) { cur = null; passBy(app); return; }
  session.today = !!cur.today; // 日記に「今日の道端で見つけた」と書く
  Object.assign(cur, { phase: 'question', session, remaining: session.current.timeLimit, shownAt: performance.now() });
  app.walkView.roadside.opened = true;
  render(app);
}

function pick(app, index) {
  if (!cur || cur.phase !== 'question' || performance.now() - cur.shownAt < REVEAL_GUARD_MS) return;
  submit(app, index);
}

function submit(app, index) {
  const answered = cur.session.current;
  const res = answerRoadside(app.state, cur.session, index, app.ctx);
  app.handleEvents(res.events);
  app.save();
  Object.assign(cur, { phase: 'result', picked: index, res, answered, wait: RESULT_SEC });
  passBy(app);
  render(app);
}

function close(app) {
  cur = null;
  passBy(app);
  render(app);
  app.refresh();
}

/** 描き直して、知らせの位置を合わせる（用紙の高さが変わると、その下に出す知らせが重なるため） */
function render(app) {
  draw(app);
  app.placeNotices();
}

function draw(app) {
  if (!showing()) { box.hidden = true; box.replaceChildren(); return; }
  box.hidden = false;
  const c = cur.phase === 'question' ? cur.session.current : cur.answered;
  const q = c.question;
  const bar = el('i');
  bar.style.width = `${Math.max(0, cur.remaining / c.timeLimit) * 100}%`;
  const choices = c.choices.map((ch, i) => {
    const b = el('button', { class: 'fc-choice', onclick: (ev) => { ev.stopPropagation(); pick(app, i); } }, ch.text);
    if (cur.phase === 'result') {
      b.disabled = true;
      if (ch.kind === 'answer') b.classList.add('right');
      else if (i === cur.picked) b.classList.add('wrong');
    }
    return b;
  });
  const parts = [
    el('div', { class: 'fc-head' }, el('b', {}, `${cur.today ? '今日の道端の' : '道端の'}${q.roadside.name}`), el('span', {}, '☆'.repeat(q.difficulty))),
    el('div', { class: 'fc-time' + (cur.phase === 'result' ? ' stop' : '') }, bar),
    el('p', { class: 'fc-q' }, q.question),
    el('div', { class: 'fc-choices' }, choices),
  ];
  if (cur.phase === 'result') {
    const r = cur.res;
    const book = r.walkBook;
    const text = r.correct
      ? (book && book.added ? `正解！　散歩帳に「${q.roadside.name}」が載った（${book.count}／${book.total}）` : '正解！（散歩帳にはもう載っている）')
      : `${r.timeout ? '時間切れ' : 'ちがう'}。正解は「${q.answer}」（散歩帳には載らなかった。また道端で会える）`;
    parts.push(el('p', { class: 'fc-result ' + (r.correct ? 'good' : 'bad') }, text));
    if (q.explanation) parts.push(el('p', { class: 'fc-explain' }, q.explanation));
    parts.push(el('small', { class: 'fc-note' }, `散歩帳は街の図書館で見られる　（タップで閉じる）`));
  }
  box.replaceChildren(...parts);
}

/** 毎フレーム（ゲームの時間が進んでいる間）：道端の物が通り過ぎるまでの時間・問題の制限時間・結果を閉じる */
export function frame(app, realDt) {
  if (!cur || app.tab !== 'adventure') return; // 冒険画面を見ていない間は止める
  if (cur.phase === 'shown') {
    cur.remaining -= realDt;
    if (cur.remaining <= 0) { cur = null; passBy(app); }
    return;
  }
  if (cur.phase === 'question') {
    cur.remaining -= realDt;
    const limit = cur.session.current.timeLimit;
    const bar = box.querySelector('.fc-time i');
    if (bar) {
      const ratio = Math.max(0, cur.remaining / limit);
      bar.style.width = ratio * 100 + '%';
      bar.parentNode.classList.toggle('low', ratio < 0.3);
    }
    if (cur.remaining <= 0) submit(app, null);
    return;
  }
  cur.wait -= realDt;
  if (cur.wait <= 0) close(app);
}

/** 最初からやり直したとき（セーブを読んだ・生まれ変わった） */
export function reset(app) {
  cur = null;
  if (box) { box.hidden = true; box.replaceChildren(); }
  if (app && app.walkView) app.walkView.roadside = null;
}
