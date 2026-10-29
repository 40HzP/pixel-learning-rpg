// game/data/questions.json を検査する。  node tools/check-questions.mjs
// 誤り（止める）：選択肢がそろっていない・重複・ジャンルが設計ページの問題ジャンル（genres.js）以外・難易度が1〜5以外・idの重複
// 誤り（止める）：出題日（date）が MM-DD の形でない・ありえない日付
// 警告（止めない）：関連する魔物が monsters.json に無い・サブジャンルが問題ジャンル以外・作問者コードの形がちがう・
//   出題日の無い日（その日の今日の1問は、出題日の無い問題から選ぶ）・同じ出題日の問題が2問以上（その日はどちらか1問）
// 作問（ユーザーの問題）から採用した問題は author: { code: 作問者コードか null, name: ペンネームか null } を持つ（どちらかはある。無い問題は author が無いか null）
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { GENRES } from '../game/js/genres.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (p) => JSON.parse(readFileSync(root + p, 'utf8'));

const { questions } = read('game/data/questions.json');
const { monsters } = read('game/data/monsters.json');
const monsterNames = new Set(monsters.map((m) => m.name));

const errors = [];
const warnings = [];
const ids = new Set();
const byGenre = {};
const byDifficulty = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };

const nonEmpty = (s) => typeof s === 'string' && s.trim() !== '';
// 今日の1問：出題日（MM-DD）ごとの問題の数
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const byDate = {};

for (const [i, q] of questions.entries()) {
  const label = `#${i + 1}「${String(q.question || '').slice(0, 24)}」`;
  if (!nonEmpty(q.id)) errors.push(`${label}: id がありません`);
  else if (ids.has(q.id)) errors.push(`${label}: id ${q.id} が重複しています`);
  ids.add(q.id);
  if (!nonEmpty(q.question)) errors.push(`${label}: 問題文がありません`);
  if (!nonEmpty(q.explanation)) warnings.push(`${label}: 解説がありません`);

  const wrong = Array.isArray(q.wrong) ? q.wrong : [];
  const choices = [q.answer, ...wrong];
  if (!nonEmpty(q.answer)) errors.push(`${label}: 解答がありません`);
  if (wrong.length !== 3 || !wrong.every(nonEmpty)) errors.push(`${label}: 誤答が3つそろっていません`);
  const trimmed = choices.filter(nonEmpty).map((c) => c.trim());
  if (new Set(trimmed).size !== trimmed.length) errors.push(`${label}: 選択肢が重複しています`);

  if (!GENRES.includes(q.genre)) errors.push(`${label}: ジャンル「${q.genre}」は${GENRES.length}ジャンルにありません`);
  for (const s of q.subgenres || []) if (!GENRES.includes(s)) warnings.push(`${label}: サブジャンル「${s}」は${GENRES.length}ジャンルにありません`);
  if (!Number.isInteger(q.difficulty) || q.difficulty < 1 || q.difficulty > 5) errors.push(`${label}: 難易度 ${q.difficulty} は1〜5ではありません`);
  if (q.monster != null && !monsterNames.has(q.monster)) warnings.push(`${label}: 関連する魔物「${q.monster}」が monsters.json にありません`);
  if (q.author != null) {
    if (typeof q.author !== 'object' || (!nonEmpty(q.author.code) && !nonEmpty(q.author.name))) errors.push(`${label}: author には作問者コード（code）かペンネーム（name）が要ります`);
    else if (nonEmpty(q.author.code) && !/^[0-9A-Z]{4}-?[0-9A-Z]{4}$/.test(q.author.code.trim().toUpperCase())) warnings.push(`${label}: 作問者コード「${q.author.code}」の形がちがいます（例：K7Q2-9MXP）。作問者に採用が知らされません`);
    for (const key of ['code', 'name']) if (q.author && q.author[key] != null && typeof q.author[key] !== 'string') errors.push(`${label}: author.${key} は文字か null`);
  }

  if (q.date != null) {
    const m = /^(\d{2})-(\d{2})$/.exec(q.date);
    if (!m || +m[1] < 1 || +m[1] > 12 || +m[2] < 1 || +m[2] > DAYS_IN_MONTH[+m[1] - 1]) errors.push(`${label}: 出題日「${q.date}」は MM-DD の日付ではありません（例 10-29）`);
    else (byDate[q.date] = byDate[q.date] || []).push(label);
  }
  if (q.anniversary != null && (!nonEmpty(q.anniversary) || q.date == null)) errors.push(`${label}: 記念日（anniversary）は出題日のある問題に、文字で`);

  byGenre[q.genre] = (byGenre[q.genre] || 0) + 1;
  if (byDifficulty[q.difficulty] != null) byDifficulty[q.difficulty]++;
}

console.log(`問題数：${questions.length}（うち作問から採用 ${questions.filter((q) => q.author).length}）`);
console.log('ジャンルごと：' + Object.entries(byGenre).map(([g, n]) => `${g} ${n}`).join('、'));
console.log('難易度ごと：' + Object.entries(byDifficulty).map(([d, n]) => `${'☆'.repeat(Number(d))} ${n}`).join('、'));
// 今日の1問：出題日のある日・無い日
const allDays = DAYS_IN_MONTH.flatMap((n, mi) => Array.from({ length: n }, (_, d) => `${String(mi + 1).padStart(2, '0')}-${String(d + 1).padStart(2, '0')}`));
const missingDays = allDays.filter((d) => !byDate[d]);
console.log(`今日の1問：出題日のある問題 ${Object.values(byDate).flat().length}問・${Object.keys(byDate).length}/366日`);
if (Object.keys(byDate).length && missingDays.length) warnings.push(`出題日の問題が無い日（${missingDays.length}日）：${missingDays.slice(0, 10).join('・')}${missingDays.length > 10 ? '…' : ''}（その日は出題日の無い問題から選ぶ）`);
for (const [d, list] of Object.entries(byDate)) if (list.length > 1) warnings.push(`出題日 ${d} の問題が${list.length}問：${list.join('・')}（その日はどれか1問）`);
for (const w of warnings) console.log('警告：' + w);
for (const e of errors) console.log('誤り：' + e);
if (errors.length) {
  console.log(`\n誤りが ${errors.length} 件あります`);
  process.exit(1);
}
console.log(`\n問題なし${warnings.length ? `（警告 ${warnings.length} 件）` : ''}`);
