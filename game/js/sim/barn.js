// ゲームの計算：飼育小屋と試作機（なつく・懐き度・誕生日の贈り物・見送り・試作機）

import { fieldActive } from '../fields.js';
import { HOURS_PER_YEAR } from './core.js';
import { ageYears } from './time.js';
import { itemById } from './stats.js';
import { generationMultiplier } from './life.js';
import { worldOf, onMoon, floorStats } from './world.js';
import { rocketSteps, launchRateVisible, launchSuccessRate } from './rocket.js';
import { isMoonItem, itemPower } from './shop.js';

/** 飼育小屋の場所：地球のザコは飼育小屋（earth）、月面のザコは月面の飼育ドーム（moon） */
export const BARN_NAMES = { earth: '飼育小屋', moon: '月面の飼育ドーム' };

export const monsterById = (ctx, id) => ctx.monsters.find((m) => m.id === id) || null;

/** 飼育小屋（world を渡すとその世界の小屋だけ）のザコ：{ id, monster, space, flights } のなついた順 */
export function barnAnimals(state, ctx, world = null) {
  return (state.legacy.barn || [])
    .map((a) => ({ ...a, monster: monsterById(ctx, a.id) }))
    .filter((a) => a.monster && (!world || worldOf(a.monster) === world));
}

/** 小屋に入れるザコの数（その世界のザコの全数） */
export const barnCapacity = (ctx, world) => ctx.monsters.filter((m) => m.kind === 'monster' && worldOf(m) === world).length;

/**
 * ザコを飼育小屋に入れる（force でなければ balance.barn.joinChance の確率で）。同じザコは1体まで。
 * ボス・中ボスは入らない（中ボスは今までどおり戦いの仲間になる）。入ったら true
 */
export function tameZako(state, ctx, monsterId, events, force = false) {
  const m = monsterById(ctx, monsterId);
  if (!m || m.kind !== 'monster') return false;
  if (state.legacy.barn.some((a) => a.id === monsterId)) return false;
  if (!force && !(ctx.rng() < joinChance(state, ctx))) return false;
  state.legacy.barn.push({ id: monsterId, affinity: 0 });
  const world = worldOf(m);
  if (events) events.push({ type: 'barnJoin', monsterId, name: m.name, world, barn: BARN_NAMES[world] });
  return true;
}

/* ---------- 動物行動学（学際分野。設計ページ「動物行動学」） ---------- */
// 専攻にしていて休眠していない間だけ、ザコがなつく確率が上がり（balance.barn.ethologyJoinChance）、
// 小屋のザコの懐き度の上がり方が balance.barn.ethologyAffinityRate 倍になる（誕生日・正解・触る・試作機のどれも）
export const ETHOLOGY = 'ethology';
/** ザコを倒したときになついて小屋に入る確率 */
export const joinChance = (state, ctx) => (fieldActive(state, ctx, ETHOLOGY) ? ctx.balance.barn.ethologyJoinChance : ctx.balance.barn.joinChance);
/** 懐き度の上がり方の倍率 */
export const affinityRate = (state, ctx) => (fieldActive(state, ctx, ETHOLOGY) ? ctx.balance.barn.ethologyAffinityRate : 1);

/* ---------- 懐き度（設計ページ「懐き度（2026-11-08）」） ---------- */
// 飼育小屋のザコの懐き度（0〜balance.barn.affinityMax）。上がるだけで下がらない（放っておくと減る作りにすると、世話の義務になるため）。
// 上がるとき：誕生日ごと（起動している間に少しずつ）・そのザコの問題に正解する・小屋で触る（1日に1回）・試作機から帰ってくる。
// 懐いた（friendlyAffinity 以上）ザコは、誕生日に贈り物を持ってきて、自分の問題で誤答を1つ消してくれる。最大になると更生する

/** 飼育小屋のそのザコ（いなければ null） */
export const barnEntry = (state, id) => (state.legacy.barn || []).find((a) => a.id === id) || null;
/** 懐き度（小屋にいなければ 0） */
export const affinityOf = (state, id) => { const a = barnEntry(state, id); return a ? a.affinity || 0 : 0; };
/** 懐いた（懐き度が balance.barn.friendlyAffinity 以上）：誕生日の贈り物と勉強の手伝い */
export const isFriendly = (state, ctx, id) => !!barnEntry(state, id) && affinityOf(state, id) >= ctx.balance.barn.friendlyAffinity;
/** 更生した（懐き度が最大）：誤解ではなく本当のことを話すようになり、姿に印（光の輪）が付く */
export const isReformed = (state, ctx, id) => !!barnEntry(state, id) && affinityOf(state, id) >= ctx.balance.barn.affinityMax;

/**
 * 懐き度を上げる（最大まで）。懐いたとき（friendlyAffinity を越えた）と更生したとき（最大に届いた）は知らせ（barnFriendly・barnReformed）。上がった量を返す。
 * 動物行動学を専攻にしていると amount の affinityRate 倍（1.5倍なので、上がる量に0.5の端数が出る）
 */
