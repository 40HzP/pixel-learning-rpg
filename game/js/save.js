// セーブの書き出し・読み込み・版の移行（ブラウザの機能に触らない）。
// localStorage への読み書きは main.js が行い、ここは文字列⇔状態の変換だけを受け持つ。

import { createState } from './sim.js';

export const SAVE_KEY = 'plrpg.save';
export const SAVE_VERSION = 3;

/**
 * 版の移行。MIGRATIONS[n] は「版 n のセーブ」を受け取り「版 n+1 のセーブ」を返す。
 * セーブの形を変えたら SAVE_VERSION を1つ上げ、ここに移行を1つ足す。
 *   例）2: (save) => { save.state.newField = 0; save.version = 3; return save; }
 * 足りない項目は読み込み時に fillDefaults が既定値で埋めるので、項目を足すだけなら移行は要らない。
 */
export const MIGRATIONS = {
  // 版1→2：ザコが群れで出るようになり、敵が1体（adventure.enemy）から群れ（adventure.enemies）になった。
  // 主人公の名前・MPなどの新しい項目は fillDefaults が既定値で埋める
  1: (save) => {
    const adv = save.state.adventure || (save.state.adventure = {});
    adv.enemies = adv.enemy ? [{ ...adv.enemy, uid: 1, slot: 0 }] : [];
    adv.nextUid = 2;
    delete adv.enemy;
    save.version = 2;
    return save;
  },
  // 版2→3：会社を複数持てるようになった。会社1つ（company）と社員（staff）を、会社の並び（companies）にし、
  // 社員はその会社で働く新人として移す。会社が無いのに雇っていた社員は、働く場所が無いので契約を終える
  2: (save) => {
    const st = save.state;
    const old = st.company;
    st.companies = [];
    if (old && old.industry) {
      st.companies.push({
        uid: 1, industry: old.industry, foundedAt: old.foundedAt || 0,
        staff: (st.staff || []).map((a) => ({ id: a.id, grade: 0, paidUntil: a.paidUntil })),
      });
    }
    st.nextCompanyUid = st.companies.length + 1;
    delete st.company;
    delete st.staff;
    save.version = 3;
    return save;
  },
};

export function serialize(state, savedAt = 0) {
  return JSON.stringify({ version: SAVE_VERSION, savedAt, state });
}

const isPlainObject = (v) => v != null && typeof v === 'object' && !Array.isArray(v);

/** セーブに無い項目を既定値で埋める（セーブにだけある項目は残す） */
export function fillDefaults(saved, defaults) {
  if (!isPlainObject(saved) || !isPlainObject(defaults)) return saved === undefined ? defaults : saved;
  const out = { ...saved };
  for (const [k, dv] of Object.entries(defaults)) {
    if (out[k] === undefined) out[k] = dv;
    else if (isPlainObject(out[k]) && isPlainObject(dv)) out[k] = fillDefaults(out[k], dv);
  }
  return out;
}

/**
 * セーブ文字列を状態に戻す。読めないときは Error を投げる。
 * opts.migrations / opts.version はテスト用（既定は MIGRATIONS / SAVE_VERSION）
 */
export function deserialize(text, balance, opts = {}) {
  const migrations = opts.migrations || MIGRATIONS;
  const current = opts.version || SAVE_VERSION;
  let save;
  try { save = JSON.parse(text); } catch { throw new Error('セーブの文字列が壊れています'); }
  if (!isPlainObject(save) || !isPlainObject(save.state)) throw new Error('セーブの形が違います');
  let v = Number.isInteger(save.version) ? save.version : 0;
  if (v > current) throw new Error(`新しい版（${v}）のセーブなので読めません`);
  while (v < current) {
    const m = migrations[v];
    if (!m) throw new Error(`版 ${v} のセーブを移行できません`);
    save = m(save);
    if (save.version !== v + 1) throw new Error(`版 ${v} の移行が版を上げていません`);
    v = save.version;
  }
  return fillDefaults(save.state, createState(balance));
}
