// ゲームの計算：月面のボスの手下と仕掛け（つるつる・満ち潮・新聞・水しぶき・塵・分裂）と、宇宙からの電波（月面の電波望遠鏡）

import { fieldActive } from '../fields.js';
import { onMoon } from './world.js';
import { partyAllies, partyMax } from './allies.js';

/* ---------- 月面のボスの手下と仕掛け（設計ページ「小ボス：月面（月の研究史をたどる）」） ---------- */

export const MINION_SLOT = 20; // 手下の slot（20, 21…。描く場所は render.js の MINION_SLOTS）
export const PART_SLOT = 30;   // 分かれたボスの slot（30＝地球、31＝月）

/** 今の群れに、その仕掛け（monsters.json の gimmick）を持つ敵がいるか */
export const gimmickIn = (state, gimmick) => state.adventure.enemies.some((e) => e.gimmick === gimmick);

/** ツキジンセツ（gimmick: newspaper）が新聞のビラをまいて、問題文の一部を隠しているか */
export const newspaperActive = (state) => gimmickIn(state, 'newspaper');

/** ボスが呼ぶ手下（monsters.json の minions）。図鑑で正体を開いている（stage 2）手下は呼べない */
export function bossMinions(state, ctx, boss) {
  return (boss.minions || []).map((id) => ctx.monsters.find((m) => m.id === id))
    .filter((m) => m && ((state.knowledge.zukan[m.id] || {}).stage || 0) < 2);
}

/** カンペキキュウ（smooth）：表面がつるつるで攻撃が滑る。正解で描き足された山と影（marks）が増えるほど効くようになる */
export const smoothDamage = (e, ctx) => {
  const r = ctx.balance.moon.smoothDamage;
  return r[Math.min(e.marks || 0, r.length - 1)];
};

/** 勉強で正解した：つるつるの月（smooth）に山と影を1つ描き足す（quiz.js が正解のたびに呼ぶ） */
export function markSmooth(state, ctx, events) {
  const max = ctx.balance.moon.smoothDamage.length - 1;
  for (const e of state.adventure.enemies) {
    if (e.gimmick !== 'smooth' || (e.marks || 0) >= max) continue;
    e.marks = (e.marks || 0) + 1;
    events.push({ type: 'smoothMarked', uid: e.uid, monsterId: e.monsterId, name: e.name, marks: e.marks, max });
  }
}

/**
 * 裏側の電波望遠鏡（月面の街）：月面にいる間、勉強で正解するたびに「宇宙からの電波」が1つたまる。
 * balance.moon.radioCharge たまると、図鑑の「月の裏側から聞こえた宇宙」の頁が1つ開く（ctx.radio.pages の順。town.json の moon.radio）。
 * 全部開いたら、もうためない。知識なので生まれ変わっても残る（knowledge.radio）
 */
export function hearRadio(state, ctx, events) {
  const pages = (ctx.radio && ctx.radio.pages) || [];
  const r = state.knowledge.radio;
  if (!onMoon(state) || r.pages >= pages.length) return;
  r.charge++;
  if (r.charge < ctx.balance.moon.radioCharge) return;
  r.charge = 0;
  r.pages++;
  events.push({ type: 'radioPage', index: r.pages - 1, name: pages[r.pages - 1].name, opened: r.pages, total: pages.length });
}

/** 電波望遠鏡のゲージ（画面に出す）：たまった数・いっぱいの数・開いた頁の数・頁の数 */
export function radioInfo(state, ctx) {
  const pages = (ctx.radio && ctx.radio.pages) || [];
  const r = state.knowledge.radio;
  return { charge: r.charge, need: ctx.balance.moon.radioCharge, opened: Math.min(r.pages, pages.length), total: pages.length, done: r.pages >= pages.length };
}

/**
 * ガリレオチョウセキ（tide）：満ち潮の盾で、群れの先頭への1体攻撃（主人公のふつうの攻撃と、先頭を叩く仲間）を弾く。
 * 全体攻撃（ひらめき・敵全体を叩く仲間）は弾けない（満潮は反対側でも起きる）
 */
