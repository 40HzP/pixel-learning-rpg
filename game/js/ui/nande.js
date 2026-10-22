// 孫の「なんで？」：孫と戦っている間、ときどき全ジャンルから1問聞いてくる（sim.js の nande の知らせで出す）。
// 出している間はゲームの時間が止まる（main.js の runOverlay）。答えはふつうの勉強と同じに数える（quiz.js の answer）。
// 正解すると孫にダメージ（sim.js の nandeAnswered）、答えられないと孫が回復する（nandeUnanswered）。
// 勉強のクイズと同じく、はじめは問題文だけを出し、「選択肢を表示する」を押すと選択肢が出て制限時間が減り始める（40HzP の依頼）
import { createSession, nextQuestion, answer } from '../quiz.js';
import { nandeAnswered, nandeUnanswered, midbossLeft } from '../sim.js';
import { spriteCanvas } from '../sprites.js';
import { el, stars } from './dom.js';

const FADE_MS = 300;

/** 1問聞く。閉じると解決する Promise を返す */
export function askNande(app) {
  return new Promise((resolve) => {
    const s = app.state;
    const ctx = app.ctx;
    const kid = s.adventure.enemies.find((e) => (ctx.monsters.find((m) => m.id === e.monsterId) || {}).nande);
    const session = createSession(s, 'quiz', ctx);
    const cur = kid && nextQuestion(s, session, ctx);
    if (!cur) { resolve(); return; } // もう戦っていない・出せる問題がない

    const q = cur.question;
    const sp = (app.monsterSprites[kid.monsterId] || {}).idle || null;
    const body = el('div', { class: 'nande-body' });
    const box = el('div', { class: 'dialog nande-box', role: 'dialog', 'aria-label': `${kid.name}の「なんで？」` },
      el('div', { class: 'nande-head' }, spriteCanvas(sp, 3, app.palette), el('div', { class: 'bubble' }, 'なんで？')),
      body);
    const overlay = el('div', { class: 'overlay nande' }, box);
    document.getElementById('app').append(overlay);
    requestAnimationFrame(() => overlay.classList.add('show'));

    let remaining = cur.timeLimit;
    let last = 0;
    let raf = 0;
    let done = false;
    let revealedAt = 0;
    const REVEAL_GUARD_MS = 300; // 押したボタンの場所に選択肢が出るので、出てすぐは選べない（続けて2回押しても選んだことにならない）
    const bar = el('div', { class: 'timebar' }, el('i', { style: { width: '100%' } }));
    const choices = el('div', { class: 'choices' }, cur.choices.map((c, i) => el('button', {
      onclick: () => { if (performance.now() - revealedAt >= REVEAL_GUARD_MS) submit(i); },
    }, c.text)));
    const reveal = el('div', { class: 'reveal' },
      el('button', { class: 'primary', onclick: () => {
        if (done || revealedAt) return;
        revealedAt = last = performance.now();
        reveal.replaceWith(choices);
        raf = requestAnimationFrame(tickTimer);
      } }, '選択肢を表示する'),
      el('div', { class: 'muted' }, `押すと制限時間（${cur.timeLimit}秒）が始まる`));
    body.replaceChildren(
      el('div', { class: 'qmeta' }, `${q.genre}　${stars(q.difficulty)}`),
      el('div', { class: 'qtext' }, q.question),
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
      const damage = res.correct ? nandeAnswered(s, ctx, res.events) : 0;
      if (!res.correct) res.healed = nandeUnanswered(s, ctx, res.events);
      app.handleEvents(res.events);
      app.save();

      let effect;
      if (res.correct && damage > 0) effect = ['good', `${kid.name}は納得した！（${damage}ダメージ）`];
      else if (res.correct) {
        const m = ctx.monsters.find((x) => x.id === kid.monsterId);
        effect = ['', `${kid.name}は納得した。でも、まだ効かない（防御が崩れるまで 累計であと${midbossLeft(s, m)}問）`];
      } else effect = ['bad', `${kid.name}は納得していない…（${kid.name}のHPが${res.healed}回復した）`];
      body.replaceChildren(
        el('div', { class: 'result-head ' + (res.correct ? 'good' : 'bad') }, res.correct ? '答えられた！' : res.timeout ? '時間切れ…' : '答えられなかった…'),
        el('div', { class: 'qtext' }, q.question),
        el('div', { class: 'explain' }, el('div', { class: 'accent' }, `正解：${q.answer}`), q.explanation),
        el('ul', { class: 'effects' }, el('li', { class: effect[0] }, effect[1])),
        el('div', { class: 'btnrow' }, el('button', { class: 'primary', onclick: close }, '閉じる')),
      );
      box.scrollTop = 0;
    }

    function close() {
      overlay.classList.remove('show');
      setTimeout(() => { overlay.remove(); resolve(); }, FADE_MS);
    }
  });
}
