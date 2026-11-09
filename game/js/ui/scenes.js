// 画面全体のミニムービーの出し方：中ボスを倒したとき・体の不調・寿命と生まれ変わりの場面・ロケットの打ち上げと帰還・試作機。
// 2026-11-09 に main.js から分けた
import {
  createRateTracker, lifeLogHighlights, seeOffFriends, launchRocket, returnToEarth, flyPrototype, launchSuccessRate, launchRateVisible,
} from '../sim.js';
import { fmt, affNum } from './dom.js';
import { playMovie } from './movie.js';
import { playLaunch } from './launch.js';
import { playPrologue } from './prologue.js';
import { profChangeText } from './proflog.js';
import * as study from './study.js';

/**
 * app に結び付けたミニムービーの関数を作る（main.js の起動で1回だけ）。
 * notify・runOverlay・saveNow・refreshActive・showIntro・resetLaunch（起動から3分の数え直し）・screens は main.js から渡す
 */
export function createScenes(app, { notify, runOverlay, saveNow, refreshActive, showIntro, resetLaunch, screens }) {
  const ctx = app.ctx;
  const balance = ctx.balance;
  const town = app.town;
  const monsterSprites = app.monsterSprites;

  /**
   * ミニムービーは、勉強画面で問題を解いている最中（問題が出ていて、まだ答えていない間）には出さずに取っておき、
   * 答え終わったら出す（40HzP の依頼）。取っておいたものは毎フレーム見て、解き終わったら順に出す（releaseHeldMovies）
   */
  const heldMovies = [];
  function afterAnswering(start) {
    if (study.answering(app)) heldMovies.push(start);
    else start();
  }
  /** 問題を解いている間に取っておいたミニムービー：答え終わったら（勉強画面を離れても）出す（main.js の frame から毎フレーム） */
  function releaseHeldMovies() {
    if (heldMovies.length && !study.answering(app)) for (const start of heldMovies.splice(0)) start();
  }

  /** 魔物の defeatMovie（倒したときのミニムービー）を流す */
  function startMovie(m) {
    if (!m || !m.defeatMovie || !m.defeatMovie.length) return;
    afterAnswering(() => runOverlay(() => playMovie(app, { lines: m.defeatMovie, otherId: m.id })));
  }

  /**
   * 年を取って体の不調を感じ始めた（寿命の life.ailmentYearsBefore 年前）：年老いた主人公のミニムービーを流す。
   * 文は town.json の病院の ailmentMovie（{name}＝主人公の名前、{age}＝年齢）
   */
  function startAilmentMovie(age) {
    const h = town.facilities.find((f) => f.id === 'hospital');
    if (!h || !h.ailmentMovie || !h.ailmentMovie.length) return;
    const fill = (line) => line.replaceAll('{name}', app.state.hero.name).replaceAll('{age}', age);
    afterAnswering(() => runOverlay(() => playMovie(app, { lines: h.ailmentMovie.map(fill), otherId: null, hero: 'old' })
      .then(() => notify(`街に病院がある。治療を受けると、寿命が${balance.hospital.extendYears}年延びる（${balance.hospital.treatmentCosts.length}回まで）`, 'good'))));
  }

  /**
   * 寿命で亡くなった：ムービーで前世をふり返り、生まれ変わりの案内を出す。
   * 問題を解いている最中なら、答え終わってから（年齢を選ぶまでゲームの時間は止まっているので、制限時間も減らない）
   */
  function onReincarnated(e) {
    afterAnswering(() => reincarnationMovie(e));
  }
  function reincarnationMovie(e) {
    resetLaunch(); // 新しい人生が始まったら、そこから3分を数え直す
    const p = e.life;
    app.rate = createRateTracker();
    for (const sc of Object.values(screens)) sc.reset && sc.reset(app);
    runOverlay(() => playPrologue(app, rebirthScene(p)).then(() => { showIntro(); saveNow(); refreshActive(true); }));
  }
  /**
   * 生まれ変わりの場面：終わったばかりの人生の本物の熟練の記録から数行を流す（設計ページ「生まれ変わるたびの『前世の記憶をたどる』」の案。
   * 初回の作り話の前世と同じ場面）。p は前世のまとめ（reincarnate の返り値）。その人生のまとめ（Lv・最高到達・残したゴールド）を下に添える
   */
  function rebirthScene(p) {
    const log = lifeLogHighlights(app.state, p.generation).map((c) => ({
      when: `${c.age}歳`, what: c.field ? `学際分野「${c.field}」` : c.genre, how: profChangeText(c),
      kind: c.field ? 'field' : c.to > c.from ? 'up' : c.to < c.from ? 'down' : 'same',
    }));
    log.push({ when: `${p.age}歳`, what: '', how: 'ここで記録が途切れている', kind: 'end' });
    return {
      log,
      head: `${p.name}の熟練の記録`,
      sub: `Lv${p.level}・最高到達${p.maxFloor}階層${p.moonFloor ? `（月面${p.moonFloor}階層）` : ''}・${fmt(p.gold)}ゴールドを残した`,
      gender: app.state.hero.gender,
      // 懐いた飼育小屋のザコが見送る（設計ページ「懐き度」の③。懐き度の高い順に数体）
      friends: seeOffFriends(app.state, ctx).map((f) => ({ ...f, sprite: (monsterSprites[f.id] || {}).idle || null })),
    };
  }

  /**
   * ロケットを打ち上げる（ロケット発射場）。成功すれば月面の1階層へ（前に行っていればその階層へ）、
   * 失敗すればエンジン・推進剤の工程をやり直す。どちらもミニムービーのあとで知らせる
   */
  function launch() {
    const r = launchRocket(app.state, ctx);
    if (!r.ok) { notify(r.reason, 'bad'); return r; }
    saveNow();
    const where = `月面${app.state.adventure.floor}階層`;
    runOverlay(() => playLaunch(app, r.success
      ? { from: 'earth', to: 'moon', lines: ['月面に着いた！', `${where}から冒険を続ける。月面の階層は、地球とは別に数える。`, '地球に帰るときは、月面の街の帰還ロケットに乗る（無料）。'] }
      : { from: 'earth', to: null, lines: ['打ち上げに失敗した…', `${r.redo.join('・')}の工程をやり直す。ロケット発射場で、また専攻にして進めよう。`] })
      .then(() => {
        if (r.success) notify(`月面に着いた！　${where}から`, 'good');
        else notify(`打ち上げに失敗した…　${r.redo.join('・')}をやり直す`, 'bad');
        refreshActive(true);
      }));
    return r;
  }
  /** 帰還ロケットで地球に帰る（無料で、必ず帰れる）。地球は打ち上げた階層から */
  function returnHome() {
    const r = returnToEarth(app.state, ctx);
    if (!r.ok) { notify(r.reason, 'bad'); return r; }
    saveNow();
    runOverlay(() => playLaunch(app, { from: 'moon', to: 'earth', lines: ['地球に帰ってきた！', `${r.floor}階層から冒険を続ける。`] })
      .then(() => { notify(`地球に帰ってきた。${r.floor}階層から`, 'good'); refreshActive(true); }));
    return r;
  }

  /**
   * 飼育小屋のザコを試作機に乗せて飛ばす（設計ページ「飼育小屋と試作機」）。ロケットのミニムービー（地球から飛び立ち、地球の打ち上げ場に戻る。
   * 失敗は少し浮いて落ちる）のあとに、帰ってきたか・効果を知らせる。動物が死ぬ話はしない（犬以外は失敗すると野に戻る）
   */
  function prototypeFlight(id) {
    const before = launchSuccessRate(app.state, ctx);
    const events = [];
    const r = flyPrototype(app.state, ctx, id, events);
    if (!r.ok) { notify(r.reason, 'bad'); return r; }
    saveNow();
    const pct = (x) => `${Math.round(x * 100)}%`;
    const shown = launchRateVisible(app.state, ctx);
    let lines;
    let summary;
    if (r.success) {
      const e = r.effect;
      let effect;
      if (e.kind === 'rate') effect = `本番の打ち上げの成功率が上がった。${shown ? `（${pct(before)}→${pct(launchSuccessRate(app.state, ctx))}）` : ''}`;
      else if (e.kind === 'step') effect = r.stepDone ? `ロケット計画の「${e.stepName}」の工程が進み、終わった！` : `ロケット計画の「${e.stepName}」の工程が進んだ。`;
      else effect = e.capped ? '（本番の打ち上げの成功率は、もう上限まで上がっている）' : `（${r.name}の効果は、もう出ている）`;
      lines = [`試作機が帰ってきた！　${r.name}は元気だ。`, `${r.name}に「宇宙帰り」の印が付いた。`, effect];
      if (r.history && e.kind !== 'none') lines.push(r.history);
      summary = `${r.name}が試作機で宇宙から帰ってきた！\n${effect}`;
    } else if (r.dog) {
      lines = ['試作機はうまく飛べなかった…', `でも${r.name}は元気に戻ってきた。犬は必ず生きて帰ってくる。`];
      summary = `試作機は失敗した。${r.name}は元気に戻ってきた`;
    } else if (r.cameBack) {
      lines = ['試作機はうまく飛べなかった…', `でも${r.name}はよく懐いていたので、ちゃんと帰ってきた。`];
      summary = `試作機は失敗した。${r.name}は懐いていたので帰ってきた`;
    } else {
      lines = ['試作機はうまく飛べなかった…', `${r.name}は驚いて、野に帰っていった。（また倒すと、なつくことがある）`];
      summary = `試作機は失敗した。${r.name}は野に帰っていった`;
    }
    if (r.affinity > 0) lines.push(`${r.name}の懐き度が上がった（+${affNum(r.affinity)}）。`);
    const sp = (monsterSprites[id] || {}).idle || null;
    runOverlay(() => playLaunch(app, { from: 'earth', to: r.success ? 'earth' : null, lines, passenger: sp ? { sprite: sp, leaves: r.left } : null })
      .then(() => { notify(summary, r.success ? 'good' : r.left ? 'bad' : ''); app.handleEvents(events); refreshActive(true); }));
    return r;
  }

  return { afterAnswering, releaseHeldMovies, startMovie, startAilmentMovie, onReincarnated, rebirthScene, launch, returnHome, prototypeFlight };
}
