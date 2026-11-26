// 毎日変わるものと日記（設計ページ「毎日変わるものと日記（2026-11-26）」）：日本時間の朝4時の日付・七十二候・祝日と行事・
// 散歩道の天気・今日の道端・日記の記録と行
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  gameDay, jstHour, addDays, daysBetween, dayTitle, koOf, occasion, moonPhase, weatherOf, weatherHere,
  todayRoadsideOf, todayRoadsideFor, markTodayRoadside, roadsideQuestions, moveToFloor,
  diaryPage, diaryDays, diaryVisit, diaryTick, diaryRecord, setDiaryText, diaryView, todayNotice, DIARY_TEXT_MAX,
} from '../js/sim.js';
import { beginRoadside, answerRoadside, createSession, nextQuestion, answer } from '../js/quiz.js';
import { serialize, deserialize } from '../js/save.js';
import { balance, makeCtx, newGame, seasons, stages } from './helpers.js';

/** 日本時間の時刻（'2026-11-26 03:59' → Date） */
const jst = (text) => new Date(`${text.replace(' ', 'T')}:00+09:00`);

test('日付：日本時間の朝4時で切り替わる（4時より前は前の日）', () => {
  assert.equal(gameDay(jst('2026-11-27 03:59')), '2026-11-26');
  assert.equal(gameDay(jst('2026-11-27 04:00')), '2026-11-27');
  assert.equal(gameDay(jst('2026-11-26 23:30')), '2026-11-26');
  assert.equal(gameDay(jst('2027-01-01 01:00')), '2026-12-31'); // 年をまたぐ
  assert.equal(jstHour(jst('2026-11-27 02:15')), 2);
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2028-03-01', -1), '2028-02-29');
  assert.equal(daysBetween('2026-11-20', '2026-11-27'), 7);
  assert.equal(dayTitle('2026-11-26'), '11月26日（木）');
});

test('七十二候：太陽の位置から、その日の候を決める（2025年の暦の日付と同じ）', () => {
  const ctx = makeCtx();
  assert.equal(seasons.ko.length, 72);
  assert.equal(seasons.sekki.length, 24);
  for (const k of seasons.ko) assert.ok(k.name && k.reading && k.meaning, `候の名前・読み・意味：${k.name}`);
  for (const s of seasons.sekki) assert.equal(s.feel.length >= 1, true, `節気の感覚の一文：${s.name}`);
  // 候の始まる日（その日から新しい候。前の日は前の候）
  const starts = [
    ['2025-03-30', '雷乃発声'], ['2025-04-04', '玄鳥至'], ['2025-04-09', '鴻雁北'], ['2025-05-05', '蛙始鳴'],
    ['2025-05-21', '蚕起食桑'], ['2025-06-11', '腐草為螢'], ['2025-06-21', '乃東枯'], ['2025-07-07', '温風至'],
  ];
  for (const [day, name] of starts) {
    const ko = koOf(ctx, day);
    assert.equal(ko.name, name, day);
    assert.equal(ko.first, true, `${day} は ${name} の最初の日`);
    assert.notEqual(koOf(ctx, addDays(day, -1)).name, name, `${day} の前の日はまだ前の候`);
  }
  assert.equal(koOf(ctx, '2026-11-26').name, '虹蔵不見');
  assert.equal(koOf(ctx, '2026-11-26').sekki.name, '小雪');
});

test('祝日と行事：決まった日・第◯月曜・春分と秋分・節分', () => {
  const ctx = makeCtx();
  assert.equal(occasion(ctx, '2026-11-23'), '勤労感謝の日');
  assert.equal(occasion(ctx, '2026-01-12'), '成人の日'); // 1月の第2月曜
  assert.equal(occasion(ctx, '2026-01-05'), null);
  assert.equal(occasion(ctx, '2026-09-21'), '敬老の日');
  assert.equal(occasion(ctx, '2026-03-20'), '春分の日');
  assert.equal(occasion(ctx, '2026-02-03'), '節分');
  assert.equal(occasion(ctx, '2026-11-26'), null);
});

test('月の満ち欠け：満月の夜が分かる', () => {
  assert.equal(moonPhase('2025-06-11'), 'full');
  assert.equal(moonPhase('2025-06-25'), 'new');
});

