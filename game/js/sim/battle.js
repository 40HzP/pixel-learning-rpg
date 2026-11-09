// ゲームの計算：戦い（敵を作る・群れを出す・主人公と仲間の攻撃・敵を倒す・経験値・やられたとき）

import { heroStats, expMultiplier, heroAttackInterval, spellDamage, expToNext, calcDamage, isInvulnerable } from './stats.js';
import { raiseZukan, midbossState, midbossLeft, bossState } from './knowledge.js';
import { generationMultiplier } from './life.js';
import { onMoon, floorStats, zakoPool } from './world.js';
import { MINION_SLOT, gimmickIn, bossMinions, smoothDamage, deflects, sinkAllies, freeSunkAllies, splitBoss, partDown, absorbParts } from './moon.js';
import { pendingBoss, askWhy } from './midboss.js';
import { stashScaffold, applyScaffold } from './floors.js';
import { partyAllies, partyMax, partyFull, recruitById } from './allies.js';
import { tameZako } from './barn.js';
import { pickZakoGroup, zakoZukanCount } from './firstrun.js';

export function makeEnemy(monster, state, ctx, slot) {
  const s = floorStats(state, ctx);
  const e = {
    uid: state.adventure.nextUid++, slot,
    monsterId: monster.id, name: monster.name, kind: monster.kind,
    maxHp: s.maxHp, hp: s.maxHp, atk: s.atk, def: s.def, exp: s.exp, gold: s.gold,
    cd: ctx.balance.monster.attackIntervalSec,
  };
  // 中ボス・ボスは、その階層のザコの数値に倍率をかける
  const mult = monster.kind === 'midboss' ? ctx.balance.midboss : monster.kind === 'boss' ? ctx.balance.boss : null;
  if (mult) {
    e.maxHp = e.hp = Math.round(s.maxHp * mult.hpMultiplier);
    e.atk = Math.max(1, Math.round(s.atk * mult.atkMultiplier));
    e.def = Math.round(s.def * (mult.defMultiplier || 1));
    e.exp = Math.round(s.exp * mult.expMultiplier);
    e.gold = Math.round(s.gold * mult.goldMultiplier);
  }
  // 月面のボスの仕掛け（gimmick）。つるつる（smooth）は正解で描き足された山と影の数（marks）を持つ
  if (monster.gimmick) {
    e.gimmick = monster.gimmick;
    if (monster.gimmick === 'smooth') e.marks = 0;
  }
  // monsters.json に stats（hp・atk・def・exp・gold）があれば、階層に関係なくその強さで出る（小学校教師など）
  if (monster.stats) {
    const st = monster.stats;
    e.maxHp = e.hp = st.hp; e.atk = st.atk; e.def = st.def; e.exp = st.exp; e.gold = st.gold;
  }
  return e;
}

/** 次に出る敵を1体決める。その階層の未撃破のボスが先（中ボスは自動では出ない） */
export function chooseNextMonster(state, ctx) {
  const mb = pendingBoss(state, ctx);
  if (mb) return mb;
  const pool = zakoPool(state, ctx);
  return pool[Math.floor(ctx.rng() * pool.length)] || null;
}

/** 今狙っている敵（群れの先頭） */
export const frontEnemy = (state) => state.adventure.enemies[0] || null;

/**
 * 敵の群れを出す。ザコはその階層の残りの数だけまとめて出る（ボスは1体で出る）。
 * ボスのいる階層はボスだけ。倒すと次の階層に進む。中ボスは challengeMidboss で出す。
 * monsterIds を渡すとその魔物を出す（テスト・デバッグ用）
 */
