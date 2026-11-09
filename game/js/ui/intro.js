// 最初の案内（年齢と名前と性別を選ぶ）。初めて始めるときと、生まれ変わったときに出す。2026-11-09 に main.js から分けた
import { canStartAt, startGame, lifespanFor, generationMultiplier, HOURS_PER_YEAR } from '../sim.js';
import { beginRecall } from '../quiz.js';
import { spriteCanvas } from '../sprites.js';

/** 案内のボタンをつなぎ、案内を出す関数（showIntro）を返す（main.js の起動で1回だけ）。heroLooks・saveNow・refreshActive は main.js から渡す */
export function createIntro(app, { heroLooks, saveNow, refreshActive }) {
  const ctx = app.ctx;
  const balance = ctx.balance;
  const palette = app.palette;
  const intro = document.getElementById('intro');
  /** 最初の案内（年齢と名前を選ぶ）。生まれ変わったあとも出す（世代と、受け継いだものを書く） */
  function showIntro() {
    const s = app.state;
    const gen = document.getElementById('intro-gen');
    gen.hidden = s.life.generation <= 1;
    if (s.life.generation > 1) {
      gen.textContent = `${s.life.generation}世代目。前世の記憶（熟練・図鑑・称号）を受け継いだ。`
        + `ステータスの伸び・経験値・ゴールドが ${generationMultiplier(s, balance)}倍`;
    }
    document.getElementById('hero-name').value = s.hero.name === '主人公' ? '' : s.hero.name;
    // 性別は前に選んだもの（初めては男の子）を選んでおく
    pickGender(s.hero.gender);
    // 初めて始めるとき（1世代目）は7歳からを選べない。生まれ変わったあとは選べる
    for (const b of intro.querySelectorAll('[data-age]')) b.disabled = !canStartAt(s, Number(b.dataset.age));
    document.getElementById('intro-age7-note').textContent = canStartAt(s, 7) ? 'すぐ戦えるが弱い' : '生まれ変わると選べる';
    intro.hidden = false;
  }
  // 性別のボタン（男の子・女の子）。それぞれの主人公の絵を付ける
  let gender = 'male';
  const genderButtons = [...intro.querySelectorAll('[data-gender]')];
  function pickGender(g) {
    gender = g === 'female' ? 'female' : 'male';
    for (const b of genderButtons) {
      const on = b.dataset.gender === gender;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
    }
  }
  for (const b of genderButtons) {
    // 生まれたばかりは何も装備していないので、素手でいつもの服の姿
    const sp = heroLooks({ hero: { gender: b.dataset.gender }, equipment: {} }).idle;
    if (sp) b.prepend(spriteCanvas(sp, 2, palette));
    b.addEventListener('click', () => pickGender(b.dataset.gender));
  }
  // 7歳まで現実でどのくらいかかるか（balance.json の時間の速さから出す）
  const untilSeven = (7 * HOURS_PER_YEAR) / balance.time.gameHoursPerRealSecond;
  const span = untilSeven >= 90 * 60 ? `約${Math.round(untilSeven / 3600)}時間` : `約${Math.max(1, Math.round(untilSeven / 60))}分`;
  document.getElementById('intro-age0-note').textContent = `準備期間が長い（7歳まで、遊んでいる時間で${span}）`;
  for (const b of intro.querySelectorAll('[data-age]')) {
    b.addEventListener('click', () => {
      if (!canStartAt(app.state, Number(b.dataset.age))) return;
      startGame(app.state, Number(b.dataset.age), document.getElementById('hero-name').value, lifespanFor(balance, Math.random), gender);
      // 前世の記憶をたどる5問を決める：初めて遊ぶ人の最初の人生と、生まれ変わるたび（前のセーブの1世代目は出さない）。
      // 出すのは冒険画面の横（ui/recall.js。冒険が始まると出る）
      if (app.state.life.generation > 1 || !app.state.firstRun) beginRecall(app.state, ctx);
      intro.hidden = true;
      saveNow();
      refreshActive(true);
    });
  }
  return { showIntro };
}
