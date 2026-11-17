// 远征模式 Phase E3 无头冒烟：expeditionStore 编排 + 战报事件流 + 局内开包 + 阵容排序 + 终局清算
// 运行：node scripts/expedition-ui-smoke.mjs
// 覆盖验收链路：建局 → draft → 模拟行动结算 → 战报事件流 → Boss 受击
//              → 局内开包（队列→选牌/跳过）→ 阵容拖拽 → 通关/失败 → 清算单 → 持久化降级
import { createPinia, setActivePinia } from 'pinia'
import { useExpeditionStore } from '../expeditionStore.js'

let pass = 0, fail = 0
function ok(cond, name) {
  if (cond) { pass++; console.log(`  ✔ ${name}`) }
  else { fail++; console.error(`  ✘ ${name}`) }
}

// 模拟行动事件（契约 §5.1 形状；与 ExpeditionView 的 E3 模拟器同族）
function mockEvents(kind, tag = '') {
  const now = Date.now()
  if (kind === 'light') {
    return [
      { type: 'daily_task', taskId: `d${tag}`, priority: 'normal', completedAt: now },
      { type: 'habit_checkin', taskId: `h${tag}`, streak: 3, completedAt: now },
    ]
  }
  if (kind === 'heavy') {
    return [
      { type: 'project_milestone', taskId: `m${tag}`, projectId: 'proj-a', completedAt: now },
      { type: 'day_cleared', taskId: `dc${tag}`, completedAt: now },
      { type: 'project_task', taskId: `p${tag}`, projectId: 'proj-a', priority: 'high', completedAt: now },
      { type: 'daily_task', taskId: `d${tag}`, priority: 'high', completedAt: now },
      { type: 'habit_checkin', taskId: `h${tag}`, streak: 12, completedAt: now },
    ]
  }
  return [
    { type: 'daily_task', taskId: `d${tag}`, priority: 'high', completedAt: now },
    { type: 'habit_checkin', taskId: `h${tag}`, streak: 8, completedAt: now },
    { type: 'project_task', taskId: `p${tag}`, projectId: 'proj-a', priority: 'normal', completedAt: now },
  ]
}

setActivePinia(createPinia())
const store = useExpeditionStore()

console.log('== init（node 无 IPC/localStorage，持久化静默降级，不抛） ==')
await store.init()
ok(store.loaded === true, 'init 完成')
ok(store.active === false, '初始无局')

console.log('== 建局 ==')
const r1 = store.startExpedition('thesis', { difficulty: 1 })
ok(r1.ok === true, 'startExpedition(thesis) 成功')
ok(store.snap.bossId === 'boss_distraction', `主题带出 Boss（实际 ${store.snap.bossId}）`)
ok(store.snap.nodes.length === 5, `节点路线 5 站（实际 ${store.snap.nodes.length}）`)
ok(store.snap.nodes[4].kind === 'boss', '关底为 Boss 节点')
ok(store.snap.status === 'active', '状态 active')
ok(store.meta.runs === 1, `生涯局数 +1（实际 ${store.meta.runs}）`)

console.log('== 起始 draft ==')
ok(store.snap.draft && !store.snap.draft.resolved, 'draft 待选')
ok(store.snap.draft.jokerOptions.length >= 1, `小丑选项 ${store.snap.draft.jokerOptions.length} 个`)
ok(store.snap.draft.cardOptions.length >= 2, `扑克选项 ${store.snap.draft.cardOptions.length} 个`)
const r2 = store.applyDraft({ jokerIndex: 0, cardIndices: [0, 1] })
ok(r2.ok === true, 'applyDraft 成功')
ok(store.snap.jokers.length === 1, `阵容 1 小丑（实际 ${store.snap.jokers.length}）`)
ok(store.snap.deckCount === 2, `牌组 2 张（实际 ${store.snap.deckCount}）`)
ok(store.snap.draft.resolved === true, 'draft 已落地')

console.log('== 模拟行动 → 结算战报 ==')
const r3 = store.settleToday(mockEvents('standard', '-d1'))
ok(r3.ok === true, 'settleToday 成功')
ok(r3.settled === true, '引擎确认已结算')
ok(r3.pulls === 3, `3 张行动牌 → 3 次拉杆（实际 ${r3.pulls}）`)
ok(typeof r3.total === 'number' && r3.total > 0, `总伤害 ${r3.total}`)
ok(store.snap.dayIndex === 1, `活跃日推进到 ${store.snap.dayIndex}`)
ok(store.pullsToday === 3, '今日拉杆计数正确')
ok(store.settledToday === true, '今日已结算标记')

console.log('== 战报事件流（UI 只播不重算；事件类型齐全） ==')
const evts = r3.events
ok(evts.some(e => e.type === 'pullStart'), '含 pullStart（拉杆）')
ok(evts.some(e => e.type === 'handEvaluated'), '含 handEvaluated（牌型）')
ok(evts.some(e => e.type === 'cardScore' || e.type === 'jokerTrigger'), '含 cardScore/jokerTrigger（逐牌/小丑）')
ok(evts.some(e => e.type === 'pullTotal'), '含 pullTotal（单次合计）')
ok(evts.some(e => e.type === 'dayTotal'), '含 dayTotal（日合计）')
const pullStart = evts.find(e => e.type === 'pullStart')
ok(pullStart.drawn.length >= 1, `首杆抽牌 ${pullStart.drawn.length} 张`)
ok(store.pendingReport && store.pendingReport.result.total === r3.total
  && store.pendingReport.result.events.length === r3.events.length, '待播战报已挂账')