export const deflects = (state, e, by, extra) =>
  (by === 'hero' || (by === 'ally' && !extra.area)) && e === state.adventure.enemies[0] && gimmickIn(state, 'tide');

/**
 * チリノウミセツ（dust）：moon.sinkIntervalSec 秒ごとに、パーティーの仲間を1人ずつ塵に沈めて動けなくする。
 * 航空宇宙工学（機体設計の学際分野）を専攻にしていれば沈まない。ボスがいなくなると仲間は出てくる
 */
export function sinkAllies(state, dt, ctx, events) {
  const boss = state.adventure.enemies.find((e) => e.gimmick === 'dust');
  if (!boss || fieldActive(state, ctx, 'aerospace')) { freeSunkAllies(state, events); return; }
  const every = ctx.balance.moon.sinkIntervalSec;
  boss.sinkCd = (boss.sinkCd ?? every) - dt;
  if (boss.sinkCd > 0) return;
  boss.sinkCd += every;
  const ally = partyAllies(state).slice(0, partyMax(ctx)).find((a) => !a.sunk);
  if (!ally) return;
  ally.sunk = true;
  events.push({ type: 'allySunk', id: ally.id, name: ally.name, by: boss.name });
}

export function freeSunkAllies(state, events) {
  const sunk = state.allies.filter((a) => a.sunk);
  if (!sunk.length) return;
  for (const a of sunk) delete a.sunk;
  events.push({ type: 'alliesFreed', names: sunk.map((a) => a.name) });
}

/** ブンレツセツ（split）：HPが moon.splitAt を下回ると、地球と月の2体に分かれる（HPは半分ずつ） */
export function splitBoss(state, e, ctx, events) {
  const adv = state.adventure;
  const half = (part, slot) => ({ ...e, uid: adv.nextUid++, part, slot, maxHp: Math.ceil(e.maxHp / 2), hp: Math.max(1, Math.ceil(e.hp / 2)), wholeMaxHp: e.maxHp });
  const parts = [half('earth', PART_SLOT), half('moon', PART_SLOT + 1)];
  parts[1].cd = e.cd + ctx.balance.monster.attackIntervalSec / 2; // 交互に攻撃する
  adv.enemies.splice(adv.enemies.indexOf(e), 1, ...parts);
  events.push({ type: 'split', monsterId: e.monsterId, name: e.name, uids: parts.map((x) => x.uid) });
}

/**
 * 分かれた片方を倒した。もう片方が残っていれば、moon.absorbSec 秒たつと吸収して元の1体に戻る（true を返す）。
 * その間にもう片方も倒せばボスを倒したことになる（false＝両方倒れた）
 */
export function partDown(state, e, ctx, events) {
  const adv = state.adventure;
  const other = adv.enemies.find((x) => x.part && x !== e && x.monsterId === e.monsterId);
  if (!other) return false;
  adv.enemies = adv.enemies.filter((x) => x !== e);
  if (other.absorbCd == null) other.absorbCd = ctx.balance.moon.absorbSec;
  events.push({ type: 'partDown', uid: e.uid, slot: e.slot, monsterId: e.monsterId, part: e.part, name: e.name });
  return true;
}

/** 残った片方が、倒れた片方を吸収して元の1体に戻る（HPは残った片方の2倍。また半分を下回ると分かれる） */
export function absorbParts(state, dt, ctx, events) {
  for (const e of state.adventure.enemies) {
    if (!e.part || e.absorbCd == null) continue;
    e.absorbCd -= dt;
    if (e.absorbCd > 0) continue;
    Object.assign(e, { maxHp: e.wholeMaxHp, hp: Math.min(e.wholeMaxHp, e.hp * 2), slot: 0 });
    delete e.part; delete e.absorbCd; delete e.wholeMaxHp;
    events.push({ type: 'merged', uid: e.uid, monsterId: e.monsterId, name: e.name });
  }
}
