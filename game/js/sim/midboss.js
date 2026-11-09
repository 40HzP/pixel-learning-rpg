// ゲームの計算：中ボスとボスの出番（挑戦・逃げる・知らせ）と、孫の「なんで？」

import { ageYears } from './time.js';
import { midbossState, bossState } from './knowledge.js';
import { worldOf } from './world.js';
import { spawnGroup, spawnDelay, damageEnemy, healEnemy, healAll } from './battle.js';
import { stashScaffold } from './floors.js';

/** 年齢を満たした未撃破の中ボス（いなければ null） */
export function pendingMidboss(state, ctx) {
  const age = ageYears(state);
  for (const m of ctx.monsters) {
    if (m.kind !== 'midboss') continue;
    if (midbossState(state, m.id).status !== 'defeated' && age >= m.appearAge) return m;
  }
  return null;
}

/** 今の階層の未撃破のボス（いなければ null）。ボスは monsters.json の floor に書いた階層に出る（月面のボスは月面の階層） */
export function pendingBoss(state, ctx) {
  const floor = state.adventure.floor;
  const world = state.adventure.world || 'earth';
  for (const m of ctx.monsters) {
    if (m.kind === 'boss' && worldOf(m) === world && m.floor === floor && bossState(state, m.id).status !== 'defeated') return m;
  }
  return null;
}

/**
 * 挑戦できる中ボス（年齢を満たした未撃破の中ボスで、今は戦っていないもの。いなければ null）。
 * 中ボスは自動では出ない。冒険画面の「挑戦する」で challengeMidboss を呼ぶと出る
 */
export function challengeableMidboss(state, ctx) {
  const m = pendingMidboss(state, ctx);
  if (!m || state.adventure.enemies.some((e) => e.monsterId === m.id)) return null;
  return m;
}

/** 中ボスに挑戦する：今の敵の群れは退き、中ボスが1体で出る。出した中ボスを返す（挑戦できなければ null） */
export function challengeMidboss(state, ctx, events) {
  const m = challengeableMidboss(state, ctx);
  if (!m) return null;
  stashScaffold(state, ctx);
  state.adventure.enemies = [];
  // 挑む前に HP・MP（と仲間の HP）を全回復する（40HzP の依頼。誕生日・やられたときと同じ healAll）
  healAll(state, ctx);
  if (events) events.push({ type: 'challengeHeal', monsterId: m.id, name: m.name });
  return spawnGroup(state, ctx, events, [m.id])[0] || null;
}

/** 中ボスから逃げる：中ボスは退き、少ししてザコの群れが出る。報酬はなく、また挑戦できる */
export function retreatMidboss(state, ctx, events) {
  const adv = state.adventure;
  const e = adv.enemies.find((x) => x.kind === 'midboss');
  if (!e) return false;
  adv.enemies = [];
  adv.spawnTimer = spawnDelay(adv, ctx.balance);
  if (events) events.push({ type: 'retreat', monsterId: e.monsterId, name: e.name });
  return true;
}

/**
 * 中ボスに挑戦できるようになったら一度だけ知らせる（まだ一度も戦っていない中ボスだけ）。
 * 中ボスは monsters.json の順に1体ずつ挑む。前の中ボスを倒すまで、次の中ボスは知らせない
 */
export function announceMidbosses(state, ctx, events) {
  const m = pendingMidboss(state, ctx);
  if (!m) return;
  const st = midbossState(state, m.id);
  if (st.status !== 'waiting' || st.announced) return;
  st.announced = true;
  events.push({ type: 'midbossReady', monsterId: m.id, name: m.name });
}


/** monsters.json で nande: true の魔物（孫）。戦っている間、全ジャンルから「なんで？」と聞いてくる */
export const asksWhy = (ctx, monsterId) => !!(ctx.monsters.find((m) => m.id === monsterId) || {}).nande;

/**
 * 孫が戦いに出てから balance.nande.firstSec 秒後、以後 intervalSec 秒ごとに nande の知らせを出す。
 * 画面（main.js）はこれを受けて、時間を止めて問題を出す（ui/nande.js）
 */
export function askWhy(state, dt, ctx, events) {
  const nb = ctx.balance.nande;
  for (const e of state.adventure.enemies) {
    if (!asksWhy(ctx, e.monsterId)) continue;
    e.nandeCd = (e.nandeCd ?? nb.firstSec) - dt;
    if (e.nandeCd > 0) continue;
    e.nandeCd += nb.intervalSec;
    events.push({ type: 'nande', uid: e.uid, monsterId: e.monsterId, name: e.name });
  }
}

/**
 * 孫の「なんで？」に正解した：孫は納得して、最大HP×correctDamageRatio のダメージ（防御が崩れる前は0）。
 * 勉強の正解では敵にダメージは入らない（40HzP の依頼で無くした）が、孫の「なんで？」は戦いの仕掛けなので残す
 */
export function nandeAnswered(state, ctx, events) {
  const e = state.adventure.enemies.find((x) => asksWhy(ctx, x.monsterId));
  if (!e) return 0;
  return damageEnemy(state, Math.ceil(e.maxHp * ctx.balance.nande.correctDamageRatio), ctx, events, 'quiz', e);
}

/** 孫の「なんで？」に答えられなかった（間違えた・時間切れ）：孫は納得せず、HPが最大HP×wrongHealRatio 回復する */
export function nandeUnanswered(state, ctx, events) {
  const e = state.adventure.enemies.find((x) => asksWhy(ctx, x.monsterId));
  if (!e) return 0;
  return healEnemy(state, e.maxHp * ctx.balance.nande.wrongHealRatio, events, e);
}
