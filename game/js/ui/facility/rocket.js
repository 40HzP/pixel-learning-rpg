// ロケット発射場（ロケット計画の工程・建造費・打ち上げ・試作機と、ロケット発射場の顧問）。2026-11-09 に ui/facility.js から分けた
import {
  payRocketBuildCost, rocketSteps, launchInfo, advisorActive, rocketBuildCost,
  barnAnimals, isSpaceDog, prototypeInfo, prototypeEffect, launchSuccessRate, worldOf,
} from '../../sim.js';
import { fieldById, isUnlocked } from '../../fields.js';
import { spriteCanvas } from '../../sprites.js';
import { el, fmt } from '../dom.js';
import { live, say, update, note, pct } from './common.js';
import { advisorSection } from './advisor.js';

/**
 * ロケット発射場：ロケット計画の工程（設計ページ「ロケット計画」）。建造費はゴールドで払い、
 * ほかの工程（機体設計・エンジン・軌道計算・打ち上げ許可）は、工程の学際分野を専攻にしている間に進む。
 * 工程は生まれ変わっても残る。ゴールドは生まれ変わると無くなるので、建造費は1つの人生のうちに貯める
 */
export function rocketPanel(app) {
  const s = app.state;
  const ctx = app.ctx;
  const cost = rocketBuildCost(s, ctx);
  const subsidy = advisorActive(s, ctx, 'politician');
  const paid = s.legacy.rocket.buildCostPaid;
  const ratio = Math.min(1, s.gold / cost);
  const btn = el('button', {
    class: 'primary', disabled: paid,
    onclick: () => {
      if (!confirm(`${fmt(cost)}G を払ってロケットの建造費にしますか？`)) return;
      const res = payRocketBuildCost(app.state, app.ctx);
      if (!res.ok) { say(app, res.reason, 'bad'); return; }
      say(app, 'ロケットの建造費を払った！（生まれ変わっても残る）', 'good');
      app.save();
      update(app, true);
    },
  }, paid ? '払った' : `建造費を払う（${fmt(cost)}G）`);
  if (!paid) live.buttons.push({ btn, price: cost });
  const steps = rocketSteps(s, ctx);
  const rows = steps.map((st) => {
    const f = st.fieldDef;
    const bar = el('i');
    const text = el('small');
    live.rocket.push({ id: st.id, bar, text });
    let how;
    if (st.done) how = '';
    else if (st.active) how = '専攻にしているので進んでいる';
    else if (!isUnlocked(s, f.id)) how = `${f.name}を解放すると進められる`;
    else if (s.knowledge.majors.includes(f.id)) how = `${f.name}が休眠しているので止まっている`;
    else how = `${f.name}を専攻にすると進む（学校・研究室で付け替える）`;
    return el('div', { class: 'item rocket-step' + (st.done ? '' : st.active ? '' : ' locked') },
      el('div', { class: 'name' }, st.name, el('small', {}, `${f.name}（${f.genres.join('＋')}）`),
        el('div', { class: 'timebar' }, bar), text, how ? el('small', { class: st.active ? 'good' : '' }, how) : null),
      el('span', { class: st.done ? 'good' : 'muted' }, st.done ? '済' : st.active ? '進行中' : '未'));
  });
  const info = launchInfo(s, ctx);
  const rate = `${Math.round(info.successRate * 100)}%`;
  const redo = ctx.fields.rocketSteps.filter((st) => st.redoOnFailure).map((st) => st.name).join('・');
  const launchBtn = el('button', {
    class: 'primary launch', disabled: !info.ok,
    onclick: () => {
      const odds = info.rateVisible ? `成功率は${rate}。` : '';
      if (!confirm(`ロケットを打ち上げますか？\n${odds}失敗すると${redo}の工程をやり直しになる`)) return;
      app.launch();
    },
  }, '打ち上げる');
  return [
    note('ロケットができると、打ち上げて月面の階層に行ける。工程は生まれ変わっても残る。ゴールドは生まれ変わると無くなるので、建造費は1つの人生のうちに貯めて払う'),
    el('h3', { class: 'subhead' }, '建造費'),
    el('div', { class: 'profit' }, '所持金 ', live.gold, `G ／ ${fmt(cost)}G`),
    subsidy && !paid ? el('small', { class: 'good' }, `補助金（政治家）：建造費 ${fmt(ctx.balance.rocket.buildCost)}G のうち ${fmt(ctx.balance.rocket.buildCost - cost)}G を肩代わりしてくれる`) : null,
    el('div', { class: 'timebar' }, el('i', { style: { width: `${(paid ? 1 : ratio) * 100}%` } })),
    el('div', { class: 'btnrow' }, btn),
    el('h3', { class: 'subhead' }, '工程（学際分野を専攻にしている間に進む）'),
    note(`1つの工程に ゲーム内で${ctx.balance.rocket.stepYears}年かかる。専攻は2枠なので、同時に進むのは2つまで。工程ごとに専攻を付け替える`),
    el('div', { class: 'list' }, rows),
    el('h3', { class: 'subhead' }, '打ち上げ'),
    note(info.ok ? `ロケットができた！　打ち上げは無料で、何度でもできる。失敗すると${redo}の工程だけやり直しになる`
      : `建造費とすべての工程が終わると打ち上げられる（${info.reason}）`),
    el('div', { class: 'profit' }, '成功率 ', el('b', {}, info.rateVisible ? rate : '？？？'),
      el('small', { class: 'muted' }, info.rateVisible ? `（${fieldById(ctx, 'probability').name}で見えている）` : `（${fieldById(ctx, 'probability').name}を専攻にすると見える）`)),
    el('div', { class: 'btnrow' }, launchBtn),
    ...prototypeSection(app),
    ...advisorSection(app, ['rocket']),
  ];
}

