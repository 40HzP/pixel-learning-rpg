// 前世の記憶をたどる（設計ページ「最初の3分」と「生まれ変わるたびの『前世の記憶をたどる』」。前の名前は常識チェック）：
// 初めて遊ぶ人の最初の人生と、生まれ変わるたびに、始まりの画面（最初の案内）のあと冒険画面のステータスの下に5問を1問ずつ出す。
// ゲームは止めない（主人公は後ろで歩いて戦い続ける）。出している間、ステータスは短く（HUD の .checking）。制限時間は冒険画面を見ている間だけ減る。
// 誤答1を選んだ問題のザコは「前世で魔物に吹き込まれた噂」として出てくる（sim.js・main.js）
import { recallProgress, nextRecall, answerRecall } from '../quiz.js';
import { el } from './dom.js';

export const RECALL_TITLE = '前世の記憶をたどる';
const RESULT_SEC = 2.6;      // 答えたあと、結果を見せてから次の問題へ（タップで先へ）
const DONE_SEC = 9;          // 5問終わったまとめを出しておく時間（タップで閉じる）
const REVEAL_GUARD_MS = 300; // 出してすぐは押せない（前の問題の結果を押したつもりで答えないように）

let box = null;
let view = fresh();
function fresh() { return { phase: 'idle', session: null, answered: null, remaining: 0, wait: 0, shownAt: 0, kind: null, picked: null, summary: null }; }

export function init(app, parent) {
  box = el('div', { class: 'first-check recall', hidden: true });
  parent.append(box);
  box.addEventListener('click', () => tap(app));
}

/** 前世の記憶をたどるを出しているか（出している間はステータスを短くし、今日の1問の札とレベルアップなどの知らせを出さない） */
export const showing = () => view.phase !== 'idle';

/** 描き直して、知らせの位置を合わせる（用紙の高さが変わると、その下に出す知らせが重なるため） */
function render(app) {
  draw(app);
  app.placeNotices();
}

function draw(app) {
  const p = recallProgress(app.state);
  if (view.phase === 'idle') { box.hidden = true; box.replaceChildren(); return; }
  box.hidden = false;
  if (view.phase === 'done') {
    const sm = view.summary;
    box.replaceChildren(
      el('div', { class: 'fc-head' }, el('b', {}, RECALL_TITLE), el('span', {}, `${sm.total}問中${sm.correct}問正解`)),
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
    el('div', { class: 'fc-head' }, el('b', {}, RECALL_TITLE), el('span', {}, `${'☆'.repeat(q.difficulty)}　${p.index + (view.phase === 'result' ? 0 : 1)}/${p.total}`)),
    el('div', { class: 'fc-time' + (view.phase === 'result' ? ' stop' : '') }, bar),
    el('p', { class: 'fc-q' }, q.question),
    el('div', { class: 'fc-choices' }, choices),
  ];
  if (view.phase === 'result') parts.push(el('p', { class: 'fc-result ' + (view.kind === 'correct' ? 'good' : 'bad') }, resultText(view.kind, q)));
  box.replaceChildren(...parts);
}

function resultText(kind, q) {
  if (kind === 'correct') return '正解！　前世の記憶がよみがえった';
  const right = `正解は「${q.answer}」`;
  if (kind === 'myth') return `それは、前世で魔物に吹き込まれた噂。${right}`;
  if (kind === 'timeout') return `時間切れ。${right}`;
  return `ちがう。${right}`;
}

function pick(app, index) {
  if (view.phase !== 'question' || performance.now() - view.shownAt < REVEAL_GUARD_MS) return;
  submit(app, index);
}

function submit(app, index) {
  view.answered = view.session.current;
  const res = answerRecall(app.state, view.session, index, app.ctx);
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
  view.session = nextRecall(app.state, app.ctx);
  if (view.session) {
    view.phase = 'question';
    view.remaining = view.session.current.timeLimit;
    view.shownAt = performance.now();
  } else if (view.phase === 'result') {
    view.phase = 'done';
    view.wait = DONE_SEC;
    view.summary = summarize(app.state);
  } else {
    view.phase = 'idle';
  }
  render(app);
}

/** 5問のまとめ：正解の数と、前世で魔物に吹き込まれた噂（誤答1を選んだ問題）・知らなかった問題の数 */
function summarize(s) {
  const answers = s.firstRun.check.answers.filter((a) => a.kind !== 'skipped');
  const correct = answers.filter((a) => a.kind === 'correct').length;
  const rumors = answers.filter((a) => a.kind === 'myth').length;
  const missed = answers.length - correct - rumors;
  let message;
  if (correct === answers.length) message = '前世の記憶はたしかだった。草原では、いつもの魔物が待っている';
  else if (rumors) message = `前世で魔物に吹き込まれた噂が${rumors}つ。噂をささやいた魔物が草原に現れる${missed ? `（思い出せなかった問題の魔物も${missed}体）` : ''}`;
  else message = `思い出せなかった問題の魔物が${missed}体、草原に現れる`;
  return { total: answers.length, correct, message };
}

/** 結果・まとめをタップで先へ */
function tap(app) {
  if (view.phase === 'result') view.wait = 0;
  else if (view.phase === 'done') close(app);
}

function close(app) {
  view.phase = 'idle';
  render(app);
  app.refresh();
}

/** 冒険画面の表示を更新するたびに呼ぶ：まだ答えていない問題があれば始める（読み込み直したときも続きから） */
export function update(app) {
  const s = app.state;
  if (view.phase !== 'idle' || s.meta.startAge == null || recallProgress(s).done) return;
  advance(app);
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
  else close(app);
}

/** 最初からやり直したとき（セーブを読んだ・生まれ変わった・デバッグでやり直す） */
export function reset() {
  view = fresh();
  if (box) { box.hidden = true; box.replaceChildren(); }
}