test('散歩道の天気：日付で決まり（全員同じ）、季節で変わる。月面と屋内の世界には描かない', () => {
  const ctx = makeCtx();
  assert.deepEqual(weatherOf(ctx, '2026-11-26'), weatherOf(ctx, '2026-11-26'));
  // 夏（大暑）に雪は降らない。1年で、晴れ・くもり・雨がどれも出る
  const kinds = new Set();
  for (let i = 0; i < 365; i++) {
    const day = addDays('2026-01-01', i);
    const w = weatherOf(ctx, day);
    kinds.add(w.kind);
    if (koOf(ctx, day).sekki.name === '大暑') assert.notEqual(w.kind, 'snow', day);
  }
  for (const k of ['sunny', 'cloudy', 'rain', 'snow']) assert.ok(kinds.has(k), k);
  const s = newGame(0);
  assert.ok(weatherHere(s, ctx, '2026-11-26'));
  s.adventure.world = 'moon';
  assert.equal(weatherHere(s, ctx, '2026-11-26'), null);
  s.adventure.world = 'earth';
  s.adventure.floor = stages.find((x) => x.name === '海の底').from;
  assert.equal(weatherHere(s, ctx, '2026-11-26'), null);
});

test('今日の道端：世界ごとに日付で決まる1つ。1日1回だけ出し、答えると日記に「今日の道端で見つけた」', () => {
  const ctx = makeCtx();
  const s = newGame(0);
  const day = '2026-11-26';
  const q = todayRoadsideOf(ctx, day, 'はじまりの草原');
  assert.ok(q && q.roadside.world === 'はじまりの草原');
  assert.equal(todayRoadsideOf(ctx, day, 'はじまりの草原').id, q.id); // 同じ日なら同じ
  // 日が変わると変わることがある（道端の物が2つある世界なので、1週間のうちには両方出る）
  const week = new Set(Array.from({ length: 14 }, (_, i) => todayRoadsideOf(ctx, addDays(day, i), 'はじまりの草原').id));
  assert.equal(week.size, roadsideQuestions(ctx, 'はじまりの草原').length);
  assert.equal(todayRoadsideFor(s, ctx, day).id, q.id);
  markTodayRoadside(s, day, 'はじまりの草原');
  assert.equal(todayRoadsideFor(s, ctx, day), null); // 今日はもう出した
  assert.ok(todayRoadsideFor(s, ctx, addDays(day, 1))); // 次の日はまた出る
  // 答える（今日の道端のもの）
  const session = beginRoadside(s, ctx, q.id);
  session.today = true;
  const res = answerRoadside(s, session, session.current.choices.findIndex((c) => c.kind === 'answer'), ctx);
  diaryRecord(s, ctx, day, res.events);
  const v = diaryView(s, ctx, day);
  assert.ok(v.lines.some((l) => l.text === `今日の道端で、${q.roadside.name}を見つけた`), JSON.stringify(v.lines));
});

test('日記：初めて正解した問題は「おぼえたこと」（タップで解き直せる問題id）。2回目の正解では書かない', () => {
  const ctx = makeCtx();
  const s = newGame(0);
  const day = '2026-11-26';
  const session = createSession(s, 'quiz', ctx);
  nextQuestion(s, session, ctx);
  const q = session.current.question;
  const right = () => session.current.choices.findIndex((c) => c.kind === 'answer');
  const res = answer(s, session, right(), ctx);
  assert.ok(res.events.some((e) => e.type === 'firstSolved' && e.id === q.id));
  diaryRecord(s, ctx, day, res.events);
  const line = diaryView(s, ctx, day).lines.find((l) => l.solved);
  assert.ok(line && line.text.startsWith('おぼえたこと：'), JSON.stringify(diaryView(s, ctx, day).lines));
  assert.deepEqual(line.solved, [q.id]);
  // 同じ問題にもう一度正解しても firstSolved は出ない
  const again = createSession(s, 'review', ctx, null, [q.id]);
  nextQuestion(s, again, ctx);
  const res2 = answer(s, again, again.current.choices.findIndex((c) => c.kind === 'answer'), ctx);
  assert.ok(!res2.events.some((e) => e.type === 'firstSolved'));
});

test('日記の行：散歩道の天気・ゲームの中の出来事2行まで・現実の手がかり1行。問いかけない', () => {
  const ctx = makeCtx();
  const s = newGame(0);
  const day = '2026-11-22'; // 虹蔵不見の最初の日
  diaryVisit(s, day, jst('2026-11-22 23:10'));
  diaryRecord(s, ctx, day, [
    { type: 'barnJoin', name: 'ミカクチズ' },
    { type: 'bossDefeated', name: 'テンドウセツ' },
    { type: 'floorUp', floor: 11, world: 'earth' },
  ]);
  const v = diaryView(s, ctx, day);
  assert.equal(v.title, '11月22日（日）');
  assert.equal(v.ko.name, '虹蔵不見');
  assert.ok(v.lines.length <= 4);
  assert.equal(v.lines[0].kind, 'weather');
  assert.match(v.lines[0].text, /^散歩道は.+。虹が見えなくなるころらしい$/); // 候の最初の日は意味を添える
  assert.equal(v.lines.filter((l) => l.kind === 'game').length, 2);
  const real = v.lines.find((l) => l.kind === 'real');
  assert.match(real.text, /^夜11時すぎに歩いた。/);
  for (const l of v.lines) assert.ok(!/[？?]/.test(l.text), `問いかけない：${l.text}`);
  // 候の2日目は意味を添えない
  diaryVisit(s, '2026-11-23', jst('2026-11-23 12:00'));
  const v2 = diaryView(s, ctx, '2026-11-23');
  assert.match(v2.lines[0].text, /^散歩道は[^。]+$/);
  assert.match(v2.lines.find((l) => l.kind === 'real').text, /^今日は勤労感謝の日。お昼に歩いた。/);
});

