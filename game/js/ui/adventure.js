// 冒険画面の表示項目（設計ページ「自動冒険画面に必ず表示する項目」）。空の部分（y=0〜97）に重ねる
import {
  heroStats, partyAllies, companiesProfit, expToNext, formatDate, monthlyRates, monthlyContractCost, monthlyNetGold, isInvulnerable, midbossLeft, pendingBoss, expMultiplier,
  challengeableMidboss, challengeMidboss, retreatMidboss, onMoon,
} from '../sim.js';
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
    exp: span(), total: span(), gold: span(), xmul: span(), rexp: span(), rgold: span(), fee: span(), net: span(), enemy: span(),
    company: span(),
    boss: el('div', { class: 'boss', onclick: () => app.showTab('study') }),
    // 中ボスは自動では出ない。挑戦できる年齢になったらこのボタンを出す
    challengeName: span(), challengeNote: el('small'),
  };
  refs.challenge = el('button', {
    class: 'challenge', hidden: true,
    onclick: () => {
      const ev = [];
      if (challengeMidboss(app.state, app.ctx, ev)) { app.handleEvents(ev); app.save(); update(app); }
    },
  }, refs.challengeName, refs.challengeNote);
  // 中ボス戦の途中で逃げる（報酬なし。また挑戦できる）
  refs.retreat = el('button', {
    class: 'retreat', hidden: true,
    onclick: () => {
      const ev = [];
      if (retreatMidboss(app.state, app.ctx, ev)) { app.handleEvents(ev); app.save(); update(app); }
    },
  }, '逃げる');
  refs.bossBar = el('div', { class: 'bossbar', hidden: true }, refs.boss, refs.retreat);
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
    el('div', { class: 'row' }, el('span', {}, '所持金 ', r.gold, 'G'), el('span', {}, '経験値 ×', r.xmul)),
    el('div', { class: 'row' }, el('span', {}, '1か月あたり 経験値 ', r.rexp, '・', r.rgold, 'G')),
    r.companyRow = el('div', { class: 'row', hidden: true }, r.company),
    el('div', { class: 'row' }, el('span', {}, '契約料 ', r.fee, 'G'), el('span', {}, '手取り ', r.net, 'G')),
    el('div', { class: 'row enemy' }, r.enemy),
    r.bossBar,
    r.challenge,
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
  // ボスのいる階層は、ボスを倒すと次の階層へ進む
  const bossFloor = adv.enemies.some((e) => e.kind === 'boss') || pendingBoss(s, ctx);
  const where = `${onMoon(s) ? '月面' : ''}${adv.floor}階層`;
  r.floor.textContent = bossFloor ? `${where} ボス` : `${where} ${adv.kills}/${ctx.balance.floor.monstersPerFloor}体`;
  r.name.textContent = s.life.generation > 1 ? `${s.hero.name}（${s.life.generation}世代目）` : s.hero.name;
  r.lv.textContent = s.hero.level;
  const party = partyAllies(s).length, bench = s.allies.length - party;
  r.allies.textContent = s.allies.length ? `仲間 ${party}${bench ? `（控え${bench}）` : ''}` : '';
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
  r.xmul.textContent = expMultiplier(s, ctx.balance).toFixed(2);
  // ゲーム内1か月あたりの獲得量（契約料を引く前）
  const rates = monthlyRates(app.rate, ctx.balance);
  r.rexp.textContent = fmt(Math.round(rates.exp));
  r.rgold.textContent = fmt(Math.round(rates.gold));
  // 手取り＝入るゴールド−仲間の契約料（足りないときは赤）
  const fee = monthlyContractCost(s, ctx);
  const net = Math.round(monthlyNetGold(rates.gold, s, ctx));
  r.fee.textContent = fee ? `−${fmt(fee)}` : '0';
  // 会社の利益（起業していれば。手取りに入る）
  const cp = companiesProfit(s, ctx);
  r.companyRow.hidden = !cp.companies.length;
  if (cp.companies.length) {
    const who = cp.companies.length === 1 ? cp.companies[0].industry.name : `${cp.companies.length}社`;
    r.company.textContent = `会社（${who}）の利益 1か月 +${fmt(cp.total)}G`;
  }
  r.net.textContent = `${net < 0 ? '−' : ''}${fmt(Math.abs(net))}`;
  r.net.parentNode.classList.toggle('bad', net < 0);
  const enemies = adv.enemies;
  const front = enemies[0];
  r.enemy.textContent = front
    ? `${front.kind === 'boss' ? 'ボス' : '敵'}：${front.name}　HP ${Math.ceil(front.hp)}/${front.maxHp}${enemies.length > 1 ? `（ほか${enemies.length - 1}体）` : ''}`
    : '…進んでいる';

  const boss = enemies.find((e) => e.kind === 'midboss');
  r.bossBar.hidden = !boss;
  r.retreat.hidden = !boss;
  if (boss && isInvulnerable(s, boss)) {
    const mb = ctx.monsters.find((m) => m.id === boss.monsterId);
    r.boss.textContent = `勉強で累計${mb.unlockCorrect}問正解しよう（あと${midbossLeft(s, mb)}問）　→ 勉強へ`;
    r.boss.hidden = false;
  } else {
    r.boss.hidden = true;
  }

  const cm = challengeableMidboss(s, ctx);
  r.challenge.hidden = !cm;
  if (cm) {
    const left = midbossLeft(s, cm);
    r.challengeName.textContent = `${cm.name}に挑戦する`;
    r.challengeNote.textContent = left
      ? `勉強であと${left}問正解すると攻撃が効く`
      : 'これまでの勉強で、もう攻撃が効く';
  }
}