export function spawnGroup(state, ctx, events, monsterIds = null) {
  const adv = state.adventure;
  const b = ctx.balance;
  let list;
  let minions = [];
  const misbelief = []; // 前世の記憶をたどるで覚えたザコ（前世で魔物に吹き込まれた噂）のうち、この群れで初めて出したもの
  if (monsterIds) list =monsterIds.map((id) => ctx.monsters.find((m) => m.id === id)).filter(Boolean);
  else {
    const mb = pendingBoss(state, ctx);
    if (mb) {
      // 月面のボスは手下（関係する月面のザコ）を呼ぶ。図鑑で正体を開いた手下は呼べない
      minions = bossMinions(state, ctx, mb);
      list = [...minions, mb];
      if ((mb.minions || []).length) events.push({ type: 'minions', monsterId: mb.id, name: mb.name, called: minions.map((m) => m.name), known: mb.minions.length - minions.length });
    } else {
      const n = Math.max(1, b.floor.monstersPerFloor - adv.kills);
      if (state.firstRun) list = pickZakoGroup(state, ctx, n, misbelief); // 最初の人生は、前世の記憶をたどるで覚えたザコを先に
      else {
        const pool = zakoPool(state, ctx);
        list = [];
        for (let i = 0; i < n && pool.length; i++) list.push(pool[Math.floor(ctx.rng() * pool.length)]);
      }
    }
  }
  if (!list.length) return [];
  adv.enemies = list.map((m, i) => makeEnemy(m, state, ctx, i));
  // 手下はボスの手前に並ぶ（群れの先頭。描く場所は render.js の MINION_SLOTS）
  adv.enemies.slice(0, minions.length).forEach((e, i) => { e.minion = true; e.slot = MINION_SLOT + i; });
  // 全員が同時に殴らないよう、最初の攻撃をずらす（主人公の攻撃の拍はそのまま。テンポを一定に保つ）
  adv.enemies.forEach((e, i) => { e.cd = b.monster.attackIntervalSec * (0.5 + i / adv.enemies.length); });
  for (const e of adv.enemies) {
    raiseZukan(state, e.monsterId, 1, events);
    let first = false;
    if (e.kind === 'boss') applyScaffold(state, ctx, e, events);
    if (e.kind === 'midboss' || e.kind === 'boss') {
      const st = e.kind === 'midboss' ? midbossState(state, e.monsterId) : bossState(state, e.monsterId);
      first = st.status === 'waiting';
      if (first) st.status = 'appeared';
      // それまでの勉強で正解が足りていれば、出てきた時点で防御が崩れている
      if (e.kind === 'midboss' && st.status === 'appeared') {
        const m = ctx.monsters.find((x) => x.id === e.monsterId);
        if (m && midbossLeft(state, m) === 0) st.status = 'broken';
      }
    }
    events.push({ type: 'spawn', monsterId: e.monsterId, name: e.name, kind: e.kind, uid: e.uid, slot: e.slot, floor: adv.floor, first });
  }
  // 前世の記憶をたどるで間違えた問題のザコが出てきた（「前世で魔物に吹き込まれた噂」と添える。main.js）
  for (const r of misbelief) {
    const e = adv.enemies.find((x) => x.monsterId === r.monster.id);
    events.push({ type: 'misbelief', monsterId: r.monster.id, name: r.monster.name, myth: r.monster.myth, believed: r.believed, uid: e ? e.uid : null });
  }
  return adv.enemies;
}

/** 1体だけ出す（テスト・デバッグ用）。出した敵を返す */
export function spawnEnemy(state, ctx, events, monsterId = null) {
  const m = monsterId ? ctx.monsters.find((x) => x.id === monsterId) : chooseNextMonster(state, ctx);
  return m ? spawnGroup(state, ctx, events, [m.id])[0] : null;
}

/**
 * 次の群れが出るまでの秒数。攻撃のテンポを一定にするため、主人公の次の攻撃の floor.spawnLeadSec 秒前に出す
 * （群れが出てくる動き（render.js、0.35秒）が終わったところに、いつもの間隔で攻撃が当たる）。もう間に合わなければすぐ出す
 */
export const spawnDelay = (adv, b) => Math.max(0, adv.heroCd - b.floor.spawnLeadSec);

/** 仲間の行動の間隔（契約した仲間は recruits.json の intervalSec、中ボスだった仲間は ally.attackIntervalSec） */
export const allyInterval = (ally, ctx) => {
  const r = ally.hired ? recruitById(ctx, ally.id) : null;
  return r ? r.intervalSec : ctx.balance.ally.attackIntervalSec;
};

/** 敵がいない間：主人公と仲間の攻撃の拍は止めずに進め（相手がいない拍は見送る）、次の群れを待つ */
export function idleStep(state, dt, ctx, events) {
  const adv = state.adventure;
  freeSunkAllies(state, events);
  adv.heroCd -= dt;
  while (adv.heroCd <= 0) adv.heroCd += heroAttackInterval(ctx.balance);
  for (const ally of partyAllies(state).slice(0, partyMax(ctx))) {
    ally.cd -= dt;
    while (ally.cd <= 0) ally.cd += allyInterval(ally, ctx);
  }
  adv.spawnTimer -= dt;
  if (adv.spawnTimer <= 0) spawnGroup(state, ctx, events);
}

