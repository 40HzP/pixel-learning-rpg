// 前世の記憶をたどる（設計ページ「最初の3分」。40HzP の依頼で、前世の最期のすぐあとに5問を出す。前の名前は「常識チェック」）。
// 初めて遊ぶ人だけ。最初の案内（生まれ変わり）の前に、画面全体で1問ずつ出す（main.js の runOverlay。出している間ゲームの時間は止まる）。
// 間違えた問題（誤答・時間切れ）は「前世で魔物に吹き込まれた噂」になり、そのザコが最初の人生の1〜10階層で先に出る（sim.js の pickZakoGroup）
import { firstCheckProgress, nextFirstCheck, answerFirstCheck } from '../quiz.js';
import { el } from './dom.js';

export const RECALL_TITLE = '前世の記憶をたどる';
const RESULT_SEC = 2.6;      // 答えたあと、結果を見せてから次の問題へ（タップで先へ）
const REVEAL_GUARD_MS = 300; // 出してすぐは押せない（前の問題の結果を押したつもりで答えないように）
const MAX_STEP_SEC = 0.25;   // 1フレームで減らす時間の上限（ほかのアプリに切り替えていた間は数えない）

/** 前世の記憶をたどる5問を出す（まだ答えていない問題から）。「生まれ変わる」を押すと解決する Promise を返す */
export function recallPastLife(app) {
  return new Promise((resolve) => {
    const card = el('div', { class: 'recall-card' });
    const overlay = el('div', { class: 'overlay movie recall', role: 'dialog', 'aria-label': RECALL_TITLE, tabindex: '-1' },
      el('h2', { class: 'recall-title' }, RECALL_TITLE), card);
    document.getElementById('app').append(overlay);

    const view = { phase: 'question', session: null, answered: null, remaining: 0, wait: 0, shownAt: 0, kind: null, picked: null };
    let last = performance.now();
    let raf = 0;

    function draw() {
      const s = app.state;
      const p = firstCheckProgress(s);
      if (view.phase === 'done') {
        const sm = summarize(s);
        card.replaceChildren(
          el('div', { class: 'fc-head' }, el('b', {}, 'おわり'), el('span', {}, `${sm.total}問中${sm.correct}問正解`)),
          el('p', { class: 'fc-msg' }, sm.message),
          el('small', { class: 'fc-note' }, '答えた問題は、勉強の「過去問復習」で見直せる'),
          el('button', { class: 'primary recall-go', onclick: (ev) => { ev.stopPropagation(); close(); } }, '生まれ変わる'));
        return;
      }
      const cur = view.session.current || view.answered;
      const q = cur.question;
      const bar = el('i');
      bar.style.width = `${Math.max(0, view.remaining / cur.timeLimit) * 100}%`;
      const choices = cur.choices.map((c, i) => {
        const b = el('button', { class: 'fc-choice', onclick: (ev) => { ev.stopPropagation(); pick(i); } }, c.text);
        if (view.phase === 'result') {
          b.disabled = true;
          if (c.kind === 'answer') b.classList.add('right');
          else if (i === view.picked) b.classList.add('wrong');
        }
        return b;
      });
      const parts = [
        el('div', { class: 'fc-head' }, el('b', {}, `${p.index + (view.phase === 'result' ? 0 : 1)}/${p.total}`)),
        el('div', { class: 'fc-time' + (view.phase === 'result' ? ' stop' : '') }, bar),
        el('p', { class: 'fc-q' }, q.question),
        el('div', { class: 'fc-choices' }, choices),
      ];
      if (view.phase === 'result') parts.push(el('p', { class: 'fc-result ' + (view.kind === 'correct' ? 'good' : 'bad') }, resultText(view.kind, q)));
      card.replaceChildren(...parts);
    }

    function pick(index) {
      if (view.phase !== 'question' || performance.now() - view.shownAt < REVEAL_GUARD_MS) return;
      submit(index);
    }
    function submit(index) {
      view.answered = view.session.current;
      const res = answerFirstCheck(app.state, view.session, index, app.ctx);
      app.handleEvents(res.events);
      app.save();
      view.phase = 'result';
      view.kind = res.check.kind;
      view.picked = index;
      view.wait = RESULT_SEC;
      draw();
    }
    /** 次の問題へ。もう無ければ、まとめ */
    function advance() {
      view.session = nextFirstCheck(app.state, app.ctx);
      if (view.session) {
        view.phase = 'question';
        view.remaining = view.session.current.timeLimit;
        view.shownAt = performance.now();
      } else {
        view.phase = 'done';
      }
      draw();
    }
    function step(now) {
      const dt = Math.min(MAX_STEP_SEC, Math.max(0, (now - last) / 1000));
      last = now;
      if (view.phase === 'question') {
        view.remaining -= dt;
        const bar = card.querySelector('.fc-time i');
        if (bar) {
          const ratio = Math.max(0, view.remaining / view.session.current.timeLimit);
          bar.style.width = ratio * 100 + '%';
          bar.parentNode.classList.toggle('low', ratio < 0.3);
        }
        if (view.remaining <= 0) submit(null);
      } else if (view.phase === 'result') {
        view.wait -= dt;
        if (view.wait <= 0) advance();
      }
      raf = requestAnimationFrame(step);
    }
    function close() {
      cancelAnimationFrame(raf);
      overlay.classList.remove('show');
      setTimeout(() => { overlay.remove(); resolve(); }, 500);
    }
    // 結果はタップで先へ
    overlay.addEventListener('click', () => { if (view.phase === 'result') { view.wait = 0; } });

    advance();
    raf = requestAnimationFrame(step);
    requestAnimationFrame(() => { overlay.classList.add('show'); overlay.focus(); });
  });
}

function resultText(kind, q) {
  if (kind === 'correct') return '正解！　前世の記憶がよみがえった';
  const right = `正解は「${q.answer}」`;
  if (kind === 'myth') return `それは、前世で魔物に吹き込まれた噂。${right}`;
  if (kind === 'timeout') return `時間切れ。${right}`;
  return `ちがう。${right}`;
}

/** 5問のまとめ：正解の数と、前世で魔物に吹き込まれた噂（間違えた問題）の数 */
function summarize(s) {
  const answers = s.firstRun.check.answers.filter((a) => a.kind !== 'skipped');
  const correct = answers.filter((a) => a.kind === 'correct').length;
  const rumors = answers.length - correct;
  const message = rumors
    ? `前世で魔物に吹き込まれた噂が${rumors}つ見つかった。噂をささやいた魔物が、生まれ変わった先の草原で待っている`
    : '前世の記憶はたしかだった。草原では、いつもの魔物が待っている';
  return { total: answers.length, correct, message };
}
