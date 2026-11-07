// 常識チェック（設計ページ「最初の3分」）：初めて遊ぶ人の最初の人生だけ、起動するとすぐ冒険画面のステータスの下に5問を1問ずつ出す。
// ゲームは止めない（主人公は後ろで歩いて戦い続ける）。出している間、ステータスは短く（HUD の .checking）。
// 制限時間は冒険画面を見ている間だけ減る。誤解（誤答1）を選んだ問題のザコは「あなたが信じていた誤解」として出てくる（sim.js・main.js）
import { firstCheckProgress, nextFirstCheck, answerFirstCheck } from '../quiz.js';
import { el } from './dom.js';

const RESULT_SEC = 2.6; // 答えたあと、結果を見せてから次の問題へ（タップで先へ）
const DONE_SEC = 9;     // 5問終わったまとめを出しておく時間（タップで閉じる）
const REVEAL_GUARD_MS = 300; // 出してすぐは押せない（前の問題の結果を押したつもりで答えないように）

let box = null;
let view = { phase: 'idle', session: null, remaining: 0, wait: 0, shownAt: 0, summary: null };

export function init(app, parent) {
  box = el('div', { class: 'first-check', hidden: true });
  parent.append(box);
}

/** 常識チェックを出しているか（出している間はステータスを短くし、今日の1問の札を出さない） */
export const showing = () => view.phase !== 'idle';

/** 描き直して、知らせの位置を合わせる（用紙の高さが変わると、その下に出す知らせが重なるため） */
function render(app) {
  draw(app);
  app.placeNotices();
}

function draw(app) {
  const s = app.state;
  const p = firstCheckProgress(s);
  if (view.phase === 'idle') { box.hidden = true; box.replaceChildren(); return; }
  box.hidden = false;
  if (view.phase === 'done') {
    const sm = view.summary;
    box.replaceChildren(
      el('div', { class: 'fc-head' }, el('b', {}, '常識チェック　おわり'), el('span', {}, `${sm.total}問中${sm.correct}問正解`)),
      el('p', { class: 'fc-msg' }, sm.message),
      el('small', { class: 'fc-note' }, '答えた問題は、勉強の「過去問復習」で見直せる　（タップで閉じる）'));
    return;
  }
  const cur = view.session.current || view.answered;
  const q = cur.question;
  const bar = el('i');
  bar.style.width = `${Math.max(0, view.remaining / cur.timeLimit) * 100}%`;
  const choices = cur.choices.map((c, i) => {
    const b = el('button', { class: 'fc-choice', onclick: (ev) => { ev.stopPropagation(); pick(app, i); } }, c.text);
    if (view.phase === 'result') {
      b.disabled = true;
      if (c.kind === 'answer') b.classList.add('right');
      else if (i === view.picked) b.classList.add('wrong');
    }
    return b;
  });
  const parts = [
    el('div', { class: 'fc-head' }, el('b', {}, '常識チェック'), el('span', {}, `${p.index + (view.phase === 'result' ? 0 : 1)}/${p.total}`)),
    el('div', { class: 'fc-time' + (view.phase === 'result' ? ' stop' : '') }, bar),
    el('p', { class: 'fc-q' }, q.question),
    el('div', { class: 'fc-choices' }, choices),
  ];
  if (view.phase === 'result') parts.push(el('p', { class: 'fc-result ' + (view.kind === 'correct' ? 'good' : 'bad') }, resultText(view.kind, q)));
  box.replaceChildren(...parts);
}

function resultText(kind, q) {
  if (kind === 'correct') return '正解！';
  const right = `正解は「${q.answer}」`;
  if (kind === 'myth') return `それは、よくある誤解。${right}`;
  if (kind === 'timeout') return `時間切れ。${right}`;
  return `ちがう。${right}`;
}

function pick(app, index) {
  if (view.phase !== 'question' || performance.now() - view.shownAt < REVEAL_GUARD_MS) return;
  submit(app, index);
}

function submit(app, index) {
  const session = view.session;
  view.answered = session.current;
  const res = answerFirstCheck(app.state, session, index, app.ctx);
  app.handleEvents(res.events);
  app.save();
  view.phase = 'result';
  view.kind = res.check.kind;
  view.picked = index;
  view.wait = RESULT_SEC;
  render(app);
}

/** 次の問題へ。5問終わったら、まとめを出す */
function advance(app) {
  const s = app.state;
  view.session = nextFirstCheck(s, app.ctx);
  if (view.session) {
    view.phase = 'question';
    view.remaining = view.session.current.timeLimit;
    view.shownAt = performance.now();
  } else if (view.phase === 'result') {
    view.phase = 'done';
    view.wait = DONE_SEC;
    view.summary = summarize(s);
  } else {
    view.phase = 'idle';
  }
  render(app);
}

function summarize(s) {
  const answers = s.firstRun.check.answers.filter((a) => a.kind !== 'skipped');
  const correct = answers.filter((a) => a.kind === 'correct').length;
  const believed = answers.filter((a) => a.kind === 'myth').length;
  const missed = answers.length - correct - believed;
  let message;
  if (correct === answers.length) message = '全問正解！　草原では、いつもの魔物が待っている';
  else if (believed) message = `信じていた誤解が${believed}つ、魔物になって草原に出てくる${missed ? `（知らなかった問題の魔物も${missed}体）` : ''}`;
  else message = `知らなかった問題の魔物が${missed}体、草原に出てくる`;
  return { total: answers.length, correct, message };
}

/** 結果・まとめをタップで先へ */
function tap(app) {
  if (view.phase === 'result') { view.wait = 0; frame(app, 0); }
  else if (view.phase === 'done') { view.phase = 'idle'; render(app); app.refresh(); }
}

/** 冒険画面の表示を更新するたびに呼ぶ：始める・終わったものを閉じる */
export function update(app) {
  const s = app.state;
  if (!box.onclick) box.onclick = () => tap(app);
  if (view.phase === 'idle') {
    if (s.meta.startAge == null || !s.firstRun || s.life.generation !== 1 || firstCheckProgress(s).done) return;
    advance(app); // 起動した（読み込み直した）ときは、まだ答えていない問題から
  }
}

/** 毎フレーム（ゲームの時間が進んでいる間）：制限時間を減らし、結果・まとめを閉じる */
export function frame(app, realDt) {
  if (view.phase === 'idle') return;
  if (view.phase === 'question') {
    if (app.tab !== 'adventure') return; // 冒険画面を見ていない間は止める
    view.remaining -= realDt;
    const bar = box.querySelector('.fc-time i');
    const cur = view.session.current;
    if (bar) {
      const ratio = Math.max(0, view.remaining / cur.timeLimit);
      bar.style.width = ratio * 100 + '%';
      bar.parentNode.classList.toggle('low', ratio < 0.3);
    }
    if (view.remaining <= 0) submit(app, null);
    return;
  }
  view.wait -= realDt;
  if (view.wait > 0) return;
  if (view.phase === 'result') advance(app);
  else { view.phase = 'idle'; render(app); app.refresh(); }
}

/** 最初からやり直したとき（セーブを消した・別のセーブを読んだ） */
export function reset() {
  view = { phase: 'idle', session: null, remaining: 0, wait: 0, shownAt: 0, summary: null };
  if (box) { box.hidden = true; box.replaceChildren(); }
}
