// ゲームの計算：店（品物の値段・輸送費・買う・装備する）

import { fieldActive } from '../fields.js';
import { itemById, ITEM_STATS } from './stats.js';
import { onMoon } from './world.js';

/** 月面の補給所でだけ売っている品（items.json の moon: true）。割合で効く（effects）。買えば地球にも持ち帰れる */
export const isMoonItem = (item) => !!(item && item.moon);

/**
 * 月面の補給所の輸送費：品物の重さ（items.json の weight、kg）× balance.moon.transportPerKg。
 * 地球の店では0。行動経済学の値引きは効かない（重さは値切れない）。氷の採掘場で下がる（作る順の②。今は下がらない）
 */
export function transportCost(state, item, ctx) {
  if (!onMoon(state)) return 0;
  return Math.round((item.weight || 0) * ctx.balance.moon.transportPerKg);
}

/** 品物の本体の値段。行動経済学を専攻にしていると値引き交渉ができる（balance.fields.shopDiscount 引き） */
export function itemBodyPrice(state, item, ctx) {
  const off = fieldActive(state, ctx, 'behavioral_economics') ? ctx.balance.fields.shopDiscount : 0;
  return Math.max(1, Math.round(item.price * (1 - off)));
}

/** 品物の値段（払う額）＝ 本体（値引き後）＋ 輸送費（月面の補給所だけ） */
export const itemPrice = (state, item, ctx) => itemBodyPrice(state, item, ctx) + transportCost(state, item, ctx);

/**
 * 店の品揃え。price は払う額、body は本体の値段（値引き後）、listPrice は本体の元の値段、transport は輸送費。
 * 月面だけの品は、月面の補給所に並ぶ（地球の店には、持っているものだけ「装備する」ために並ぶ）
 */
export function shopList(state, ctx) {
  return ctx.items.filter((it) => !isMoonItem(it) || onMoon(state) || state.owned.includes(it.id)).map((it) => ({
    ...it,
    price: itemPrice(state, it, ctx),
    body: itemBodyPrice(state, it, ctx),
    listPrice: it.price,
    transport: transportCost(state, it, ctx),
    unlocked: state.knowledge.totalCorrect >= it.unlockCorrect,
    owned: state.owned.includes(it.id),
    equipped: state.equipment[it.slot] === it.id,
  }));
}

/**
 * 品物の強さ：足すステータスの合計（武器は攻撃、防具は防御だけなので、そのまま）。
 * 割合で効く月面だけの品は、地球の品より強いとみなす（月面のレベルでは固定の数値より割合のほうが効くため）
 */
export const itemPower = (item) => (item ? ITEM_STATS.reduce((n, k) => n + (item[k] || 0), 0) + (item.effects ? 1e9 : 0) : -Infinity);

/** 買う。同じ枠の今の装備より強ければ（足すステータスの合計が大きければ）自動で装備する */
export function buyItem(state, itemId, ctx) {
  const it = itemById(ctx.items, itemId);
  if (!it) return { ok: false, reason: 'ない品物です' };
  if (state.owned.includes(it.id)) return { ok: false, reason: 'もう持っています' };
  if (isMoonItem(it) && !onMoon(state)) return { ok: false, reason: '月面の補給所でだけ買える' };
  if (state.knowledge.totalCorrect < it.unlockCorrect) return { ok: false, reason: 'まだ入荷していません' };
  const price = itemPrice(state, it, ctx);
  if (state.gold < price) return { ok: false, reason: 'ゴールドが足りません' };
  state.gold -= price;
  state.owned.push(it.id);
  const current = itemById(ctx.items, state.equipment[it.slot]);
  const equipped = itemPower(it) > itemPower(current);
  if (equipped) state.equipment[it.slot] = it.id;
  return { ok: true, equipped };
}

/** 持っている品物に付け替える（装飾品の選び直しや、弱い装備に戻すとき） */
export function equipItem(state, itemId, ctx) {
  const it = itemById(ctx.items, itemId);
  if (!it || !state.owned.includes(it.id)) return { ok: false, reason: '持っていない品物です' };
  if (state.equipment[it.slot] === it.id) return { ok: false, reason: 'もう装備しています' };
  state.equipment[it.slot] = it.id;
  return { ok: true };
}
