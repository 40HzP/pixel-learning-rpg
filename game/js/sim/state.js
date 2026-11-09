// ゲームの計算：状態（新しいゲームの状態・名前・開始年齢）

import { HOURS_PER_YEAR, DEFAULT_HERO_NAME, HERO_NAME_MAX, GENDERS } from './core.js';
import { heroStats } from './stats.js';
import { birthday } from './birthday.js';

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
