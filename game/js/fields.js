// 学際分野（設計ページ「特定のジャンルマスターの組み合わせでしかできない機能」）。描画しない・ブラウザの機能に触らない。
// 2つのジャンルの熟練がどちらも balance.fields.unlockLevel（3）以上になると解放され、称号がもらえる。
// 効果が出るのは主専攻・副専攻（2枠）に入れたものだけ。熟練が条件を下回ると「休眠」して止まり、戻ると復活する。
// 解放の記録と専攻は知識なので、生まれ変わっても残る。
//
// ctx.fields … data/fields.json（groups・fields・rocketSteps）
// state.knowledge.fields … 学際分野id → { at, generation, dormant }（解放した記録）
// state.knowledge.majors … [主専攻, 副専攻]（学際分野id か null）

export const MAJOR_SLOTS = ['主専攻', '副専攻'];

const lv = (state, genre) => (state.knowledge.genres[genre] || { level: 0 }).level;

export const fieldDefs = (ctx) => (ctx.fields && ctx.fields.fields) || [];
export const fieldById = (ctx, id) => fieldDefs(ctx).find((f) => f.id === id) || null;
const unlockLevel = (ctx) => ctx.balance.fields.unlockLevel;

/** 2つのジャンルの熟練がどちらも条件を満たしているか（解放の条件。解放したあとは、満たしていないと休眠） */
export const meetsField = (state, f, ctx) => f.genres.every((g) => lv(state, g) >= unlockLevel(ctx));

/** 条件に足りないジャンル（休眠の理由）：[{ genre, level }] */
export const lowGenres = (state, f, ctx) => f.genres.filter((g) => lv(state, g) < unlockLevel(ctx)).map((genre) => ({ genre, level: lv(state, genre) }));

/** 解放したか（一度解放すると、熟練が下がっても解放のまま。称号も残る） */
export const isUnlocked = (state, id) => !!state.knowledge.fields[id];

/** 専攻にできるか（隠しの学際分野は称号だけ） */
export const canMajor = (f) => !!f && f.group !== 'hidden';

/** 効果が出ているか：専攻に入れていて、休眠していない */
export function fieldActive(state, ctx, id) {
  const f = fieldById(ctx, id);
  return !!f && isUnlocked(state, id) && state.knowledge.majors.includes(id) && meetsField(state, f, ctx);
}

/** 主専攻（slot 0）・副専攻（slot 1）に入れる。もう片方の枠に入っていたら移す。id が null なら空ける。いつでも付け替えられる */
export function setMajor(state, slot, id, ctx) {
  const m = state.knowledge.majors;
  if (!(slot >= 0 && slot < MAJOR_SLOTS.length)) return { ok: false, reason: 'ない枠です' };
  if (id == null) { m[slot] = null; return { ok: true }; }
  const f = fieldById(ctx, id);
  if (!f || !isUnlocked(state, id)) return { ok: false, reason: 'まだ解放していない学際分野です' };
  if (!canMajor(f)) return { ok: false, reason: `${f.name}は称号だけの学際分野です` };
  for (let i = 0; i < MAJOR_SLOTS.length; i++) if (m[i] === id) m[i] = null;
  m[slot] = id;
  return { ok: true };
}

/**
 * 解放と休眠を見張る（毎回の tick で呼ぶ。熟練は勉強・睡眠・デバッグのどこで変わっても、ここで拾う）。
 * 新しく解放した学際分野は fieldUnlocked、専攻に入れている学際分野が休眠した・復活したら fieldDormant／fieldAwake
 */
export function updateFields(state, ctx, events) {
  const rec = state.knowledge.fields;
  for (const f of fieldDefs(ctx)) {
    const meets = meetsField(state, f, ctx);
    const r = rec[f.id];
    if (!r) {
      if (!meets) continue;
      rec[f.id] = { at: state.life.gameHours, generation: state.life.generation, dormant: false };
      events.push({ type: 'fieldUnlocked', id: f.id, name: f.name, title: f.title, genres: f.genres, hidden: f.group === 'hidden' });
      continue;
    }
    if (r.dormant === !meets) continue;
    r.dormant = !meets;
    const slot = state.knowledge.majors.indexOf(f.id);
    if (slot >= 0) events.push({ type: meets ? 'fieldAwake' : 'fieldDormant', id: f.id, name: f.name, slot, low: lowGenres(state, f, ctx) });
  }
}

/** 解放した学際分野の称号 */
export const fieldTitles = (state, ctx) => fieldDefs(ctx).filter((f) => isUnlocked(state, f.id)).map((f) => f.title);

/**
 * 画面用の一覧。未解放は名前を伏せ、片方のジャンル（熟練の高いほう）だけ見せる（hint）。
 * 隠しの学際分野は解放するまで出さない
 */
export function fieldList(state, ctx) {
  return fieldDefs(ctx).filter((f) => f.group !== 'hidden' || isUnlocked(state, f.id)).map((f) => {
    const unlocked = isUnlocked(state, f.id);
    const levels = f.genres.map((g) => lv(state, g));
    const shown = levels[1] > levels[0] ? 1 : 0;
    return {
      ...f, unlocked, levels,
      slot: state.knowledge.majors.indexOf(f.id),
      dormant: unlocked && !meetsField(state, f, ctx),
      active: fieldActive(state, ctx, f.id),
      low: lowGenres(state, f, ctx),
      hint: unlocked ? null : { genre: f.genres[shown], level: levels[shown] },
    };
  });
}