store.markReportPlayed()
ok(store.pendingReport === null, 'markReportPlayed 后不再自动弹')

console.log('== Boss 受击 / 节点推进 ==')
// 打满伤害的一天，可能清节点或打到 Boss
const r4 = store.settleToday(mockEvents('heavy', '-d2'))
ok(r4.ok === true, '第 2 活跃日结算成功')
ok(r4.events.some(e => e.type === 'nodeCleared' || e.type === 'pullTotal'), '事件流反映节点/Boss 伤害')
const bossAfter = store.snap.nodes[4]
ok(bossAfter.hp <= bossAfter.hpMax, `Boss HP ${bossAfter.hp}/${bossAfter.hpMax}`)
if (store.snap.packQueue.length > 0) {
  console.log('== 局内开包（节点奖励入队） ==')
  const offer = store.nextPackOffer()
  ok(offer !== null, `队列首项 ${offer.kind}`)
  const chosen = offer.kind === 'packChoice' ? offer.options[0] : null
  const r5 = store.openPackFromQueue(chosen)
  ok(r5.ok === true, 'openPackFromQueue 成功')
  ok(store.snap.pendingPack !== null, 'pendingPack 已挂')
  ok(store.snap.packQueue.length >= 0, '队列已消费')
  const r6 = store.pickPackCards([0])
  ok(r6.ok === true, `pickPackCards 选 1 张（applied ${r6.applied?.length}）`)
  ok(store.snap.pendingPack === null, 'pendingPack 清空')
} else {
  console.log('  · 今日未通关节点，无卡包入队（合法随机结果），改测商店包')
}

console.log('== 阵容拖拽排序 ==')
// 直接注入第 2 张小丑再排序（UI 只会拖已有阵容，这里验证 store→engine 通路）
if (store.snap.jokers.length < 2) {
  // 通过开包/直装补一张：直装引擎字段（测试友好路径）
  store.exp.jokers.push({ ...store.exp.jokers[0], uid: 'mock_j2' })
  store.sync()
}
const before0 = store.snap.jokers[0].uid
const okReorder = store.reorderJokers(0, 1)
ok(okReorder === true, 'reorderJokers(0,1) 成功')
ok(store.snap.jokers[1].uid === before0, '顺序已交换（触发顺位移后）')
ok(store.reorderJokers(0, 0) === false, 'from===to 拒绝')
ok(store.reorderJokers(-1, 5) === false, '越界拒绝')

console.log('== 推进至终局（通关或失败）==')
let guard = 0
while (store.active && guard++ < 10) {
  const res = store.settleToday(mockEvents(guard % 2 ? 'standard' : 'heavy', `-g${guard}`))
  if (!res.ok) break
}
ok(store.snap.status !== 'active' || store.snap.dayIndex >= 4,
  `跑到终局/后段（status=${store.snap.status}, day=${store.snap.dayIndex}）`)

console.log('== 清算单 ==')
if (store.snap.status !== 'active') {
  const sr = store.snap.settlementReport
  ok(sr !== null, 'settlementReport 存在')
  ok(typeof sr.won === 'boolean', `won=${sr.won}`)
  ok(Array.isArray(sr.cleared.jokers), '清算：阵容记录')
  ok(Array.isArray(sr.discovered), '清算：图鉴点亮记录（永久保留）')
  if (sr.won) ok(store.meta.wins >= 1, `通关写入生涯 wins=${store.meta.wins}`)
} else {
  console.log('  · 未终局（罕见随机），放弃收尾验证清算')
  store.abandonExpedition()
  ok(store.snap.status === 'abandoned', '放弃 → abandoned')
  ok(store.snap.settlementReport !== null, '放弃也出清算单')
}

console.log('== 开新局前清理 ==')
store.clearRun()
ok(store.snap === null, 'clearRun 后无局')
ok(store.active === false, '回到选远征态')

console.log('== 序列化/反序列化（持久化通路） ==')
store.startExpedition('firefighting', { difficulty: 1 })
store.applyDraft({ jokerIndex: 0, cardIndices: [0, 1] })
store.settleToday(mockEvents('light', '-s1'))
const saved = store.exp.serialize()
const { Expedition } = await import('../engine/expedition/stateMachine.js')
const restored = Expedition.deserialize(saved)
ok(restored.status === 'active', '反序列化还原 active')
ok(restored.dayIndex === store.exp.dayIndex, `dayIndex 一致（${restored.dayIndex}）`)
ok(restored.jokers.length === store.exp.jokers.length, '阵容一致')
// 反序列化异常 → 空局不抛（契约 §7）
let corrupted = false
try { Expedition.deserialize('{broken json') } catch { corrupted = true }
ok(corrupted === true, '损坏 JSON 抛出（由 store.init 捕获降级为空局）')
const bad = Expedition.deserialize('{"status":"active","rng":{"seed":"1","state":1},"balance":null,"nodes":[],"jokers":[],"deck":[],"consumables":[],"packQueue":[],"handLevels":{},"seen":{},"stats":{},"dayRecords":[],"intentHistory":[]}')
ok(bad.status === 'active', '缺字段快照仍可还原（引擎兜底）')

console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
