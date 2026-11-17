// Balatro Phase 3 无头测试：卡包全开 / 目标消耗牌 / 优惠券 / Boss 快照 / 标签
// 运行：node scripts/balatro-phase3-test.mjs
import { createPinia, setActivePinia } from 'pinia'
import { useBalatroStore } from '../src/balatro/store.js'
import { BalatroRun } from '../src/balatro/engine/run.js'
import { PACKS_BY_ID, JOKERS_BY_ID, SPECTRAL_BY_ID } from '../src/balatro/data/index.js'
import { computePlayRules, consumableTargetSpec, packOptionRare } from '../src/balatro/playRules.js'

let pass = 0, fail = 0
function ok(cond, name) {
  if (cond) { pass++; console.log(`  ✔ ${name}`) }
  else { fail++; console.error(`  ✘ ${name}`) }
}
function expectThrow(fn, code, name) {
  try { fn(); fail++; console.error(`  ✘ ${name}（未抛出 ${code}）`) }
  catch (e) {
    if (String(e.message).includes(code)) { pass++; console.log(`  ✔ ${name}`) }
    else { fail++; console.error(`  ✘ ${name}（抛出的是 "${e.message}"）`) }
  }
}

setActivePinia(createPinia())
const store = useBalatroStore()

// ============ 1. 纯函数：目标规格 / Boss 约束 / 稀有判定 ============
console.log('== consumableTargetSpec ==')
ok(consumableTargetSpec({ effect: { handler: 'death' } }).max === 2 &&
   consumableTargetSpec({ effect: { handler: 'death' } }).min === 2, '死神：恰好 2 张')
ok(consumableTargetSpec({ effect: { handler: 'destroyCards', params: { count: 2 } } }).max === 2, '倒吊人：至多 2 张')
ok(consumableTargetSpec({ effect: { handler: 'convertSuit', params: { count: 3 } } }).max === 3, '花色转换：至多 3 张')
ok(consumableTargetSpec({ effect: { handler: 'enhance', params: { count: 2 } } }).min === 1, '增强类：至少 1 张')
ok(consumableTargetSpec({ effect: { handler: 'addSeal' } }).max === 1, '蜡封类：1 张')
ok(consumableTargetSpec({ effect: { handler: 'hermit' } }) === null, '隐者：无需目标')
ok(consumableTargetSpec({ type: 'planet', effect: { handler: 'planet' } }) === null, '星球：无需目标（立即生效）')

console.log('== computePlayRules ==')
ok(computePlayRules(null).exactCount === 0, '无回合：无约束')
ok(computePlayRules({ boss: { effect: { handler: 'psychic' } }, handTypesPlayed: [] }).exactCount === 5, '通灵者：必须 5 张')
ok(computePlayRules({ boss: { effect: { handler: 'eye' } }, handTypesPlayed: ['pair'] }).bannedTypes.includes('pair'), '眼睛：禁已出牌型')
ok(computePlayRules({ boss: { effect: { handler: 'mouth' } }, handTypesPlayed: ['flush'] }).forcedType === 'flush', '嘴巴：锁定牌型')
ok(computePlayRules({ boss: { effect: { handler: 'debuffSuit', params: { suit: 'clubs' } } }, handTypesPlayed: [] }).debuffSuit === 'clubs', '梅花：花色削弱标记')
ok(computePlayRules({ boss: { effect: { handler: 'plant' } }, handTypesPlayed: [] }).debuffFace === true, '植物：人头牌削弱标记')
ok(computePlayRules({ boss: { effect: { handler: 'crimsonHeart' } }, handTypesPlayed: [] }).jokerDisabled === true, '绯红之心：小丑禁用标记')
ok(computePlayRules({ boss: { effect: { handler: 'psychic' } }, bossDisabled: true, handTypesPlayed: [] }).exactCount === 0, 'Boss 已禁用：无约束')

console.log('== packOptionRare ==')
const someRareJoker = Object.values(JOKERS_BY_ID).find(j => j.rarity === 3)
const someCommonJoker = Object.values(JOKERS_BY_ID).find(j => j.rarity === 1)
ok(packOptionRare({ kind: 'joker', id: someRareJoker.id }, JOKERS_BY_ID, SPECTRAL_BY_ID) === true, `稀有小丑（${someRareJoker.name}）触发悬念`)
ok(packOptionRare({ kind: 'joker', id: someCommonJoker.id }, JOKERS_BY_ID, SPECTRAL_BY_ID) === false, '普通小丑不触发')
ok(packOptionRare({ kind: 'spectral', id: 's_soul' }, JOKERS_BY_ID, SPECTRAL_BY_ID) === true, '灵魂触发悬念')
ok(packOptionRare({ kind: 'tarot', id: 'c_fool' }, JOKERS_BY_ID, SPECTRAL_BY_ID) === false, '塔罗不触发')

