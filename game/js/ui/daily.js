// 今日の1問（40HzP の依頼）：冒険画面の札・街の掲示板を押すと、画面全体に出す。
// まだ答えていなければ出題する（クイズと同じく、はじめは問題文だけ。「選択肢を表示する」で選択肢が出て制限時間が減り始める）。
// 答えたあとは、答えと解説を読める。閉じると冒険画面の札は消え、街の掲示板に残る（quiz.js の markDailyOpened）。
// 出している間はゲームの時間が止まる（main.js の runOverlay）
import { createSession, nextQuestion, answer, dailyInfo, dailyPending, markDailyOpened } from '../quiz.js';
import { el, stars } from './dom.js';
import { credit, questionText, effectLines, favButton, choiceText } from './study.js';

const FADE_MS = 300;
const REVEAL_GUARD_MS = 300; // 押したボタンの場所に選択肢が出るので、出てすぐは選べない（続けて2回押しても選んだことにならない）

/** 今日の1問の札の見出し（「今日の1問　10月29日」と記念日） */
export function dailyTitle(info) {
  return el('div', { class: 'daily-title' },
    el('b', {}, '今日の1問'), el('span', {}, info.label),
    info.anniversary ? el('small', {}, info.anniversary) : null);
}

/** 今日の1問を出す。閉じると解決する Promise を返す */
export function openDaily(app) {
  return new Promise((resolve) => {
    const s = app.state;
    const ctx = app.ctx;
    const info = dailyInfo(s, ctx);
    if (!info) { resolve(); return; }
    const q = info.question;
    const body = el('div', { class: 'nande-body' });
    const box = el('div', { class: 'dialog nande-box daily-box', role: 'dialog', 'aria-label': `今日の1問（${info.label}）` }, dailyTitle(info), body);
    const overlay = el('div', { class: 'overlay nande daily' }, box);
    document.getElementById('app').append(overlay);
    requestAnimationFrame(() => overlay.classList.add('show'));
    const closeRow = (label = '閉じる') => el('div', { class: 'btnrow' }, el('button', { class: 'primary', onclick: close }, label));
    let raf = 0;
    let done = false;
    let revealedAt = 0;

    if (!dailyPending(s, ctx)) { showAnswered(); return; }

    const session = createSession(s, 'daily', ctx);
    const cur = nextQuestion(s, session, ctx);
    if (!cur) { showAnswered(); return; }
    let remaining = cur.timeLimit;
    let last = 0;
    const bar = el('div', { class: 'timebar' }, el('i', { style: { width: '100%' } }));
    const choices = el('div', { class: 'choices' }, cur.choices.map((c, i) => el('button', {
      onclick: () => { if (performance.now() - revealedAt >= REVEAL_GUARD_MS) submit(i); },
    }, choiceText(c))));
    const reveal = el('div', { class: 'reveal' },
      el('button', { class: 'primary', onclick: () => {
        if (done || revealedAt) return;
        revealedAt = last = performance.now();
        reveal.replaceWith(choices);
        raf = requestAnimationFrame(tickTimer);
      } }, '選択肢を表示する'),
      el('div', { class: 'muted' }, `押すと制限時間（${cur.timeLimit}秒）が始まる`),
      // あとで答えてもよい（掲示板に残る）
      el('button', { class: 'later', onclick: close }, 'あとで答える（街の掲示板に貼る）'));
    body.replaceChildren(
      el('div', { class: 'qmeta' }, `${q.genre}　${stars(q.difficulty)}　正解すると熟練が ${ctx.balance.quiz.dailyProgress}/${ctx.balance.quiz.correctPerProficiencyLevel} 進む`),
      questionText(app, q),
      bar,
      reveal,
    );

    function tickTimer(now) {
      if (done) return;
      remaining -= Math.max(0, now - last) / 1000;
      last = now;
      const ratio = Math.max(0, remaining / cur.timeLimit);
      bar.firstChild.style.width = ratio * 100 + '%';
      bar.classList.toggle('low', ratio < 0.3);
      if (remaining <= 0) { submit(null); return; }
      raf = requestAnimationFrame(tickTimer);
    }

    function submit(index) {
      if (done) return;
      done = true;
      cancelAnimationFrame(raf);
      const res = answer(s, session, index, ctx);
      Object.assign(res, { question: q, choices: cur.choices });
      app.handleEvents(res.events);
      app.save();
      body.replaceChildren(
        el('div', { class: 'result-head ' + (res.correct ? 'good' : 'bad') }, res.correct ? '正解！' : res.timeout ? '時間切れ…' : '不正解…'),
        el('div', { class: 'qtext' }, q.question),
        el('div', { class: 'choices' }, cur.choices.map((c, i) => el('button', {
          disabled: true, class: c.kind === 'answer' ? 'correct' : i === index ? 'wrong' : '',
        }, choiceText(c)))),
        el('div', { class: 'explain' }, el('div', { class: 'accent' }, `正解：${q.answer}`), q.explanation, credit(app, q)),
        favButton(app, q),
        el('ul', { class: 'effects' }, effectLines(app, res).map(([cls, t]) => el('li', { class: cls }, t))),
        closeRow(),
      );
      box.scrollTop = 0;
    }

    /** もう答えた：自分の答えと、正解・解説 */
    function showAnswered() {
      const r = s.legacy.daily.result || {};
      body.replaceChildren(
        el('div', { class: 'result-head ' + (r.correct ? 'good' : 'bad') }, r.correct ? '今日は正解した！' : '今日は答えた（また明日）'),
        el('div', { class: 'qmeta' }, `${q.genre}　${stars(q.difficulty)}`),
        el('div', { class: 'qtext' }, q.question),
        r.chosen == null ? el('div', { class: 'review-yours bad' }, '時間切れ')
          : el('div', { class: 'review-yours' }, 'あなたの答え：', r.chosen, el('span', { class: r.correct ? 'good' : 'bad' }, r.correct ? '（正解）' : '（不正解）')),
        el('div', { class: 'explain' }, el('div', { class: 'accent' }, `正解：${q.answer}`), q.explanation, credit(app, q)),
        favButton(app, q),
        el('div', { class: 'muted daily-next' }, '次の問題は明日（日付が変わると、冒険画面に札が届く）'),
        closeRow(),
      );
    }

    function close() {
      cancelAnimationFrame(raf);
      if (!done && revealedAt) submit(null); // 選択肢を出したあとに閉じたら、時間切れと同じ
      markDailyOpened(s);
      app.save();
      overlay.classList.remove('show');
      setTimeout(() => { overlay.remove(); resolve(); }, FADE_MS);
    }
  });
}
