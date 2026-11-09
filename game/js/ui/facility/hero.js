// 主人公（街の道に立つ主人公をタップ）：名前の変更とステータス。2026-11-09 に ui/facility.js から分けた
import {
  EQUIP_SLOTS, heroTitles, heroStats, renameHero, HERO_NAME_MAX, expMultiplier, generationMultiplier, ageYears, farthestReached,
} from '../../sim.js';
import { el } from '../dom.js';
import { live, say, update, note } from './common.js';

/** 主人公：名前とステータス */
export function heroPanel(app) {
  const s = app.state;
  const b = app.ctx.balance;
  const hs = heroStats(s, app.ctx);
  const titles = heroTitles(s, app.ctx);
  const nameInput = el('input', { type: 'text', value: s.hero.name, maxLength: HERO_NAME_MAX, autocomplete: 'off', 'aria-label': '主人公の名前' });
  const rename = () => {
    const name = renameHero(app.state, nameInput.value);
    app.save();
    say(app, `名前を「${name}」にした`, 'good');
    update(app, true);
  };
  const stat = (label, value, text) => el('div', { class: 'stat' }, el('span', {}, label), value instanceof Node ? value : el('b', {}, value), el('small', {}, text));
  // 最高到達地点（40HzP の依頼）：この人生でいちばん深く進んだ階層とその世界、月面。生まれ変わったあとは前世も含めた最高も出す
  const far = farthestReached(s, app.stages);
  const whose = (g) => (g === s.life.generation ? 'この人生' : `${g}世代目`);
  const farText = 'この人生でいちばん深く進んだところ' + (s.legacy.lives.length
    ? `。歴代最高は${far.best.floor}階層（${whose(far.best.generation)}）${far.bestMoon.floor ? `・月面${far.bestMoon.floor}階層（${whose(far.bestMoon.generation)}）` : ''}`
    : '');
  return [
    el('div', { class: 'rename' }, nameInput, el('button', { onclick: rename }, '名前を変える')),
    el('div', { class: 'stats' },
      stat('HP', live.hp, '0になるとやられて、1つ手前の階層の最初からやり直す（全回復する）。誕生日にも全回復'),
      stat('MP', live.mp, `敵が2体以上いると「${b.spell.name}」（MP${b.spell.mpCost}・敵全体）を使う`),
      stat('攻撃', hs.atk, `1体を叩く強さ（秒間${+(1 / b.hero.attackIntervalSec).toFixed(1)}回）`),
      stat('防御', hs.def, '受けるダメージが減る'),
      stat('賢さ', hs.wis, `「${b.spell.name}」の強さ。勉強で正解するほど上がる`),
      stat('経験値倍率', `×${expMultiplier(s, b).toFixed(2)}`, `勉強で正解するたびに +${Math.round((b.hero.expBonusPerCorrect || 0) * 100)}%`),
      el('div', { class: 'stat wide' }, el('span', {}, '最高到達地点'),
        el('b', {}, `${far.floor}階層${far.stage ? `（${far.stage.name}）` : ''}${far.moon ? `・月面${far.moon}階層` : ''}`),
        el('small', {}, farText)),
      el('div', { class: 'stat wide' }, el('span', {}, '装備'),
        el('b', {}, EQUIP_SLOTS.map((slot) => app.ctx.items.find((i) => i.id === s.equipment[slot])).filter(Boolean).map((i) => i.name).join('・') || 'なし'),
        el('small', {}, '街の店で買う。武器・防具・装飾品を1つずつ付けられる')),
      // 称号は学際分野でたくさん増えるので、幅いっぱいに並べる
      titles.length ? el('div', { class: 'stat wide' }, el('span', {}, '称号'), el('b', {}, titles.join('・')), el('small', {}, '中ボスを倒したり、学際分野を解放したりするともらえる')) : null,
      stat('世代', `${s.life.generation}世代目`, `ステータスの伸び・経験値・ゴールド ×${generationMultiplier(s, b)}（生まれ変わるたびに ×${b.reincarnation.multiplier}）`),
      stat('寿命', s.life.treatments ? `${b.life.lifespanYears}歳前後 ＋${s.life.treatments * b.hospital.extendYears}年` : `${b.life.lifespanYears}歳前後`,
        `今${ageYears(s)}歳。${s.life.ailing ? '体の不調を感じている（街の病院で治療を受けると寿命が延びる）。' : ''}寿命が来ると、前世の記憶（熟練・図鑑・称号）を受け継いで生まれ変わる。Lv・ゴールド・装備・仲間・会社は最初から`)),
    s.legacy.lives.length
      ? note(`前世：${s.legacy.lives.slice(-3).reverse().map((p) => `${p.generation}世代目 ${p.name}（${p.age}歳・Lv${p.level}・最高${p.maxFloor}階層）`).join('　')}`)
      : null,
  ];
}
