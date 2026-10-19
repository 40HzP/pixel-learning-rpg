// game/data/questions.json を検査する。  node tools/check-questions.mjs
// 誤り（止める）：選択肢がそろっていない・重複・ジャンルが設計ページの問題ジャンル（genres.js）以外・難易度が1〜5以外・idの重複
// 警告（止めない）：関連する魔物が monsters.json に無い・サブジャンルが問題ジャンル以外
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

  byGenre[q.genre] = (byGenre[q.genre] || 0) + 1;
  if (byDifficulty[q.difficulty] != null) byDifficulty[q.difficulty]++;
}

console.log(`問題数：${questions.length}`);
console.log('ジャンルごと：' + Object.entries(byGenre).map(([g, n]) => `${g} ${n}`).join('、'));
console.log('難易度ごと：' + Object.entries(byDifficulty).map(([d, n]) => `${'☆'.repeat(Number(d))} ${n}`).join('、'));
for (const w of warnings) console.log('警告：' + w);
for (const e of errors) console.log('誤り：' + e);
if (errors.length) {
  console.log(`\n誤りが ${errors.length} 件あります`);
  process.exit(1);
}
console.log(`\n問題なし${warnings.length ? `（警告 ${warnings.length} 件）` : ''}`);
