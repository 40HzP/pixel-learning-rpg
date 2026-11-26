// 図書館（月面は月面の書庫も同じ画面）。2026-11-09 に ui/facility.js から分けた
import { walkBookPages, diaryView, diaryDays, setDiaryText, DIARY_TEXT_MAX, diaryText, diaryBackup, diaryRestore } from '../../sim.js';
import { spriteCanvas } from '../../sprites.js';
import { el } from '../dom.js';
import { profLogList, profLogNote } from '../proflog.js';
import { redo } from '../study.js';
import { note, update } from './common.js';

const PAST_STEP = 7;  // 前の日の頁を、いくつずつ見せるか
const SAVE_WAIT_MS = 800; // 自由入力を書き終えてから残すまで
let pastShown = PAST_STEP;
let saveTimer = null;
const opened = new Set(); // 開いている前の日の頁（作り直しても開いたままにする）
let hideOwn = false;      // 見せる用：自分で書いた「今日のこと」を隠す（スクショを人に見せるとき）

/**
 * 図書館（寝床の跡。月面は月面の書庫）：散歩帳（日記と見つけたもの）と熟練の記録（誕生日の判定・勉強で上がった分・学際分野の休眠と復活。ui/proflog.js）。
 * 設計ページの「放置で眺める暗記資料」はまだ無い（準備中）
 */
export function libraryPanel(app) {
  return [
    ...diary(app),
    ...walkBook(app),
    el('h3', { class: 'subhead' }, '熟練の記録'),
    note(profLogNote(app)),
    profLogList(app),
    el('h3', { class: 'subhead' }, '暗記資料'),
    note('放置で眺める暗記資料は準備中'),
  ];
}

/** 作り直す目印（飼育小屋と同じく、日記に関わることが変わったときだけ作り直す。書いている途中で消えないように） */
export function libraryKey(app) {
  const s = app.state;
  const day = app.today();
  const page = s.legacy.diary.pages[day];
  // 歩いた階層の数は数階層ごとに変わるので目印に入れない（開いている頁が作り直しで閉じないように。次に作り直したときに出る）
  return [day, page ? page.notes.length : null, diaryDays(s).length, (s.knowledge.walkBook || []).length,
    (s.knowledge.profLog || []).length, (s.knowledge.profLog || [])[0], s.life.generation, pastShown, hideOwn];
}

/* ---------- 日記（設計ページ「毎日変わるものと日記」。sim/diary.js） ---------- */

/**
 * 散歩帳の日記：今日の頁（自動の行＋今日のこと）と、去年の今日、前の日の頁。
 * 自動の行はドット文字、自分で書いた行は手書きの字（ゲームの記録と現実の記録が混ざって見えないように）
 */
function diary(app) {
  const today = app.today();
  const v = diaryView(app.state, app.ctx, today);
  const past = diaryDays(app.state).filter((d) => d < today);
  const parts = [
    el('h3', { class: 'subhead' }, '散歩帳（日記）'),
    note('散歩道の天気と七十二候は毎日変わる（日本時間の朝4時に次の日）。見つけたもの・おぼえたことは主人公が書く。「今日のこと」は自由に書ける（この端末のセーブにだけ残る）'),
    el('label', { class: 'diary-hide' },
      el('input', { type: 'checkbox', checked: hideOwn, onchange: (ev) => { hideOwn = ev.target.checked; update(app, true); } }),
      '見せる用（自分で書いた「今日のこと」を隠す。スクショを人に見せるとき）'),
  ];
  if (v) parts.push(pageCard(app, v, true));
  if (past.length) {
    parts.push(el('div', { class: 'diary-past' },
      past.slice(0, pastShown).map((d) => {
        const pv = diaryView(app.state, app.ctx, d, false);
        const fold = el('details', { class: 'diary-fold', open: opened.has(d) },
          el('summary', {}, pv.title, el('small', {}, `　${pv.ko.name}・${pv.weather.word}${pv.text ? '・書いた日' : ''}`)), pageCard(app, pv, false));
        fold.addEventListener('toggle', () => { if (fold.open) opened.add(d); else opened.delete(d); });
        return fold;
      }),
      past.length > pastShown ? el('button', { onclick: () => { pastShown += PAST_STEP; update(app, true); } }, `前の日をもっと見る（あと${past.length - pastShown}日）`) : null));
  }
  parts.push(backupBox(app));
  return parts;
}

/**
 * 日記の書き出しと読み込み（機種変更に備えて）。ファイルはこの端末に保存するだけで、どこにも送らない。
 * 読む用（テキスト）と、別の端末で読み込む引き継ぎ用。読み込んでも、こちらで書いたことは消さない
 */