export function raiseAffinity(state, ctx, id, amount, events) {
  const a = barnEntry(state, id);
  if (!a || !(amount > 0)) return 0;
  amount *= affinityRate(state, ctx);
  const { affinityMax: max, friendlyAffinity: friendly } = ctx.balance.barn;
  const before = a.affinity || 0;
  if (before >= max) return 0;
  a.affinity = Math.min(max, before + amount);
  const m = monsterById(ctx, id) || {};
  const where = BARN_NAMES[worldOf(m)];
  if (events && before < friendly && a.affinity >= friendly && a.affinity < max) events.push({ type: 'barnFriendly', monsterId: id, name: m.name, barn: where });
  if (events && a.affinity >= max) events.push({ type: 'barnReformed', monsterId: id, name: m.name, truth: m.truth, barn: where });
  return a.affinity - before;
}

/**
 * 小屋でザコを触る（なでる）。そのザコは1日に1回だけ懐き度が balance.barn.affinityPerTouch 上がる。day は現実の日付 'YYYY-MM-DD'
 * （ゲームの計算は時計に触らないので、画面から渡す）。{ ok, gained, already（今日はもう触った） }
 */
export function touchZako(state, ctx, id, day, events) {
  const a = barnEntry(state, id);
  if (!a) return { ok: false, gained: 0, already: false };
  if (a.touchedOn === day) return { ok: true, gained: 0, already: true };
  a.touchedOn = day;
  return { ok: true, gained: raiseAffinity(state, ctx, id, ctx.balance.barn.affinityPerTouch, events), already: false };
}

/**
 * 誕生日の懐き度と贈り物：小屋のザコ全員の懐き度が affinityPerYear 上がり、懐いたザコの中から1体が小さな贈り物を持ってくる。
 * 贈り物：今の階層のザコ giftGoldKills 体分のゴールド（世代の倍率も掛ける）。そのゴールドで買える値段の品物のうち、
 * 入荷していて、持っていなくて、今の装備より強いものがあれば、いちばん安いその品（買ったときと同じく、強ければ付け替える）
 */
export function barnBirthday(state, ctx, events) {
  const b = ctx.balance.barn;
  for (const a of state.legacy.barn || []) raiseAffinity(state, ctx, a.id, b.affinityPerYear, events);
  const friends = (state.legacy.barn || []).filter((a) => (a.affinity || 0) >= b.friendlyAffinity && monsterById(ctx, a.id));
  if (!friends.length) return null;
  const a = friends[Math.floor(ctx.rng() * friends.length)];
  const m = monsterById(ctx, a.id);
  const gold = Math.max(1, Math.round(floorStats(state, ctx).gold * generationMultiplier(state, ctx.balance) * b.giftGoldKills));
  const item = (ctx.items || [])
    .filter((it) => !isMoonItem(it) && !state.owned.includes(it.id) && state.knowledge.totalCorrect >= it.unlockCorrect && it.price <= gold
      && itemPower(it) > itemPower(itemById(ctx.items, state.equipment[it.slot])))
    .sort((x, y) => x.price - y.price)[0] || null;
  const gift = { type: 'barnGift', monsterId: a.id, name: m.name, age: ageYears(state) };
  if (item) {
    state.owned.push(item.id);
    state.equipment[item.slot] = item.id;
    Object.assign(gift, { itemId: item.id, itemName: item.name });
  } else {
    state.gold += gold;
    gift.gold = gold;
  }
  events.push(gift);
  return gift;
}

/** 誕生日に見送ってくれる（生まれ変わりの場面）：懐いたザコを懐き度の高い順に balance.barn.seeOffMax 体まで */
export function seeOffFriends(state, ctx) {
  const b = ctx.balance.barn;
  return (state.legacy.barn || [])
    .filter((a) => (a.affinity || 0) >= b.friendlyAffinity && monsterById(ctx, a.id))
    .sort((x, y) => (y.affinity || 0) - (x.affinity || 0))
    .slice(0, b.seeOffMax)
    .map((a) => ({ id: a.id, name: monsterById(ctx, a.id).name, affinity: a.affinity || 0 }));
}

/** 犬のザコ（monsters.json の space.kind が dog。イヌハモノクロと、犬の仲間の月面のツキボエ）：試作機で必ず生きて帰ってくる */
export const isSpaceDog = (m) => !!(m && m.space && m.space.kind === 'dog');

