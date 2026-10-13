// 冒険画面の表示項目（設計ページ「自動冒険画面に必ず表示する項目」）。空の部分（y=0〜97）に重ねる
import { heroStats, expToNext, formatDate, trackRates, isInvulnerable, midbossState } from '../sim.js';
import { el, fmt } from './dom.js';

let refs = null;

export function init(app) {
  const hud = document.getElementById('hud');
  const span = () => el('span');
  refs = {
    hud,
    date: span(), floor: span(), lv: span(), hp: span(), hpbar: el('i'), atk: span(), def: span(),
    exp: span(), total: span(), gold: span(), rexp: span(), rgold: span(), enemy: span(), allies: span(),
    boss: el('div', { class: 'boss', onclick: () => app.showTab('study') }),
  };
  const r = refs;
  hud.append(
    el('div', { class: 'row' }, r.date, r.floor),
    el('div', { class: 'row' }, el('span', {}, 'Lv ', r.lv), el('span', {}, 'HP ', r.hp)),
    el('div', { class: 'hpbar' }, r.hpbar),
    el('div', { class: 'row' }, el('span', {}, '攻撃 ', r.atk, '　防御 ', r.def), r.allies),
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

export function update(app) {
  const s = app.state;
  const ctx = app.ctx;
  const r = refs;
  const hs = heroStats(s, ctx);
  const adv = s.adventure;
  r.date.textContent = formatDate(s.life.gameHours);
  r.floor.textContent = `${adv.floor}階層 ${adv.kills}/${ctx.balance.floor.monstersPerFloor}体`;
  r.lv.textContent = s.hero.level;
  r.hp.textContent = `${Math.ceil(s.hero.hp)}/${hs.maxHp}`;
  r.hpbar.style.width = Math.max(0, Math.min(100, (s.hero.hp / hs.maxHp) * 100)) + '%';
  r.atk.textContent = hs.atk;
  r.def.textContent = hs.def;
  r.allies.textContent = s.allies.length ? `仲間 ${s.allies.length}` : '';
  r.exp.textContent = `${fmt(s.hero.exp)}/${fmt(expToNext(s.hero.level, ctx.balance))}`;
  r.total.textContent = fmt(s.hero.totalExp);
  r.gold.textContent = fmt(s.gold);
  const rates = trackRates(app.rate, ctx.balance.rateWindowSec);
  r.rexp.textContent = rates.exp.toFixed(1);
  r.rgold.textContent = rates.gold.toFixed(1);
  const e = adv.enemy;
  r.enemy.textContent = e ? `敵：${e.name}　HP ${Math.ceil(e.hp)}/${e.maxHp}` : '…進んでいる';

  const boss = e && e.kind === 'midboss' ? e : null;
  if (boss && isInvulnerable(s, boss)) {
    const mb = ctx.monsters.find((m) => m.id === boss.monsterId);
    const left = mb.unlockCorrect - midbossState(s, boss.monsterId).correct;
    r.boss.textContent = `勉強で${mb.unlockCorrect}問正解しよう（あと${left}問）　→ 勉強へ`;
    r.boss.hidden = false;
  } else {
    r.boss.hidden = true;
  }
}
