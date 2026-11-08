// 図鑑：未遭遇はシルエット（地球のザコは出現エリアも）、遭遇で名前と俗説、撃破か関連する問題に正解で正体
// ボス（かつての学説）は、正体に加えて「なぜ信じられたか」「誰がどう覆したか」を載せる
// 中ボスには顧問にしたときの役目、大学教授が研究室の顧問なら次に戦うボスの「当時の根拠」（予習）も載せる
// 上のボタンで並べ方を選べる（40HzP の依頼「図鑑の魔物をソートしたい。例えばジャンル別とかで」）：
// 種類順・ジャンル別・出現エリア別・名前順。選んだ並べ方は設定と一緒にこの端末に覚える（settings.js の zukanSort）
import { spriteCanvas, cssColor } from '../sprites.js';
import { ADVISOR_PLACES, advisorActive, nextBoss, areaLabels, stageFor, stageRange, worldOf, onMoon, isReformed } from '../sim.js';
import { el } from './dom.js';
import { ZUKAN_SORTS, saveSettings } from './settings.js';

let root = null;
let key = '';

/** ボスのいる階層（月面のボスは「月面◯階層」） */
const where = (m) => `${m.world === 'moon' ? '月面' : ''}${m.floor}階層`;

/** 月面を踏破すると開く頁（monsters.json の clear.page）。踏破するまでは題だけ伏せて見せる */
function pageCard(app, m) {
  const p = m.clear.page;
  if (!app.state.knowledge.moonCleared) {
    return el('div', { class: 'zcard wide unknown' }, el('div', { class: 'zname' }, '？？？の頁'),
      el('div', { class: 'muted' }, `月面を踏破する（${where(m)}の${m.name}を倒す）と開く`));
  }
  return el('div', { class: 'zcard wide page' },
    el('div', { class: 'zname' }, p.title, el('span', { class: 'muted' }, `（称号「${m.clear.title}」）`)),
    p.lines.map((line) => el('p', {}, line)));
}

/**
 * 月の裏側から聞こえた宇宙（town.json の moon.radio）：月面の街の裏側の電波望遠鏡で「宇宙からの電波」がいっぱいになるたびに1頁ずつ開く。
 * 月面に行ったことがあるか、1頁でも開いていれば見せる。まだの頁は題を伏せる
 */
function radioCard(app) {
  const radio = app.ctx.radio;
  const s = app.state;
  const opened = Math.min(s.knowledge.radio.pages, radio.pages.length);
  if (!opened && !onMoon(s) && !s.life.moonMaxFloor) return null;
  return el('div', { class: 'zcard wide page radio' },
    el('div', { class: 'zname' }, radio.title, el('span', { class: 'muted' }, `（${opened}/${radio.pages.length}頁）`)),
    el('p', { class: 'muted' }, radio.intro),
    radio.pages.map((p, i) => (i < opened
      ? el('div', { class: 'radio-page' }, el('b', {}, `${i + 1}. ${p.name}`), p.lines.map((line) => el('p', {}, line)))
      : el('div', { class: 'radio-page unknown' }, el('b', {}, `${i + 1}. ？？？`),
        el('p', { class: 'muted' }, i === opened ? '月面の街の「裏側の電波望遠鏡」で、宇宙からの電波を受信すると開く（月面で勉強に正解するとたまる）' : '')))));
}

export function init() {
  root = document.getElementById('screen-zukan');
  root.classList.add('pad');
}

export function reset() { key = ''; }

/** 予習（大学教授が研究室の顧問）：次に戦うボスなら、戦う前でも「当時の根拠」を見せる */
const prepFor = (app, m) => {
  if (!advisorActive(app.state, app.ctx, 'professor')) return null;
  const b = nextBoss(app.state, app.ctx);
  return b && b.id === m.id ? el('div', { class: 'prep' }, el('b', {}, '予習（大学教授）'), `：当時の根拠「${m.whyBelieved}」`) : null;
};

