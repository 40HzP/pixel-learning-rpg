// ゲームの計算（描画しない・ブラウザの機能に触らない）。
// 乱数は ctx.rng（0以上1未満を返す関数）で受け取る。テストで固定できるようにするため。
//
// ctx = { balance, monsters, items, recruits, business, fields, rng }
//   balance  … data/balance.json
//   monsters … data/monsters.json の monsters 配列
//   items    … data/items.json の items 配列
//   recruits … data/recruits.json の recruits 配列（仲間が集まる場所で契約できる仲間）
//   business … data/business.json（会社の業種）
//   fields   … data/fields.json（学際分野。計算は fields.js）

import { GENRES, MAX_PROFICIENCY } from './genres.js';
import { fieldActive, fieldById, fieldTitles, updateFields } from './fields.js';

export const HOURS_PER_YEAR = 8760;
export const HOURS_PER_MONTH = HOURS_PER_YEAR / 12; // 契約料を払う間隔（ゲーム内の1か月）
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const STEP_SEC = 0.1; // 戦闘を細かく刻む幅（速さ×600でも攻撃の順番が崩れないように）
export const DEFAULT_HERO_NAME = '主人公';
export const HERO_NAME_MAX = 8;

/* ================= 状態 ================= */

export function createState(balance) {
  return {
    meta: { startAge: null },                       // 開始年齢の選択（null＝まだ選んでいない）
    // 何世代目か・0歳1月1日0時からの経過時間・生まれたときに決まった寿命（歳）・この人生で一番深い階層・体の不調を感じ始めたか・病院で治療を受けた回数
    life: { generation: 1, gameHours: 0, lifespan: balance.life.lifespanYears, maxFloor: 1, ailing: false, treatments: 0 },
    hero: { name: DEFAULT_HERO_NAME, level: 1, exp: 0, totalExp: 0, hp: balance.hero.base.hp, mp: balance.hero.base.mp },
    gold: 0,
    equipment: { weapon: null, armor: null },
    owned: [],                                      // 買った品物のid
    allies: [],                                     // 中ボス：{ id, name, atk, maxHp, hp, cd }／契約：{ id, name, hired: true, cd, paidUntil }
    companies: [],                                  // 起業した会社：{ uid, industry, foundedAt, staff: [{ id, grade, paidUntil }] }（業種ごとに1社まで）
    nextCompanyUid: 1,
    adventure: { floor: 1, kills: 0, enemies: [], spawnTimer: 0, heroCd: 0, nextUid: 1, baseFloor: null, evadeAcc: 0 }, // enemies：今出ている群れ（先頭が狙う相手）。baseFloor：拠点（構造工学）。evadeAcc：ためた回避率
    knowledge: {                                    // 転生で引き継ぐ前提のもの（第2段階）
      genres: {},                                   // ジャンル名 → { level, progress, correct, studied }
      totalCorrect: 0,
      review: [],                                   // 過去問復習の問題id
      recent: [],                                   // 直近に出した問題id
      zukan: {},                                    // 魔物id → { stage: 0|1|2, fooled }
      fields: {},                                   // 解放した学際分野：学際分野id → { at, generation, dormant }（fields.js）
      majors: [null, null],                         // 主専攻・副専攻（学際分野id）
    },
    midbosses: {},                                  // 中ボスid → { status: waiting|appeared|broken|defeated, announced }
    bosses: {},                                     // 小ボスid → { status: waiting|appeared|defeated }（一度倒した小ボスは復活しない）
    lastSleep: null,                                // 直近の睡眠のまとめ
    legacy: {                                       // 転生しても残るもの
      titles: [],                                   // 前世までにもらった称号
      lives: [],                                    // 前世のまとめ：{ generation, name, age, level, maxFloor, gold }
      rocket: { buildCostPaid: false, steps: {} },  // ロケット計画の工程（建造費を払ったか・工程ごとに進んだゲーム内の時間）
    },
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

/** レベルを直接決める（デバッグ用）。次のレベルまでの経験値は0から、HP・MPは満タンにする */
export function setHeroLevel(state, level, ctx) {
  state.hero.level = Math.max(1, Math.floor(Number(level) || 1));
  state.hero.exp = 0;
  const hs = heroStats(state, ctx);
  state.hero.hp = hs.maxHp;
  state.hero.mp = hs.maxMp;
  return state.hero.level;
}

/** 開始年齢（0歳 or 7歳）と名前を決めてゲームを始める */
export function startGame(state, startAge, name, lifespan) {
  state.meta.startAge = startAge;
  state.life.gameHours = startAge * HOURS_PER_YEAR;
  if (name !== undefined) renameHero(state, name);
  if (lifespan !== undefined) state.life.lifespan = lifespan;
}

/* ================= 寿命と転生 ================= */

/** 生まれるたびに決める寿命（lifespanYears ± lifespanSpread 歳） */
export const lifespanFor = (balance, rng) =>
  balance.life.lifespanYears + Math.round((rng() * 2 - 1) * balance.life.lifespanSpread);

/** 今の寿命（歳）：生まれたときに決まった寿命（life.lifespan）＋病院の治療で延びた分 */
export const lifespanOf = (state, balance) => state.life.lifespan + (state.life.treatments || 0) * balance.hospital.extendYears;

/** 体の不調を感じ始める年齢：生まれたときの寿命の life.ailmentYearsBefore 年前（寿命80歳なら70歳。治療で延びた分は数えない） */
export const ailmentAge = (state, balance) => state.life.lifespan - balance.life.ailmentYearsBefore;

/**
 * 病院の治療（次の1回）。体の不調を感じ始めてから受けられ、1回ごとに寿命が hospital.extendYears 年延びる。
 * 治療費は hospital.treatmentCosts の順（1回目・2回目…）で、1つの人生で受けられるのはその数まで
 */
export function treatmentInfo(state, ctx) {
  const h = ctx.balance.hospital;
  const count = state.life.treatments || 0;
  const max = h.treatmentCosts.length;
  const cost = count < max ? h.treatmentCosts[count] : null;
  let reason = null;
  if (!state.life.ailing) reason = '体の不調を感じ始めてから受けられる';
  else if (cost == null) reason = 'これ以上の治療はできない';
  else if (state.gold < cost) reason = 'ゴールドが足りません';
  return { count, max, cost, years: h.extendYears, ok: !reason, reason };
}

/** 病院で治療を受ける：治療費を払い、寿命が hospital.extendYears 年延びる */
export function receiveTreatment(state, ctx) {
  const t = treatmentInfo(state, ctx);
  if (!t.ok) return { ok: false, reason: t.reason };
  state.gold -= t.cost;
  state.life.treatments = t.count + 1;
  return { ok: true, cost: t.cost, years: t.years, lifespan: lifespanOf(state, ctx.balance) };
}

/** 熟練Lvの上限：1世代目は MAX_PROFICIENCY（5）。生まれ変わるたびに reincarnation.proficiencyCapStep（5）ずつ上がる（2世代目10・3世代目15…） */
export const proficiencyCap = (state, balance) => MAX_PROFICIENCY + (balance.reincarnation.proficiencyCapStep || 0) * (state.life.generation - 1);

/** 世代の倍率：ステータスの伸び・獲得経験値・獲得ゴールドに掛かる（1世代目は1、2世代目は1.5、3世代目は2.25…） */
export const generationMultiplier = (state, balance) => balance.reincarnation.multiplier ** (state.life.generation - 1);

/**
 * 寿命で亡くなり、次の世代に生まれ変わる。
 * 最初からになるもの：Lv・経験値・ゴールド・品物と装備・仲間（契約も）・会社・中ボス・階層・年齢。
 * 引き継ぐもの：知識（熟練・累計正解数・過去問復習・図鑑・学際分野と専攻）・倒した小ボス・称号・名前・ロケット計画の工程。
 * 拠点（adventure.baseFloor）は階層と一緒に無くなる。
 * 年齢を選ぶまで（meta.startAge＝null）時間は止まる。前世のまとめを返す
 */
export function reincarnate(state, ctx) {
  const b = ctx.balance;
  const prev = {
    generation: state.life.generation, name: state.hero.name, age: ageYears(state),
    level: state.hero.level, maxFloor: state.life.maxFloor || state.adventure.floor, gold: Math.floor(state.gold),
  };
  state.legacy.titles = [...new Set([...state.legacy.titles, ...heroTitles(state, ctx)])];
  state.legacy.lives.push(prev);
  const fresh = createState(b);
  state.meta = fresh.meta;
  state.life = { ...fresh.life, generation: prev.generation + 1 };
  state.hero = { ...fresh.hero, name: state.hero.name };
  state.gold = 0;
  state.equipment = fresh.equipment;
  state.owned = [];
  state.allies = [];
  state.companies = [];
  state.adventure = fresh.adventure;
  state.midbosses = {};
  state.lastSleep = null;
  return prev;
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
  if (!state.midbosses[id]) state.midbosses[id] = { status: 'waiting' };
  return state.midbosses[id];
}

/** 中ボスの防御が崩れるまでに要る正解の残り。累計の正解数（中ボスが出る前の正解も含む）で数える */
export const midbossLeft = (state, monster) => Math.max(0, (monster.unlockCorrect || 0) - state.knowledge.totalCorrect);

/**
 * 出ている中ボスのうち、累計の正解数が足りたものの防御を崩す。崩れたら events に積む。
 * 正解したとき（quiz.js）と毎回の tick で呼ぶ（古いセーブや、先に正解を貯めていた場合もここで崩れる）
 */
export function breakMidbosses(state, ctx, events) {
  const broken = [];
  for (const e of state.adventure.enemies) {
    if (e.kind !== 'midboss') continue;
    const st = midbossState(state, e.monsterId);
    const m = ctx.monsters.find((x) => x.id === e.monsterId);
    if (st.status === 'appeared' && m && midbossLeft(state, m) === 0) {
      st.status = 'broken';
      broken.push(e.monsterId);
      if (events) events.push({ type: 'midbossBroken', monsterId: e.monsterId });
    }
  }
  return broken;
}

export function bossState(state, id) {
  if (!state.bosses[id]) state.bosses[id] = { status: 'waiting' };
  return state.bosses[id];
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

/** 表示は日付まで（時間の進みが速く「◯時」はめまぐるしく変わるだけなので出さない） */
export function formatDate(gameHours) {
  const d = gameDate(gameHours);
  return `${d.age}歳 ${d.month}月${d.day}日`;
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

/** ゲーム内1か月あたりの獲得量（直近 rateWindowSec 秒の平均を、1か月の長さに直す） */
export function monthlyRates(tr, balance) {
  const r = trackRates(tr, balance.rateWindowSec);
  const secPerMonth = HOURS_PER_MONTH / balance.time.gameHoursPerRealSecond;
  return { exp: r.exp * secPerMonth, gold: r.gold * secPerMonth };
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
  const gm = generationMultiplier(state, ctx.balance); // 世代が進むと伸び方が大きくなる
  const grow = (k) => Math.floor((hero.base[k] || 0) + (hero.perLevel[k] || 0) * gm * (L - 1));
  return {
    maxHp: grow('hp') + gear('hp'),
    maxMp: grow('mp') + gear('mp'),
    atk: grow('atk') + gear('atk'),
    def: grow('def') + gear('def'),
    wis: grow('wis') + Math.floor((hero.wisPerCorrect || 0) * gm * state.knowledge.totalCorrect) + gear('wis'),
    agi: grow('agi') + gear('agi'),
    luck: grow('luck') + gear('luck'),
  };
}

/** 経験値の倍率：勉強で正解するたびに上がる（1 ＋ 累計の正解数 × expBonusPerCorrect） */
export const expMultiplier = (state, balance) => 1 + state.knowledge.totalCorrect * (balance.hero.expBonusPerCorrect || 0);

/** 主人公の攻撃の間隔（秒）。すばやさでは変わらない（balance.hero.attackIntervalSec。0.5なら秒間2回） */
export const heroAttackInterval = (balance) => balance.hero.attackIntervalSec;

/** すばやさ：回避率（敵の攻撃をかわす割合）＝ すばやさ × evadePerAgi（上限あり） */
export const evadeChance = (stats, balance) => Math.min(balance.stats.evadeMax, stats.agi * balance.stats.evadePerAgi);

/** 運の良さ：会心の一撃の出やすさ（上限あり） */
export const critChance = (stats, balance) => Math.min(balance.stats.critChanceMax, stats.luck * balance.stats.critChancePerLuck);

/** 運の良さ：もらえるゴールドが増える */
export const goldWithLuck = (gold, stats, balance) => Math.round(gold * (1 + stats.luck * balance.stats.goldBonusPerLuck));

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

/* ================= 冒険 ================= */

function makeEnemy(monster, state, ctx, slot) {
  const s = monsterStats(state.adventure.floor, ctx.balance);
  const e = {
    uid: state.adventure.nextUid++, slot,
    monsterId: monster.id, name: monster.name, kind: monster.kind,
    maxHp: s.maxHp, hp: s.maxHp, atk: s.atk, def: s.def, exp: s.exp, gold: s.gold,
    cd: ctx.balance.monster.attackIntervalSec,
  };
  // 中ボス・小ボスは、その階層のザコの数値に倍率をかける
  const mult = monster.kind === 'midboss' ? ctx.balance.midboss : monster.kind === 'boss' ? ctx.balance.boss : null;
  if (mult) {
    e.maxHp = e.hp = Math.round(s.maxHp * mult.hpMultiplier);
    e.atk = Math.max(1, Math.round(s.atk * mult.atkMultiplier));
    e.def = Math.round(s.def * (mult.defMultiplier || 1));
    e.exp = Math.round(s.exp * mult.expMultiplier);
    e.gold = Math.round(s.gold * mult.goldMultiplier);
  }
  // monsters.json に stats（hp・atk・def・exp・gold）があれば、階層に関係なくその強さで出る（小学校教師など）
  if (monster.stats) {
    const st = monster.stats;
    e.maxHp = e.hp = st.hp; e.atk = st.atk; e.def = st.def; e.exp = st.exp; e.gold = st.gold;
  }
  return e;
}

/**
 * その階層の世界（stages.json）。from がその階層以下で一番大きい世界を返す。
 * 最後の世界より先の階層は、最後の世界のまま（世界を足すまで）
 */
export function stageFor(floor, stages) {
  let st = null;
  for (const s of stages || []) if (floor >= s.from && (!st || s.from > st.from)) st = s;
  return st;
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

/** 今の階層の未撃破の小ボス（いなければ null）。小ボスは monsters.json の floor に書いた階層に出る */
export function pendingBoss(state, ctx) {
  const floor = state.adventure.floor;
  for (const m of ctx.monsters) {
    if (m.kind === 'boss' && m.floor === floor && bossState(state, m.id).status !== 'defeated') return m;
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
  state.adventure.enemies = [];
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
function announceMidbosses(state, ctx, events) {
  const m = pendingMidboss(state, ctx);
  if (!m) return;
  const st = midbossState(state, m.id);
  if (st.status !== 'waiting' || st.announced) return;
  st.announced = true;
  events.push({ type: 'midbossReady', monsterId: m.id, name: m.name });
}

/** 称号：中ボスを倒してもらったもの（monsters.json の title。仲間にならない中ボス＝孫）と、解放した学際分野のもの */
export const heroTitles = (state, ctx) => [...new Set([
  ...state.legacy.titles,
  ...ctx.monsters.filter((m) => m.kind === 'midboss' && m.title && midbossState(state, m.id).status === 'defeated').map((m) => m.title),
  ...fieldTitles(state, ctx),
])];

/** 次に出る敵を1体決める。その階層の未撃破の小ボスが先（中ボスは自動では出ない） */
export function chooseNextMonster(state, ctx) {
  const mb = pendingBoss(state, ctx);
  if (mb) return mb;
  const pool = ctx.monsters.filter((m) => m.kind === 'monster');
  return pool[Math.floor(ctx.rng() * pool.length)] || null;
}

/** 今狙っている敵（群れの先頭） */
export const frontEnemy = (state) => state.adventure.enemies[0] || null;

/**
 * 敵の群れを出す。ザコはその階層の残りの数だけまとめて出る（小ボスは1体で出る）。
 * 小ボスのいる階層は小ボスだけ。倒すと次の階層に進む。中ボスは challengeMidboss で出す。
 * monsterIds を渡すとその魔物を出す（テスト・デバッグ用）
 */
export function spawnGroup(state, ctx, events, monsterIds = null) {
  const adv = state.adventure;
  const b = ctx.balance;
  let list;
  if (monsterIds) list = monsterIds.map((id) => ctx.monsters.find((m) => m.id === id)).filter(Boolean);
  else {
    const mb = pendingBoss(state, ctx);
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
  // 全員が同時に殴らないよう、最初の攻撃をずらす（主人公の攻撃の拍はそのまま。テンポを一定に保つ）
  adv.enemies.forEach((e, i) => { e.cd = b.monster.attackIntervalSec * (0.5 + i / adv.enemies.length); });
  for (const e of adv.enemies) {
    raiseZukan(state, e.monsterId, 1, events);
    let first = false;
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
  if (ageYears(state) >= lifespanOf(state, ctx.balance)) {
    // 寿命：生まれ変わる（年齢を選ぶまで時間は止まる）
    const life = reincarnate(state, ctx);
    events.push({ type: 'reincarnated', life, generation: state.life.generation });
    return events;
  }
  if (!state.life.ailing && ageYears(state) >= ailmentAge(state, ctx.balance)) {
    // 年を取って、体の不調を感じ始める（ミニムービー。このあと病院で治療を受けられる）
    state.life.ailing = true;
    events.push({ type: 'ailment', age: ageYears(state) });
  }
  payContracts(state, ctx, events);
  earnCompany(state, dt, ctx);
  updateFields(state, ctx, events);
  advanceRocket(state, dt, ctx, events);
  announceMidbosses(state, ctx, events);
  breakMidbosses(state, ctx, events);
  let remaining = dt;
  while (remaining > 1e-9) {
    const step = Math.min(remaining, STEP_SEC);
    remaining -= step;
    combatStep(state, step, ctx, events);
  }
  return events;
}

/**
 * 次の群れが出るまでの秒数。攻撃のテンポを一定にするため、主人公の次の攻撃の floor.spawnLeadSec 秒前に出す
 * （群れが出てくる動き（render.js、0.35秒）が終わったところに、いつもの間隔で攻撃が当たる）。もう間に合わなければすぐ出す
 */
const spawnDelay = (adv, b) => Math.max(0, adv.heroCd - b.floor.spawnLeadSec);

/** 仲間の行動の間隔（契約した仲間は recruits.json の intervalSec、中ボスだった仲間は ally.attackIntervalSec） */
const allyInterval = (ally, ctx) => {
  const r = ally.hired ? recruitById(ctx, ally.id) : null;
  return r ? r.intervalSec : ctx.balance.ally.attackIntervalSec;
};

/** 敵がいない間：主人公と仲間の攻撃の拍は止めずに進め（相手がいない拍は見送る）、次の群れを待つ */
function idleStep(state, dt, ctx, events) {
  const adv = state.adventure;
  adv.heroCd -= dt;
  while (adv.heroCd <= 0) adv.heroCd += heroAttackInterval(ctx.balance);
  for (const ally of partyAllies(state).slice(0, partyMax(ctx))) {
    ally.cd -= dt;
    while (ally.cd <= 0) ally.cd += allyInterval(ally, ctx);
  }
  adv.spawnTimer -= dt;
  if (adv.spawnTimer <= 0) spawnGroup(state, ctx, events);
}

function combatStep(state, dt, ctx, events) {
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
  for (const ally of partyAllies(state).slice(0, partyMax(ctx))) {
    ally.cd -= dt;
    if (ally.cd > 0) continue;
    ally.cd += allyInterval(ally, ctx);
    if (adv.enemies.length) allyAct(state, ally, ally.hired ? recruitById(ctx, ally.id) : null, hs, ctx, events);
  }
  if (!adv.enemies.length) return;
  askWhy(state, dt, ctx, events);
  for (const e of [...adv.enemies]) {
    e.cd -= dt;
    if (e.cd > 0) continue;
    e.cd += b.monster.attackIntervalSec;
    // すばやさ：回避率の分だけ、敵の攻撃をかわす。運でぶれないよう、攻撃を受けるたびに回避率をためていき、
    // 1になったらかわす（回避率30%なら10回に3回。中ボスに勝てるかどうかが運で大きく変わらないように）
    adv.evadeAcc = (adv.evadeAcc || 0) + evadeChance(hs, b);
    if (adv.evadeAcc >= 1) {
      adv.evadeAcc -= 1;
      events.push({ type: 'attack', by: 'enemy', target: 'hero', uid: e.uid, slot: e.slot, dmg: 0, evaded: true });
      continue;
    }
    const dmg = calcDamage(e.atk, hs.def, b, ctx.rng);
    state.hero.hp = Math.max(0, state.hero.hp - dmg);
    events.push({ type: 'attack', by: 'enemy', target: 'hero', uid: e.uid, slot: e.slot, dmg });
    if (state.hero.hp <= 0) { heroDefeated(state, ctx, events); return; }
  }
}

/* ================= 孫の「なんで？」 ================= */

/** monsters.json で nande: true の魔物（孫）。戦っている間、全ジャンルから「なんで？」と聞いてくる */
const asksWhy = (ctx, monsterId) => !!(ctx.monsters.find((m) => m.id === monsterId) || {}).nande;

/**
 * 孫が戦いに出てから balance.nande.firstSec 秒後、以後 intervalSec 秒ごとに nande の知らせを出す。
 * 画面（main.js）はこれを受けて、時間を止めて問題を出す（ui/nande.js）
 */
function askWhy(state, dt, ctx, events) {
  const nb = ctx.balance.nande;
  for (const e of state.adventure.enemies) {
    if (!asksWhy(ctx, e.monsterId)) continue;
    e.nandeCd = (e.nandeCd ?? nb.firstSec) - dt;
    if (e.nandeCd > 0) continue;
    e.nandeCd += nb.intervalSec;
    events.push({ type: 'nande', uid: e.uid, monsterId: e.monsterId, name: e.name });
  }
}

/** 孫の「なんで？」に答えられなかった（間違えた・時間切れ）：孫は納得せず、HPが最大HP×wrongHealRatio 回復する */
export function nandeUnanswered(state, ctx, events) {
  const e = state.adventure.enemies.find((x) => asksWhy(ctx, x.monsterId));
  if (!e) return 0;
  return healEnemy(state, e.maxHp * ctx.balance.nande.wrongHealRatio, events, e);
}

/**
 * 仲間の番。中ボスだった仲間は先頭を攻撃。契約した仲間は役目どおりに動く：
 * attack＝先頭を攻撃、all＝敵全体を攻撃、heal＝主人公のHPを回復（満タンなら何もしない）。
 * 契約した仲間の攻撃は主人公の攻撃×atkRatio（主人公が強くなると仲間も強くなる）
 */
function allyAct(state, ally, r, hs, ctx, events) {
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
  const targets = r && r.role === 'all' ? [...adv.enemies] : [adv.enemies[0]];
  for (const e of targets) {
    const dmg = isInvulnerable(state, e) ? 0 : calcDamage(atk, e.def, b, ctx.rng);
    hitEnemy(state, e, dmg, 'ally', ctx, events, { allyId: ally.id });
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
  events.push({ type: 'heal', target: 'enemy', uid: e.uid, slot: e.slot, monsterId: e.monsterId, amount: healed });
  return healed;
}

function defeatEnemy(state, e, ctx, events) {
  const adv = state.adventure;
  const b = ctx.balance;
  adv.enemies = adv.enemies.filter((x) => x !== e);
  const gm = generationMultiplier(state, b);
  const gold = goldWithLuck(e.gold * gm, heroStats(state, ctx), b);
  const exp = Math.max(1, Math.round(e.exp * gm * expMultiplier(state, b)));
  state.gold += gold;
  events.push({ type: 'defeat', uid: e.uid, slot: e.slot, monsterId: e.monsterId, kind: e.kind, exp, gold });
  gainExp(state, exp, ctx, events);
  raiseZukan(state, e.monsterId, 2, events);
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
    events.push({ type: 'bossDefeated', monsterId: e.monsterId, name: e.name, floor: adv.floor });
  } else {
    adv.kills++;
  }
  if (adv.enemies.length) return;
  // 群れを全部倒した。ザコを階層の数だけ倒すか、小ボスを倒すと次の階層へ（階層の上限はない）
  adv.spawnTimer = spawnDelay(adv, b);
  if (adv.kills >= b.floor.monstersPerFloor || e.kind === 'boss') {
    adv.kills = 0;
    adv.floor++;
    state.life.maxFloor = Math.max(state.life.maxFloor || 1, adv.floor);
    events.push({ type: 'floorUp', floor: adv.floor });
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

/** その階層の最初からやり直す（撃破数0。戦っていた敵の群れや中ボスは退き、少しして新しい群れが出る） */
function restartFloor(state, floor, ctx) {
  const adv = state.adventure;
  adv.floor = floor;
  adv.kills = 0;
  adv.enemies = [];
  adv.spawnTimer = spawnDelay(adv, ctx.balance);
}

/** やられたとき：階層だけ戻る（1階層か、拠点の階層）。強さ・装備・仲間はそのまま。睡眠と同じ処理が起きる */
function heroDefeated(state, ctx, events) {
  restartFloor(state, respawnFloor(state, ctx), ctx);
  const summary = sleep(state, ctx, 'defeated');
  events.push({ type: 'heroDefeated', sleep: summary });
}

/* ---------- 拠点（構造工学） ---------- */

const STRUCTURAL = 'structural_engineering';

/** 拠点が働いているか：拠点があり、構造工学を専攻にしていて休眠していない */
export const baseActive = (state, ctx) => state.adventure.baseFloor != null && fieldActive(state, ctx, STRUCTURAL);

/** 今いる階層に拠点を建てる（構造工学を専攻にしているとき）。拠点は1つで、建て直すと移る */
export function buildBase(state, ctx) {
  if (!fieldActive(state, ctx, STRUCTURAL)) return { ok: false, reason: `${(fieldById(ctx, STRUCTURAL) || {}).name || '構造工学'}を専攻にすると建てられる` };
  const floor = state.adventure.floor;
  if (state.adventure.baseFloor === floor) return { ok: false, reason: `もう${floor}階層に拠点がある` };
  state.adventure.baseFloor = floor;
  return { ok: true, floor };
}

/**
 * やられたときに戻る階層：拠点が働いていて、拠点より深い階層でやられたら拠点の階層。それ以外は1階層
 * （拠点の階層そのものでやられたら1階層。勝てない階層でやられ続けないように）
 */
export function respawnFloor(state, ctx) {
  const b = state.adventure.baseFloor;
  return baseActive(state, ctx) && state.adventure.floor > b ? b : 1;
}

/** 寝床（テント）で眠ったときに戻る階層：1つ手前（1階層なら1階層） */
export const bedFloor = (state) => Math.max(1, state.adventure.floor - 1);

/**
 * 寝床（テント）で眠る：1つ手前の階層に戻り、その最初から始める（1階層なら1階層の最初から）。
 * 戦っていた敵の群れや中ボスは退く。そのあと睡眠の処理（全回復・熟練の判定）が起きる
 */
export function sleepAtBed(state, ctx) {
  restartFloor(state, bedFloor(state), ctx);
  return sleep(state, ctx, 'bed');
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
      if (ctx.rng() < s.upChance && g.level < proficiencyCap(state, ctx.balance)) { g.level++; up.push(genre); }
    } else if (g.level >= 1) {
      if (ctx.rng() < s.downChance) { g.level--; down.push(genre); }
    }
    g.studied = false;
  }
  state.lastSleep = { reason, up, down, hours: s.gameHours, at: state.life.gameHours, floor: state.adventure.floor };
  return state.lastSleep;
}

/* ================= パーティー ================= */

/** パーティーにいる仲間（控えに回した中ボスだった仲間は戦わず、冒険画面にも出ない） */
export const inParty = (ally) => !ally.benched;
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
  if (!on) { ally.benched = true; return { ok: true }; }
  if (!inParty(ally) && partyFull(state, ctx)) return { ok: false, reason: `パーティーは${partyMax(ctx)}人まで。だれかを外してから入れる` };
  delete ally.benched;
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

/* ================= 仲間が集まる場所（契約） ================= */

export const recruitById = (ctx, id) => (ctx.recruits || []).find((r) => r.id === id) || null;
/** 社員（role: staff）は会社で働く専門職。会社ごとに雇う（hireStaff）。戦わず、パーティーにも入らない */
export const isStaff = (r) => !!r && r.role === 'staff';
const genreLevel = (state, genre) => (state.knowledge.genres[genre] || { level: 0 }).level;

/** 契約できるようになっているか（unlock があれば、そのジャンルの熟練がそのLv以上） */
export const recruitUnlocked = (state, r) => !r.unlock || genreLevel(state, r.unlock.genre) >= r.unlock.level;

/** 戦う仲間の契約中の記録 */
const contractOf = (state, id) => state.allies.find((a) => a.id === id && a.hired) || null;

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

/* ================= 会社（起業） ================= */

export const industryById = (ctx, id) => ((ctx.business && ctx.business.industries) || []).find((x) => x.id === id) || null;
const companyByUid = (state, uid) => state.companies.find((c) => c.uid === uid) || null;

/** 起業できるようになっているか（business.json の unlock：経営学の熟練 Lv1 から） */
export function canFound(state, ctx) {
  const u = ctx.business && ctx.business.unlock;
  return !!u && genreLevel(state, u.genre) >= u.level;
}

/**
 * 起業できる業種の一覧。業種の level（経営学の熟練Lv）に届いていれば解放。同じ業種の会社は1つまで
 */
export function industryList(state, ctx) {
  const lv = genreLevel(state, ctx.business.unlock.genre);
  return ctx.business.industries.map((ind) => ({
    ...ind, unlocked: lv >= ind.level, founded: state.companies.some((c) => c.industry === ind.id),
  }));
}

/** 起業する。業種を選び、元手（cost）を払う。会社はいくつでも持てる（同じ業種は1つまで） */
export function foundCompany(state, industryId, ctx) {
  const ind = industryById(ctx, industryId);
  if (!ind) return { ok: false, reason: 'ない業種です' };
  const u = ctx.business.unlock;
  if (genreLevel(state, u.genre) < Math.max(u.level, ind.level)) return { ok: false, reason: `${u.genre}の熟練レベルが${Math.max(u.level, ind.level)}以上で起業できる` };
  if (state.companies.some((c) => c.industry === ind.id)) return { ok: false, reason: `${ind.name}はもうある` };
  if (state.gold < ind.cost) return { ok: false, reason: 'ゴールドが足りません' };
  state.gold -= ind.cost;
  state.companies.push({ uid: state.nextCompanyUid++, industry: ind.id, foundedAt: state.life.gameHours, staff: [] });
  return { ok: true };
}

/** 会社をたたむ（元手は戻らない。その会社の社員との契約も終わる） */
export function closeCompany(state, uid) {
  const i = state.companies.findIndex((c) => c.uid === uid);
  if (i < 0) return { ok: false, reason: '会社がありません' };
  state.companies.splice(i, 1);
  return { ok: true };
}

/* ---------- 社員（会社ごと。質は心理学の熟練で上がる） ---------- */

/** 心理学（business.json の staffGenre）の熟練レベルで雇える、いちばん優秀な社員の質（staffGrades の番号） */
export function bestStaffGrade(state, ctx) {
  const lv = genreLevel(state, ctx.business.staffGenre);
  let best = 0;
  ctx.business.staffGrades.forEach((g, i) => { if (lv >= g.psychLevel) best = i; });
  return best;
}
const gradeOf = (ctx, i) => ctx.business.staffGrades[Math.max(0, Math.min(i, ctx.business.staffGrades.length - 1))];

/** 社員の1か月の契約料（基本×質の costMultiplier） */
export const staffCost = (ctx, id, grade) => Math.round((recruitById(ctx, id) || { monthlyCost: 0 }).monthlyCost * gradeOf(ctx, grade).costMultiplier);

/** 社員1人がその会社の利益を増やす割合（基本×質の bonusMultiplier×業種のよく効く社員なら specialtyMultiplier） */
export function staffBonus(ctx, ind, id, grade) {
  const r = recruitById(ctx, id);
  const special = ind && ind.specialty === id;
  return (r ? r.profitBonus || 0 : 0) * gradeOf(ctx, grade).bonusMultiplier * (special ? ind.specialtyMultiplier : 1);
}

/**
 * 会社に社員を雇う（会計士・営業・企画・事務員を1人ずつ）。いま雇えるいちばん優秀な質で雇う。
 * もういる役なら、より優秀な社員に入れ替える（前の社員との契約は終わる。払った分は戻らない）
 */
export function hireStaff(state, uid, id, ctx) {
  const c = companyByUid(state, uid);
  const r = recruitById(ctx, id);
  if (!c) return { ok: false, reason: '会社がありません' };
  if (!isStaff(r)) return { ok: false, reason: 'いない社員です' };
  const grade = bestStaffGrade(state, ctx);
  const cur = c.staff.find((x) => x.id === id);
  if (cur && cur.grade >= grade) return { ok: false, reason: 'これより優秀な社員はまだ雇えない（心理学の熟練が上がると雇える）' };
  const cost = staffCost(ctx, id, grade);
  if (state.gold < cost) return { ok: false, reason: 'ゴールドが足りません' };
  state.gold -= cost;
  if (cur) c.staff.splice(c.staff.indexOf(cur), 1);
  c.staff.push({ id, grade, paidUntil: state.life.gameHours + HOURS_PER_MONTH });
  const order = (x) => (ctx.recruits || []).findIndex((rr) => rr.id === x.id);
  c.staff.sort((a, b) => order(a) - order(b));
  return { ok: true, grade, upgraded: !!cur };
}

/** 社員との契約をやめる（払った分は戻らない） */
export function dismissStaff(state, uid, id) {
  const c = companyByUid(state, uid);
  const i = c ? c.staff.findIndex((x) => x.id === id) : -1;
  if (i < 0) return { ok: false, reason: '雇っていません' };
  c.staff.splice(i, 1);
  return { ok: true };
}

/* ---------- 利益 ---------- */

/**
 * 会社1つの1か月あたりの利益（社員の契約料を引く前）と内訳。
 * 利益＝業種の monthlyProfit ×（1＋社員の staffBonus の合計）×（1＋関係するジャンルの熟練Lvの合計×genreBonusPerLevel）×世代の倍率
 */
export function companyProfit(state, company, ctx) {
  const ind = industryById(ctx, company.industry);
  if (!ind) return null;
  const staff = company.staff.map((st) => {
    const r = recruitById(ctx, st.id);
    if (!r) return null;
    return { id: r.id, name: r.name, grade: st.grade, gradeName: gradeOf(ctx, st.grade).name, bonus: staffBonus(ctx, ind, st.id, st.grade), special: ind.specialty === r.id };
  }).filter(Boolean);
  const bonus = staff.reduce((sum, x) => sum + x.bonus, 0);
  const genreLevels = ind.genres.reduce((sum, g) => sum + genreLevel(state, g), 0);
  const genreBonus = genreLevels * ctx.business.genreBonusPerLevel;
  const gm = generationMultiplier(state, ctx.balance);
  return { company, industry: ind, base: ind.monthlyProfit, staff, staffBonus: bonus, genreLevels, genreBonus, generation: gm, total: Math.round(ind.monthlyProfit * (1 + bonus) * (1 + genreBonus) * gm) };
}

/**
 * 計量経済学：その業種を今起業したときの収益の期待値（1か月あたり）。
 * 社員は、いま雇えるいちばん優秀な質で、雇うと契約料より利益が増える役だけ雇う前提。
 * profit＝利益、cost＝社員の契約料、net＝手取り、paybackMonths＝元手を取り戻すまでの月数（手取りが0以下なら null）
 */
export function industryOutlook(state, ind, ctx) {
  const grade = bestStaffGrade(state, ctx);
  const plain = companyProfit(state, { industry: ind.id, staff: [] }, ctx);
  const perBonus = plain.base * (1 + plain.genreBonus) * plain.generation; // 社員の効果1あたりの利益
  const staff = (ctx.recruits || []).filter((r) => isStaff(r) && perBonus * staffBonus(ctx, ind, r.id, grade) > staffCost(ctx, r.id, grade));
  const p = companyProfit(state, { industry: ind.id, staff: staff.map((r) => ({ id: r.id, grade })) }, ctx);
  const cost = staff.reduce((sum, r) => sum + staffCost(ctx, r.id, grade), 0);
  const net = p.total - cost;
  return { grade, staff: staff.map((r) => r.name), profit: p.total, cost, net, paybackMonths: net > 0 ? ind.cost / net : null };
}

/** 全部の会社の利益（1か月あたり）。companies は会社ごとの内訳 */
export function companiesProfit(state, ctx) {
  const companies = state.companies.map((c) => companyProfit(state, c, ctx)).filter(Boolean);
  return { companies, total: companies.reduce((sum, p) => sum + p.total, 0) };
}

/** 会社の利益は時間がたつと少しずつ入る（1か月で companiesProfit().total） */
function earnCompany(state, dt, ctx) {
  if (!state.companies.length) return;
  state.gold += companiesProfit(state, ctx).total * (dt * ctx.balance.time.gameHoursPerRealSecond) / HOURS_PER_MONTH;
}

/* ================= ロケット計画 ================= */

/**
 * ロケット計画の工程（fields.json の rocketSteps：機体設計・エンジン・軌道計算・打ち上げ許可）。
 * 工程の学際分野を専攻にしていて休眠していない間、ゲーム内の時間で進み、balance.rocket.stepYears 年で完了する。
 * 進み具合は legacy.rocket.steps に残る（生まれ変わっても残る）
 */
export function rocketSteps(state, ctx) {
  const need = ctx.balance.rocket.stepYears * HOURS_PER_YEAR;
  return ((ctx.fields && ctx.fields.rocketSteps) || []).map((st) => {
    const hours = state.legacy.rocket.steps[st.id] || 0;
    return { ...st, fieldDef: fieldById(ctx, st.field), hours, need, done: hours >= need, active: fieldActive(state, ctx, st.field) };
  });
}

function advanceRocket(state, dt, ctx, events) {
  const hours = dt * ctx.balance.time.gameHoursPerRealSecond;
  for (const st of rocketSteps(state, ctx)) {
    if (st.done || !st.active) continue;
    state.legacy.rocket.steps[st.id] = Math.min(st.need, st.hours + hours);
    if (state.legacy.rocket.steps[st.id] >= st.need) events.push({ type: 'rocketStepDone', id: st.id, name: st.name });
  }
}

/**
 * ロケットの建造費（balance.rocket.buildCost）を払う。払った工程は転生しても残る（設計ページ「工程ごとに完了を保存する」）
 */
export function payRocketBuildCost(state, ctx) {
  const cost = ctx.balance.rocket.buildCost;
  if (state.legacy.rocket.buildCostPaid) return { ok: false, reason: 'もう建造費は払った' };
  if (state.gold < cost) return { ok: false, reason: 'ゴールドが足りません' };
  state.gold -= cost;
  state.legacy.rocket.buildCostPaid = true;
  return { ok: true };
}

/* ================= 店 ================= */

/** 品物の値段。行動経済学を専攻にしていると値引き交渉ができる（balance.fields.shopDiscount 引き） */
export function itemPrice(state, item, ctx) {
  const off = fieldActive(state, ctx, 'behavioral_economics') ? ctx.balance.fields.shopDiscount : 0;
  return Math.max(1, Math.round(item.price * (1 - off)));
}

/** 店の品揃え。price は値引き後の値段、listPrice は元の値段 */
export function shopList(state, ctx) {
  return ctx.items.map((it) => ({
    ...it,
    price: itemPrice(state, it, ctx),
    listPrice: it.price,
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
  const price = itemPrice(state, it, ctx);
  if (state.gold < price) return { ok: false, reason: 'ゴールドが足りません' };
  state.gold -= price;
  state.owned.push(it.id);
  const current = itemById(ctx.items, state.equipment[it.slot]);
  const equipped = slotPower(it) > slotPower(current);
  if (equipped) state.equipment[it.slot] = it.id;
  return { ok: true, equipped };
}