// ============ 2. 卡包全开（store 层，15 种规格） ============
console.log('== 卡包全开（5 类 × 3 规格） ==')
for (const type of ['arcana', 'celestial', 'standard', 'spectral', 'buffoon']) {
  for (const size of ['normal', 'jumbo', 'mega']) {
    const id = `pack_${type}_${size}`
    const def = PACKS_BY_ID[id]
    store.newRun('deck_red')
    store.openPack(id)
    const ps = store.run.packState
    const goodShape = store.screen === 'pack' && ps.options.length === def.count && ps.def.choose === def.choose
    const jokersBefore = store.run.jokers.length
    const consumBefore = store.run.consumables.length
    const deckBefore = store.run.fullDeck.length
    const picks = def.choose === 2 ? [0, 1] : [0]
    let granted = true
    try { store.pickPackCards(picks) } catch (e) { granted = false; console.error(`    ${id} 选牌异常: ${e.message}`) }
    let deltaOk = true
    if (def.contents === 'joker') deltaOk = store.run.jokers.length === jokersBefore + def.choose
    else if (def.contents === 'playing') deltaOk = store.run.fullDeck.length === deckBefore + def.choose
    else deltaOk = store.run.consumables.length === consumBefore + def.choose
    ok(goodShape && granted && deltaOk && store.screen === 'blind',
      `${def.name}（${def.count} 选 ${def.choose}）开启并入栏`)
  }
}

console.log('== 卡包栏位限制 ==')
store.newRun('deck_red')
for (let k = 0; k < 5; k++) { store.openPack('pack_buffoon_normal'); store.pickPackCards([0]) }
ok(store.run.jokers.length === 5, `5 包后小丑满栏（${store.run.jokers.length}/5）`)
store.openPack('pack_buffoon_normal')
expectThrow(() => store.pickPackCards([0]), 'no joker slot', '满栏再拿小丑抛出 no joker slot')
store.skipPack()

// ============ 3. 目标消耗牌（引擎层，与 store.useConsumable 同路径） ============
console.log('== 死神（左变右） ==')
{
  const run = new BalatroRun({ deckId: 'deck_red', seed: 'p3_death' })
  run.selectBlind()
  const hand = run.round.hand
  let li = 0, ri = 1
  if (hand[li].rank === hand[ri].rank && hand[li].suit === hand[ri].suit) ri = 2
  const left = hand[li], right = hand[ri]
  const before = { rank: left.rank, suit: left.suit }
  run.createConsumable('c_death')
  run.useConsumable(run.consumables[0].uid, [left.id, right.id])
  ok(left.rank === right.rank && left.suit === right.suit &&
    (before.rank !== right.rank || before.suit !== right.suit),
    `左牌 ${before.rank}/${before.suit} → ${right.rank}/${right.suit}`)
}

console.log('== 倒吊人（销毁至多 2 张） ==')
{
  const run = new BalatroRun({ deckId: 'deck_red', seed: 'p3_hanged' })
  run.selectBlind()
  const deckBefore = run.fullDeck.length
  const handBefore = run.round.hand.length
  const victims = run.round.hand.slice(0, 2).map(c => c.id)
  run.createConsumable('c_hanged_man')
  run.useConsumable(run.consumables[0].uid, victims)
  ok(run.fullDeck.length === deckBefore - 2 && run.round.hand.length === handBefore - 2,
    `牌堆 ${deckBefore}→${run.fullDeck.length}，手牌 ${handBefore}→${run.round.hand.length}`)
  ok(victims.every(id => !run.fullDeck.some(c => c.id === id)), '被销毁牌不在牌堆中')
}

// ============ 4. 优惠券（引擎层） ============
console.log('== 优惠券购买与永久生效 ==')
{
  const run = new BalatroRun({ deckId: 'deck_red', seed: 'p3_voucher' })
  run.enterShop()
  run.money = 100
  run.shop.voucher = 'v_grabber'
  const handsBefore = run.handsTotal()
  run.buyVoucher()
  ok(run.vouchers.includes('v_grabber'), '已持有抓取器')
  ok(run.handsTotal() === handsBefore + 1, `每回合出牌 ${handsBefore}→${run.handsTotal()}`)
  ok(run.money === 90 && run.shop.voucher === null, `扣款 $10（余 $${run.money}）且券位移空`)
  // 序列化往返后仍生效
  const restored = BalatroRun.deserialize(run.serialize())
  ok(restored.vouchers.includes('v_grabber') && restored.handsTotal() === handsBefore + 1, '存档往返后优惠券仍生效')
}

