// ゲームの計算：強さ（主人公と魔物のステータス・装備の効果・経験値・ダメージ）

import { midbossState } from './knowledge.js';
import { generationMultiplier } from './life.js';
import { gimmickIn } from './moon.js';

export const itemById = (items, id) => (id ? items.find((i) => i.id === id) || null : null);

/** 装備の枠（items.json の slot）。武器・防具・装飾品に1つずつ */
export const EQUIP_SLOTS = ['weapon', 'armor', 'accessory'];
/** 品物が足すステータス（すばやさ・運の良さは 40HzP の依頼で無くした） */
export const ITEM_STATS = ['hp', 'mp', 'atk', 'def', 'wis'];

/**
 * 主人公のステータス。レベルで伸び、装備（武器・防具・装飾品）で足される。
 * 賢さは勉強の正解数でも伸びる（balance.hero.wisPerCorrect）
 */
export function heroStats(state, ctx) {
  const { hero } = ctx.balance;
  const L = state.hero.level;
  const worn = EQUIP_SLOTS.map((slot) => itemById(ctx.items, state.equipment[slot])).filter(Boolean);
  const gear = (k) => worn.reduce((n, it) => n + (it[k] || 0), 0);
  // 月面だけの品は割合で効く（effects。宇宙服＝受けるダメージを減らす・金のバイザー＝攻撃・月面車の車輪＝HP）
  const eff = (k) => worn.reduce((n, it) => n + ((it.effects || {})[k] || 0), 0);
  const gm = generationMultiplier(state, ctx.balance); // 世代が進むと伸び方が大きくなる
  const grow = (k) => Math.floor((hero.base[k] || 0) + (hero.perLevel[k] || 0) * gm * (L - 1));
  // 月面のボスの水しぶき（gimmick: splash）を浴びている間は、攻撃が moon.splashAtkMultiplier 倍に下がる
  const splash = gimmickIn(state, 'splash') ? ctx.balance.moon.splashAtkMultiplier : 1;
  return {
    maxHp: Math.floor((grow('hp') + gear('hp')) * (1 + eff('hpRate'))),
    maxMp: grow('mp') + gear('mp'),
    atk: Math.floor((grow('atk') + gear('atk')) * (1 + eff('atkRate')) * splash),
    def: grow('def') + gear('def'),
    wis: grow('wis') + Math.floor((hero.wisPerCorrect || 0) * gm * state.knowledge.totalCorrect) + gear('wis'),
    damageCut: Math.min(0.9, eff('damageCut')), // 受けるダメージを減らす割合
  };
}

/** 経験値の倍率：勉強で正解するたびに上がる（1 ＋ 累計の正解数 × expBonusPerCorrect） */
export const expMultiplier = (state, balance) => 1 + state.knowledge.totalCorrect * (balance.hero.expBonusPerCorrect || 0);

/** 主人公の攻撃の間隔（秒）。決まった間隔（balance.hero.attackIntervalSec。0.5なら秒間2回） */
export const heroAttackInterval = (balance) => balance.hero.attackIntervalSec;

/** 賢さ：ひらめき（敵全体への攻撃）のダメージ。防御は効かない */
export function spellDamage(wis, balance, rng) {
  const v = balance.damage.variance;
  return Math.max(1, Math.round(wis * balance.spell.power * (1 + (rng() * 2 - 1) * v)));
}

/**
 * 次のLvまでの経験値＝ base × Lv^power（Lvの2乗なら Lv10→11 に100）。
 * 魔物の強さは階層に比例して伸びるので、必要な経験値も掛け算（growth^Lv）では増やさない（どこかで頭打ちになるため）
 */
export const expToNext = (level, balance) => Math.max(1, Math.floor(balance.levelExp.base * level ** balance.levelExp.power));

/**
 * 階層Fの魔物の数値＝ base ＋ perFloor ×（F−1）。主人公の perLevel と同じく、1階層ごとに一定の量ずつ強くなる
 * （掛け算で強くすると、足し算で伸びる主人公がどこかで追いつけなくなる）
 */
export function monsterStats(floor, balance) {
  const m = balance.monster;
  const v = (k) => m.base[k] + (m.perFloor[k] || 0) * (floor - 1);
  return {
    maxHp: Math.max(1, Math.round(v('hp'))),
    atk: Math.max(1, Math.round(v('atk'))),
    def: Math.round(v('def')),
    exp: Math.max(1, Math.round(v('exp'))),
    gold: Math.max(1, Math.round(v('gold'))),
  };
}

/** ダメージ＝ max(1, 攻撃 − 防御×defFactor) に ±variance のゆらぎ */
export function calcDamage(atk, def, balance, rng) {
  const base = Math.max(1, atk - def * balance.damage.defFactor);
  const v = balance.damage.variance;
  return Math.max(1, Math.round(base * (1 + (rng() * 2 - 1) * v)));
}

/** 中ボスが「防御が崩れた」状態になるまでは攻撃が効かない */
export function isInvulnerable(state, enemy) {
  return !!enemy && enemy.kind === 'midboss' && midbossState(state, enemy.monsterId).status !== 'broken';
}
