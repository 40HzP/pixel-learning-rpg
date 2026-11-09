// 月面の街だけの施設の中身：通信基地（仲間が集まる場所と会社）・裏側の電波望遠鏡（学校・研究室と宇宙からの電波）・帰還ロケット。
// ほかの月面の施設（補給所・月面の書庫・医務室・飼育ドーム）は地球の施設と同じ画面。2026-11-09 に ui/facility.js から分けた
import { radioInfo } from '../../sim.js';
import { el } from '../dom.js';
import { note, lockText } from './common.js';
import { guildPanel } from './guild.js';
import { companyPanel } from './company.js';
import { majorPanel } from './major.js';

/**
 * 帰還ロケット（月面の街）：無料で、いつでも、必ず地球に帰れる。地球は打ち上げた階層から続ける。
 * 月面の階層は取っておくので、また打ち上げると月面はその階層から
 */
export function moonRocketPanel(app) {
  const adv = app.state.adventure;
  return [
    el('div', { class: 'profit' }, `今は月面${adv.floor}階層。地球に帰ると${adv.earthFloor || 1}階層から続ける`),
    note(`月面の階層（月面${adv.floor}階層）は取っておく。地球のロケット発射場からまた打ち上げると、月面${adv.floor}階層から`),
    el('div', { class: 'btnrow' }, el('button', {
      class: 'primary launch',
      onclick: () => {
        if (!confirm('帰還ロケットで地球に帰りますか？（無料）')) return;
        app.returnHome();
      },
    }, '地球に帰る（無料）')),
  ];
}

/** 通信基地（月面の街）：地球の仲間が集まる場所と会社の仕事を、地球との通信でする（決めたことの返事は約2.6秒あとに届く） */
export function commPanel(app) {
  const lock = lockText(app, 'company');
  // 会社の欄を先に作る（所持金の数字の部品 live.gold は1つなので、あとで作る仲間の欄の所持金に付ける）
  const company = lock
    ? [el('div', { class: 'soon-box' }, el('b', {}, '準備中'), el('div', {}, (app.town.facilities.find((f) => f.id === 'company') || {}).desc || ''), el('div', { class: 'unlock' }, lock))]
    : companyPanel(app).slice(1); // 所持金は上（仲間の欄）に出す
  return [
    note('決めたことは地球へ送信し、地球から返事が届く。決めた効果はすぐに出る'),
    el('h3', { class: 'subhead' }, '仲間（地球の「仲間が集まる場所」）'),
    ...guildPanel(app),
    el('h3', { class: 'subhead' }, '会社（地球の「会社」）'),
    ...company,
  ];
}

/**
 * 裏側の電波望遠鏡（月面の街）：学校・研究室と同じ（専攻の付け替え・学校と研究室の顧問）に、次の月面のボスの予習と、
 * 「宇宙からの電波」のゲージ（月面で勉強に正解するとたまり、いっぱいになると図鑑の「月の裏側から聞こえた宇宙」の頁が開く）
 */
export function telescopePanel(app) {
  const r = radioInfo(app.state, app.ctx);
  const radio = app.ctx.radio;
  return [
    el('h3', { class: 'subhead' }, '宇宙からの電波'),
    el('div', { class: 'profit' }, '図鑑「', radio.title, '」 ', el('b', {}, `${r.opened}/${r.total}頁`)),
    ...(r.done ? [note('すべての頁を受信した（図鑑のいちばん下で読める）')]
      : [el('div', { class: 'timebar' }, el('i', { style: { width: `${(r.charge / r.need) * 100}%` } })),
        note(`月面で勉強に正解するたびに電波がたまる（${r.charge}/${r.need}）。いっぱいになると、図鑑の頁が1つ開く`)]),
    ...majorPanel(app, { telescope: true }),
  ];
}