function card(app, m) {
  const z = app.state.knowledge.zukan[m.id] || { stage: 0, fooled: 0 };
  const sprite = (app.monsterSprites[m.id] || {}).idle || null;
  // 飼育小屋で懐き度が最大になったザコは「更生」：絵に光の輪と、札に印（設計ページ「懐き度」の⑤。新しい欄は作らない）
  const reformed = m.kind === 'monster' && z.stage >= 1 && isReformed(app.state, app.ctx, m.id);
  const pic = el('div', { class: 'pic' }, spriteCanvas(sprite, 3, app.palette, { silhouette: z.stage === 0, halo: reformed }));
  if (z.stage === 0) {
    return el('div', { class: 'zcard unknown' + (m.kind === 'boss' ? ' wide' : '') }, pic, el('div', { class: 'zname' }, '？？？'),
      el('div', { class: 'muted' }, m.kind === 'boss' ? `${where(m)}で待っているボス` : m.world === 'moon' ? '月面で待っている' : 'まだ出会っていない'),
      // 地球のザコは出現エリア（設計ページ「出現エリア」。先の世界を見たくなるように）
      m.kind === 'monster' && (m.areas || []).length ? el('div', { class: 'area' }, `出現：${areaLabels(m, app.stages).join('・')}`) : null,
      m.kind === 'boss' ? prepFor(app, m) : null);
  }
  if (m.kind === 'boss') {
    const label = (t) => el('span', { class: 'label' }, t);
    const known = z.stage >= 2;
    return el('div', { class: 'zcard wide' }, pic,
      el('div', { class: 'zname' }, m.name, el('span', { class: 'muted' }, `（ボス・${where(m)}）`)),
      label('かつての学説'), el('div', {}, m.myth),
      // 月面のボスの仕掛け（会えば分かる）
      ...(m.gimmickNote ? [label('仕掛け'), el('div', {}, m.gimmickNote)] : []),
      ...(known
        ? [label('正体'), el('div', {}, m.debated ? '研究が割れている' : m.truth),
          label('なぜ信じられたか'), el('div', {}, m.whyBelieved || ''),
          label('誰がどう覆したか'), el('div', {}, m.overturnedBy || ''),
          el('div', { class: z.fooled ? 'bad' : 'muted', style: { marginTop: '4px' } }, `この学説に${z.fooled}回騙された`)]
        : [prepFor(app, m), el('div', { class: 'muted', style: { marginTop: '4px' } }, '倒すか、関連する問題に正解すると、正体と「なぜ信じられたか」「誰がどう覆したか」が分かる')]));
  }
  if (m.kind === 'midboss') {
    return el('div', { class: 'zcard' }, pic,
      el('div', { class: 'zname' }, m.name, el('span', { class: 'muted' }, '（中ボス）')),
      el('div', {}, m.intro || ''),
      z.stage >= 2
        ? el('div', { class: 'good' }, m.ally === false ? `倒した。称号「${m.title}」をもらった` : '倒した。仲間になった')
        : el('div', { class: 'muted' }, `まだ倒していない（${m.appearAge}歳から挑戦できる）`),
      m.advisor ? el('div', { class: 'muted', style: { marginTop: '4px' } },
        `顧問にすると：${ADVISOR_PLACES[m.advisor.place]}で${m.advisor.role}${m.advisor.soon ? `（${m.advisor.soon}）` : ''}`) : null);
  }
  // mythLabel：「俗説」の代わりの見出し（ググンは「よくある間違い」。40HzP の依頼）
  const mythLabel = m.mythLabel || (m.wordType ? 'よく言われる意味' : '俗説');
  const truthLabel = m.wordType ? '本来の意味' : '正体';
  let truth;
  if (z.stage < 2) truth = el('div', { class: 'muted' }, '倒すか、関連する問題に正解すると分かる');
  else if (m.debated) truth = el('div', {}, '研究が割れている');
  else truth = el('div', {}, m.truth);
  return el('div', { class: 'zcard' }, pic,
    el('div', { class: 'zname' }, m.name, reformed ? el('span', { class: 'space-badge reformed' }, '更生') : null),
    el('span', { class: 'label' }, mythLabel), el('div', {}, m.myth),
    el('span', { class: 'label' }, truthLabel), truth,
    z.stage >= 2 ? el('div', { class: z.fooled ? 'bad' : 'muted', style: { marginTop: '4px' } }, `この${m.wordType ? '言い方' : mythLabel}に${z.fooled}回騙された`) : null);
}

/**
 * 並べ方ごとのまとまり：[{ title, color（パレットのキー。見出しの左の印）, items: 魔物の並び }]。
 * 魔物はどれか1つのまとまりに1回だけ入る。
 * - kind  種類順：地球のザコ・月面のザコ・ボス・中ボス（monsters.json の並び）
 * - genre ジャンル別：最初のジャンル（genres の先頭）で分ける。並びと色はテストのジャンル選びと同じ（genre-groups.json）。中ボスは最後
 * - area  出現エリア別：地球のザコは最初の出現エリア、地球のボスはいる階層の世界。世界の順のあとに月面、中ボス
 * - name  名前順：出会った魔物をあいうえお順。まだ出会っていない魔物は名前が分からないので最後にまとめる（元の並び）
 */
