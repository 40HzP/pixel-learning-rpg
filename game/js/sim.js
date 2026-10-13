// ゲームの計算（描画しない・ブラウザの機能に触らない）。
// 乱数は ctx.rng（0以上1未満を返す関数）で受け取る。テストで固定できるようにするため。
//
// ctx = { balance, monsters, items, rng }
//   balance  … data/balance.json
//   monsters … data/monsters.json の monsters 配列
//   items    … data/items.json の items 配列

import { GENRES, MAX_PROFICIENCY } from './genres.js';

export const HOURS_PER_YEAR = 8760;
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const STEP_SEC = 0.1; // 戦闘を細かく刻む幅（速さ×600でも攻撃の順番が崩れないように）
export const DEFAULT_HERO_NAME = '主人公';
export const HERO_NAME_MAX = 8;

/* ================= 状態 ================= */

export function createState(balance) {
  return {
    meta: { startAge: null },                       // 開始年齢の選択（null＝まだ選んでいない）
    life: { generation: 1, gameHours: 0 },          // 何回目の人生か・0歳1月1日0時からの経過時間
    hero: { name: DEFAULT_HERO_NAME, level: 1, exp: 0, totalExp: 0, hp: balance.hero.base.hp, mp: balance.hero.base.mp },
    gold: 0,
    equipment: { weapon: null, armor: null },
    owned: [],                                      // 買った品物のid
    allies: [],                                     // { id, name, atk, maxHp, hp, cd }
    adventure: { floor: 1, kills: 0, enemies: [], spawnTimer: 0, heroCd: 0, nextUid: 1 }, // enemies：今出ている群れ（先頭が狙う相手）
    knowledge: {                                    // 転生で引き継ぐ前提のもの（第2段階）
      genres: {},                                   // ジャンル名 → { level, progress, correct, studied }
      totalCorrect: 0,
      review: [],                                   // 過去問復習の問題id
      recent: [],                                   // 直近に出した問題id
      zukan: {},                                    // 魔物id → { stage: 0|1|2, fooled }
    },
    midbosses: {},                                  // 中ボスid → { status: waiting|appeared|broken|defeated, correct }
    lastSleep: null,                                // 直近の睡眠のまとめ
  };
}

/** 主人公の名前を整える（制御文字を除き、前後の空白を取り、8文字まで。空なら「主人公」） */
export function sanitizeName(name) {
  const s = String(name == null ? '' : name).replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return Array.from(s).slice(0, HERO_NAME_MAX).join('') || DEFAULT_HERO_NAME;
}

export function renameHero(state, name) {
  state.hero.name = sanitizeName(name);
  return state.hero.name;
}

/** 開始年齢（0歳 or 7歳）と名前を決めてゲームを始める */
export function startGame(state, startAge, name) {
  state.meta.startAge = startAge;
  state.life.gameHours = startAge * HOURS_PER_YEAR;
  if (name !== undefined) renameHero(state, name);
}

export function genreState(state, genre) {
  const g = state.knowledge.genres;
  if (!g[genre]) g[genre] = { level: 0, progress: 0, correct: 0, studied: false };
  return g[genre];
}

export function zukanEntry(state, monsterId) {
  const z = state.knowledge.zukan;
  if (!z[monsterId]) z[monsterId] = { stage: 0, fooled: 0 };
  return z[monsterId];
}

/** 図鑑の段階を上げる（下げない）。上がったら events に積む */
export function raiseZukan(state, monsterId, stage, events) {
  const z = zukanEntry(state, monsterId);
  if (z.stage >= stage) return false;
  z.stage = stage;
  if (events) events.push({ type: 'zukan', monsterId, stage });
  return true;
}

export function midbossState(state, id) {
  if (!state.midbosses[id]) state.midbosses[id] = { status: 'waiting', correct: 0 };
  return state.midbosses[id];
}

/* ================= 時間 ================= */

export const ageYears = (state) => Math.floor(state.life.gameHours / HOURS_PER_YEAR);

/** ゲーム内の日時（0歳1月1日0時から数える。うるう年なし） */
export function gameDate(gameHours) {
  const total = Math.floor(gameHours);
  const age = Math.floor(total / HOURS_PER_YEAR);
  const inYear = total % HOURS_PER_YEAR;
  let day = Math.floor(inYear / 24);
  const hour = inYear % 24;
  let month = 0;
  while (day >= MONTH_DAYS[month]) { day -= MONTH_DAYS[month]; month++; }
  return { age, month: month + 1, day: day + 1, hour };
}

