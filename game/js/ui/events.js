// ゲームの計算で起きたこと（tick などが返す events）を、知らせ・札・ミニムービーにする。2026-11-09 に main.js から分けた
import { trackGain, stageFor, ADVISOR_PLACES } from '../sim.js';
import { MAJOR_SLOTS } from '../fields.js';
import { fmt } from './dom.js';
import { askNande } from './nande.js';
import { profChangeText } from './proflog.js';
import { showing as recallShowing } from './recall.js';

/**
 * events を受け取って知らせる関数（handleEvents）を作る（main.js の起動で1回だけ）。
 * 知らせ（notify・runOverlay）・札（rumorDefeated・notifyFirstZukan・notifyMisbeliefs）・ミニムービー（startMovie・startAilmentMovie・onReincarnated）は main.js から渡す
 */
export function createEventHandler(app, { notify, runOverlay, startMovie, startAilmentMovie, onReincarnated, rumorDefeated, notifyFirstZukan, notifyMisbeliefs }) {
  const ctx = app.ctx;
  const monsters = ctx.monsters;
  const balance = ctx.balance;

  /** やられたとき：1つ手前の階層の最初からやり直す（全回復。熟練の判定はしない） */
  function notifyDefeat(e) {
    const at = (floor) => `${e.world === 'moon' ? '月面' : ''}${floor}階層`;
    notify(`${app.state.hero.name}はやられた…　${at(e.floor)}の最初からやり直す（HPとMPが全回復した）`, 'bad');
  }
  /** 誕生日：熟練が変わったときだけ知らせる（全回復は毎年。熟練の記録に残る） */
  function notifyBirthday(e) {
    if (!e.changes.length) return;
    const lines = [`${e.age}歳の誕生日！　熟練の判定`];
    for (const c of e.changes) lines.push(`${c.genre} ${profChangeText(c)}`);
    notify(lines.join('\n'), e.changes.some((c) => c.to < c.from) ? '' : 'good');
  }

  function handleEvents(events) {
    app.renderer.onEvents(events, performance.now() / 1000);
    const met = [];
    const found = []; // 新しく解放した学際分野（まとめて知らせる）
    const misbelief = [];
    // 初めて倒したザコが噂のザコなら、正体の札と図鑑の1体目の札を1枚にする
    let firstZukan = events.find((e) => e.type === 'firstZukan') || null;
    for (const e of events) {
      if (e.type === 'defeat') {
        trackGain(app.rate, e.exp, e.gold);
        if (e.kind === 'midboss') startMovie(monsters.find((m) => m.id === e.monsterId));
        if (rumorDefeated(e.uid, firstZukan)) firstZukan = null;
      }
      else if (e.type === 'misbelief') misbelief.push(e);
      else if (e.type === 'firstZukan') { if (firstZukan) notifyFirstZukan(e); }
      else if (e.type === 'nande') runOverlay(() => askNande(app));
      else if (e.type === 'reincarnated') onReincarnated(e);
      else if (e.type === 'ailment') startAilmentMovie(e.age);
      // 前世の記憶をたどるを出している間は、レベルアップと「図鑑に載った」は知らせない（最初は次々に来て、問題と戦いの様子を隠すため）
      else if (e.type === 'levelUp') { if (!recallShowing()) notify(`${app.state.hero.name}のレベルが上がった！　Lv ${e.level}`, 'good'); }
      else if (e.type === 'floorUp') {
        // 10階層ごとに世界が変わる。新しい世界の最初の階層では世界の名前を出す（月面の階層は「月面◯階層」）
        const st = stageFor(e.floor, app.stages, e.world);
        if (e.world === 'moon') notify(`月面${e.floor}階層に進んだ`);
        else notify(st && st.from === e.floor && e.floor > 1 ? `${e.floor}階層　${st.name}に入った` : `${e.floor}階層に進んだ`);
      }
      else if (e.type === 'heroDefeated') notifyDefeat(e);
      else if (e.type === 'birthday') notifyBirthday(e);
      else if (e.type === 'scaffold') notify(`足場（構造工学）：ボス「${e.name}」には前の挑戦のダメージが残っている（残りHP ${Math.round(e.left * 100)}%）`, 'good');
      else if (e.type === 'retreat') notify(`${e.name}から逃げた。また挑戦できる`);
      else if (e.type === 'challengeHeal') notify(`HP・MPが全回復した。${e.name}との戦いだ！`, 'good');
      else if (e.type === 'midbossReady') notify(`${e.name}に挑戦できるようになった！\n冒険画面の「挑戦する」を押すと戦える`, 'good');
      else if (e.type === 'midbossBroken') notify(`${(monsters.find((m) => m.id === e.monsterId) || {}).name || '中ボス'}の防御が崩れた！`, 'good');
      else if (e.type === 'spawn' && e.kind === 'boss') {
        // 月面のボスは仕掛けを持つ（monsters.json の gimmickNote）
        const m = monsters.find((x) => x.id === e.monsterId) || {};
        notify(`ボス「${e.name}」が現れた！${m.gimmickNote ? `\n${m.gimmickNote}` : ''}`, 'bad');
      }
      else if (e.type === 'bossDefeated') {
        const m = monsters.find((x) => x.id === e.monsterId) || {};
        notify(`ボス「${e.name}」を倒した！${e.learned ? '\n図鑑に「なぜ信じられたか」が載った' : ''}${m.remains ? `\n${m.remains.note}` : ''}`, 'good');
      }
      else if (e.type === 'minions') notify(e.called.length ? `${e.name}が手下を呼んだ：${e.called.join('・')}` : `${e.name}の手下は来なかった（図鑑で正体を知っているので）`, e.called.length ? 'bad' : 'good');
      else if (e.type === 'minionsFled') notify(`手下の${e.names.join('・')}は逃げていった`);
      else if (e.type === 'smoothMarked') notify(e.marks >= e.max ? `${e.name}に山と影が描き足された！　もう攻撃は滑らない` : `${e.name}に山と影が描き足された！　攻撃が少し効くようになった`, 'good');
      else if (e.type === 'radioPage') notify(`宇宙からの電波を受信した！（月面の街の裏側の電波望遠鏡）\n図鑑「${ctx.radio.title}」に「${e.name}」が載った（${e.opened}/${e.total}）`, 'good');
      else if (e.type === 'split') notify(`${e.name}が地球と月に分かれた！\n両方をほぼ同時に倒そう（片方だけだと元に戻る）`, 'bad');
      else if (e.type === 'partDown') notify(`${e.part === 'earth' ? '地球' : '月'}のほうを倒した！　急いでもう片方も`, 'good');
      else if (e.type === 'merged') notify(`${e.name}が元の1体に戻った…`, 'bad');
      else if (e.type === 'allySunk') notify(`${e.name}が塵に沈んで動けない！`, 'bad');
      else if (e.type === 'alliesFreed') notify(`${e.names.join('・')}が塵から出てきた`, 'good');
      else if (e.type === 'moonCleared') notify(e.first ? `月面を踏破した！　称号「${e.title}」を手に入れた\n図鑑に「${e.page}」の頁が開いた` : `月面をまた踏破した！`, 'good');
      else if (e.type === 'authorRights') {
        notify(e.first ? `作問権を手に入れた！\n${e.genres.join('・')}の問題を作って送れる（勉強の「作問」から）` : `作問できるジャンルが増えた：${e.genres.join('・')}`, 'good');
      }
      else if (e.type === 'taxPaid') {
        // 決算（法人化した会社の法人税）
        const lines = [`決算：法人税 ${fmt(e.tax)}G を納めた（今年の法人の利益 ${fmt(e.earned)}G）`];
        if (e.saved > 0) lines.push(`税務調査官のおかげで ${fmt(e.saved)}G 安くなった`);
        if (e.owed > 0) lines.push(`${fmt(e.owed)}G 足りなかった。このあとの会社の利益から払う`);
        notify(lines.join('\n'), e.owed > 0 ? 'bad' : '');
      }
      else if (e.type === 'allyJoined') {
        // 顧問にもできる中ボスなら、置く場所と役目も知らせる
        const adv = (ctx.monsters.find((m) => m.id === e.id) || {}).advisor;
        const tip = adv && !adv.soon ? `\n${ADVISOR_PLACES[adv.place]}の顧問（${adv.role}）にもできる` : '';
        notify((e.benched ? `${e.name}が仲間になった！\nパーティーがいっぱいなので控えにいる（仲間が集まる場所で入れ替えられる）` : `${e.name}が仲間になった！`) + tip, 'good');
      }
      else if (e.type === 'barnFriendly') notify(`${e.name}がすっかり懐いた！（${e.barn}）\n誕生日に贈り物を持ってきたり、${e.name}の問題で誤答を1つ消してくれたりする`, 'good');
      else if (e.type === 'barnReformed') notify(`${e.name}が自分の誤解に気づいた！（更生）\n${e.barn}で触ると、本当のことを話してくれる`, 'good');
      else if (e.type === 'barnGift') notify(`${e.age}歳の誕生日。${e.name}から贈り物：${e.itemName ? `${e.itemName}（装備した）` : `${fmt(e.gold)}G`}`, 'good');
      else if (e.type === 'barnRoom') notify(`${e.barn}の部屋が増えた！（${e.rooms}部屋。${e.genre} Lv${e.level}）\n${e.world === 'moon' ? '月面の街の飼育ドーム' : '街の飼育小屋'}で、ザコの部屋分けと部屋の背景を選べる`, 'good');
      else if (e.type === 'barnJoin') notify(`${e.name}がなついて、${e.barn}に入った！\n${e.world === 'moon' ? '月面の街' : '街'}の${e.world === 'moon' ? '飼育ドーム' : '飼育小屋'}で見られる`, 'good');
      else if (e.type === 'titleGained') notify(`称号「${e.title}」を手に入れた！`, 'good');
      else if (e.type === 'contractEnded') notify(`ゴールドが足りず、${e.name}との契約が切れた`, 'bad');
      else if (e.type === 'fieldUnlocked') found.push(e);
      else if (e.type === 'fieldDormant' && e.slot >= 0) notify(`${MAJOR_SLOTS[e.slot]}の${e.name}が休眠した（${e.low.map((x) => `${x.genre} Lv${x.level}`).join('・')}）\n熟練をLv${balance.fields.unlockLevel}に戻すと復活する`, 'bad');
      else if (e.type === 'fieldAwake' && e.slot >= 0) notify(`${e.name}が休眠から復活した！`, 'good');
      else if (e.type === 'rocketStepDone') notify(`ロケット計画：「${e.name}」が完了した！\n（生まれ変わっても残る）`, 'good');
      else if (e.type === 'zukan' && e.stage === 1) {
        const m = monsters.find((x) => x.id === e.monsterId);
        if (m && !met.includes(m.name)) met.push(m.name);
      }
    }
    if (misbelief.length) notifyMisbeliefs(misbelief);
    // 群れで初めて会った魔物は1つの知らせにまとめる（噂のザコは噂の札で出すので、ここには入れない）
    const metOthers = met.filter((name) => !misbelief.some((e) => e.believed && e.name === name));
    if (metOthers.length && !recallShowing()) notify(`図鑑に載った：${metOthers.join('・')}`);
    // 学際分野の解放（前のセーブで、もう条件を満たしていたときは一度にいくつも来る）
    if (found.length === 1 && found[0].hidden) notify(`隠しの学際分野「${found[0].name}」を見つけた！\n称号「${found[0].title}」を手に入れた`, 'good');
    else if (found.length === 1) notify(`学際分野「${found[0].name}」を解放した！（${found[0].genres.join('＋')}）\n称号「${found[0].title}」を手に入れた。街の「学校・研究室」で専攻にすると効果が出る`, 'good');
    else if (found.length) notify(`学際分野を解放した：${found.map((e) => e.name).join('・')}\n称号も手に入れた。街の「学校・研究室」で専攻にすると効果が出る`, 'good');
  }

  return handleEvents;
}