/**
 * 試作機に乗せたら、成功したときに何が起きるか：
 * - 犬：本番の打ち上げの成功率が balance.rocket.prototype.dogBonus 上がる
 * - 実際に宇宙を飛んだ生き物（space.step）：その工程が prototype.stepYears 年分進む（その工程がもう終わっていれば、ほかのザコと同じ）
 * - ほかのザコ：成功率が prototype.otherBonus 上がる
 * 同じザコの効果は1回まで（legacy.rocket.flown）。成功率が上限なら効果は無い（使ったことにしない）。
 * { kind: 'rate'|'step'|'none', amount?, step?, stepName?, hours?, used?（もう効果が出た）, capped?（成功率が上限） }
 */
export function prototypeEffect(state, ctx, monsterId) {
  const m = monsterById(ctx, monsterId);
  const pr = ctx.balance.rocket.prototype;
  if (!m) return { kind: 'none' };
  if ((state.legacy.rocket.flown || []).includes(monsterId)) return { kind: 'none', used: true };
  const sp = m.space || {};
  if (sp.step && !isSpaceDog(m)) {
    const st = rocketSteps(state, ctx).find((x) => x.id === sp.step);
    if (st && !st.done) return { kind: 'step', step: st.id, stepName: st.name, hours: Math.min(st.need - st.hours, pr.stepYears * HOURS_PER_YEAR) };
  }
  const room = ctx.balance.rocket.launchSuccessRateMax - launchSuccessRate(state, ctx);
  if (room <= 1e-9) return { kind: 'none', capped: true };
  return { kind: 'rate', amount: Math.min(room, isSpaceDog(m) ? pr.dogBonus : pr.otherBonus) };
}

/**
 * 試作機を飛ばせるか：ロケット計画の「機体設計」の工程が終わっていて、地球にいる（地球のロケット発射場から飛ばす）。
 * { ok, reason, cost, successRate, rateVisible }（成功率が見えるのは確率論を専攻にしているときだけ。本番と同じ）
 */
export function prototypeInfo(state, ctx) {
  const pr = ctx.balance.rocket.prototype;
  const frame = rocketSteps(state, ctx).find((st) => st.id === 'airframe');
  let reason = null;
  if (onMoon(state)) reason = '地球のロケット発射場から飛ばす';
  else if (!frame || !frame.done) reason = `「${frame ? frame.name : '機体設計'}」の工程が終わると飛ばせる`;
  return { ok: !reason, reason, cost: pr.cost, successRate: pr.successRate, rateVisible: launchRateVisible(state, ctx) };
}

/**
 * 飼育小屋のザコを試作機に乗せて飛ばす（balance.rocket.prototype.cost のゴールドを払う）。
 * 成功（prototype.successRate）すると「宇宙帰り」の印が付き、prototypeEffect の効果が出る。
 * 失敗すると、犬は必ず生きて帰ってくる（小屋に残る）。ほかのザコは懐き度%の確率で帰ってくる（設計ページ「懐き度」の①）。
 * 帰ってこなければ小屋からいなくなり、野に戻る（また仲間にできる。そのときの懐き度は0から）。
 * 帰ってきたら（成功・失敗とも）懐き度が balance.barn.affinityPerFlight 上がる。
 * { ok, reason?, success, dog, left（野に戻った）, cameBack（失敗したが懐いていて帰ってきた）, effect, stepDone?, name, history, affinity（上がった量） }
 */
export function flyPrototype(state, ctx, monsterId, events = []) {
  const info = prototypeInfo(state, ctx);
  if (!info.ok) return { ok: false, reason: info.reason };
  const a = state.legacy.barn.find((x) => x.id === monsterId);
  const m = monsterById(ctx, monsterId);
  if (!a || !m) return { ok: false, reason: '飼育小屋にいない' };
  if (state.gold < info.cost) return { ok: false, reason: 'ゴールドが足りません' };
  state.gold -= info.cost;
  const effect = prototypeEffect(state, ctx, monsterId);
  const dog = isSpaceDog(m);
  const res = { ok: true, success: ctx.rng() < info.successRate, dog, left: false, effect, name: m.name, history: (m.space && m.space.history) || null };
  if (res.success) {
    a.space = true;
    a.flights = (a.flights || 0) + 1;
    const r = state.legacy.rocket;
    if (effect.kind === 'rate') r.rateBonus = (r.rateBonus || 0) + effect.amount;
    if (effect.kind === 'step') {
      const need = ctx.balance.rocket.stepYears * HOURS_PER_YEAR;
      r.steps[effect.step] = Math.min(need, (r.steps[effect.step] || 0) + effect.hours);
      res.stepDone = r.steps[effect.step] >= need;
    }
    if (effect.kind !== 'none') r.flown = [...(r.flown || []), monsterId];
  } else if (!dog) {
    if (ctx.rng() < (a.affinity || 0) / 100) res.cameBack = true;
    else {
      state.legacy.barn = state.legacy.barn.filter((x) => x !== a);
      res.left = true;
    }
  }
  res.affinity = res.left ? 0 : raiseAffinity(state, ctx, monsterId, ctx.balance.barn.affinityPerFlight, events);
  return res;
}
