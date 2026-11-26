// ゲームの計算：毎日変わるものと日記（設計ページ「毎日変わるものと日記（2026-11-26）」）。
// ① 日付：日本時間の朝4時で切り替える（40HzP の判断）。夜更かしして0時をまたいでも、寝るまでが「今日」のまま。
// ② 七十二候と二十四節気：太陽の位置（黄経）から、その日の候を決める（data/seasons.json）。祝日・行事・月の満ち欠けも計算で出す。
// ③ 今日の道端：日付から決まる数で、その日の散歩道の天気と、世界ごとの「今日の道端のもの」が決まる（全員が同じ日に同じものを見る）。
// ④ 日記：散歩帳の日付の頁。起きたこと（events）をデータで残し、見るときに文章にする（あとから言い回しを変えても過去の日記がまとめて直る）。
//    自動の行は4行まで（散歩道の天気・ゲームの中の出来事2行・現実と共有している手がかり1行）。遊ぶ人に問いかけない（40HzP の判断）。
//    自由入力（今日のこと）はセーブと同じ所に残り、外へは送らない。現実の日付の記録なので、生まれ変わっても残る（legacy.diary）。
// 強さ・ゴールド・経験値には効かない。開かなかった日の頁は作らない（空白の頁を見せない）
//
// ctx.seasons = data/seasons.json。時刻は Date（端末の時計）で受け取るが、日付と時間はいつも日本時間で数える

import { onMoon, currentStage, stageFor } from './world.js';
import { roadsideQuestions, walkKm, walkerEntry } from './walk.js';

/* ---------- ① 日付（日本時間の朝4時で切り替え） ---------- */

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const JST = 9;            // 日本時間は世界時（UTC）の9時間先
const DAY_START_HOUR = 4; // この時刻（日本時間）で日付が変わる
const SESSION_GAP_MS = 10 * 60_000; // これより長く離れていたら、別の回に遊んだことにする（「3回に分けて歩いた」）
const NOTES_MAX = 40;     // 1日の頁に残す出来事の数の上限（多すぎるとセーブが大きくなる）
const VISITS_MAX = 12;
const TEXT_MAX = 400;     // 自由入力の字数の上限
const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
const VISION_TYPE = { protan: '1型', deutan: '2型', tritan: '3型' };