// ============ 5. Boss 效果快照（引擎层 + playRules 同源函数） ============
console.log('== 植物：人头牌削弱到达快照 ==')
{
  const run = new BalatroRun({ deckId: 'deck_red', seed: 'p3_plant' })
  run.bossId = 'bl_plant'
  run.blindIndex = 2
  run.selectBlind()
  const faces = run.round.hand.filter(c => c.rank >= 11 && c.rank <= 13)
  const snap = run.serialize()
  const snapFaces = snap.round.hand.filter(c => c.rank >= 11 && c.rank <= 13)
  ok(run.round.boss?.effect?.handler === 'plant', 'Boss 为植物')
  ok(faces.length > 0 && faces.every(c => c.debuffed), `手牌 ${faces.length} 张人头牌全部 debuffed`)
  ok(snapFaces.every(c => c.debuffed === true), '快照中 debuffed 标记完整（UI 可读）')
  ok(computePlayRules(run.round).debuffFace === true, 'playRules.debuffFace 置位')
}

console.log('== 通灵者：5 张约束到达 UI 层 ==')
{
  const run = new BalatroRun({ deckId: 'deck_red', seed: 'p3_psychic' })
  run.bossId = 'bl_psychic'
  run.blindIndex = 2
  run.selectBlind()
  ok(computePlayRules(run.round).exactCount === 5, 'playRules.exactCount=5')
  expectThrow(() => run.playCards(run.round.hand.slice(0, 4).map(c => c.id)), 'must play 5', '出 4 张被引擎拒绝')
}

console.log('== 绯红之心：小丑禁用到达快照 ==')
{
  const run = new BalatroRun({ deckId: 'deck_red', seed: 'p3_crimson' })
  run.createJoker({ id: 'j_joker' })
  run.createJoker({ id: 'j_greedy_joker' })
  run.bossId = 'bl_crimson_heart'
  run.blindIndex = 2
  run.selectBlind()
  const debuffed = run.jokers.filter(j => j.debuffed)
  ok(debuffed.length === 1, `恰好 1 张小丑被禁用（实际 ${debuffed.length}）`)
  const snap = run.serialize()
  ok(snap.jokers.filter(j => j.debuffed).length === 1, '快照中禁用标记完整（JokerBar 变灰可读）')
}

// ============ 6. store：牌型预览 / 生产力卡包 / 标签快照 ============
console.log('== evaluateSelection（Boss gating 用） ==')
store.newRun('deck_red')
store.selectBlind()
{
  const ids = store.run.round.hand.slice(0, 2).map(c => c.id)
  for (const id of ids) store.toggleCardSelect(id)
  const ht = store.evaluateSelection(store.selectedCardIds)
  ok(typeof ht === 'string' && ht.length > 0, `2 张牌预览牌型 = ${ht}`)
  ok(store.run.meta?.playRules && typeof store.run.meta.playRules === 'object', '快照 meta.playRules 存在')
}

console.log('== claimPendingPack（生产力免费卡包） ==')
{
  store.newRun('deck_red')
  for (let k = 0; k < 10; k++) store.grantProductivityReward({})
  ok(store.productivity.pendingPacks.length === 1, `10 次打卡攒 1 个免费包（实际 ${store.productivity.pendingPacks.length}）`)
  const claimed = store.claimPendingPack()
  ok(claimed === true && store.screen === 'pack', '领取后进入开包')
  ok(store.run.packState.def.packType === 'buffoon', `卡包类型 = ${store.run.packState.def.packType}`)
  ok(store.productivity.pendingPacks.length === 0, '待领取队列已清空')
  store.skipPack()
  ok(store.screen === 'blind', '跳过后回到盲注选择')
}

console.log('== 标签快照（跳过盲注） ==')
{
  store.newRun('deck_red')
  store.skipBlind()
  ok(Array.isArray(store.run.meta?.recentTags) && store.run.meta.recentTags.length >= 1,
    `recentTags 记录 = ${JSON.stringify(store.run.meta?.recentTags)}`)
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
