// テスト用の共通部品（データの読み込みと、固定できる乱数）
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createState, startGame } from '../js/sim.js';

const dataDir = fileURLToPath(new URL('../data/', import.meta.url));
const read = (name) => JSON.parse(readFileSync(dataDir + name, 'utf8'));

export const balance = read('balance.json');
export const monsters = read('monsters.json').monsters;
export const items = read('items.json').items;
export const recruits = read('recruits.json').recruits;
export const questions = read('questions.json').questions;
export const business = read('business.json');
export const fields = read('fields.json');
export const stages = read('stages.json').stages;

/** いつも同じ値を返す乱数 */
export const constRng = (v) => () => v;

/** 決まった並びを順に返す乱数（最後まで行ったら最初に戻る） */
export function seqRng(values) {
  let i = 0;
  return () => values[i++ % values.length];
}

/** 種から決まる乱数（mulberry32） */
export function seededRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeCtx(rng = constRng(0.5)) {
  return { balance, monsters, items, recruits, questions, business, fields, stages, rng };
}

export function newGame(startAge = 0) {
  const state = createState(balance);
  startGame(state, startAge);
  return state;
}

export const questionFor = (monsterName) => questions.find((q) => q.monster === monsterName);
