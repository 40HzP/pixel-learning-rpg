// ゲームの計算：散歩の要素（設計ページ「散歩の要素」2026-11-20）。
// ① 前世の足跡：前世の最高階層に石碑。通りかかると立ち止まり、越えると「前世の自分を追い越した」。
// ② 歩いた距離：階層を歩き切るごとに数える（強さには効かない。記録として眺める）。
// ③ 道端のもの：問題リストの「道端」を書いた問題（questions.json の roadside）が、その世界の道端に出る。正解すると散歩帳に載る。
// どれも攻略を遅らせず、強さ・ゴールド・経験値に効かない（設計ページのとおり）

import { onMoon, currentStage } from './world.js';
import { spawnDelay } from './battle.js';

/* ---------- ① 前世の足跡（石碑） ---------- */

/**
 * 今の世界に置く石碑：直近 walk.steleLives 人の前世（legacy.lives の後ろから）の最高階層に1つずつ。
 * 地球は maxFloor、月面は moonFloor（月面に行っていない前世の石碑は月面に置かない）。
 * 全部の前世ではなく直近の数人にしたのは、何世代も生まれ変わると最初の数分で古い石碑を次々に通り過ぎるため（Claude Code の判断）
 */
export function steles(state, ctx, world = state.adventure.world || 'earth') {
  const n = ctx.balance.walk.steleLives;
  return (state.legacy.lives || []).slice(-n).map((p) => ({
    key: `${world}:${p.generation}`, world, generation: p.generation, name: p.name, age: p.age,
    floor: world === 'moon' ? p.moonFloor || 0 : p.maxFloor || 1,
  })).filter((st) => st.floor >= 1);
}

/**
 * 階層を歩き始めた（次の階層に進んだ・やられて1つ手前からやり直した・階層を移動した・地球と月面を行き来した）：
 * その階層に石碑があれば、群れを出す前に walk.steleStopSec 秒立ち止まる（adventure.stop。idleStep が数える）。無ければ立ち止まりを消す
 */
export function arriveFloor(state, ctx) {
  const adv = state.adventure;
  const here = steles(state, ctx).filter((st) => st.floor === adv.floor);
  adv.stop = here.length ? { kind: 'stele', sec: ctx.balance.walk.steleStopSec, started: false, steles: here } : null;
}

/**
 * 群れのいない間に呼ぶ：石碑の前で立ち止まっていれば、時間を数えて true（次の群れを出さない）。
 * 立ち止まり始めに stele、終わりに steleDone を events に積む。終わったら、次の群れは攻撃の拍に合わせて出す
 */
export function walkPause(state, dt, ctx, events) {
  const adv = state.adventure;
  const st = adv.stop;
  if (!st) return false;
  if (!st.started) {
    st.started = true;
    events.push({ type: 'stele', world: adv.world || 'earth', floor: adv.floor, steles: st.steles });
  }
  st.sec -= dt;
  if (st.sec > 0) return true;
  adv.stop = null;
  adv.spawnTimer = spawnDelay(adv, ctx.balance);
  events.push({ type: 'steleDone' });
  return false;
}

/* ---------- ② 歩いた距離 ---------- */

/** 歩き切った階層の数 → km */
export const walkKm = (floors, balance) => Math.round((floors || 0) * balance.walk.kmPerFloor);

/** この人生で歩いた距離と、歴代の合計（前世の分＋この人生の分）。km */
export function walkedKm(state, ctx) {
  const b = ctx.balance;
  const life = state.life.walkedFloors || 0;
  return { life: walkKm(life, b), total: walkKm((state.legacy.walkedFloors || 0) + life, b) };
}

/**
 * 距離の身近なたとえ（設計ページ「歩いた距離」の案：東京〜大阪の直線で約400km、地球1周で約4万km、月まで約38万km）。
 * 東京〜大阪に届くまでは残りの距離、地球1周までは東京〜大阪の何倍か、月までは地球何周分か、その先は月まで何回分か
 */
export function likenDistance(km, balance) {
  const w = balance.walk;
  const { tokyoOsaka, earth } = w.likenKm;
  const num = (x) => (x >= 10 ? String(Math.round(x)) : x.toFixed(1).replace(/\.0$/, ''));
  if (km < tokyoOsaka) return `東京〜大阪の直線（約${tokyoOsaka}km）まで、あと${tokyoOsaka - km}km`;
  if (km < earth) return `東京〜大阪の直線の約${num(km / tokyoOsaka)}倍`;
  if (km < w.moonKm) return `地球${num(km / earth)}周分（月までは約${Math.round(w.moonKm / 10000)}万km）`;
  return `歩いて月まで行ける距離の約${num(km / w.moonKm)}倍`;
}

