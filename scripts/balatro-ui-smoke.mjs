// Balatro Phase 2 无头冒烟：store 编排 + 快照派生值/价格注入 + 事件流
// 运行：node scripts/balatro-ui-smoke.mjs
import { createPinia, setActivePinia } from 'pinia'
import { useBalatroStore } from '../src/balatro/store.js'

let pass = 0, fail = 0
function ok(cond, name) {
  if (cond) { pass++; console.log(`  ✔ ${name}`) }
  else { fail++; console.error(`  ✘ ${name}`) }
}

setActivePinia(createPinia())
const store = useBalatroStore()

console.log('== init ==')
await store.init()
ok(store.loaded === true, 'init 完成')
ok(store.screen === 'menu', `无存档时落在 menu（实际 ${store.screen}）`)

console.log('== newRun ==')
store.newRun('deck_red')
ok(store.screen === 'blind', `开局进入盲注选择（实际 ${store.screen}）`)
ok(store.run.meta?.jokerSlots === 5, `meta.jokerSlots=5（实际 ${store.run.meta?.jokerSlots}）`)
ok(store.run.meta?.consumableSlots === 2, `meta.consumableSlots=2（实际 ${store.run.meta?.consumableSlots}）`)
ok(store.run.meta?.handSize === 8, `meta.handSize=8（实际 ${store.run.meta?.handSize}）`)

console.log('== selectBlind ==')
store.selectBlind()
ok(store.screen === 'round', '进入回合')
ok(store.run.round.hand.length === 8, `手牌 8 张（实际 ${store.run.round.hand.length}）`)
ok(store.run.round.handsLeft === 4, `出牌次数 4（实际 ${store.run.round.handsLeft}）`)

console.log('== 出牌循环（直到离开 round）==')
let guard = 0
while (store.screen === 'round' && guard++ < 40) {
  const hand = store.run.round.hand
  // 简单策略：选点数最高的至多 5 张
  const picks = [...hand].sort((a, b) => b.rank - a.rank).slice(0, Math.min(5, hand.length))
  for (const c of picks) store.toggleCardSelect(c.id)
  try {
    store.playSelected()
  } catch (e) {
    // Boss 限制等：清空选择后弃牌
    for (const c of picks) store.toggleCardSelect(c.id)
    try { store.discardSelected() } catch { for (const id of [...store.selectedCardIds]) store.toggleCardSelect(id); break }
    for (const id of [...store.selectedCardIds]) store.toggleCardSelect(id)
    const d = [...store.run.round.hand].slice(0, 1)
    store.toggleCardSelect(d[0].id)
    try { store.discardSelected() } catch { break }
  }
}
ok(guard < 40, `出牌循环收敛（${guard} 手）`)
ok(['shop', 'runEnd', 'victory'].includes(store.screen) || store.run?.state === 'runOver',
  `回合结束去向合法（screen=${store.screen}）`)

const evts = store.scoreEvents
ok(evts.some(e => e.type === 'handEvaluated'), '事件流含 handEvaluated')
ok(evts.some(e => e.type === 'final'), '事件流含 final')
ok(evts.some(e => e.type === 'cardScore' || e.type === 'heldCard' || e.type === 'jokerTrigger'), '事件流含计分条目')
const final = [...evts].reverse().find(e => e.type === 'final')
console.log(`  · 最后一手：chips=${final?.chips} mult=${final?.mult} total=${final?.total}`)

if (store.screen === 'shop') {
  console.log('== 商店 ==')
  const shop = store.run.shop
  ok(Array.isArray(shop.cards) && shop.cards.length >= 2, `商品槽 ${shop.cards.length} 个`)
  ok(shop.cards.every(c => typeof c.price === 'number'), '商品价格已注入快照')
  ok(shop.packs.length === 2 && shop.packs.every(p => typeof p.price === 'number'), '卡包价格已注入快照')
  ok(typeof shop.voucherPrice === 'number', `优惠券价格已注入（$${shop.voucherPrice}）`)
  ok(store.lastCashout && typeof store.lastCashout.reward === 'number', '结算明细存在')
  console.log(`  · 现金 $${store.run.money}，商品：${shop.cards.map(c => `${c.kind}:${c.id}($${c.price})`).join(', ')}`)
  // 买得起就买第一个
  const affordable = shop.cards.findIndex(c => (c.price ?? 99) <= store.run.money && c.kind !== 'joker')
  if (affordable >= 0) {
    const before = store.run.money
    store.buyShopItem(affordable)
    ok(store.run.money < before, '购买扣款成功')
  }
  // 买卡包 → pack 流程
  const packIdx = store.run.shop.packs.findIndex(p => (p.price ?? 99) <= store.run.money)
  if (packIdx >= 0) {
    store.buyPack(packIdx)
    ok(store.screen === 'pack', '购买卡包进入开包界面')
    const ps = store.run.packState
    ok(ps.options.length === ps.def.count, `卡包选项 ${ps.options.length}/${ps.def.count}`)
    store.skipPack()
    ok(store.screen === 'shop', '跳过卡包回到商店')
  }
  store.leaveShop()
  ok(store.screen === 'blind', `离开商店进入下一盲注（实际 ${store.screen}）`)
} else {
  console.log(`  · （本局在 Ante ${store.run.ante} 终结，screen=${store.screen}，属正常随机结果）`)
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