function backupBox(app) {
  const stamp = app.today().replace(/-/g, '');
  const file = el('input', { type: 'file', accept: '.json,application/json', hidden: true });
  file.addEventListener('change', async () => {
    const f = file.files && file.files[0];
    if (!f) return;
    const r = diaryRestore(app.state, await f.text());
    file.value = '';
    if (!r.ok) { app.notify(r.reason, 'bad'); return; }
    app.save();
    app.notify(`日記を読み込んだ（足した日 ${r.added}日・今日のことを入れた日 ${r.filled}日）`, 'good');
    update(app, true);
  });
  return el('details', { class: 'diary-fold diary-backup' },
    el('summary', {}, '日記の書き出し・読み込み', el('small', {}, '　機種変更のとき')),
    note('書き出したファイルは、この端末に保存されるだけ（どこにも送らない）。「引き継ぎ用」を新しい端末の図書館で読み込むと、日記が移る（読み込んでも、新しい端末で書いたことは消えない）'),
    el('div', { class: 'diary-backup-btns' },
      el('button', { onclick: () => download(`hateshirazu-diary-${stamp}.txt`, diaryText(app.state, app.ctx), 'text/plain') }, '読む用に書き出す（テキスト）'),
      el('button', { onclick: () => download(`hateshirazu-diary-${stamp}.json`, diaryBackup(app.state), 'application/json') }, '引き継ぎ用に書き出す'),
      el('button', { onclick: () => file.click() }, '引き継ぎ用を読み込む'),
      file));
}

/** ファイルとしてこの端末に保存する（ブラウザのダウンロード。通信はしない） */
function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const a = el('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 1日の頁（today：今日の頁。去年の今日を添える） */
function pageCard(app, v, today) {
  return el('div', { class: 'diary-page' + (today ? ' today' : '') },
    today ? el('div', { class: 'diary-head' }, el('b', {}, v.title), el('span', { class: 'diary-ko' }, `${v.ko.name}（${v.ko.reading}）`)) : null,
    el('ul', { class: 'diary-lines' }, v.lines.map((line) => el('li', { class: `diary-auto ${line.kind}` },
      line.solved ? el('button', { class: 'diary-redo', onclick: () => redo(app, line.solved), title: 'タップで解き直す' }, line.text, el('small', {}, '　解き直す')) : line.text))),
    textBox(app, v),
    today && v.lastYear ? lastYear(v.lastYear) : null);
}

/** 今日のこと（自由入力）。書いた分は少し待ってから残す。前の日の頁も書き直せる。見せる用のときは隠す */
function textBox(app, v) {
  if (hideOwn) return el('p', { class: 'diary-hidden' }, v.text ? '（今日のことは隠しています）' : '');
  const box = el('textarea', { class: 'diary-text', placeholder: '今日のこと', maxLength: DIARY_TEXT_MAX, rows: 3, 'aria-label': `${v.title}の今日のこと` });
  box.value = v.text || '';
  box.addEventListener('input', () => {
    setDiaryText(app.state, v.day, box.value);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => app.save(), SAVE_WAIT_MS);
  });
  box.addEventListener('blur', () => { clearTimeout(saveTimer); app.save(); });
  return box;
}

/** 去年の今日（1年前の同じ日に頁があれば） */
function lastYear(v) {
  return el('div', { class: 'diary-lastyear' },
    el('b', {}, `去年の今日（${v.title}）`),
    el('ul', { class: 'diary-lines' }, v.lines.map((line) => el('li', { class: `diary-auto ${line.kind}` }, line.text))),
    v.text ? el('p', { class: 'diary-written' + (hideOwn ? ' diary-hidden' : '') }, hideOwn ? '（今日のことは隠しています）' : v.text) : null);
}

/* ---------- 散歩帳（見つけたもの） ---------- */

/**
 * 散歩帳（設計ページ「散歩の要素」）：冒険の道端の物の問題に正解すると載る（絵・名前・見つけた世界・解説）。
 * 図鑑とは別の帳面。まだ載っていない物は影絵と、出る世界だけを見せる。知識なので生まれ変わっても残る。
 * 日記の索引として、日記の下に置く（設計ページ「毎日変わるものと日記」の案）
 */
function walkBook(app) {
  const pages = walkBookPages(app.state, app.ctx);
  if (!pages.length) return [];
  const found = pages.filter((p) => p.found).length;
  const rows = pages.map((p) => {
    const sp = (app.walkSprites.items || {})[p.name] || null;
    if (!p.found) {
      return el('div', { class: 'item walk-page locked' },
        spriteCanvas(sp, 2, app.palette, { silhouette: true }),
        el('div', { class: 'name' }, '？？？', el('small', {}, `${p.world}の道端`)));
    }
    return el('div', { class: 'item walk-page' },
      spriteCanvas(sp, 2, app.palette),
      el('div', { class: 'name' }, p.name,
        el('small', { class: 'muted' }, `${p.world}で見つけた（${p.found.generation}世代目）`),
        el('small', {}, p.question.explanation)));
  });
  return [
    el('h3', { class: 'subhead' }, `散歩帳（見つけたもの ${found}／${pages.length}）`),
    note('冒険の道端に、ときどき物が出る（上に「？」。今日の道端のものは黄色）。冒険の絵をタップして、その物の問題に正解すると載る。間違えても罰は無く、また道端で会える'),
    el('div', { class: 'list walk-book' }, rows),
  ];
}