test('日記の行：何日ぶり・何回に分けて・いつもより長く', () => {
  const ctx = makeCtx();
  const s = newGame(0);
  diaryVisit(s, '2026-11-01', jst('2026-11-01 08:00'));
  diaryVisit(s, '2026-11-10', jst('2026-11-10 08:00'));
  assert.equal(diaryPage(s, '2026-11-10').gap, 9);
  assert.match(diaryView(s, ctx, '2026-11-10').lines.at(-1).text, /9日ぶりに歩いた/);
  // 同じ日に、しばらく離れてから3回来た
  diaryVisit(s, '2026-11-11', jst('2026-11-11 08:00'));
  diaryVisit(s, '2026-11-11', jst('2026-11-11 08:05')); // すぐ戻ってきたのは同じ回
  diaryVisit(s, '2026-11-11', jst('2026-11-11 12:30'));
  diaryVisit(s, '2026-11-11', jst('2026-11-11 21:00'));
  assert.equal(diaryPage(s, '2026-11-11').visits.length, 3);
  assert.match(diaryView(s, ctx, '2026-11-11').lines.at(-1).text, /3回に分けて歩いた/);
  // ふだん5分ずつ遊んでいて、今日は20分
  for (const d of ['2026-11-12', '2026-11-13', '2026-11-14']) { diaryVisit(s, d, jst(`${d} 20:00`)); diaryTick(s, d, 300, jst(`${d} 20:05`)); }
  diaryVisit(s, '2026-11-15', jst('2026-11-15 20:00'));
  diaryTick(s, '2026-11-15', 1200, jst('2026-11-15 20:20'));
  assert.match(diaryView(s, ctx, '2026-11-15').lines.at(-1).text, /^夜、いつもより長く歩いた/);
});

test('日記：自由入力は字数の上限まで残り、去年の今日が添えられ、セーブして読み込んでも残る', () => {
  const ctx = makeCtx();
  const s = newGame(0);
  diaryVisit(s, '2025-11-26', jst('2025-11-26 21:00'));
  setDiaryText(s, '2025-11-26', '去年のこと');
  diaryVisit(s, '2026-11-26', jst('2026-11-26 21:00'));
  assert.equal(setDiaryText(s, '2026-11-26', 'あ'.repeat(DIARY_TEXT_MAX + 50)).length, DIARY_TEXT_MAX);
  const v = diaryView(s, ctx, '2026-11-26');
  assert.ok(v.lastYear);
  assert.equal(v.lastYear.text, '去年のこと');
  assert.equal(v.lastYear.lastYear, null);
  assert.deepEqual(diaryDays(s), ['2026-11-26', '2025-11-26']);
  const loaded = deserialize(serialize(s), balance);
  assert.equal(diaryView(loaded, ctx, '2025-11-26').text, '去年のこと');
  // 前の版のセーブ（日記が無い）も読める
  const old = JSON.parse(serialize(newGame(0)));
  delete old.state.legacy.diary;
  const fromOld = deserialize(JSON.stringify(old), balance);
  assert.deepEqual(fromOld.legacy.diary, { pages: {}, lastActive: 0 });
});

test('日記：遊ばなかった日の頁は作らない。今日の知らせは候と天気', () => {
  const ctx = makeCtx();
  const s = newGame(0);
  diaryVisit(s, '2026-11-20', jst('2026-11-20 10:00'));
  diaryVisit(s, '2026-11-26', jst('2026-11-26 10:00'));
  assert.equal(diaryView(s, ctx, '2026-11-23'), null);
  assert.equal(diaryDays(s).length, 2);
  assert.match(todayNotice(ctx, '2026-11-26'), /^今日は虹蔵不見（にじかくれてみえず）。散歩道は.+$/);
});

test('日記：月面の階層では、世界に入った行を書かない（地球の世界の名前だけ）', () => {
  const ctx = makeCtx();
  const s = newGame(0);
  moveToFloor(s, ctx, 1);
  diaryRecord(s, ctx, '2026-11-26', [{ type: 'floorUp', floor: 11, world: 'moon' }, { type: 'floorUp', floor: 21, world: 'earth' }]);
  const notes = diaryPage(s, '2026-11-26').notes;
  assert.deepEqual(notes.filter((n) => n.k === 'world').map((n) => n.name), ['平安京']);
  assert.equal(diaryPage(s, '2026-11-26').floors, 2);
});