/**
 * 1階層を歩き切った（floorUp。やられてやり直した分も歩いたので数える。階層の移動では呼ばない）：
 * 歩いた距離を足し、歴代の合計が月まで（walk.moonKm）に届いたら一度だけ walkedToMoon（称号 walk.moonTitle）。
 * 越えた階層に石碑があれば、その石碑ごとに一度だけ steleOvertaken（前世の自分を追い越した）
 */
export function walkFloor(state, ctx, events, passedFloor) {
  const b = ctx.balance;
  state.life.walkedFloors = (state.life.walkedFloors || 0) + 1;
  if (!state.legacy.moonWalk && walkedKm(state, ctx).total >= b.walk.moonKm) {
    state.legacy.moonWalk = true;
    events.push({ type: 'walkedToMoon', km: walkedKm(state, ctx).total, title: b.walk.moonTitle });
  }
  const passed = state.life.stelesPassed || (state.life.stelesPassed = []);
  for (const st of steles(state, ctx)) {
    if (st.floor !== passedFloor || passed.includes(st.key)) continue;
    passed.push(st.key);
    events.push({ type: 'steleOvertaken', ...st });
  }
}

/* ---------- ③ 道端のもの（散歩帳） ---------- */

/** 道端に出る問題（questions.json の roadside を持つ問題）。world を渡すと、その世界（10階層ごとの世界の名前）の分だけ */
export const roadsideQuestions = (ctx, world = null) => ctx.questions.filter((q) => q.roadside && (!world || q.roadside.world === world));

/** 前世の記憶をたどるの5問をまだ答え終わっていないか（その間は道端の物を出さない。白い紙が重なるため） */
function recallPending(state) {
  const c = state.firstRun && state.firstRun.check;
  return !!c && (c.generation || 1) === state.life.generation && c.answers.length < c.questions.length;
}

/**
 * 道端の物を出すか決める（階層を歩き切って次の階層に進んだときに、冒険画面が呼ぶ。rng は乱数）：
 * 地球の、道端の物がある世界で、walk.roadsideChance の確率。石碑の前で立ち止まる階層と、前世の記憶をたどるの間は出さない。
 * 出すときはその世界の問題から1問（まだ散歩帳に載っていない物を先に）。出さなければ null。
 * 冒険は止めない（主人公は戦い続ける。攻略を遅らせないため）
 */
export function pickRoadside(state, ctx, rng) {
  if (onMoon(state) || state.adventure.stop || recallPending(state)) return null;
  const stage = currentStage(state, ctx.stages);
  const list = stage ? roadsideQuestions(ctx, stage.name) : [];
  if (!list.length || rng() >= ctx.balance.walk.roadsideChance) return null;
  const fresh = list.filter((q) => !inWalkBook(state, q.id));
  const pool = fresh.length ? fresh : list;
  return pool[Math.floor(rng() * pool.length)] || null;
}

/** 散歩帳に載っているか */
export const inWalkBook = (state, id) => (state.knowledge.walkBook || []).some((x) => x.id === id);

/** 散歩帳に載せる（道端の問題に正解したとき。知識なので生まれ変わっても残る）。新しく載ったら true */
export function addToWalkBook(state, id) {
  const book = state.knowledge.walkBook || (state.knowledge.walkBook = []);
  if (book.some((x) => x.id === id)) return false;
  book.push({ id, generation: state.life.generation, gameHours: Math.floor(state.life.gameHours) });
  return true;
}

/**
 * 散歩帳の頁：道端に出るすべての物を、世界の順（stages.json の並び）に。載っているものは found（何世代目に見つけたか）。
 * 同期で外れた問題は出さない
 */
export function walkBookPages(state, ctx) {
  const order = (ctx.stages || []).map((s) => s.name);
  const rank = (w) => (order.includes(w) ? order.indexOf(w) : order.length);
  const book = new Map((state.knowledge.walkBook || []).map((x) => [x.id, x]));
  return roadsideQuestions(ctx)
    .map((q) => ({ question: q, name: q.roadside.name, world: q.roadside.world, found: book.get(q.id) || null }))
    .sort((a, b) => rank(a.world) - rank(b.world));
}
