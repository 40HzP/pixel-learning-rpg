// ゲームの計算：パーティーと、仲間が集まる場所（契約・契約料）

import { HOURS_PER_MONTH } from './core.js';
import { industryById, staffCost, companiesProfit } from './company.js';

/** パーティーにいる仲間（控えに回した中ボスだった仲間と、顧問に置いた中ボスだった仲間は戦わず、冒険画面にも出ない） */
export const inParty = (ally) => !ally.benched && !ally.advisor;
export const partyAllies = (state) => state.allies.filter(inParty);
/** パーティーの上限（balance.ally.partyMax 人。契約した仲間も数える。戦うのも冒険画面に並ぶのもこの人数まで） */
export const partyMax = (ctx) => ctx.balance.ally.partyMax;
export const partyFull = (state, ctx) => partyAllies(state).length >= partyMax(ctx);

/**
 * 中ボスだった仲間をパーティーに入れる（on=true）・外して控えに回す（on=false）。いつでも何度でも変えられる。
 * パーティーがいっぱいのときは入れられない。契約した仲間は対象外（やめるときは解約する）
 */
export function setInParty(state, id, on, ctx) {
  const ally = state.allies.find((a) => a.id === id && !a.hired);
  if (!ally) return { ok: false, reason: '中ボスだった仲間ではありません' };
  if (!on) { delete ally.advisor; ally.benched = true; return { ok: true }; }
  if (!inParty(ally) && partyFull(state, ctx)) return { ok: false, reason: `パーティーは${partyMax(ctx)}人まで。だれかを外してから入れる` };
  delete ally.benched;
  delete ally.advisor;
  return { ok: true };
}

/** パーティーが上限を超えていたら、後ろの中ボスだった仲間から控えに回す（前のセーブを読んだとき）。控えに回した仲間の名前を返す */
export function fitParty(state, ctx) {
  let over = partyAllies(state).length - partyMax(ctx);
  const moved = [];
  for (let i = state.allies.length - 1; i >= 0 && over > 0; i--) {
    const a = state.allies[i];
    if (a.hired || !inParty(a)) continue;
    a.benched = true;
    moved.unshift(a.name);
    over--;
  }
  return moved;
}


export const recruitById = (ctx, id) => (ctx.recruits || []).find((r) => r.id === id) || null;
/** 社員（role: staff）は会社で働く専門職。会社ごとに雇う（hireStaff）。戦わず、パーティーにも入らない */
export const isStaff = (r) => !!r && r.role === 'staff';
export const genreLevel = (state, genre) => (state.knowledge.genres[genre] || { level: 0 }).level;

/** 契約できるようになっているか（unlock があれば、そのジャンルの熟練がそのLv以上） */
export const recruitUnlocked = (state, r) => !r.unlock || genreLevel(state, r.unlock.genre) >= r.unlock.level;

/** 戦う仲間の契約中の記録 */
export const contractOf = (state, id) => state.allies.find((a) => a.id === id && a.hired) || null;

/** 契約できる仲間の一覧（契約中か・次の支払いはいつか・契約できるようになっているか）。社員は含めない */
export function recruitList(state, ctx) {
  return (ctx.recruits || []).filter((r) => !isStaff(r)).map((r) => {
    const a = contractOf(state, r.id);
    return { ...r, hired: !!a, paidUntil: a ? a.paidUntil : null, unlocked: recruitUnlocked(state, r) };
  });
}

/** 契約中の仲間と、全部の会社の社員の、1か月あたりの契約料の合計 */
export function monthlyContractCost(state, ctx) {
  let sum = 0;
  for (const a of state.allies) if (a.hired) sum += (recruitById(ctx, a.id) || { monthlyCost: 0 }).monthlyCost;
  for (const c of state.companies) for (const st of c.staff) sum += staffCost(ctx, st.id, st.grade);
  return sum;
}

/** 1か月あたりの手取り＝1か月あたりに入るゴールド＋会社の利益−契約料の合計（マイナスにもなる） */
export const monthlyNetGold = (grossGold, state, ctx) => grossGold + companiesProfit(state, ctx).total - monthlyContractCost(state, ctx);

/** 契約する（戦う仲間）。最初の1か月分をその場で払い、以後はゲーム内の1か月ごとに払う */
export function hireRecruit(state, id, ctx) {
  const r = recruitById(ctx, id);
  if (!r || isStaff(r)) return { ok: false, reason: 'いない仲間です' };
  if (contractOf(state, id) || state.allies.some((a) => a.id === id)) return { ok: false, reason: 'もう契約しています' };
  if (!recruitUnlocked(state, r)) return { ok: false, reason: `${r.unlock.genre}の熟練が Lv${r.unlock.level} になると契約できる` };
  if (partyFull(state, ctx)) return { ok: false, reason: `パーティーがいっぱい（${partyMax(ctx)}人まで）。中ボスだった仲間を外すと契約できる` };
  if (state.gold < r.monthlyCost) return { ok: false, reason: 'ゴールドが足りません' };
  state.gold -= r.monthlyCost;
  state.allies.push({ id: r.id, name: r.name, hired: true, cd: r.intervalSec, paidUntil: state.life.gameHours + HOURS_PER_MONTH });
  return { ok: true };
}

/** 解約する（払った分は戻らない） */
export function dismissRecruit(state, id) {
  const i = state.allies.findIndex((a) => a.id === id && a.hired);
  if (i < 0) return { ok: false, reason: '契約していません' };
  state.allies.splice(i, 1);
  return { ok: true };
}

/** 支払日が来た契約の契約料を払う。払えなければ契約が切れて仲間（社員）が去る */
export function payContracts(state, ctx, events) {
  const due = []; // [契約料, 払えなかったら外す処理, 記録, 名前]
  for (const a of state.allies) {
    if (!a.hired) continue;
    const r = recruitById(ctx, a.id);
    due.push({ rec: a, cost: r ? r.monthlyCost : null, remove: () => state.allies.splice(state.allies.indexOf(a), 1), name: a.name, id: a.id });
  }
  for (const c of state.companies) {
    const ind = industryById(ctx, c.industry);
    for (const st of c.staff) {
      const r = recruitById(ctx, st.id);
      due.push({ rec: st, cost: r ? staffCost(ctx, st.id, st.grade) : null, remove: () => c.staff.splice(c.staff.indexOf(st), 1), name: `${r ? r.name : st.id}（${ind ? ind.name : ''}）`, id: st.id });
    }
  }
  for (const d of due) {
    if (d.cost == null) { d.remove(); continue; }
    while (state.life.gameHours >= d.rec.paidUntil) {
      if (state.gold < d.cost) {
        d.remove();
        if (events) events.push({ type: 'contractEnded', id: d.id, name: d.name });
        break;
      }
      state.gold -= d.cost;
      d.rec.paidUntil += HOURS_PER_MONTH;
      if (events) events.push({ type: 'contractPaid', id: d.id, cost: d.cost });
    }
  }
}