export function combatStep(state, dt, ctx, events) {
  const adv = state.adventure;
  const b = ctx.balance;
  if (!adv.enemies.length) { idleStep(state, dt, ctx, events); return; }
  const hs = heroStats(state, ctx);
  state.hero.mp = Math.min(hs.maxMp, state.hero.mp + b.spell.mpRegenPerSec * dt);
  adv.heroCd -= dt;
  if (adv.heroCd <= 0) {
    adv.heroCd += heroAttackInterval(b);
    heroAct(state, hs, ctx, events);
  }
  // 仲間の拍も止めない（群れを倒し終えたあとの拍は見送る）
  sinkAllies(state, dt, ctx, events);
  for (const ally of partyAllies(state).slice(0, partyMax(ctx))) {
    ally.cd -= dt;
    if (ally.cd > 0) continue;
    ally.cd += allyInterval(ally, ctx);
    if (ally.sunk) continue; // 塵に沈んでいる間は動けない
    if (adv.enemies.length) allyAct(state, ally, ally.hired ? recruitById(ctx, ally.id) : null, hs, ctx, events);
  }
  if (!adv.enemies.length) return;
  absorbParts(state, dt, ctx, events);
  askWhy(state, dt, ctx, events);
  for (const e of [...adv.enemies]) {
    e.cd -= dt;
    if (e.cd > 0) continue;
    e.cd += b.monster.attackIntervalSec;
    // 宇宙服（月面だけの品）は受けるダメージを割合で減らす
    const dmg = Math.max(1, Math.round(calcDamage(e.atk, hs.def, b, ctx.rng) * (1 - (hs.damageCut || 0))));
    state.hero.hp = Math.max(0, state.hero.hp - dmg);
    events.push({ type: 'attack', by: 'enemy', target: 'hero', uid: e.uid, slot: e.slot, dmg });
    if (state.hero.hp <= 0) { heroDefeated(state, ctx, events); return; }
  }
}

/**
 * 仲間の番。中ボスだった仲間は先頭を攻撃。契約した仲間は役目どおりに動く：
 * attack＝先頭を攻撃、all＝敵全体を攻撃、heal＝主人公のHPを回復（満タンなら何もしない）。
 * 契約した仲間の攻撃は主人公の攻撃×atkRatio（主人公が強くなると仲間も強くなる）
 */
export function allyAct(state, ally, r, hs, ctx, events) {
  const adv = state.adventure;
  const b = ctx.balance;
  if (r && r.role === 'heal') {
    const before = state.hero.hp;
    state.hero.hp = Math.min(hs.maxHp, state.hero.hp + Math.max(1, Math.round(hs.maxHp * r.healRatio)));
    const amount = Math.round(state.hero.hp - before);
    if (amount > 0) events.push({ type: 'heal', target: 'hero', amount, allyId: ally.id });
    return;
  }
  const atk = r ? Math.max(1, Math.round(hs.atk * r.atkRatio)) : ally.atk;
  const area = !!(r && r.role === 'all');
  const targets = area ? [...adv.enemies] : [adv.enemies[0]];
  for (const e of targets) {
    const dmg = isInvulnerable(state, e) ? 0 : calcDamage(atk, e.def, b, ctx.rng);
    hitEnemy(state, e, dmg, 'ally', ctx, events, { allyId: ally.id, area });
  }
}

/** 主人公の番：敵が2体以上いてMPが足りれば「ひらめき」で全体攻撃、そうでなければ先頭を攻撃 */
export function heroAct(state, hs, ctx, events) {
  const adv = state.adventure;
  const b = ctx.balance;
  const sp = b.spell;
  const hittable = adv.enemies.filter((e) => !isInvulnerable(state, e));
  // 満ち潮の盾（gimmick: tide）は先頭への攻撃を弾くので、敵が1体でも全体攻撃を使う（全体攻撃は弾けない）
  const wantSpell = hittable.length >= sp.minTargets || (hittable.length && gimmickIn(state, 'tide'));
  if (wantSpell && state.hero.mp >= sp.mpCost) {
    state.hero.mp -= sp.mpCost;
    events.push({ type: 'spell', name: sp.name, count: hittable.length });
    for (const e of hittable) hitEnemy(state, e, spellDamage(hs.wis, b, ctx.rng), 'spell', ctx, events);
    return;
  }
  const e = adv.enemies[0];
  if (isInvulnerable(state, e)) { hitEnemy(state, e, 0, 'hero', ctx, events); return; }
  hitEnemy(state, e, calcDamage(hs.atk, e.def, b, ctx.rng), 'hero', ctx, events);
}