export function formatDate(gameHours) {
  const d = gameDate(gameHours);
  return `${d.age}歳 ${d.month}月${d.day}日 ${d.hour}時`;
}

/** 画面が見えている間だけ進む時計。戻ってきた最初のフレームは0（止まっていた分を取り戻さない） */
export function createClock() { return { last: null }; }

export function clockFrame(clock, nowMs, visible, maxFrameSeconds) {
  if (!visible) { clock.last = null; return 0; }
  if (clock.last == null) { clock.last = nowMs; return 0; }
  const dt = (nowMs - clock.last) / 1000;
  clock.last = nowMs;
  return Math.min(Math.max(dt, 0), maxFrameSeconds);
}

/** 秒間獲得量（直近 windowSec 秒の平均）を数える */
export function createRateTracker() { return { t: 0, log: [] }; }
export function trackTime(tr, dt) { tr.t += dt; }
export function trackGain(tr, exp, gold) { tr.log.push([tr.t, exp, gold]); }
export function trackRates(tr, windowSec) {
  const from = tr.t - windowSec;
  while (tr.log.length && tr.log[0][0] < from) tr.log.shift();
  const span = Math.max(1, Math.min(windowSec, tr.t));
  let exp = 0, gold = 0;
  for (const [, e, g] of tr.log) { exp += e; gold += g; }
  return { exp: exp / span, gold: gold / span };
}

/* ================= 強さ ================= */

const itemById = (items, id) => (id ? items.find((i) => i.id === id) || null : null);

/**
 * 主人公のステータス。レベルで伸び、装備で足される。
 * 賢さは勉強の正解数でも伸びる（balance.hero.wisPerCorrect）
 */
export function heroStats(state, ctx) {
  const { hero } = ctx.balance;
  const L = state.hero.level;
  const w = itemById(ctx.items, state.equipment.weapon);
  const a = itemById(ctx.items, state.equipment.armor);
  const gear = (k) => (w ? w[k] || 0 : 0) + (a ? a[k] || 0 : 0);
  const grow = (k) => Math.floor((hero.base[k] || 0) + (hero.perLevel[k] || 0) * (L - 1));
  return {
    maxHp: grow('hp') + gear('hp'),
    maxMp: grow('mp') + gear('mp'),
    atk: grow('atk') + gear('atk'),
    def: grow('def') + gear('def'),
    wis: grow('wis') + Math.floor((hero.wisPerCorrect || 0) * state.knowledge.totalCorrect) + gear('wis'),
    agi: grow('agi') + gear('agi'),
    luck: grow('luck') + gear('luck'),
  };
}

/** すばやさ：攻撃の間隔 ＝ attackIntervalSec ÷（1 ＋ すばやさ × agiSpeedPerPoint） */
export const heroAttackInterval = (stats, balance) => balance.hero.attackIntervalSec / (1 + stats.agi * balance.stats.agiSpeedPerPoint);

/** 運の良さ：会心の一撃の出やすさ（上限あり） */
export const critChance = (stats, balance) => Math.min(balance.stats.critChanceMax, stats.luck * balance.stats.critChancePerLuck);

/** 運の良さ：もらえるゴールドが増える */
export const goldWithLuck = (gold, stats, balance) => Math.round(gold * (1 + stats.luck * balance.stats.goldBonusPerLuck));

/** 賢さ：ひらめき（敵全体への攻撃）のダメージ。防御は効かない */
export function spellDamage(wis, balance, rng) {
  const v = balance.damage.variance;
  return Math.max(1, Math.round(wis * balance.spell.power * (1 + (rng() * 2 - 1) * v)));
}

export const expToNext = (level, balance) => Math.floor(balance.levelExp.base * balance.levelExp.growth ** (level - 1));

