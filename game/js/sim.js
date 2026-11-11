// ゲームの計算の入口。中身は sim/ の話題ごとのファイルにある（2026-11-09 に1つのファイルから分けた）。
// ほかのファイルとテストは、今までどおりここから読み込む（ここに並べた名前が、外から使える名前）。
// 話題ごとのファイルどうしは、互いに必要な名前を import し合う（読み込んだときに動く処理は置かない）。

// ゲームの計算（描画しない・ブラウザの機能に触らない）。
// 乱数は ctx.rng（0以上1未満を返す関数）で受け取る。テストで固定できるようにするため。
//
// ctx = { balance, monsters, items, recruits, business, fields, stages, radio（月面の電波望遠鏡の図鑑の頁）, rng }
//   balance  … data/balance.json
//   monsters … data/monsters.json の monsters 配列
//   items    … data/items.json の items 配列
//   recruits … data/recruits.json の recruits 配列（仲間が集まる場所で契約できる仲間）
//   business … data/business.json（会社の業種）
//   fields   … data/fields.json（学際分野。計算は fields.js）

export { HOURS_PER_YEAR, HOURS_PER_MONTH, DEFAULT_HERO_NAME, HERO_NAME_MAX, GENDERS } from './sim/core.js';
export { createState, sanitizeName, renameHero, setHeroLevel, startGame, honorific, canStartAt } from './sim/state.js';
export { ageYears, gameDate, formatDate, createClock, clockFrame, createRateTracker, trackTime, trackGain, trackRates, monthlyRates } from './sim/time.js';
export { EQUIP_SLOTS, ITEM_STATS, heroStats, expMultiplier, heroAttackInterval, spellDamage, expToNext, monsterStats, calcDamage, isInvulnerable } from './sim/stats.js';
export { genreState, zukanEntry, raiseZukan, midbossState, midbossLeft, breakMidbosses, bossState, heroTitles, updateAuthorRights, authorRightsInfo } from './sim/knowledge.js';
export { lifespanFor, lifespanOf, ailmentAge, heroLooksOld, treatmentInfo, receiveTreatment, proficiencyCap, generationMultiplier, reincarnate, forgetPastLifeBosses } from './sim/life.js';
export { worldOf, onMoon, strengthFloor, moonRamp, floorStats, zakoPool, stageRange, areaLabels, stageFor, currentStage, farthestReached } from './sim/world.js';
export { MINION_SLOT, PART_SLOT, gimmickIn, newspaperActive, bossMinions, smoothDamage, markSmooth, hearRadio, radioInfo } from './sim/moon.js';
export { chooseNextMonster, frontEnemy, spawnGroup, spawnEnemy, damageEnemy, healEnemy, gainExp } from './sim/battle.js';
export { pendingMidboss, pendingBoss, challengeableMidboss, challengeMidboss, retreatMidboss, nandeAnswered, nandeUnanswered } from './sim/midboss.js';
export { tick } from './sim/tick.js';
export { reachedFloor, floorAreas, moveToFloor } from './sim/floors.js';
export { PROF_LOG_MAX, logProficiency, lifeLogHighlights, birthday } from './sim/birthday.js';
export { inParty, partyAllies, partyMax, partyFull, setInParty, fitParty, recruitById, isStaff, recruitUnlocked, recruitList, monthlyContractCost, monthlyNetGold, hireRecruit, dismissRecruit, payContracts } from './sim/allies.js';
export { ADVISOR_PLACES, advisorDef, advisorSlots, advisorsAt, advisorActive, setAdvisor, hrFactor, rocketBuildCost, citationsLeft, nextBoss } from './sim/advisor.js';
export { industryById, canFound, industryList, foundCompany, closeCompany, bestStaffGrade, staffCost, staffBonus, hireStaff, dismissStaff, companyProfit, industryOutlook, companiesProfit, LAW_ECONOMICS, canIncorporate, incorporate, corporateTax, settleTaxes } from './sim/company.js';
export { rocketSteps, payRocketBuildCost, launchRateVisible, launchSuccessRate, launchInfo, launchRocket, returnToEarth } from './sim/rocket.js';
export { BARN_NAMES, barnAnimals, barnCapacity, tameZako, ROOM_NAME_MAX, defaultRoomName, barnRoomsOf, roomIndex, barnRoomInfo, syncBarnRooms, moveToRoom, renameBarnRoom, barnBackgrounds, barnBackgroundById, roomBackground, setRoomBackground, barnRoomList, ETHOLOGY, joinChance, affinityRate, barnEntry, affinityOf, isFriendly, isReformed, raiseAffinity, touchZako, seeOffFriends, isSpaceDog, prototypeEffect, prototypeInfo, flyPrototype } from './sim/barn.js';
export { isMoonItem, transportCost, itemBodyPrice, itemPrice, shopList, buyItem, equipItem } from './sim/shop.js';
export { FIRST_LIFE_FLOORS, rememberedZako, summonRemembered, zakoZukanCount, lifeBar, expBar, heroSnapshot, compareSnapshots } from './sim/firstrun.js';
