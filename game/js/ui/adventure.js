// 冒険画面の表示項目（設計ページ「自動冒険画面に必ず表示する項目」）。空の部分（y=0〜97）に重ねる
import { heroStats, expToNext, formatDate, trackRates, isInvulnerable, midbossState } from '../sim.js';
import { el, fmt } from './dom.js';

let refs = null;

export function init(app) {
  const hud = document.getElementById('hud');
  const span = () => el('span');
  refs = {
    hud,
    date: span(), floor: span(), name: span(), lv: span(), allies: span(),
    hp: span(), hpbar: el('i'), mp: span(), mpbar: el('i'),
    atk: span(), def: span(), wis: span(), agi: span(), luck: span(),
    exp: span(), total: span(), gold: span(), rexp: span(), rgold: span(), enemy: span(),
    boss: el('div', { class: 'boss', onclick: () => app.showTab('study') }),
  };
  const r = refs;
  hud.append(
    el('div', { class: 'row' }, r.date, r.floor),
    el('div', { class: 'row' }, el('span', {}, r.name, '　Lv ', r.lv), r.allies),
    el('div', { class: 'gauges' },
      el('div', {}, el('div', { class: 'row' }, el('span', {}, 'HP'), r.hp), el('div', { class: 'hpbar' }, r.hpbar)),
      el('div', {}, el('div', { class: 'row' }, el('span', {}, 'MP'), r.mp), el('div', { class: 'hpbar mp' }, r.mpbar))),
    el('div', { class: 'row' }, el('span', {}, '攻撃 ', r.atk, '　防御 ', r.def, '　賢さ ', r.wis)),
    el('div', { class: 'row' }, el('span', {}, 'すばやさ ', r.agi, '　運の良さ ', r.luck)),
    el('div', { class: 'row' }, el('span', {}, '経験値 ', r.exp), el('span', {}, '累計 ', r.total)),
    el('div', { class: 'row' }, el('span', {}, '所持金 ', r.gold, 'G')),
    el('div', { class: 'row' }, el('span', {}, '毎秒 経験値 ', r.rexp, '・ゴールド ', r.rgold)),
    el('div', { class: 'row enemy' }, r.enemy),
    r.boss,
  );
}

export function setScale(app, scale) {
  if (refs) refs.hud.classList.toggle('big', scale >= 4);
}

const pct = (v, max) => Math.max(0, Math.min(100, (v / max) * 100)) + '%';

export function update(app) {
  const s = app.state;
  const ctx = app.ctx;
  const r = refs;
  const hs = heroStats(s, ctx);
  const adv = s.adventure;
  r.date.textContent = formatDate(s.life.gameHours);
  r.floor.textContent = `${adv.floor}階層 ${adv.kills}/${ctx.balance.floor.monstersPerFloor}体`;
  r.name.textContent = s.hero.name;
  r.lv.textContent = s.hero.level;
  r.allies.textContent = s.allies.length ? `仲間 ${s.allies.length}` : '';
  r.hp.textContent = `${Math.ceil(s.hero.hp)}/${hs.maxHp}`;
  r.hpbar.style.width = pct(s.hero.hp, hs.maxHp);
  r.mp.textContent = `${Math.floor(s.hero.mp)}/${hs.maxMp}`;
  r.mpbar.style.width = pct(s.hero.mp, hs.maxMp);
  r.atk.textContent = hs.atk;
  r.def.textContent = hs.def;
  r.wis.textContent = hs.wis;
  r.agi.textContent = hs.agi;
  r.luck.textContent = hs.luck;
  r.exp.textContent = `${fmt(s.hero.exp)}/${fmt(expToNext(s.hero.level, ctx.balance))}`;
  r.total.textContent = fmt(s.hero.totalExp);
  r.gold.textContent = fmt(s.gold);
  const rates = trackRates(app.rate, ctx.balance.rateWindowSec);
  r.rexp.textContent = rates.exp.toFixed(1);
  r.rgold.textContent = rates.gold.toFixed(1);
  const enemies = adv.enemies;
  const front = enemies[0];
  r.enemy.textContent = front
    ? `敵：${front.name}　HP ${Math.ceil(front.hp)}/${front.maxHp}${enemies.length > 1 ? `（ほか${enemies.length - 1}体）` : ''}`
    : '…進んでいる';

  const boss = enemies.find((e) => e.kind === 'midboss');
  if (boss && isInvulnerable(s, boss)) {
    const mb = ctx.monsters.find((m) => m.id === boss.monsterId);
    const left = mb.unlockCorrect - midbossState(s, boss.monsterId).correct;
    r.boss.textContent = `勉強で${mb.unlockCorrect}問正解しよう（あと${left}問）　→ 勉強へ`;
    r.boss.hidden = false;
  } else {
    r.boss.hidden = true;
  }
}