/** 敵にダメージを与える。実際に与えたダメージ（仕掛けで減ったあと）を返す */
export function hitEnemy(state, e, dmg, by, ctx, events, extra = {}) {
  if (!state.adventure.enemies.includes(e)) return 0;
  // 月面のボスの仕掛け：つるつるの表面で攻撃が滑る・満ち潮の盾で先頭への攻撃を弾く
  if (e.gimmick === 'smooth') dmg = Math.round(dmg * smoothDamage(e, ctx));
  if (deflects(state, e, by, extra)) { dmg = 0; extra = { ...extra, deflected: true }; }
  const { area, ...shown } = extra;
  e.hp = Math.max(0, e.hp - dmg);
  events.push({ type: 'attack', by, target: 'enemy', uid: e.uid, slot: e.slot, monsterId: e.monsterId, dmg, ...shown });
  if (e.hp <= 0) {
    // 分かれた片方だけ倒したときは、もう片方に吸収される（partDown）。両方倒れたらボスを倒した
    if (!(e.part && partDown(state, e, ctx, events))) defeatEnemy(state, e, ctx, events);
  } else if (e.gimmick === 'split' && !e.part && e.hp <= e.maxHp * ctx.balance.moon.splitAt) {
    splitBoss(state, e, ctx, events);
  }
  return dmg;
}

/** 敵にダメージを与える（孫の「なんで？」の正解など。既定は群れの先頭。中ボスの防御が崩れる前は0） */
export function damageEnemy(state, amount, ctx, events, by = 'quiz', target = null) {
  const e = target || frontEnemy(state);
  if (!e || !state.adventure.enemies.includes(e)) return 0;
  const dmg = isInvulnerable(state, e) ? 0 : Math.max(0, Math.round(amount));
  return hitEnemy(state, e, dmg, by, ctx, events);
}

export function healEnemy(state, amount, events, target = null) {
  const e = target || frontEnemy(state);
  if (!e || !state.adventure.enemies.includes(e)) return 0;
  const before = e.hp;
  e.hp = Math.min(e.maxHp, e.hp + Math.round(amount));
  const healed = e.hp - before;
  events.push({ type: 'heal', target: 'enemy', uid: e.uid, slot: e.slot, monsterId: e.monsterId, amount: healed });
  return healed;
}