export function monsterStats(floor, balance) {
  const m = balance.monster;
  const g = m.growthPerFloor ** (floor - 1);
  const hg = m.hpGrowthPerFloor ** (floor - 1);
  return {
    maxHp: Math.max(1, Math.round(m.base.hp * hg)),
    atk: Math.max(1, Math.round(m.base.atk * g)),
    def: Math.round(m.base.def * g),
    exp: Math.max(1, Math.round(m.base.exp * g)),
    gold: Math.max(1, Math.round(m.base.gold * g)),
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

/* ================= 冒険 ================= */

function makeEnemy(monster, state, ctx, slot) {
  const s = monsterStats(state.adventure.floor, ctx.balance);
  const e = {
    uid: state.adventure.nextUid++, slot,
    monsterId: monster.id, name: monster.name, kind: monster.kind,
    maxHp: s.maxHp, hp: s.maxHp, atk: s.atk, def: s.def, exp: s.exp, gold: s.gold,
    cd: ctx.balance.monster.attackIntervalSec,
  };
  if (monster.kind === 'midboss') {
    const mb = ctx.balance.midboss;
    e.maxHp = e.hp = Math.round(s.maxHp * mb.hpMultiplier);
    e.atk = Math.max(1, Math.round(s.atk * mb.atkMultiplier));
    e.exp = Math.round(s.exp * mb.expMultiplier);
    e.gold = Math.round(s.gold * mb.goldMultiplier);
  }
  return e;
}

/** 年齢を満たした未撃破の中ボス（いなければ null） */
export function pendingMidboss(state, ctx) {
  const age = ageYears(state);
  for (const m of ctx.monsters) {
    if (m.kind !== 'midboss') continue;
    if (midbossState(state, m.id).status !== 'defeated' && age >= m.appearAge) return m;
  }
  return null;
}

/** 次に出る敵を1体決める。年齢を満たした未撃破の中ボスが最優先 */
export function chooseNextMonster(state, ctx) {
  const mb = pendingMidboss(state, ctx);
  if (mb) return mb;
  const pool = ctx.monsters.filter((m) => m.kind === 'monster');
  return pool[Math.floor(ctx.rng() * pool.length)] || null;
}

/** 今狙っている敵（群れの先頭） */
export const frontEnemy = (state) => state.adventure.enemies[0] || null;

/**
 * 敵の群れを出す。ザコはその階層の残りの数だけまとめて出る（中ボスは1体で出る）。
 * monsterIds を渡すとその魔物を出す（テスト・デバッグ用）
 */
export function spawnGroup(state, ctx, events, monsterIds = null) {
  const adv = state.adventure;
  const b = ctx.balance;
  let list;
  if (monsterIds) list = monsterIds.map((id) => ctx.monsters.find((m) => m.id === id)).filter(Boolean);
  else {
    const mb = pendingMidboss(state, ctx);
    if (mb) list = [mb];
    else {
      const pool = ctx.monsters.filter((m) => m.kind === 'monster');
      const n = Math.max(1, b.floor.monstersPerFloor - adv.kills);
      list = [];
      for (let i = 0; i < n && pool.length; i++) list.push(pool[Math.floor(ctx.rng() * pool.length)]);
    }
  }
  if (!list.length) return [];
  adv.enemies = list.map((m, i) => makeEnemy(m, state, ctx, i));
  // 全員が同時に殴らないよう、最初の攻撃をずらす
  adv.enemies.forEach((e, i) => { e.cd = b.monster.attackIntervalSec * (0.5 + i / adv.enemies.length); });
  adv.heroCd = heroAttackInterval(heroStats(state, ctx), b) / 2;
  for (const e of adv.enemies) {
    raiseZukan(state, e.monsterId, 1, events);
    let first = false;
    if (e.kind === 'midboss') {
      const st = midbossState(state, e.monsterId);
      first = st.status === 'waiting';
      if (first) st.status = 'appeared';
    }
    events.push({ type: 'spawn', monsterId: e.monsterId, kind: e.kind, uid: e.uid, slot: e.slot, first });
  }
  return adv.enemies;
}

/** 1体だけ出す（テスト・デバッグ用）。出した敵を返す */
export function spawnEnemy(state, ctx, events, monsterId = null) {
  const m = monsterId ? ctx.monsters.find((x) => x.id === monsterId) : chooseNextMonster(state, ctx);
  return m ? spawnGroup(state, ctx, events, [m.id])[0] : null;
}

/** 経過時間 dt 秒（速さ倍率をかけた後）だけゲームを進める。起きたことを events で返す */
export function tick(state, dt, ctx) {
  const events = [];
  if (state.meta.startAge == null || !(dt > 0)) return events;
  state.life.gameHours += dt * ctx.balance.time.gameHoursPerRealSecond;
  let remaining = dt;
  while (remaining > 1e-9) {
    const step = Math.min(remaining, STEP_SEC);
    remaining -= step;
    combatStep(state, step, ctx, events);
  }
  return events;
}

function combatStep(state, dt, ctx, events) {
  const adv = state.adventure;
  const b = ctx.balance;
  if (!adv.enemies.length) {
    adv.spawnTimer -= dt;
    if (adv.spawnTimer <= 0) spawnGroup(state, ctx, events);
    return;
  }
  const hs = heroStats(state, ctx);
  state.hero.mp = Math.min(hs.maxMp, state.hero.mp + b.spell.mpRegenPerSec * dt);
  adv.heroCd -= dt;
  if (adv.heroCd <= 0) {
    adv.heroCd += heroAttackInterval(hs, b);
    heroAct(state, hs, ctx, events);
    if (!adv.enemies.length) return;
  }
  for (const ally of state.allies) {
    ally.cd -= dt;
    if (ally.cd > 0) continue;
    ally.cd += b.ally.attackIntervalSec;
    const e = adv.enemies[0];
    const dmg = isInvulnerable(state, e) ? 0 : calcDamage(ally.atk, e.def, b, ctx.rng);
    hitEnemy(state, e, dmg, 'ally', ctx, events, { allyId: ally.id });
    if (!adv.enemies.length) return;
  }
  for (const e of [...adv.enemies]) {
    e.cd -= dt;
    if (e.cd > 0) continue;
    e.cd += b.monster.attackIntervalSec;
    const dmg = calcDamage(e.atk, hs.def, b, ctx.rng);
    state.hero.hp = Math.max(0, state.hero.hp - dmg);
    events.push({ type: 'attack', by: 'enemy', target: 'hero', uid: e.uid, slot: e.slot, dmg });
    if (state.hero.hp <= 0) { heroDefeated(state, ctx, events); return; }
  }
}

/** 主人公の番：敵が2体以上いてMPが足りれば「ひらめき」で全体攻撃、そうでなければ先頭を攻撃（会心あり） */
function heroAct(state, hs, ctx, events) {
  const adv = state.adventure;
  const b = ctx.balance;
  const sp = b.spell;
  const hittable = adv.enemies.filter((e) => !isInvulnerable(state, e));
  if (hittable.length >= sp.minTargets && state.hero.mp >= sp.mpCost) {
    state.hero.mp -= sp.mpCost;
    events.push({ type: 'spell', name: sp.name, count: hittable.length });
    for (const e of hittable) hitEnemy(state, e, spellDamage(hs.wis, b, ctx.rng), 'spell', ctx, events);
    return;
  }
  const e = adv.enemies[0];
  if (isInvulnerable(state, e)) { hitEnemy(state, e, 0, 'hero', ctx, events); return; }
  let dmg = calcDamage(hs.atk, e.def, b, ctx.rng);
  const crit = ctx.rng() < critChance(hs, b);
  if (crit) dmg = Math.round(dmg * b.stats.critMultiplier);
  hitEnemy(state, e, dmg, 'hero', ctx, events, { crit });
}

function hitEnemy(state, e, dmg, by, ctx, events, extra = {}) {
  if (!state.adventure.enemies.includes(e)) return;
  e.hp = Math.max(0, e.hp - dmg);
  events.push({ type: 'attack', by, target: 'enemy', uid: e.uid, slot: e.slot, monsterId: e.monsterId, dmg, ...extra });
  if (e.hp <= 0) defeatEnemy(state, e, ctx, events);
}

/** 勉強の正解などで敵にダメージを与える（既定は群れの先頭。中ボスの防御が崩れる前は0） */
export function damageEnemy(state, amount, ctx, events, by = 'quiz', target = null) {
  const e = target || frontEnemy(state);
  if (!e || !state.adventure.enemies.includes(e)) return 0;
  const dmg = isInvulnerable(state, e) ? 0 : Math.max(0, Math.round(amount));
  hitEnemy(state, e, dmg, by, ctx, events);
  return dmg;
}

export function healEnemy(state, amount, events, target = null) {
  const e = target || frontEnemy(state);
  if (!e || !state.adventure.enemies.includes(e)) return 0;
  const before = e.hp;
  e.hp = Math.min(e.maxHp, e.hp + Math.round(amount));
  const healed = e.hp - before;
  events.push({ type: 'heal', target: 'enemy', uid: e.uid, slot: e.slot, amount: healed });
  return healed;
}

function defeatEnemy(state, e, ctx, events) {
  const adv = state.adventure;
  const b = ctx.balance;
  adv.enemies = adv.enemies.filter((x) => x !== e);
  const gold = goldWithLuck(e.gold, heroStats(state, ctx), b);
  state.gold += gold;
  events.push({ type: 'defeat', uid: e.uid, slot: e.slot, monsterId: e.monsterId, kind: e.kind, exp: e.exp, gold });
  gainExp(state, e.exp, ctx, events);
  raiseZukan(state, e.monsterId, 2, events);
  if (e.kind === 'midboss') {
    midbossState(state, e.monsterId).status = 'defeated';
    if (!state.allies.some((a) => a.id === e.monsterId)) {
      const maxHp = Math.max(1, Math.round(e.maxHp * b.ally.hpFromBoss));
      state.allies.push({
        id: e.monsterId, name: e.name,
        atk: Math.max(1, Math.round(e.atk * b.ally.atkFromBoss)),
        maxHp, hp: maxHp, cd: b.ally.attackIntervalSec,
      });
      events.push({ type: 'allyJoined', id: e.monsterId, name: e.name });
    }
  } else {
    adv.kills++;
  }
  if (adv.enemies.length) return;
  // 群れを全部倒した
  adv.spawnTimer = b.floor.spawnDelaySec;
  if (adv.kills >= b.floor.monstersPerFloor) {
    adv.kills = 0;
    if (adv.floor < b.floor.maxFloorPhase1) {
      adv.floor++;
      events.push({ type: 'floorUp', floor: adv.floor });
    } else {
      events.push({ type: 'floorRepeat', floor: adv.floor });
    }
  }
}

export function gainExp(state, amount, ctx, events) {
  const h = state.hero;
  h.exp += amount;
  h.totalExp += amount;
  let need = expToNext(h.level, ctx.balance);
  while (h.exp >= need) {
    const before = heroStats(state, ctx);
    h.exp -= need;
    h.level++;
    const after = heroStats(state, ctx);
    h.hp += after.maxHp - before.maxHp;
    h.mp += after.maxMp - before.maxMp;
    events.push({ type: 'levelUp', level: h.level });
    need = expToNext(h.level, ctx.balance);
  }
}

/** やられたとき：階層だけ1に戻る。強さ・装備・仲間はそのまま。睡眠と同じ処理が起きる */
function heroDefeated(state, ctx, events) {
  const adv = state.adventure;
  adv.floor = 1;
  adv.kills = 0;
  adv.enemies = [];
  adv.spawnTimer = ctx.balance.floor.spawnDelaySec;
  const summary = sleep(state, ctx, 'defeated');
  events.push({ type: 'heroDefeated', sleep: summary });
}

/* ================= 睡眠 ================= */

/**
 * ゲーム内時間を進めてHP・MPを全回復し、ジャンルごとに熟練を判定する。
 * 前回の睡眠以降に解いたジャンル：upChance で+1。解いていないジャンル（Lv1以上）：downChance で−1。
 * 乱数はジャンルの並び順（GENRES）に、判定するジャンルごとに1回ずつ使う。
 */
export function sleep(state, ctx, reason = 'bed') {
  const s = ctx.balance.sleep;
  state.life.gameHours += s.gameHours;
  const hs = heroStats(state, ctx);
  state.hero.hp = hs.maxHp;
  state.hero.mp = hs.maxMp;
  for (const a of state.allies) a.hp = a.maxHp;
  const up = [], down = [];
  for (const genre of GENRES) {
    const g = state.knowledge.genres[genre];
    if (!g) continue;
    if (g.studied) {
      if (ctx.rng() < s.upChance && g.level < MAX_PROFICIENCY) { g.level++; up.push(genre); }
    } else if (g.level >= 1) {
      if (ctx.rng() < s.downChance) { g.level--; down.push(genre); }
    }
    g.studied = false;
  }
  state.lastSleep = { reason, up, down, hours: s.gameHours, at: state.life.gameHours };
  return state.lastSleep;
}

/* ================= 店 ================= */

export function shopList(state, ctx) {
  return ctx.items.map((it) => ({
    ...it,
    unlocked: state.knowledge.totalCorrect >= it.unlockCorrect,
    owned: state.owned.includes(it.id),
    equipped: state.equipment[it.slot] === it.id,
  }));
}

const slotPower = (item) => (item ? (item.slot === 'weapon' ? item.atk : item.def) : -Infinity);

/** 買う。前より強ければ自動で装備する */
export function buyItem(state, itemId, ctx) {
  const it = itemById(ctx.items, itemId);
  if (!it) return { ok: false, reason: 'ない品物です' };
  if (state.owned.includes(it.id)) return { ok: false, reason: 'もう持っています' };
  if (state.knowledge.totalCorrect < it.unlockCorrect) return { ok: false, reason: 'まだ入荷していません' };
  if (state.gold < it.price) return { ok: false, reason: 'ゴールドが足りません' };
  state.gold -= it.price;
  state.owned.push(it.id);
  const current = itemById(ctx.items, state.equipment[it.slot]);
  const equipped = slotPower(it) > slotPower(current);
  if (equipped) state.equipment[it.slot] = it.id;
  return { ok: true, equipped };
}