/**
 * 試作機（設計ページ「飼育小屋と試作機」）：「機体設計」の工程が終わると、飼育小屋（月面の飼育ドームも）のザコを1体乗せて飛ばせる。
 * 成功すると「宇宙帰り」の印と、ザコごとの効果（prototypeEffect）。犬は必ず生きて帰ってくる。ほかのザコは失敗すると野に戻る。
 * 成功率と、成功率が上がる量が見えるのは、確率論を専攻にしているときだけ（本番と同じ）
 */
function prototypeSection(app) {
  const s = app.state;
  const ctx = app.ctx;
  const info = prototypeInfo(s, ctx);
  const head = el('h3', { class: 'subhead' }, '試作機（飼育小屋のザコを乗せて飛ばす）');
  if (!info.ok) return [head, note(`ロケット計画の「機体設計」が終わると、飼育小屋のザコを試作機に乗せて飛ばせる（${info.reason}）`)];
  const shown = info.rateVisible;
  const prob = fieldById(ctx, 'probability').name;
  const animals = barnAnimals(s, ctx);
  const effectText = (a) => {
    const e = prototypeEffect(s, ctx, a.id);
    const dog = isSpaceDog(a.monster);
    let t;
    if (e.kind === 'rate') t = `成功すると、本番の打ち上げの成功率が${dog ? '' : '少し'}上がる${shown ? `（+${+(e.amount * 100).toFixed(1)}%）` : ''}`;
    else if (e.kind === 'step') t = `成功すると「${e.stepName}」の工程が進む`;
    else t = e.capped ? '本番の成功率はもう上限（飛ばすことはできる）' : '効果はもう出た（飛ばすことはできる）';
    // 犬以外は、失敗しても懐き度%の確率で帰ってくる（設計ページ「懐き度」の①）
    const back = Math.floor(a.affinity || 0);
    return t + (dog ? '。犬は必ず生きて帰ってくる' : back > 0 ? `。失敗しても${back}%の確率で帰ってくる（懐き度${back}）` : '。失敗すると野に戻る（懐き度0）');
  };
  const rows = animals.map((a) => {
    const m = a.monster;
    const sp = (app.monsterSprites[m.id] || {}).idle;
    const btn = el('button', {
      class: 'primary',
      onclick: () => {
        const odds = shown ? `\n成功率は${pct(info.successRate)}。` : '';
        const back = Math.floor(a.affinity || 0);
        const risk = isSpaceDog(m) ? '' : `\n失敗すると、${m.name}は${back > 0 ? `懐き度${back}%の確率で帰ってくる。帰ってこなければ` : ''}野に戻る。`;
        if (!confirm(`${m.name}を試作機に乗せて飛ばしますか？（${fmt(info.cost)}G）${odds}${risk}`)) return;
        app.flyPrototype(m.id);
      },
    }, '乗せて飛ばす');
    live.buttons.push({ btn, price: info.cost });
    return el('div', { class: 'item' },
      sp ? spriteCanvas(sp, 2, app.palette) : null,
      el('div', { class: 'name' }, m.name, a.space ? el('span', { class: 'space-badge' }, '宇宙帰り') : null,
        worldOf(m) === 'moon' ? el('small', {}, '月面の飼育ドーム') : null,
        el('small', {}, effectText(a))),
      el('div', { class: 'btns' }, btn));
  });
  return [
    head,
    note(`1回 ${fmt(info.cost)}G。成功すると「宇宙帰り」の印が付き、乗せたザコによって本番の打ち上げの成功率が上がったり、ロケット計画の工程が進んだりする（同じザコの効果は1回まで）。犬は必ず生きて帰ってくる。ほかのザコは失敗しても懐き度%の確率で帰ってくるが、帰ってこなければ小屋からいなくなり、野に戻る（また倒すと、なつくことがある。懐き度は0から）。帰ってくると懐き度が上がる`),
    el('div', { class: 'profit' }, '試作機の成功率 ', el('b', {}, shown ? pct(info.successRate) : '？？？'),
      el('small', { class: 'muted' }, shown ? `（${prob}で見えている）` : `（${prob}を専攻にすると見える）`)),
    shown ? el('div', { class: 'profit' }, '本番の打ち上げの成功率 ', el('b', {}, pct(launchSuccessRate(s, ctx))),
      el('small', { class: 'muted' }, `（試作機で +${+((launchSuccessRate(s, ctx) - ctx.balance.rocket.launchSuccessRate) * 100).toFixed(1)}%。${pct(ctx.balance.rocket.launchSuccessRateMax)}まで）`)) : null,
    animals.length ? el('div', { class: 'list' }, rows)
      : note('飼育小屋にまだ誰もいない。ザコを倒すと、ときどきなついて、飼育小屋に入る'),
  ];
}
