// ゲームの計算（描画しない・ブラウザの機能に触らない）。
// 乱数は ctx.rng（0以上1未満を返す関数）で受け取る。テストで固定できるようにするため。
//
// ctx = { balance, monsters, items, recruits, business, fields, stages, radio（月面の電波望遠鏡の図鑑の頁）, rng }
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
/** 主人公の性別（初回起動時と転生時に選ぶ。40HzP の依頼）。変わるのは見た目（hero_* と heroine_* の絵）と、先生の呼び方（君・さん）だけ */
export const GENDERS = ['male', 'female'];

/* ================= 状態 ================= */

export function createState(balance) {
  return {
    meta: { startAge: null },                       // 開始年齢の選択（null＝まだ選んでいない）
    // 何世代目か・0歳1月1日0時からの経過時間・生まれたときに決まった寿命（歳）・この人生で一番深い階層（地球）・月面で一番深い階層（0＝まだ行っていない）・体の不調を感じ始めたか・病院で治療を受けた回数・
    // 誕生日：前に誕生日の処理（全回復・熟練の判定）をした年齢
    life: { generation: 1, gameHours: 0, lifespan: balance.life.lifespanYears, maxFloor: 1, moonMaxFloor: 0, ailing: false, treatments: 0, birthday: 0 },
    hero: { name: DEFAULT_HERO_NAME, gender: 'male', level: 1, exp: 0, totalExp: 0, hp: balance.hero.base.hp, mp: balance.hero.base.mp },
    gold: 0,
    equipment: { weapon: null, armor: null, accessory: null }, // 武器・防具・装飾品（品物のid）
    owned: [],                                      // 買った品物のid
    allies: [],                                     // 中ボス：{ id, name, atk, maxHp, hp, cd, benched?（控え）, advisor?（顧問） }／契約：{ id, name, hired: true, cd, paidUntil }
    citationsUsed: 0,                               // 学会の査読者（顧問）の「要出典」を、前の誕生日から使った回数
    companies: [],                                  // 起業した会社：{ uid, industry, foundedAt, staff: [{ id, grade, paidUntil }], corp?（法人化した）, incorporatedAt? }（業種ごとに1社まで）
    nextCompanyUid: 1,
    // 法人税（法と経済学で法人化した会社）：今年の法人の利益（決算で税を計算する元）・払いきれなかった法人税・前に決算した年齢
    tax: { earned: 0, owed: 0, year: 0 },
    // enemies：今出ている群れ（先頭が狙う相手）。
    // world：今いる世界（earth＝地球、moon＝月面）。floor は今いる世界の階層で、もう片方の世界の階層は earthFloor・moonFloor に取っておく
    adventure: { floor: 1, kills: 0, enemies: [], spawnTimer: 0, heroCd: 0, nextUid: 1, world: 'earth', earthFloor: null, moonFloor: 1 },
    knowledge: {                                    // 転生で引き継ぐ前提のもの（第2段階）
      genres: {},                                   // ジャンル名 → { level, progress, correct, studied（前の誕生日から勉強した）, idle（勉強していない年数） }
      profLog: [],                                  // 熟練の記録（新しい順。PROF_LOG_MAX 件まで。logProficiency）
      totalCorrect: 0,
      review: [],                                   // 間違えたままの問題id（正解すると外れる。心理統計学で見る）
      history: [],                                  // 過去問復習の「最近解いた問題」：{ id, correct, chosen, oogiri? } の新しい順（正誤を問わず10問まで）
      favorites: [],                                // 過去問復習の「お気に入り」：問題id（5問まで）
      torn: [],                                     // 破りすてたテストの問題id（小学校教師の補習で出す。正解すると外れる）
      solved: [],                                   // 正解したことがある問題id（前世の記憶をたどるで、まだ正解したことのない問題を優先する）
      recent: [],                                   // 直近に出した問題id
      zukan: {},                                    // 魔物id → { stage: 0|1|2, fooled }
      fields: {},                                   // 解放した学際分野：学際分野id → { at, generation, dormant }（fields.js）
      majors: [null, null],                         // 主専攻・副専攻（学際分野id）
      moonCleared: false,                           // 月面を踏破した（月面の最後のボスを倒した。称号と図鑑の頁が残る）
      authorGenres: [],                             // 作問権のあるジャンル（2つのジャンルを Lv5 にするともらえる。一度もらうと熟練が下がっても残る）
      radio: { charge: 0, pages: 0 },               // 裏側の電波望遠鏡：たまった「宇宙からの電波」と、開いた図鑑の頁の数（月面で正解するとたまる）
    },
    midbosses: {},                                  // 中ボスid → { status: waiting|appeared|broken|defeated, announced }
    bosses: {},                                     // ボスid → { status: waiting|appeared|defeated }（一度倒したボスは、その人生ではもう出ない。生まれ変わるとまた出る）
    scaffold: {},                                   // 足場（構造工学）：ボスid → 前の挑戦で与えたダメージ（次の挑戦に持ち越す。その人生だけ）
    // 前世の記憶をたどる（初めて遊ぶ人と、生まれ変わるたび。quiz.js の beginRecall で作る。前のセーブは null のまま＝生まれ変わるまで出ない）：
    // check：どの世代の分か・5問の問題id・答え（{ id, monsterId, kind: correct|myth|wrong|timeout }）・
    // introduced：その人生の1〜10階層で、もう優先して出した覚えたザコ・zukanShown：初めてザコを倒したときの図鑑の札を出したか（一度だけ）
    firstRun: null,
    legacy: {                                     // 転生しても残るもの
      titles: [],                                   // 前世までにもらった称号
      lives: [],                                    // 前世のまとめ：{ generation, name, age, level, maxFloor, gold }
      // ロケット計画：建造費を払ったか・工程ごとに進んだゲーム内の時間・
      // 試作機で効果が出たザコ（同じザコの効果は1回まで）・試作機で上がった打ち上げの成功率
      rocket: { buildCostPaid: false, steps: {}, flown: [], rateBonus: 0 },
      // 飼育小屋（地球のザコ）と月面の飼育ドーム（月面のザコ）：なついたザコ { id, affinity（懐き度）, touchedOn?（小屋で最後に触った日 'YYYY-MM-DD'）,
      // space?（宇宙帰り）, flights?（飛んで帰ってきた回数） } のなついた順。同じザコは1体まで。生まれ変わっても残る（40HzP の判断）
      barn: [],
      author: { code: null, seen: [] },            // 作問：作問者コード（はじめて起動したときに決まる）・もう知らせた採用の問題id
      // 今日の1問（現実の日付ごとに1問）：その日（'YYYY-MM-DD'）・問題id・札を開いて閉じたか・答え（{ correct, chosen, timeout }。まだなら null）
      daily: { day: null, id: null, opened: false, result: null },
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
export function startGame(state, startAge, name, lifespan, gender) {
  state.meta.startAge = startAge;
  state.life.gameHours = startAge * HOURS_PER_YEAR;
  state.life.birthday = startAge; // 次の誕生日（startAge＋1歳）から処理する
  if (name !== undefined) renameHero(state, name);
  if (lifespan !== undefined) state.life.lifespan = lifespan;
  if (GENDERS.includes(gender)) state.hero.gender = gender;
}

/** 先生が主人公を呼ぶときの敬称（大喜利のミニムービー）：男の子は「君」、女の子は「さん」 */
export const honorific = (state) => (state.hero.gender === 'female' ? 'さん' : '君');

/** 最初の案内で選べる年齢か。ゲームを初めて始めるとき（1世代目）は0歳からだけで、7歳からは生まれ変わったあとに選べる（40HzP の依頼） */
export const canStartAt = (state, startAge) => startAge === 0 || state.life.generation > 1;

/* ================= 寿命と転生 ================= */

/** 生まれるたびに決める寿命（lifespanYears ± lifespanSpread 歳） */
export const lifespanFor = (balance, rng) =>
  balance.life.lifespanYears + Math.round((rng() * 2 - 1) * balance.life.lifespanSpread);

/** 今の寿命（歳）：生まれたときに決まった寿命（life.lifespan）＋病院の治療で延びた分 */
export const lifespanOf = (state, balance) => state.life.lifespan + (state.life.treatments || 0) * balance.hospital.extendYears;

/** 体の不調を感じ始める年齢：生まれたときの寿命の life.ailmentYearsBefore 年前（寿命80歳なら70歳。治療で延びた分は数えない） */
export const ailmentAge = (state, balance) => state.life.lifespan - balance.life.ailmentYearsBefore;

/** 冒険画面の主人公を年を取った姿で描くか：体の不調を感じ始めてから（40HzP の依頼）。生まれ変わると若い姿に戻る */
export const heroLooksOld = (state) => !!state.life.ailing;

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
 * 最初からになるもの：Lv・経験値・ゴールド・品物と装備・仲間（契約も）・会社・中ボス・ボス（倒したボスにもまた会う。40HzP の依頼）・階層（月面にいても地球の1階層から）・年齢。
 * 引き継ぐもの：知識（熟練・累計正解数・間違えたままの問題・過去問復習・図鑑・学際分野と専攻）・称号・名前・ロケット計画の工程・飼育小屋のザコ。
 * 足場（構造工学。ボスに与えたダメージ）はボスと一緒に最初から。
 * 年齢を選ぶまで（meta.startAge＝null）時間は止まる。前世のまとめを返す
 */
export function reincarnate(state, ctx) {
  const b = ctx.balance;
  const prev = {
    generation: state.life.generation, name: state.hero.name, age: ageYears(state),
    level: state.hero.level, maxFloor: state.life.maxFloor || 1, moonFloor: state.life.moonMaxFloor || 0, gold: Math.floor(state.gold),
  };
  state.legacy.titles = [...new Set([...state.legacy.titles, ...heroTitles(state, ctx)])];
  state.legacy.lives.push(prev);
  const fresh = createState(b);
  state.meta = fresh.meta;
  state.life = { ...fresh.life, generation: prev.generation + 1 };
  state.hero = { ...fresh.hero, name: state.hero.name, gender: state.hero.gender }; // 名前と性別は、生まれ変わったときの案内に前のものを入れておく（選び直せる）
  state.gold = 0;
  state.equipment = fresh.equipment;
  state.owned = [];
  state.allies = [];
  state.citationsUsed = 0;
  state.companies = [];
  state.tax = fresh.tax;
  state.adventure = fresh.adventure;
  state.midbosses = {};
  state.bosses = {};
  state.scaffold = {};
  return prev;
}

/**
 * 前のセーブ（生まれ変わっても倒したボスが出なかった版）で、前世で倒したボスにまた会えるようにする。
 * ボスを倒すと次の階層に進むので、この人生で倒したボスは、この人生の最高階層（life.maxFloor）より手前の階層にいる。
 * 最高階層かそれより先の階層のボスは前世で倒したものなので、倒した印を消す。消したボスの id を返す
 * （月面のボスはこの版で入ったので、前の版のセーブには倒した印が無い。月面の階層は数え方が違うので見ない）
 */
export function forgetPastLifeBosses(state, ctx) {
  if (state.life.generation < 2) return [];
  const reached = state.life.maxFloor || 1;
  const back = [];
  for (const m of ctx.monsters) {
    if (m.kind !== 'boss' || worldOf(m) !== 'earth' || m.floor < reached || (state.bosses[m.id] || {}).status !== 'defeated') continue;
    delete state.bosses[m.id];
    back.push(m.id);
  }
  return back;
}

export function genreState(state, genre) {
  const g = state.knowledge.genres;
  if (!g[genre]) g[genre] = { level: 0, progress: 0, correct: 0, studied: false, idle: 0 };
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

/* ================= 冒険 ================= */

/* ---------- 地球と月面 ---------- */

/** 魔物・世界がどちらの世界のものか（monsters.json・stages.json の world。書いていなければ地球） */
export const worldOf = (x) => (x && x.world) || 'earth';
/** 月面にいるか（ロケットで打ち上げて行く。月面の階層は地球とは別に1から数える） */
export const onMoon = (state) => state.adventure.world === 'moon';

/**
 * 敵の強さを決める階層：地球はその階層。月面は balance.moon.floorOffset ＋ 月面の階層
 * （月面1階層は地球の floorOffset＋1 階層と同じ強さ。ロケットができるころの主人公に合わせた）
 */
export const strengthFloor = (state, ctx) => state.adventure.floor + (onMoon(state) ? ctx.balance.moon.floorOffset : 0);

/**
 * 月面の強さの倍率（40HzP の依頼「月面1階から段階的に強くして」）：月面1階層は1倍で、月面 moon.rampFloor（60）階層まで
 * 階層ごとに同じ割合で増え、rampFloor で moon.rampTo 倍になる。その先は rampTo 倍のまま（地球と同じく1階層ごとに少しずつ強くなる）。
 * 主人公は世代ごとに掛け算で強くなるので、月面も掛け算で強くして、何世代もかけて登る階層にした（60階層は10世代目でやっと越えられる）
 */
export function moonRamp(floor, balance) {
  const m = balance.moon;
  const f = Math.min(Math.max(floor, 1), m.rampFloor);
  return m.rampTo ** ((f - 1) / (m.rampFloor - 1));
}

/** 今いる階層の敵（ザコ）の数値。月面は地球の（floorOffset＋階層）の数値に、HP・攻撃・防御・経験値・ゴールドとも moonRamp を掛ける */
export function floorStats(state, ctx) {
  const s = monsterStats(strengthFloor(state, ctx), ctx.balance);
  if (!onMoon(state)) return s;
  const k = moonRamp(state.adventure.floor, ctx.balance);
  return Object.fromEntries(Object.entries(s).map(([key, v]) => [key, key === 'def' ? Math.round(v * k) : Math.max(1, Math.round(v * k))]));
}

/**
 * 今いる世界に出るザコ（月面には月面のザコだけ、地球には地球のザコだけが出る）。
 * 地球のザコは出現エリア（monsters.json の areas。10階層ごとの世界の名前）が今いる世界のものだけ。
 * 今いる世界に出られるザコが1体もいなければ、地球のザコ全体から選ぶ（設計ページ「出現エリア」）
 */
export function zakoPool(state, ctx) {
  const world = state.adventure.world || 'earth';
  const all = ctx.monsters.filter((m) => m.kind === 'monster' && worldOf(m) === world);
  if (world !== 'earth' || !ctx.stages) return all;
  const stage = currentStage(state, ctx.stages);
  const here = stage ? all.filter((m) => (m.areas || []).includes(stage.name)) : [];
  return here.length ? here : all;
}

/** 世界（stages.json の1件）の階層の範囲 [始まり, 終わり]。最後の世界は終わりが null（その先もずっと続く） */
export function stageRange(stage, stages) {
  const next = (stages || []).filter((s) => worldOf(s) === worldOf(stage) && s.from > stage.from).map((s) => s.from);
  return [stage.from, next.length ? Math.min(...next) - 1 : null];
}

/** ザコの出現エリアの説明（図鑑の未遭遇の札に出す）。例：「はじまりの草原（1〜10階層）」 */
export function areaLabels(m, stages) {
  return (m.areas || []).map((name) => {
    const st = (stages || []).find((s) => s.name === name && worldOf(s) === worldOf(m));
    if (!st) return name;
    const [a, b] = stageRange(st, stages);
    return `${name}（${a}〜${b === null ? '' : b}階層）`;
  });
}

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
const deflects = (state, e, by, extra) =>
  (by === 'hero' || (by === 'ally' && !extra.area)) && e === state.adventure.enemies[0] && gimmickIn(state, 'tide');

/**
 * チリノウミセツ（dust）：moon.sinkIntervalSec 秒ごとに、パーティーの仲間を1人ずつ塵に沈めて動けなくする。
 * 航空宇宙工学（機体設計の学際分野）を専攻にしていれば沈まない。ボスがいなくなると仲間は出てくる
 */
function sinkAllies(state, dt, ctx, events) {
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

function freeSunkAllies(state, events) {
  const sunk = state.allies.filter((a) => a.sunk);
  if (!sunk.length) return;
  for (const a of sunk) delete a.sunk;
  events.push({ type: 'alliesFreed', names: sunk.map((a) => a.name) });
}

/** ブンレツセツ（split）：HPが moon.splitAt を下回ると、地球と月の2体に分かれる（HPは半分ずつ） */
function splitBoss(state, e, ctx, events) {
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
function partDown(state, e, ctx, events) {
  const adv = state.adventure;
  const other = adv.enemies.find((x) => x.part && x !== e && x.monsterId === e.monsterId);
  if (!other) return false;
  adv.enemies = adv.enemies.filter((x) => x !== e);
  if (other.absorbCd == null) other.absorbCd = ctx.balance.moon.absorbSec;
  events.push({ type: 'partDown', uid: e.uid, slot: e.slot, monsterId: e.monsterId, part: e.part, name: e.name });
  return true;
}

/** 残った片方が、倒れた片方を吸収して元の1体に戻る（HPは残った片方の2倍。また半分を下回ると分かれる） */
function absorbParts(state, dt, ctx, events) {
  for (const e of state.adventure.enemies) {
    if (!e.part || e.absorbCd == null) continue;
    e.absorbCd -= dt;
    if (e.absorbCd > 0) continue;
    Object.assign(e, { maxHp: e.wholeMaxHp, hp: Math.min(e.wholeMaxHp, e.hp * 2), slot: 0 });
    delete e.part; delete e.absorbCd; delete e.wholeMaxHp;
    events.push({ type: 'merged', uid: e.uid, monsterId: e.monsterId, name: e.name });
  }
}

function makeEnemy(monster, state, ctx, slot) {
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

/**
 * その階層の世界（stages.json）。from がその階層以下で一番大きい世界を返す。
 * 最後の世界より先の階層は、最後の世界のまま（世界を足すまで）。
 * world を渡すと、その世界（earth＝地球・moon＝月面。stages.json の world、書いていなければ地球）の中から選ぶ
 */
export function stageFor(floor, stages, world = 'earth') {
  let st = null;
  for (const s of stages || []) if (worldOf(s) === world && floor >= s.from && (!st || s.from > st.from)) st = s;
  return st;
}

/** 今いる階層の世界（地球の10階層ごとの世界か、月面） */
export const currentStage = (state, stages) => stageFor(state.adventure.floor, stages, state.adventure.world || 'earth');

/**
 * 最高到達地点（主人公のステータスに出す。40HzP の依頼）：この人生でいちばん深く進んだ地球の階層とその世界、月面の階層（行っていなければ0）。
 * best・bestMoon は、前世（legacy.lives）も含めたいちばん深い階層と、それが何世代目か（同じ深さなら先の世代）
 */
export function farthestReached(state, stages) {
  const floor = state.life.maxFloor || 1;
  const moon = state.life.moonMaxFloor || 0;
  const lives = [
    ...(state.legacy.lives || []).map((p) => ({ generation: p.generation, floor: p.maxFloor || 1, moon: p.moonFloor || 0 })),
    { generation: state.life.generation, floor, moon },
  ];
  const top = (k) => lives.reduce((a, p) => (p[k] > a[k] ? p : a));
  const best = top('floor'), bestMoon = top('moon');
  return {
    floor, stage: stageFor(floor, stages, 'earth'), moon,
    best: { floor: best.floor, generation: best.generation },
    bestMoon: { floor: bestMoon.moon, generation: bestMoon.generation },
  };
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
  // 月面を踏破した（月面の最後のボスを倒した）称号。知識なので生まれ変わっても残る
  ...(state.knowledge.moonCleared ? ctx.monsters.filter((m) => m.clear && m.clear.title).map((m) => m.clear.title) : []),
])];

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
  birthdays(state, ctx, events);
  payContracts(state, ctx, events);
  earnCompany(state, dt, ctx);
  settleTaxes(state, ctx, events);
  const fieldEvents = [];
  updateFields(state, ctx, fieldEvents);
  // 学際分野の休眠と復活も熟練の記録に残す（知らせは main.js が、専攻に入れているものだけ出す）
  for (const e of fieldEvents) if (e.type === 'fieldDormant' || e.type === 'fieldAwake') logProficiency(state, { field: e.name, reason: e.type === 'fieldDormant' ? 'dormant' : 'awake' });
  events.push(...fieldEvents);
  updateAuthorRights(state, ctx, events);
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
  const area = !!(r && r.role === 'all');
  const targets = area ? [...adv.enemies] : [adv.enemies[0]];
  for (const e of targets) {
    const dmg = isInvulnerable(state, e) ? 0 : calcDamage(atk, e.def, b, ctx.rng);
    hitEnemy(state, e, dmg, 'ally', ctx, events, { allyId: ally.id, area });
  }
}

/** 主人公の番：敵が2体以上いてMPが足りれば「ひらめき」で全体攻撃、そうでなければ先頭を攻撃 */
function heroAct(state, hs, ctx, events) {
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
function hitEnemy(state, e, dmg, by, ctx, events, extra = {}) {
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

function defeatEnemy(state, e, ctx, events) {
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
function restartFloor(state, floor, ctx) {
  const adv = state.adventure;
  stashScaffold(state, ctx);
  adv.floor = floor;
  adv.kills = 0;
  adv.enemies = [];
  for (const a of state.allies) delete a.sunk;
  adv.spawnTimer = spawnDelay(adv, ctx.balance);
}

/** HP・MPと仲間のHPを全回復する（誕生日・やられたとき・中ボスに挑むとき） */
function healAll(state, ctx) {
  const hs = heroStats(state, ctx);
  state.hero.hp = hs.maxHp;
  state.hero.mp = hs.maxMp;
  for (const a of state.allies) a.hp = a.maxHp;
}

/**
 * やられたとき：1つ手前の階層の最初からやり直し（1階層なら1階層の最初から）、全回復する（設計ページ「誕生日の熟練判定と階層の移動」）。
 * 熟練の判定はしない。強さ・装備・仲間はそのまま。一度倒したボスは出ない
 */
function heroDefeated(state, ctx, events) {
  const from = state.adventure.floor;
  restartFloor(state, Math.max(1, from - 1), ctx);
  healAll(state, ctx);
  events.push({ type: 'heroDefeated', from, floor: state.adventure.floor, world: state.adventure.world || 'earth' });
}

/* ================= 階層の移動 ================= */

/** 今いる世界で、この人生で到達した一番深い階層（地球は life.maxFloor、月面は life.moonMaxFloor） */
export const reachedFloor = (state) => Math.max(1, (onMoon(state) ? state.life.moonMaxFloor : state.life.maxFloor) || 1);

/**
 * 階層の移動の行き先：今いる世界の、この人生で到達した階層を、エリア（10階層ごと）に分けて返す。
 * 地球のエリアは10階層ごとの世界（stages.json。101階層から先は天空の神殿が10階層ずつ続く）、月面は月面の10階層ずつ。
 * エリアごとに、出るザコのうち図鑑でまだ出会っていない数（unmet）と、そのエリアのボスを付ける
 */
export function floorAreas(state, ctx) {
  const world = state.adventure.world || 'earth';
  const max = reachedFloor(state);
  const zk = state.knowledge.zukan;
  const met = (m) => (zk[m.id] || {}).stage >= 1;
  const zakoAll = ctx.monsters.filter((m) => m.kind === 'monster' && worldOf(m) === world);
  const areas = [];
  for (let from = 1; from <= max; from += 10) {
    const to = from + 9;
    const stage = world === 'earth' && ctx.stages ? stageFor(from, ctx.stages, 'earth') : null;
    let zako = stage ? zakoAll.filter((m) => (m.areas || []).includes(stage.name)) : zakoAll;
    if (!zako.length) zako = zakoAll;
    const boss = ctx.monsters.find((m) => m.kind === 'boss' && worldOf(m) === world && m.floor >= from && m.floor <= to) || null;
    areas.push({
      from, to, last: Math.min(to, max),
      name: stage ? stage.name : '月面',
      zako: zako.length, unmet: zako.filter((m) => !met(m)).length,
      boss: boss ? { id: boss.id, name: boss.name, floor: boss.floor, defeated: bossState(state, boss.id).status === 'defeated' } : null,
    });
  }
  return areas;
}

/**
 * この人生で到達した階層（今いる世界）に移動する。その階層の最初から始める（戦っていた群れや中ボスは退く）。
 * 一度倒したボスの階層は、ボスの代わりにその世界のザコが出る（いつもと同じ）
 */
export function moveToFloor(state, ctx, floor) {
  const f = Math.floor(floor);
  const max = reachedFloor(state);
  if (!(f >= 1 && f <= max)) return { ok: false, reason: `${onMoon(state) ? '月面' : ''}${max}階層より先には、まだ行ったことがない` };
  if (f === state.adventure.floor && !state.adventure.enemies.some((e) => e.kind === 'midboss')) return { ok: false, reason: `もう${onMoon(state) ? '月面' : ''}${f}階層にいる` };
  restartFloor(state, f, ctx);
  return { ok: true, floor: f, world: state.adventure.world || 'earth' };
}

/* ================= 足場（構造工学） ================= */

const STRUCTURAL = 'structural_engineering';

/** 今出ているボスに与えたダメージ（分かれたブンレツセツは、分かれた2体の残りのHPから） */
function bossDamage(state, monsterId) {
  const es = state.adventure.enemies.filter((e) => e.kind === 'boss' && e.monsterId === monsterId);
  if (!es.length) return 0;
  const whole = es[0].part ? es[0].wholeMaxHp : es[0].maxHp;
  return Math.max(0, whole - es.reduce((n, e) => n + Math.max(0, e.hp), 0));
}

/**
 * 足場を組む（構造工学を専攻にしていて休眠していないとき）：倒しきれずにボスの前を離れる（やられた・階層を移った・中ボスに挑んだ・ロケットで移った）とき、
 * 与えたダメージを覚えておく。次にそのボスが出たとき、そのダメージを受けた状態で出る（applyScaffold）
 */
function stashScaffold(state, ctx) {
  if (!fieldActive(state, ctx, STRUCTURAL)) return;
  for (const id of new Set(state.adventure.enemies.filter((e) => e.kind === 'boss').map((e) => e.monsterId))) {
    const dmg = bossDamage(state, id);
    if (dmg > 0) state.scaffold[id] = Math.max(state.scaffold[id] || 0, dmg);
  }
}

/** ボスが出たとき、足場に覚えたダメージを受けた状態にする（構造工学が働いているときだけ） */
function applyScaffold(state, ctx, e, events) {
  const dmg = state.scaffold[e.monsterId];
  if (!dmg || !fieldActive(state, ctx, STRUCTURAL)) return;
  e.hp = Math.max(1, e.maxHp - dmg);
  events.push({ type: 'scaffold', monsterId: e.monsterId, name: e.name, damage: Math.round(dmg), left: e.hp / e.maxHp });
}

/* ================= 誕生日 ================= */

/** 熟練の記録の件数の上限（新しい順に残す。1件はセーブで60字ほど） */
export const PROF_LOG_MAX = 200;

/**
 * 熟練の記録（knowledge.profLog）に1件足す。世代と年齢を付ける。
 * entry：{ genre, from, to, reason: 'study'（勉強で正解）| 'year'（この1年に勉強した）| 'cap'（上限に届いている）| 'idle'（years 年勉強していない） }
 * または { field: 学際分野の名前, reason: 'dormant'（休眠）| 'awake'（復活） }
 */
export function logProficiency(state, entry) {
  const log = state.knowledge.profLog || (state.knowledge.profLog = []);
  log.unshift({ gen: state.life.generation, age: ageYears(state), ...entry });
  if (log.length > PROF_LOG_MAX) log.length = PROF_LOG_MAX;
}

/**
 * 終わったばかりの人生（generation）の熟練の記録から、生まれ変わりの場面に流す数行を選ぶ（設計ページ「生まれ変わるたびの『前世の記憶をたどる』」の案）。
 * 古い順に、その人生の始まり・終わりを含めて均等に max 件まで（記録が無ければ空）
 */
export function lifeLogHighlights(state, generation, max = 4) {
  const life = (state.knowledge.profLog || []).filter((c) => c.gen === generation).reverse(); // 古い順
  if (life.length <= max) return life;
  const picks = [];
  for (let i = 0; i < max; i++) picks.push(life[Math.round((i * (life.length - 1)) / (max - 1))]);
  return picks;
}

/**
 * 誕生日（ゲーム内で1歳年を取るたび）：HP・MPを全回復し、ジャンルごとに熟練を判定し、学会の査読者の「要出典」の回数を戻す。
 * 熟練の判定（balance.birthday）：前の誕生日から勉強したジャンルは upChance で+1（上限に届いていれば上がらない）。
 * 勉強していないジャンルは、勉強していない年数（idle）が idleYears 以上で Lv1 以上なら downChance で−1。
 * 乱数はジャンルの並び順（GENRES）に、判定するジャンルごとに1回ずつ使う。変わったジャンルを返す（熟練の記録にも残す）
 */
export function birthday(state, ctx, events = []) {
  const b = ctx.balance.birthday;
  healAll(state, ctx);
  state.citationsUsed = 0;
  const cap = proficiencyCap(state, ctx.balance);
  const changes = [];
  for (const genre of GENRES) {
    const g = state.knowledge.genres[genre];
    if (!g) continue;
    if (g.studied) {
      g.idle = 0;
      if (ctx.rng() < b.upChance) {
        const c = g.level < cap ? { genre, from: g.level, to: g.level + 1, reason: 'year' } : { genre, from: g.level, to: g.level, reason: 'cap' };
        g.level = c.to;
        changes.push(c);
      }
    } else {
      g.idle = (g.idle || 0) + 1;
      if (g.level >= 1 && g.idle >= b.idleYears && ctx.rng() < b.downChance) {
        changes.push({ genre, from: g.level, to: g.level - 1, reason: 'idle', years: g.idle });
        g.level--;
      }
    }
    g.studied = false;
  }
  for (const c of changes) logProficiency(state, c);
  events.push({ type: 'birthday', age: ageYears(state), changes });
  barnBirthday(state, ctx, events); // 飼育小屋のザコの懐き度と、懐いたザコの贈り物
  return changes;
}

/** 年を取っていたら誕生日の処理をする（tick から。何歳か飛んだときは、その数だけ） */
function birthdays(state, ctx, events) {
  const age = ageYears(state);
  if (!(state.life.birthday >= 0)) state.life.birthday = age;
  while (state.life.birthday < age) {
    state.life.birthday++;
    birthday(state, ctx, events);
  }
}

/* ================= パーティー ================= */

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

/* ================= 作問権 ================= */

/**
 * 作問権（設計ページ「作問権（いずれか2ジャンルをLv5）：そのジャンルの作問申請ができる。腕のある人だけが投稿するので審査の負担も減る」）。
 * 熟練が balance.authoring.rightsLevel（5）以上のジャンルが rightsGenres（2）つそろうと作問権がもらえ、Lv5 以上のジャンルの問題を作って送れる。
 * そのあと Lv5 に届いたジャンルも足していく。一度もらったジャンルは、誕生日の判定で熟練が下がっても残る（knowledge なので生まれ変わっても残る）。
 * 新しくもらったら authorRights（first：はじめての作問権）
 */
export function updateAuthorRights(state, ctx, events) {
  const a = ctx.balance.authoring;
  const k = state.knowledge;
  const high = GENRES.filter((g) => (k.genres[g] || { level: 0 }).level >= a.rightsLevel);
  const first = k.authorGenres.length === 0;
  if (first && high.length < a.rightsGenres) return;
  const added = high.filter((g) => !k.authorGenres.includes(g));
  if (!added.length) return;
  k.authorGenres.push(...added);
  events.push({ type: 'authorRights', genres: added, first });
}

/** 作問権の進み具合：持っているか・作問できるジャンル・熟練の高いジャンル（作問権がまだ無いときの目安） */
export function authorRightsInfo(state, ctx) {
  const a = ctx.balance.authoring;
  const k = state.knowledge;
  const levels = GENRES.map((g) => ({ genre: g, level: (k.genres[g] || { level: 0 }).level })).filter((x) => x.level > 0).sort((x, y) => y.level - x.level);
  return { granted: k.authorGenres.length > 0, genres: [...k.authorGenres], need: a.rightsGenres, level: a.rightsLevel, reached: levels.filter((x) => x.level >= a.rightsLevel).length, top: levels.slice(0, 5) };
}

/* ================= 顧問（仲間にした中ボス） ================= */

/**
 * 仲間にした中ボスは、街の施設に「顧問」として置ける（設計ページ「仲間にした後の役目（顧問）」。40HzP の依頼）。
 * 置いている間はパーティーから外れて戦わない。効果は1人1つで、置く場所は中ボスごとに決まっている（monsters.json の advisor.place）。
 * 場所ごとに置ける人数は balance.advisor.slots。advisor.soon のある中ボス（税務調査官）は、その仕組みができるまで置けない
 */
export const ADVISOR_PLACES = { school: '学校', lab: '研究室', company: '会社', rocket: 'ロケット発射場' };
export const advisorDef = (ctx, id) => (ctx.monsters.find((m) => m.id === id) || {}).advisor || null;
export const advisorSlots = (ctx, place) => (ctx.balance.advisor.slots || {})[place] || 0;
/** その場所に顧問として置いている仲間 */
export const advisorsAt = (state, ctx, place) => state.allies.filter((a) => a.advisor && (advisorDef(ctx, a.id) || {}).place === place);
/** 中ボスだった仲間（id）を顧問に置いていて、効果が出ているか */
export const advisorActive = (state, ctx, id) => {
  const d = advisorDef(ctx, id);
  return !!d && !d.soon && state.allies.some((a) => a.id === id && a.advisor && !a.hired);
};

/**
 * 中ボスだった仲間を顧問に置く（on=true）・顧問をやめさせる（on=false）。いつでも何度でも変えられる。
 * 置くとパーティーから外れる。やめさせると、パーティーに空きがあればパーティーに、なければ控えに戻る
 */
export function setAdvisor(state, id, on, ctx) {
  const ally = state.allies.find((a) => a.id === id && !a.hired);
  if (!ally) return { ok: false, reason: '中ボスだった仲間ではありません' };
  const d = advisorDef(ctx, id);
  if (!d) return { ok: false, reason: `${ally.name}は顧問にならない` };
  if (!on) {
    if (!ally.advisor) return { ok: false, reason: `${ally.name}は顧問ではありません` };
    delete ally.advisor;
    if (partyFull(state, ctx)) ally.benched = true;
    else delete ally.benched;
    return { ok: true, benched: !!ally.benched };
  }
  if (ally.advisor) return { ok: false, reason: `${ally.name}はもう顧問にいる` };
  if (d.soon) return { ok: false, reason: `${ally.name}の${d.role}は、${d.soon}置ける` };
  const place = ADVISOR_PLACES[d.place];
  if (advisorsAt(state, ctx, d.place).length >= advisorSlots(ctx, d.place)) return { ok: false, reason: `${place}の顧問の枠がいっぱい（今の顧問をやめさせてから置く）` };
  delete ally.benched;
  ally.advisor = true;
  return { ok: true, place };
}

/** 就職面接官（会社の顧問）の人事：社員の効果に掛ける倍率 */
export const hrFactor = (state, ctx) => 1 + (advisorActive(state, ctx, 'interviewer') ? ctx.balance.advisor.hrStaffBonus : 0);

/** ロケットの建造費。政治家（ロケット発射場の顧問）の補助金で balance.advisor.rocketSubsidy の分だけ安くなる */
export const rocketBuildCost = (state, ctx) =>
  Math.round(ctx.balance.rocket.buildCost * (1 - (advisorActive(state, ctx, 'politician') ? ctx.balance.advisor.rocketSubsidy : 0)));

/** 学会の査読者（研究室の顧問）の「要出典」が、次の誕生日までにあと何回使えるか */
export const citationsLeft = (state, ctx) => Math.max(0, ctx.balance.advisor.citationsPerYear - (state.citationsUsed || 0));

/** 次に戦うボス（今いる世界で、この人生でまだ倒していないボスのうち、いちばん手前の階層）。大学教授（研究室の顧問）の予習で使う */
export function nextBoss(state, ctx) {
  const world = state.adventure.world || 'earth';
  return ctx.monsters.filter((m) => m.kind === 'boss' && worldOf(m) === world && bossState(state, m.id).status !== 'defeated')
    .sort((a, b) => a.floor - b.floor)[0] || null;
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

/** 社員1人がその会社の利益を増やす割合（基本×質の bonusMultiplier×業種のよく効く社員なら specialtyMultiplier×人事の倍率 hr（hrFactor）） */
export function staffBonus(ctx, ind, id, grade, hr = 1) {
  const r = recruitById(ctx, id);
  const special = ind && ind.specialty === id;
  return (r ? r.profitBonus || 0 : 0) * gradeOf(ctx, grade).bonusMultiplier * (special ? ind.specialtyMultiplier : 1) * hr;
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
 * 利益＝業種の monthlyProfit ×（1＋社員の staffBonus の合計）×（1＋関係するジャンルの熟練Lvの合計×genreBonusPerLevel）×世代の倍率。
 * 就職面接官を会社の顧問に置いていると、社員の効果が人事の倍率（hrFactor）だけ大きくなる。
 * 法人化した会社（法と経済学）は、さらに ×（1＋balance.corporation.profitBonus）。そのかわり毎年の決算で法人税を払う（settleTaxes）
 */
export function companyProfit(state, company, ctx) {
  const ind = industryById(ctx, company.industry);
  if (!ind) return null;
  const hr = hrFactor(state, ctx);
  const staff = company.staff.map((st) => {
    const r = recruitById(ctx, st.id);
    if (!r) return null;
    return { id: r.id, name: r.name, grade: st.grade, gradeName: gradeOf(ctx, st.grade).name, bonus: staffBonus(ctx, ind, st.id, st.grade, hr), special: ind.specialty === r.id };
  }).filter(Boolean);
  const bonus = staff.reduce((sum, x) => sum + x.bonus, 0);
  const genreLevels = ind.genres.reduce((sum, g) => sum + genreLevel(state, g), 0);
  const genreBonus = genreLevels * ctx.business.genreBonusPerLevel;
  const gm = generationMultiplier(state, ctx.balance);
  const corpBonus = company.corp ? ctx.balance.corporation.profitBonus : 0;
  return { company, industry: ind, base: ind.monthlyProfit, staff, staffBonus: bonus, genreLevels, genreBonus, corpBonus, generation: gm, total: Math.round(ind.monthlyProfit * (1 + bonus) * (1 + genreBonus) * (1 + corpBonus) * gm) };
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
  const staff = (ctx.recruits || []).filter((r) => isStaff(r) && perBonus * staffBonus(ctx, ind, r.id, grade, hrFactor(state, ctx)) > staffCost(ctx, r.id, grade));
  const p = companyProfit(state, { industry: ind.id, staff: staff.map((r) => ({ id: r.id, grade })) }, ctx);
  const cost = staff.reduce((sum, r) => sum + staffCost(ctx, r.id, grade), 0);
  const net = p.total - cost;
  return { grade, staff: staff.map((r) => r.name), profit: p.total, cost, net, paybackMonths: net > 0 ? ind.cost / net : null };
}

/** 全部の会社の利益（1か月あたり）。companies は会社ごとの内訳、corpTotal は法人化した会社の利益の合計 */
export function companiesProfit(state, ctx) {
  const companies = state.companies.map((c) => companyProfit(state, c, ctx)).filter(Boolean);
  return { companies, total: companies.reduce((sum, p) => sum + p.total, 0), corpTotal: companies.reduce((sum, p) => sum + (p.company.corp ? p.total : 0), 0) };
}

/**
 * 会社の利益は時間がたつと少しずつ入る（1か月で companiesProfit().total）。
 * 法人化した会社の利益は、決算で法人税を計算するために今年の分をためておく。払いきれなかった法人税があれば、会社の利益から先に払う
 */
function earnCompany(state, dt, ctx) {
  if (!state.companies.length) return;
  const all = companiesProfit(state, ctx);
  const months = (dt * ctx.balance.time.gameHoursPerRealSecond) / HOURS_PER_MONTH;
  let income = all.total * months;
  state.tax.earned += all.corpTotal * months;
  if (state.tax.owed > 0) {
    const pay = Math.min(state.tax.owed, income);
    state.tax.owed -= pay;
    income -= pay;
  }
  state.gold += income;
}

/* ---------- 法人化と法人税（法と経済学。設計ページ「会社を法人化できる。収益が上がる代わりに税金イベントが起きる」） ---------- */

export const LAW_ECONOMICS = 'law_economics';

/** 会社を法人化できるか：法と経済学（学際分野）を専攻にしていて休眠していない */
export const canIncorporate = (state, ctx) => fieldActive(state, ctx, LAW_ECONOMICS);

/**
 * 会社を法人化する（費用なし・やめられない）。法人化した会社は利益が balance.corporation.profitBonus だけ増え、
 * 毎年の決算で法人税を払う。法人化したあとで法と経済学を専攻から外しても、法人のまま
 */
export function incorporate(state, uid, ctx) {
  const c = companyByUid(state, uid);
  if (!c) return { ok: false, reason: '会社がありません' };
  if (c.corp) return { ok: false, reason: 'もう法人化している' };
  if (!canIncorporate(state, ctx)) return { ok: false, reason: `${(fieldById(ctx, LAW_ECONOMICS) || {}).name}を専攻にすると法人化できる` };
  c.corp = true;
  c.incorporatedAt = state.life.gameHours;
  return { ok: true };
}

/**
 * 法人税：今年の法人の利益（earned）× balance.corporation.taxRate。
 * 税務調査官を会社の顧問に置いていると、税務顧問として取られる額が balance.advisor.taxCut だけ減る。{ full, tax, saved }
 */
export function corporateTax(state, ctx, earned = state.tax.earned) {
  const full = Math.round(earned * ctx.balance.corporation.taxRate);
  const cut = advisorActive(state, ctx, 'tax_inspector') ? ctx.balance.advisor.taxCut : 0;
  const tax = Math.round(full * (1 - cut));
  return { full, tax, saved: full - tax };
}

/**
 * 決算（税金イベント）：年齢が1つ上がるたびに、今年の法人の利益にかかる法人税を払う。
 * 足りなければ払えるだけ払い、残りは払いきれなかった法人税（tax.owed）として、このあとの会社の利益から先に払う
 */
export function settleTaxes(state, ctx, events) {
  const year = ageYears(state);
  if (year <= state.tax.year) return;
  state.tax.year = year;
  const earned = state.tax.earned;
  state.tax.earned = 0;
  if (earned <= 0) return;
  const { tax, saved } = corporateTax(state, ctx, earned);
  const paid = Math.min(Math.max(0, state.gold), tax);
  state.gold -= paid;
  state.tax.owed += tax - paid;
  events.push({ type: 'taxPaid', age: year, earned: Math.round(earned), tax, paid, owed: tax - paid, saved });
}

/* ================= ロケット計画 ================= */

/**
 * ロケット計画の工程（fields.json の rocketSteps：機体設計・エンジン・軌道計算・打ち上げ許可）。
 * 打ち上げに失敗すると、redoOnFailure の工程（エンジン・推進剤）が0に戻る（launchRocket）。
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
 * ロケットの建造費（balance.rocket.buildCost。政治家の補助金があれば rocketBuildCost）を払う。払った工程は転生しても残る（設計ページ「工程ごとに完了を保存する」）
 */
export function payRocketBuildCost(state, ctx) {
  const cost = rocketBuildCost(state, ctx);
  if (state.legacy.rocket.buildCostPaid) return { ok: false, reason: 'もう建造費は払った' };
  if (state.gold < cost) return { ok: false, reason: 'ゴールドが足りません' };
  state.gold -= cost;
  state.legacy.rocket.buildCostPaid = true;
  return { ok: true, cost };
}

/** 打ち上げの成功率が見えるか：確率論（学際分野）を専攻にしていて休眠していない（設計ページ「確率論があれば成功率が見える」） */
export const launchRateVisible = (state, ctx) => fieldActive(state, ctx, 'probability');

/**
 * 本番の打ち上げの成功率：balance.rocket.launchSuccessRate に、試作機で上がった分（legacy.rocket.rateBonus）を足す。
 * 上限は balance.rocket.launchSuccessRateMax
 */
export const launchSuccessRate = (state, ctx) => {
  const r = ctx.balance.rocket;
  return Math.min(r.launchSuccessRateMax, r.launchSuccessRate + (state.legacy.rocket.rateBonus || 0));
};

/**
 * ロケットを打ち上げられるか：建造費を払い、すべての工程が終わっていて、地球にいる。
 * { ok, reason, successRate, rateVisible }（成功率は launchSuccessRate）
 */
export function launchInfo(state, ctx) {
  const r = ctx.balance.rocket;
  const left = rocketSteps(state, ctx).filter((st) => !st.done);
  let reason = null;
  if (onMoon(state)) reason = 'もう月面にいる';
  else if (!state.legacy.rocket.buildCostPaid) reason = '建造費を払うと打ち上げられる';
  else if (left.length) reason = `まだ終わっていない工程：${left.map((st) => st.name).join('・')}`;
  return { ok: !reason, reason, successRate: launchSuccessRate(state, ctx), rateVisible: launchRateVisible(state, ctx) };
}

/**
 * 打ち上げる（地球 → 月面）。打ち上げは無料（建造費は一度払えばよい）。
 * 成功すると月面の階層へ（前に月面にいたら、その階層から）。失敗すると、rocketSteps の redoOnFailure の工程
 * （エンジン・推進剤）だけやり直しになり、地球に残る（設計ページ「失敗するとエンジン・推進剤の工程だけやり直し」）
 */
export function launchRocket(state, ctx) {
  const info = launchInfo(state, ctx);
  if (!info.ok) return { ok: false, reason: info.reason };
  if (ctx.rng() >= info.successRate) {
    const redo = ((ctx.fields && ctx.fields.rocketSteps) || []).filter((st) => st.redoOnFailure);
    for (const st of redo) state.legacy.rocket.steps[st.id] = 0;
    return { ok: true, success: false, redo: redo.map((st) => st.name) };
  }
  goToWorld(state, ctx, 'moon');
  return { ok: true, success: true, floor: state.adventure.floor };
}

/** 月面の街の帰還ロケットで地球に帰る（無料で、いつでも、必ず帰れる）。地球は打ち上げた階層から */
export function returnToEarth(state, ctx) {
  if (!onMoon(state)) return { ok: false, reason: 'もう地球にいる' };
  goToWorld(state, ctx, 'earth');
  return { ok: true, floor: state.adventure.floor };
}

/* ================= 飼育小屋と試作機 ================= */

/** 飼育小屋の場所：地球のザコは飼育小屋（earth）、月面のザコは月面の飼育ドーム（moon） */
export const BARN_NAMES = { earth: '飼育小屋', moon: '月面の飼育ドーム' };

const monsterById = (ctx, id) => ctx.monsters.find((m) => m.id === id) || null;

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
function barnBirthday(state, ctx, events) {
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

/**
 * 地球と月面を行き来する。今いる世界の階層を取っておき、行き先の世界の取っておいた階層の最初から始める
 * （月面は初めてなら1階層）。戦っていた群れや中ボスは退く
 */
function goToWorld(state, ctx, world) {
  const adv = state.adventure;
  if (world === 'moon') {
    adv.earthFloor = adv.floor;
    adv.world = 'moon';
    restartFloor(state, adv.moonFloor || 1, ctx);
    state.life.moonMaxFloor = Math.max(state.life.moonMaxFloor || 0, adv.floor);
  } else {
    adv.moonFloor = adv.floor;
    adv.world = 'earth';
    restartFloor(state, adv.earthFloor || 1, ctx);
    adv.earthFloor = null;
  }
}

/* ================= 店 ================= */

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
const itemPower = (item) => (item ? ITEM_STATS.reduce((n, k) => n + (item[k] || 0), 0) + (item.effects ? 1e9 : 0) : -Infinity);

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

/* ================= 最初の3分（設計ページ「最初の3分：あなたの誤解が魔物になる」） ================= */
// 前世の記憶をたどる（前の名前は常識チェック）の出題と答えは quiz.js（beginFirstRun・answerFirstCheck）。ここは冒険のほう

/** 覚えたザコ（前世で魔物に吹き込まれた噂）を優先して出すのは、その人生の地球のこの階層まで */
export const FIRST_LIFE_FLOORS = 10;

/**
 * 前世の記憶をたどるで覚えたザコ（前世で魔物に吹き込まれた噂）：正解しなかった問題のザコ（答えた順。{ monster, believed }）。
 * believed は誤答1（その魔物の噂そのもの）を選んだとき。誤答2・3と時間切れは false（どれも噂として出る）
 */
export function rememberedZako(state, ctx) {
  const check = state.firstRun && state.firstRun.check;
  const out = [];
  for (const a of (check && check.answers) || []) {
    if (a.kind === 'correct' || !a.monsterId || out.some((x) => x.monster.id === a.monsterId)) continue;
    const m = ctx.monsters.find((x) => x.id === a.monsterId);
    if (m) out.push({ monster: m, believed: a.kind === 'myth' });
  }
  return out;
}

/** 今いる場所で覚えたザコを出すか（前世の記憶をたどった人生の、地球の1〜10階層。生まれ変わるたびに入れ替わる） */
function rememberedHere(state, ctx) {
  const adv = state.adventure;
  const check = state.firstRun && state.firstRun.check;
  if (!check || (check.generation || 1) !== state.life.generation || worldOf(adv) !== 'earth' || adv.floor > FIRST_LIFE_FLOORS) return [];
  return rememberedZako(state, ctx);
}

/**
 * ザコの群れを選ぶ。最初の人生の1〜10階層では、前世の記憶をたどるで覚えたザコのうちまだ出していないものを先頭に並べ、
 * 残りは今いる世界のザコ（と覚えたザコ）から選ぶ。出したザコは introduced に入れ、misbelief に積む
 */
function pickZakoGroup(state, ctx, n, misbelief) {
  const remembered = rememberedHere(state, ctx);
  const pool = zakoPool(state, ctx);
  for (const r of remembered) if (!pool.includes(r.monster)) pool.push(r.monster);
  const list = [];
  for (const r of remembered) {
    if (list.length >= n || state.firstRun.introduced.includes(r.monster.id)) continue;
    state.firstRun.introduced.push(r.monster.id);
    list.push(r.monster);
    misbelief.push(r);
  }
  while (list.length < n && pool.length) list.push(pool[Math.floor(ctx.rng() * pool.length)]);
  return list;
}

/**
 * 前世の記憶をたどるで間違えた問題のザコを、答えてすぐ今の群れに出す（ザコの群れと戦っている最中に答えたとき。デバッグの「前世の記憶をたどり直す」など）。
 * 最初の人生の1〜10階層で、ザコの群れと戦っているときだけ。そのザコがもう群れにいればそれに印を付け、
 * いなければ群れのいちばん後ろのザコ（先頭以外）と入れ替える（強さは同じ階層の強さで、HPは満タン）。
 * 入れ替えられる相手がいなければ（先頭の1体だけ）、次の群れの先頭で出る（pickZakoGroup）。出したザコを misbelief の知らせに積む
 */
export function summonRemembered(state, ctx, events) {
  const adv = state.adventure;
  if (!state.firstRun || !adv.enemies.length || adv.enemies.some((e) => e.kind !== 'monster' || e.minion)) return [];
  const introduced = state.firstRun.introduced;
  const out = [];
  for (const r of rememberedHere(state, ctx)) {
    if (introduced.includes(r.monster.id)) continue;
    let e = adv.enemies.find((x) => x.monsterId === r.monster.id);
    let swapped = false;
    if (!e) {
      let i = adv.enemies.length - 1;
      while (i > 0 && introduced.includes(adv.enemies[i].monsterId)) i--;
      if (i <= 0) break;
      const old = adv.enemies[i];
      e = makeEnemy(r.monster, state, ctx, old.slot);
      e.cd = old.cd;
      adv.enemies[i] = e;
      raiseZukan(state, e.monsterId, 1, events);
      swapped = true;
    }
    introduced.push(r.monster.id);
    events.push({ type: 'misbelief', monsterId: r.monster.id, name: r.monster.name, myth: r.monster.myth, believed: r.believed, uid: e.uid, slot: e.slot, swapped });
    out.push(e);
  }
  return out;
}

/** 図鑑のザコ（地球と月面）のうち、正体まで開いた数と全数（初めてザコを倒したときの「1／171」） */
export function zakoZukanCount(state, ctx) {
  const zako = ctx.monsters.filter((m) => m.kind === 'monster');
  const z = state.knowledge.zukan;
  return { opened: zako.filter((m) => (z[m.id] || {}).stage >= 2).length, total: zako.length };
}

/** 寿命の帯（数字は出さない。40HzP の依頼）：今の年齢（誕生日ごとに1つ進む）と寿命（治療で延びた分も） */
export function lifeBar(state, balance) {
  const lifespan = lifespanOf(state, balance);
  return { age: Math.min(ageYears(state), lifespan), lifespan };
}

/**
 * 経験値の帯（40HzP の依頼「寿命バーと同じように、次のレベルまでに必要な量がわかるバー」）：
 * 今のレベルでためた経験値 exp・次のレベルまでに要る量 need・あと rest・たまった割合 ratio（0〜1）
 */
export function expBar(state, balance) {
  const need = expToNext(state.hero.level, balance);
  const exp = Math.max(0, Math.min(state.hero.exp, need));
  return { level: state.hero.level, exp, need, rest: need - exp, ratio: exp / need };
}

/**
 * 起動したときの主人公を覚えておく（起動から3分で「今」と比べる。40HzP の依頼で毎回）。
 * floor・moonFloor はこの人生の最高到達、zukan は図鑑に載った（出会った）魔物の数、correct は累計の正解数
 */
export function heroSnapshot(state, ctx) {
  const hs = heroStats(state, ctx);
  return {
    generation: state.life.generation, level: state.hero.level,
    maxHp: hs.maxHp, maxMp: hs.maxMp, atk: hs.atk, def: hs.def, wis: hs.wis,
    floor: state.life.maxFloor, moonFloor: state.life.moonMaxFloor || 0,
    zukan: Object.values(state.knowledge.zukan).filter((e) => e.stage >= 1).length,
    correct: state.knowledge.totalCorrect,
    barn: Object.fromEntries((state.legacy.barn || []).map((a) => [a.id, a.affinity || 0])), // 飼育小屋のザコの懐き度
  };
}

const SNAPSHOT_ROWS = [
  ['level', 'Lv'], ['maxHp', 'HP'], ['maxMp', 'MP'], ['atk', '攻撃'], ['def', '防御'], ['wis', '賢さ'],
  ['floor', '最高到達'], ['moonFloor', '最高到達（月面）'],
];

/**
 * 起動したとき（before）と今（after）を比べる：伸びたものだけ（{ key, label, from, to }）と、図鑑に加わった数・正解した数・
 * 懐き度が上がったザコ（affinity：{ id, gain } の上がった量の多い順。起動したあとに小屋に入ったザコは0から数える）。
 * 間に生まれ変わっていたら比べられない（null）
 */
export function compareSnapshots(before, after) {
  if (!before || !after || before.generation !== after.generation) return null;
  const rows = SNAPSHOT_ROWS.filter(([k]) => after[k] > before[k]).map(([key, label]) => ({ key, label, from: before[key], to: after[key] }));
  const was = before.barn || {};
  const affinity = Object.entries(after.barn || {})
    .map(([id, v]) => ({ id, gain: Math.floor(v) - Math.floor(was[id] || 0) }))
    .filter((x) => x.gain > 0)
    .sort((x, y) => y.gain - x.gain);
  return { rows, zukan: Math.max(0, after.zukan - before.zukan), correct: Math.max(0, after.correct - before.correct), affinity };
}