const pad2 = (n) => String(n).padStart(2, '0');
const keyOfUtc = (d) => `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
const parts = (day) => day.split('-').map(Number);

/** ゲームの日付（'YYYY-MM-DD'）：日本時間の朝4時で切り替える。4時より前は前の日 */
export const gameDay = (date) => keyOfUtc(new Date(date.getTime() + (JST - DAY_START_HOUR) * HOUR_MS));
/** 日本時間の時（0〜23） */
export const jstHour = (date) => (date.getUTCHours() + JST) % 24;
/** その日の、日本時間の hour 時（世界時の時刻 ms） */
const jstMs = (day, hour) => { const [y, m, d] = parts(day); return Date.UTC(y, m - 1, d, hour - JST); };
/** n 日あとの日付 */
export const addDays = (day, n) => keyOfUtc(new Date(jstMs(day, JST) + n * DAY_MS));
/** a から b まで何日か */
export const daysBetween = (a, b) => Math.round((jstMs(b, JST) - jstMs(a, JST)) / DAY_MS);
/** 曜日（0＝日曜） */
export const weekday = (day) => new Date(jstMs(day, JST)).getUTCDay();
/** 「11月26日（木）」 */
export const dayTitle = (day) => { const [, m, d] = parts(day); return `${m}月${d}日（${WEEK[weekday(day)]}）`; };

/* ---------- ② 七十二候・祝日・月の満ち欠け ---------- */

const rad = (deg) => (deg * Math.PI) / 180;
const norm = (deg) => ((deg % 360) + 360) % 360;
const julian = (ms) => ms / DAY_MS + 2440587.5;

/** 太陽の黄経（度。見かけの位置。精度は0.01度ほど＝15分ほど。Meeus『天文アルゴリズム』25章の簡単な式） */
export function sunLongitude(ms) {
  const T = (julian(ms) - 2451545) / 36525;
  const L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T;
  const M = rad(357.52911 + 35999.05029 * T - 0.0001537 * T * T);
  const C = (1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(M) + (0.019993 - 0.000101 * T) * Math.sin(2 * M) + 0.000289 * Math.sin(3 * M);
  const omega = rad(125.04 - 1934.136 * T);
  return norm(L0 + C - 0.00569 - 0.00478 * Math.sin(omega));
}

/**
 * その日の七十二候の番号（0＝立春の初候 東風解凍。黄経315度から5度ごと）。
 * 候の始まる瞬間がその日（日本時間の0時〜24時）のうちにあれば、その日から新しい候（暦の数え方）。だから日の終わりの太陽の位置で決める
 */
export const koIndex = (day) => Math.floor(norm(sunLongitude(jstMs(day, 24)) - 315) / 5);

/** その日の候：{ index, name, reading, meaning, first（その候の最初の日）, sekki（節気の { name, reading, feel }）, sekkiFirst } */
export function koOf(ctx, day) {
  const s = ctx.seasons;
  const index = koIndex(day);
  const first = koIndex(addDays(day, -1)) !== index;
  const sekki = s.sekki[Math.floor(index / 3)];
  return { index, ...s.ko[index], first, sekki, sekkiFirst: first && index % 3 === 0 };
}

/** 月齢（日。新月からの日数） */
const SYNODIC = 29.530588853;
export const moonAge = (ms) => ((((julian(ms) - 2451550.1) % SYNODIC) + SYNODIC) % SYNODIC);
/** その夜（日本時間の21時）の月：'full'（満月）・'first'（上弦）・'last'（下弦）・'new'（新月）・null（そのほか） */
export function moonPhase(day) {
  const age = moonAge(jstMs(day, 21));
  const near = (x) => Math.abs(age - x) < 1;
  if (near(SYNODIC / 2)) return 'full';
  if (near(SYNODIC / 4)) return 'first';
  if (near((SYNODIC * 3) / 4)) return 'last';
  if (age < 1 || age > SYNODIC - 1) return 'new';
  return null;
}

/** 祝日・行事の名前（data/seasons.json の days）。無ければ null。振替休日は数えない */
export function occasion(ctx, day) {
  const days = ctx.seasons.days;
  const [, m, d] = parts(day);
  const md = day.slice(5);
  if (days.fixed[md]) return days.fixed[md];
  for (const r of days.nthMonday) {
    if (r.month === m && weekday(day) === 1 && Math.ceil(d / 7) === r.nth) return r.name;
  }
  const ko = koOf(ctx, day);
  if (ko.sekkiFirst && days.sekki[ko.sekki.name]) return days.sekki[ko.sekki.name];
  const next = koOf(ctx, addDays(day, 1));
  if (next.sekkiFirst && days.beforeSekki[next.sekki.name]) return days.beforeSekki[next.sekki.name];
  return null;
}

/* ---------- ③ 今日の道端（日付から決まる） ---------- */

/** 文字列から決まる数 */
function hashString(text) {
  let h = 2166136261;
  for (const c of text) h = Math.imul(h ^ c.codePointAt(0), 16777619) >>> 0;
  return h;
}
/** 日付（と、何に使うか）から決まる 0以上1未満の数。同じ日なら誰が何度開いても同じ */
export const dayRandom = (day, salt) => hashString(`${day}:${salt}`) / 4294967296;

/** その日の散歩道の天気：{ kind（sunny・cloudy・rain・fog・snow）, word（晴れ など） }。節気ごとに重みが変わる */
export function weatherOf(ctx, day) {
  const w = ctx.seasons.weather;
  const weights = { ...w.base, ...(w.bySekki[koOf(ctx, day).sekki.name] || {}) };
  const kinds = Object.keys(w.kinds).filter((k) => weights[k] > 0);
  const total = kinds.reduce((a, k) => a + weights[k], 0);
  let r = dayRandom(day, 'weather') * total;
  for (const k of kinds) { r -= weights[k]; if (r < 0) return { kind: k, word: w.kinds[k] }; }
  return { kind: kinds[0], word: w.kinds[kinds[0]] };
}

/** 今いる場所に天気を描くか：月面・屋内や海の中の世界（seasons.json の noWeather）は描かない。描くなら天気の kind、描かないなら null */
export function weatherHere(state, ctx, day) {
  if (onMoon(state)) return null;
  const stage = currentStage(state, ctx.stages);
  if (stage && ctx.seasons.noWeather.includes(stage.name)) return null;
  return weatherOf(ctx, day).kind;
}

/** その日の、その世界の「今日の道端のもの」（道端に出る問題から日付で決まる1問。全員同じ）。その世界に道端の物が無ければ null */
export function todayRoadsideOf(ctx, day, world) {
  const list = roadsideQuestions(ctx, world);
  return list.length ? list[Math.floor(dayRandom(day, `road:${world}`) * list.length)] : null;
}

/**
 * 今いる世界の今日の道端のものを、今日まだ出していなければ返す（1日に1回だけ。出したら markTodayRoadside）。
 * 月面・出していた・道端の物が無い世界なら null
 */
export function todayRoadsideFor(state, ctx, day) {
  if (onMoon(state)) return null;
  const stage = currentStage(state, ctx.stages);
  if (!stage) return null;
  const page = diaryPage(state, day, false);
  if (page && page.todayRoad.includes(stage.name)) return null;
  return todayRoadsideOf(ctx, day, stage.name);
}

/** 今日の道端のものを出した（その世界では、今日はもう出さない） */
export function markTodayRoadside(state, day, world) {
  const page = diaryPage(state, day);
  if (!page.todayRoad.includes(world)) page.todayRoad.push(world);
}

/* ---------- ④ 日記（散歩帳の日付の頁） ---------- */

/** 日記の頁（無ければ作る。create が false なら作らずに null） */
export function diaryPage(state, day, create = true) {
  const pages = state.legacy.diary.pages;
  if (!pages[day] && create) {
    const prev = diaryDays(state)[0];
    pages[day] = { visits: [], sec: 0, gap: prev && prev < day ? daysBetween(prev, day) : null, notes: [], todayRoad: [], floors: 0, text: '' };
  }
  return pages[day] || null;
}

/** 日記のある日（新しい順） */
export const diaryDays = (state) => Object.keys(state.legacy.diary.pages).sort().reverse();

/**
 * 遊びに来た（起動したとき・画面に戻ってきたとき・日付が変わったとき）。しばらく（SESSION_GAP_MS）離れていたら、別の回として数える。
 * その日初めてなら fresh（頁を作った）
 */
export function diaryVisit(state, day, date) {
  const d = state.legacy.diary;
  const fresh = !d.pages[day];
  const page = diaryPage(state, day);
  const now = date.getTime();
  if (fresh || !page.visits.length || now - (d.lastActive || 0) > SESSION_GAP_MS) {
    page.visits.push([jstHour(date), now]);
    if (page.visits.length > VISITS_MAX) page.visits.splice(0, page.visits.length - VISITS_MAX);
  }
  d.lastActive = now;
  return { fresh };
}

/** 遊んでいる間（画面を見ている間）に数える：その日に遊んだ秒数（「いつもより長く歩いた」） */
export function diaryTick(state, day, sec, date) {
  const page = diaryPage(state, day);
  page.sec += sec;
  state.legacy.diary.lastActive = date.getTime();
}

/** 自由入力（今日のこと）を残す。TEXT_MAX 字まで */
export function setDiaryText(state, day, text) {
  const page = diaryPage(state, day);
  page.text = Array.from(String(text || '')).slice(0, TEXT_MAX).join('');
  return page.text;
}
export const DIARY_TEXT_MAX = TEXT_MAX;

/** 起きたこと（events）を、その日の頁に出来事として残す（データだけ。文章は見るときに作る） */
export function diaryRecord(state, ctx, day, events) {
  let page = null;
  const add = (note) => {
    page = page || diaryPage(state, day);
    if (page.notes.length < NOTES_MAX) page.notes.push(note);
  };
  for (const e of events) {
    if (e.type === 'walkBook') add({ k: 'road', id: e.id, name: e.name, world: e.world, today: !!e.today, added: !!e.added });
    else if (e.type === 'firstSolved') add({ k: 'solved', id: e.id });
    else if (e.type === 'walkerNoticed') add({ k: 'walker', name: e.name, road: e.road });
    else if (e.type === 'stele') {
      const w = e.sit ? walkerEntry(state, ctx) : null;
      add({ k: 'stele', steles: e.steles.map((st) => ({ generation: st.generation, name: st.name })), sat: w ? w.monster.name : null });
    }
    else if (e.type === 'steleOvertaken') add({ k: 'overtake', generation: e.generation, name: e.name });
    else if (e.type === 'reincarnated') add({ k: 'reborn', generation: e.generation });
    else if (e.type === 'visionCheck') add({ k: 'vision', vision: e.vision });
    else if (e.type === 'walkedToMoon') add({ k: 'moonWalk' });
    else if (e.type === 'bossDefeated') add({ k: 'boss', name: e.name });
    else if (e.type === 'moonCleared') add({ k: 'moonClear' });
    else if (e.type === 'barnJoin') add({ k: 'barnJoin', name: e.name });
    else if (e.type === 'defeat' && e.kind === 'midboss') {
      const m = ctx.monsters.find((x) => x.id === e.monsterId);
      if (m) add({ k: 'midboss', name: m.name });
    }
    else if (e.type === 'floorUp') {
      page = page || diaryPage(state, day);
      page.floors++;
      const st = e.world === 'moon' ? null : stageFor(e.floor, ctx.stages, 'earth');
      if (st && st.from === e.floor && e.floor > 1) add({ k: 'world', name: st.name });
    }
  }
}

/** 解説の最初の1文（日記の「おぼえたこと」） */
function firstSentence(text, max = 46) {
  const s = String(text || '').split('。')[0];
  return Array.from(s).length > max ? Array.from(s).slice(0, max).join('') + '…' : s;
}

/** ゲームの中の出来事の行（優先する順に並べた候補）：{ text, solved?（タップで解き直す問題id） } */
function gameLines(state, ctx, page) {
  const notes = page.notes;
  const out = [];
  // 1. 道端のもの（今日の道端 → 初めて見つけた物 → また見つけた物）。連れているザコが先に気づいていれば添える
  const roads = notes.filter((n) => n.k === 'road');
  const road = roads.find((n) => n.today) || roads.find((n) => n.added) || roads[0];
  if (road) {
    const zako = notes.find((n) => n.k === 'walker' && n.road === road.name);
    const head = road.today ? `今日の道端で、${road.name}を見つけた` : road.added ? `${road.world}で、${road.name}を見つけた` : `また${road.name}を見つけた`;
    out.push({ text: head + (zako ? `。${zako.name}が先に気づいた` : '') });
  }
  // 2. 初めて正解した問題（おぼえたこと。タップで解き直せる）
  const solvedIds = [...new Set(notes.filter((n) => n.k === 'solved').map((n) => n.id))].filter((id) => ctx.questions.some((q) => q.id === id));
  if (solvedIds.length) {
    const q = ctx.questions.find((x) => x.id === solvedIds[0]);
    const more = solvedIds.length > 1 ? `（ほか${solvedIds.length - 1}つ）` : '';
    out.push({ text: `おぼえたこと：${firstSentence(q.explanation || q.answer)}${more}`, solved: solvedIds });
  }
  // 3. 人生とザコの出来事（その日の最初のもの）
  const life = {
    reborn: (n) => `${n.generation}世代目として、生まれ変わった`,
    vision: (n) => `色の見え方が${VISION_TYPE[n.vision] || n.vision}だとわかった`,
    overtake: (n) => `${n.generation}世代目の自分（${n.name}）を追い越した`,
    moonClear: () => '月面を歩ききった',
    moonWalk: () => '歩いた距離が、月までとどいた',
    boss: (n) => `${n.name}を倒した`,
    midboss: (n) => `${n.name}に勝った`,
    barnJoin: (n) => `${n.name}がなついた`,
    stele: (n) => `${n.steles[0].generation}世代目の${n.steles[0].name}の石碑の前で、少し立ち止まった${n.sat ? `。${n.sat}がすわりこんだ` : ''}`,
    world: (n) => `${n.name}に入った`,
  };
  for (const k of Object.keys(life)) {
    const n = notes.find((x) => x.k === k);
    if (n) out.push({ text: life[k](n) });
  }
  // 4. 歩いた距離（行が足りないとき）
  if (page.floors > 0) out.push({ text: `${page.floors}階層ぶん歩いた（${walkKm(page.floors, ctx.balance)}km）` });
  return out;
}

/** 遊んだ時間帯のことば（日本時間の時） */
function timeWord(h) {
  if (h >= 4 && h < 10) return '朝のうち';
  if (h < 12 && h >= 10) return '昼前';
  if (h >= 12 && h < 15) return 'お昼';
  if (h >= 15 && h < 18) return '夕方';
  if (h >= 18 && h < 22) return '夜';
  if (h >= 22) return `夜${h - 12}時すぎ`;
  return `夜中の${h}時すぎ`;
}

/** 前の数日（最大7日）とくらべて、今日は長く遊んだか（10分以上で、ふだんの1.5倍以上。前の日が3日以上あるときだけ） */
function longerThanUsual(state, day, page) {
  const prev = diaryDays(state).filter((x) => x < day).slice(0, 7).map((x) => state.legacy.diary.pages[x].sec).filter((s) => s > 0);
  if (prev.length < 3 || page.sec < 600) return false;
  const sorted = [...prev].sort((a, b) => a - b);
  return page.sec >= sorted[Math.floor(sorted.length / 2)] * 1.5;
}

/**
 * 現実と共有している手がかりの行：祝日・行事、遊び方（何日ぶり・何回に分けて・いつもより長く・時間帯）、季節の感覚（または月）。
 * どれも端末の中で正しく分かることだけ。遊ぶ人に問いかけない（主人公が感じたことを書く）
 */
function realLine(state, ctx, day, page, ko) {
  const out = [];
  const occ = occasion(ctx, day);
  if (occ) out.push(`今日は${occ}`);
  const first = page.visits[0];
  const t = first ? timeWord(first[0]) : null;
  if (page.gap && page.gap >= 7) out.push(`${page.gap}日ぶりに歩いた`);
  else if (page.visits.length >= 3) out.push(`${page.visits.length}回に分けて歩いた`);
  else if (t && longerThanUsual(state, day, page)) out.push(`${t}、いつもより長く歩いた`);
  else if (t) out.push(t === '朝のうち' ? '朝のうちに歩いた' : `${t}に歩いた`);
  // 夜に遊んだ日の満月・半月（現実の空と同じ）。そうでなければ、その季節の感覚
  const night = page.visits.some(([h]) => h >= 17 || h < 4);
  const phase = moonPhase(day);
  if (night && phase === 'full') out.push('まるい月が出ていた');
  else if (night && (phase === 'first' || phase === 'last')) out.push('半分の月が出ていた');
  else out.push(ko.sekki.feel[Math.floor(dayRandom(day, 'feel') * ko.sekki.feel.length)]);
  return out.join('。');
}

/** 頁の行（自動の行。4行まで）：散歩道の天気・ゲームの中の出来事2行・現実の手がかり1行 */
function pageLines(state, ctx, day, page) {
  const ko = koOf(ctx, day);
  const w = weatherOf(ctx, day);
  const lines = [{ kind: 'weather', text: `散歩道は${w.word}${ko.first ? `。${ko.meaning}ころらしい` : ''}` }];
  for (const g of gameLines(state, ctx, page).slice(0, 2)) lines.push({ kind: 'game', ...g });
  lines.push({ kind: 'real', text: realLine(state, ctx, day, page, ko) });
  return { ko, weather: w, lines };
}

/**
 * 日記の1日の頁：{ day, title（11月26日（木））, ko, weather, lines, text（自由入力）, lastYear（去年の今日の頁。無ければ null） }。
 * 頁が無い日は null
 */
export function diaryView(state, ctx, day, withLastYear = true) {
  const page = diaryPage(state, day, false);
  if (!page) return null;
  const { ko, weather, lines } = pageLines(state, ctx, day, page);
  const [y] = parts(day);
  const lastDay = `${y - 1}-${day.slice(5)}`;
  const lastYear = withLastYear ? diaryView(state, ctx, lastDay, false) : null;
  return { day, title: dayTitle(day), ko, weather, lines, text: page.text, lastYear };
}

/** その日に初めて開いたときの知らせ：「今日は虹蔵不見（にじかくれてみえず）。散歩道はくもり」 */
export function todayNotice(ctx, day) {
  const ko = koOf(ctx, day);
  return `今日は${ko.name}（${ko.reading}）。散歩道は${weatherOf(ctx, day).word}`;
}