export function defeatEnemy(state, e, ctx, events) {
  const adv = state.adventure;
  const b = ctx.balance;
  adv.enemies = adv.enemies.filter((x) => x !== e);
  const gm = generationMultiplier(state, b);
  const gold = Math.round(e.gold * gm);
  const exp = Math.max(1, Math.round(e.exp * gm * expMultiplier(state, b)));
  state.gold += gold;
  events.push({ type: 'defeat', uid: e.uid, slot: e.slot, monsterId: e.monsterId, kind: e.kind, exp, gold, ...(e.part ? { part: e.part } : {}), ...(e.marks != null ? { marks: e.marks } : {}) });
  gainExp(state, exp, ctx, events);
  const learned = raiseZukan(state, e.monsterId, 2, events);
  // 初めて遊ぶ人が初めてザコを倒した：図鑑の札が開いて「1／171」（一度だけ）
  if (e.kind === 'monster' && state.firstRun && !state.firstRun.zukanShown) {
    state.firstRun.zukanShown = true;
    events.push({ type: 'firstZukan', monsterId: e.monsterId, ...zakoZukanCount(state, ctx) });
  }
  if (e.kind === 'midboss') {
    midbossState(state, e.monsterId).status = 'defeated';
    const m = ctx.monsters.find((x) => x.id === e.monsterId) || {};
    if (m.title) events.push({ type: 'titleGained', monsterId: e.monsterId, name: e.name, title: m.title });
    // ally: false の中ボス（孫）は仲間にならない
    if (m.ally !== false && !state.allies.some((a) => a.id === e.monsterId)) {
      const maxHp = Math.max(1, Math.round(e.maxHp * b.ally.hpFromBoss));
      const benched = partyFull(state, ctx); // パーティーがいっぱいなら控えに入る
      state.allies.push({
        id: e.monsterId, name: e.name,
        atk: Math.max(1, Math.round(e.atk * b.ally.atkFromBoss)),
        maxHp, hp: maxHp, cd: b.ally.attackIntervalSec,
        ...(benched ? { benched: true } : {}),
      });
      events.push({ type: 'allyJoined', id: e.monsterId, name: e.name, benched });
    }
  } else if (e.kind === 'boss') {
    bossState(state, e.monsterId).status = 'defeated';
    delete state.scaffold[e.monsterId];
    events.push({ type: 'bossDefeated', monsterId: e.monsterId, name: e.name, floor: adv.floor, world: adv.world || 'earth', learned }); // learned：図鑑に正体が初めて載った
    // ボスが倒れると、残っていた手下は逃げていく
    const fled = adv.enemies.filter((x) => x.minion);
    if (fled.length) {
      adv.enemies = adv.enemies.filter((x) => !x.minion);
      events.push({ type: 'minionsFled', names: fled.map((x) => x.name), uids: fled.map((x) => x.uid) });
    }
    // 月面の最後のボス：月面の踏破（称号と図鑑の頁）
    const m = ctx.monsters.find((x) => x.id === e.monsterId) || {};
    if (m.clear) {
      const first = !state.knowledge.moonCleared;
      state.knowledge.moonCleared = true;
      events.push({ type: 'moonCleared', monsterId: m.id, title: m.clear.title, page: m.clear.page.title, first });
    }
  } else if (!e.minion) {
    adv.kills++;
  }
  // ザコは低い確率でなついて、飼育小屋（月面のザコは飼育ドーム）に入る
  if (e.kind === 'monster') tameZako(state, ctx, e.monsterId, events);
  if (adv.enemies.length) return;
  // 群れを全部倒した。ザコを階層の数だけ倒すか、ボスを倒すと次の階層へ（階層の上限はない）
  adv.spawnTimer = spawnDelay(adv, b);
  if (adv.kills >= b.floor.monstersPerFloor || e.kind === 'boss') {
    adv.kills = 0;
    adv.floor++;
    if (onMoon(state)) state.life.moonMaxFloor = Math.max(state.life.moonMaxFloor || 0, adv.floor);
    else state.life.maxFloor = Math.max(state.life.maxFloor || 1, adv.floor);
    events.push({ type: 'floorUp', floor: adv.floor, world: adv.world || 'earth' });
    // 倒したあとに何か残るボス（ツキノウミセツの立て札）は、それが見えるように次の群れを少し待たせる
    if (e.kind === 'boss' && (ctx.monsters.find((m) => m.id === e.monsterId) || {}).remains) adv.spawnTimer = Math.max(adv.spawnTimer, b.moon.remainsSec);
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

/** その階層の最初からやり直す（撃破数0。戦っていた敵の群れや中ボスは退き、少しして新しい群れが出る。ボスに与えたダメージは足場に残す） */
export function restartFloor(state, floor, ctx) {
  const adv = state.adventure;
  stashScaffold(state, ctx);
  adv.floor = floor;
  adv.kills = 0;
  adv.enemies = [];
  for (const a of state.allies) delete a.sunk;
  adv.spawnTimer = spawnDelay(adv, ctx.balance);
}

/** HP・MPと仲間のHPを全回復する（誕生日・やられたとき・中ボスに挑むとき） */
export function healAll(state, ctx) {
  const hs = heroStats(state, ctx);
  state.hero.hp = hs.maxHp;
  state.hero.mp = hs.maxMp;
  for (const a of state.allies) a.hp = a.maxHp;
}

/**
 * やられたとき：1つ手前の階層の最初からやり直し（1階層なら1階層の最初から）、全回復する（設計ページ「誕生日の熟練判定と階層の移動」）。
 * 熟練の判定はしない。強さ・装備・仲間はそのまま。一度倒したボスは出ない
 */
export function heroDefeated(state, ctx, events) {
  const from = state.adventure.floor;
  restartFloor(state, Math.max(1, from - 1), ctx);
  healAll(state, ctx);
  events.push({ type: 'heroDefeated', from, floor: state.adventure.floor, world: state.adventure.world || 'earth' });
}