export function zukanGroups(monsters, mode, { genreGroups = [], stages = [], zukan = {} } = {}) {
  const midbosses = monsters.filter((m) => m.kind === 'midboss');
  const midGroup = { title: '中ボス（専門職の人）', items: midbosses };
  const nonEmpty = (gs) => gs.filter((g) => g.items.length);
  if (mode === 'genre') {
    const placed = new Set();
    const groups = [];
    for (const gg of genreGroups) {
      for (const x of gg.genres) {
        const items = monsters.filter((m) => m.kind !== 'midboss' && (m.genres || [])[0] === x.name);
        items.forEach((m) => placed.add(m.id));
        groups.push({ title: x.name, color: gg.color, items });
      }
    }
    const rest = monsters.filter((m) => m.kind !== 'midboss' && !placed.has(m.id));
    return nonEmpty([...groups, { title: 'そのほか', items: rest }, midGroup]);
  }
  if (mode === 'area') {
    const earth = stages.filter((s) => worldOf(s) === 'earth').sort((a, b) => a.from - b.from);
    const placed = new Set();
    const groups = earth.map((st) => {
      const [a, b] = stageRange(st, stages);
      const items = monsters.filter((m) => worldOf(m) === 'earth' && (
        (m.kind === 'monster' && (m.areas || [])[0] === st.name)
        || (m.kind === 'boss' && stageFor(m.floor, stages, 'earth') === st)));
      items.forEach((m) => placed.add(m.id));
      return { title: `${st.name}（${a}〜${b === null ? '' : b}階層）`, items };
    });
    const moon = monsters.filter((m) => worldOf(m) === 'moon');
    moon.forEach((m) => placed.add(m.id));
    const rest = monsters.filter((m) => m.kind !== 'midboss' && !placed.has(m.id));
    return nonEmpty([...groups, { title: '月面', items: moon }, { title: 'そのほか', items: rest }, midGroup]);
  }
  if (mode === 'name') {
    const met = (m) => ((zukan[m.id] || {}).stage || 0) >= 1;
    const known = monsters.filter(met).sort((a, b) => a.name.localeCompare(b.name, 'ja'));
    return nonEmpty([{ title: '出会った魔物（あいうえお順）', items: known }, { title: 'まだ出会っていない', items: monsters.filter((m) => !met(m)) }]);
  }
  return nonEmpty([
    { title: 'ザコ（俗説）', items: monsters.filter((m) => m.kind === 'monster' && worldOf(m) === 'earth') },
    { title: '月面のザコ', items: monsters.filter((m) => m.kind === 'monster' && worldOf(m) === 'moon') },
    { title: 'ボス（かつての学説）', items: monsters.filter((m) => m.kind === 'boss') },
    midGroup,
  ]);
}

export function update(app, force) {
  const zk = app.state.knowledge.zukan;
  const prep = advisorActive(app.state, app.ctx, 'professor') ? (nextBoss(app.state, app.ctx) || {}).id : null;
  const sort = app.settings.zukanSort;
  const reformed = (app.state.legacy.barn || []).filter((a) => isReformed(app.state, app.ctx, a.id)).map((a) => a.id); // 更生したザコ（札に印）
  const k = JSON.stringify([zk, app.state.knowledge.moonCleared, prep, sort, app.state.knowledge.radio.pages, app.state.adventure.world, reformed]);
  if (!force && k === key) return;
  key = k;
  const list = app.ctx.monsters;
  const met = list.filter((m) => (zk[m.id] || {}).stage >= 1).length;
  const known = list.filter((m) => (zk[m.id] || {}).stage >= 2).length;
  const pick = (id) => {
    if (id === app.settings.zukanSort) return;
    app.settings = { ...app.settings, zukanSort: id };
    saveSettings(app.settings);
    update(app, true);
    root.scrollTop = 0;
  };
  const groups = zukanGroups(list, sort, { genreGroups: app.genreGroups, stages: app.stages, zukan: zk });
  root.replaceChildren(
    el('div', { class: 'section' },
      el('h2', {}, '図鑑'),
      el('div', { class: 'muted', style: { marginBottom: '8px' } }, `出会った ${met}/${list.length}　正体が分かった ${known}/${list.length}`),
      el('div', { class: 'zukan-sort', role: 'radiogroup', 'aria-label': '並べ方' },
        el('span', { class: 'muted' }, '並べ方'),
        ZUKAN_SORTS.map((s) => el('button', {
          class: s.id === sort ? 'on' : null, role: 'radio', 'aria-checked': s.id === sort ? 'true' : 'false',
          'data-sort': s.id, onclick: () => pick(s.id),
        }, s.name))),
      groups.map((g) => {
        const gm = g.items.filter((m) => (zk[m.id] || {}).stage >= 1).length;
        return el('section', { class: 'zgroup' },
          el('h3', { class: 'zgroup-head', style: g.color ? `--tint:${cssColor(app.palette, g.color, '#a9a7b8')}` : null },
            el('span', {}, g.title), el('small', { class: 'muted' }, `出会った ${gm}/${g.items.length}`)),
          el('div', { class: 'zukan' }, g.items.map((m) => card(app, m))));
      }),
      // 月面を踏破すると開く頁と、月の裏側から聞こえた宇宙の頁は、どの並べ方でもいちばん下
      el('div', { class: 'zukan', style: { marginTop: '14px' } }, list.filter((m) => m.clear && m.clear.page).map((m) => pageCard(app, m)), radioCard(app))),
  );
}
