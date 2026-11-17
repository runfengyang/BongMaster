// Balatro Phase 4 联动无头测试：生产力奖励 / 图鉴发现 / localStorage 存档往返
// 运行：node scripts/balatro-integration-test.mjs

// 模拟浏览器 localStorage（验证纯网页预览降级链路 §5.5）
const mem = new Map()
globalThis.localStorage = {
  getItem: k => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: k => mem.delete(k),
}

const { createPinia, setActivePinia } = await import('pinia')
const { useBalatroStore } = await import('../src/balatro/store.js')

let pass = 0, fail = 0
function ok(cond, name) {
  if (cond) { pass++; console.log(`  ✔ ${name}`) }
  else { fail++; console.error(`  ✘ ${name}`) }
}

setActivePinia(createPinia())
const store = useBalatroStore()
await store.init()
ok(store.loaded === true, 'init（localStorage 降级链路可用）')

console.log('== 启动恢复：损坏牌局不清空收藏 ==')
{
  mem.set('balatro:state', JSON.stringify({
    collection: {
      discovered: ['j_joker'],
      ownedCards: [{ id: 'j_joker', edition: null, obtainedAt: '2026-07-26T00:00:00.000Z' }],
    },
    run: { state: 'round', seed: 'broken-run' },
  }))
  setActivePinia(createPinia())
  const recovered = useBalatroStore()
  await recovered.init()
  ok(recovered.collection.discovered.includes('j_joker') &&
     recovered.collection.ownedCards.length === 1 &&
     recovered.run === null,
  '牌局恢复失败时保留已发现与持有卡')
  await new Promise(resolve => setTimeout(resolve, 550))
  mem.clear()
}

// ============ 1. 生产力奖励：只发卡包不再发钱（§11） ============
console.log('== 生产力奖励：Run 内不再发钱（§11） ==')
store.newRun('deck_red')
const moneyBefore = store.run.money
for (let k = 0; k < 3; k++) store.grantProductivityReward({ source: 'checkin' })
ok(store.run.money === moneyBefore, `3 次打卡 → 金钱不变（$${moneyBefore}→$${store.run.money}）`)
for (let k = 0; k < 6; k++) store.grantProductivityReward({ source: 'task' })
ok(store.run.money === moneyBefore && store.productivity.pendingMoney === 0,
  `9 次累计 → 金钱仍不变，无暂存（$${store.run.money}，暂存 $${store.productivity.pendingMoney}）`)

console.log('== 生产力奖励：每 10 次免费小丑包 ==')
store.grantProductivityReward({ source: 'task' }) // n = 10
ok(store.productivity.pendingPacks.length === 1 &&
   store.productivity.pendingPacks[0] === 'pack_buffoon_normal', '第 10 次 → 待领取小丑包 ×1')
ok(store.claimPendingPack() === true && store.screen === 'pack', 'Run 中可领取（进入开包）')
store.skipPack()

console.log('== 生产力奖励：无 Run 也只攒卡包（§11） ==')
{
  // 用全新 pinia 隔离 productivity 计数
  setActivePinia(createPinia())
  const s2 = useBalatroStore()
  await s2.init() // 读取上面存下的存档
  const packs0 = s2.productivity.pendingPacks.length
  for (let k = 0; k < 3; k++) s2.grantProductivityReward({ source: 'checkin' })
  ok(s2.productivity.pendingMoney === 0, `无 Run：3 次 → 无金钱暂存（$${s2.productivity.pendingMoney}）`)
  ok(s2.productivity.pendingPacks.length === packs0, '不足 10 次 → 暂无新卡包')
  s2.newRun('deck_red')
  ok(s2.run.money === 4, `开局金钱即牌组基础 $4（无入账），实际 $${s2.run.money}`)
}

console.log('== 生产力奖励：7 天连打卡里程碑 ==')
{
  setActivePinia(createPinia())
  const s3 = useBalatroStore()
  s3.productivity.pendingPacks = []
  s3.grantProductivityReward({ source: 'checkin', streak: 7 })
  ok(s3.productivity.pendingPacks.includes('pack_celestial_normal'), '连续 7 天 → 免费天体包')
  const n = s3.productivity.pendingPacks.length
  s3.grantProductivityReward({ source: 'checkin', streak: 8 })
  ok(s3.productivity.pendingPacks.length === n, '里程碑只发一次（不重复）')
}

// ============ 2. 图鉴发现标记 ============
console.log('== 图鉴：卡包选项「见过即发现」 ==')
setActivePinia(createPinia())
const s4 = useBalatroStore()
mem.clear()
await s4.init()
s4.newRun('deck_red')
const foundBefore = s4.collection.discovered.length
s4.openPack('pack_arcana_normal')
const opts = s4.run.packState.options
ok(opts.length > 0 && opts.every(o => s4.collection.discovered.includes(o.id)),
  `开包后 ${opts.length} 个选项全部标记发现`)
ok(s4.collection.discovered.length >= foundBefore + opts.length - 1, '发现计数增长')
s4.pickPackCards([0])
ok(s4.collection.discovered.includes(opts[0].id), '获得的卡保持已发现')

console.log('== 图鉴：获得小丑/消耗牌标记发现（引擎 markDiscovered 链路） ==')
{
  const before = new Set(s4.collection.discovered)
  s4.openPack('pack_buffoon_normal')
  s4.pickPackCards([0])
  ok(s4.run.jokers.length === 1 && s4.collection.discovered.includes(s4.run.jokers[0].id),
    `小丑包获得「${s4.run.jokers[0].id}」已发现`)
  void before
}

console.log('== 图鉴：商店陈列「见过即发现」 ==')
{
  // 经公共 API 打到商店存在随机性：多次开局直到抵达商店（上限 40 局）
  let sawShop = false
  for (let attempt = 0; attempt < 40 && !sawShop; attempt++) {
    setActivePinia(createPinia())
    const sx = useBalatroStore()
    await sx.init()
    sx.newRun('deck_blue') // 蓝色牌组 +1 出牌，胜率略高
    sx.selectBlind()
    let guard = 0
    while (sx.screen === 'round' && guard++ < 40) {
      const hand = sx.run.round.hand
      const picks = [...hand].sort((a, b) => b.rank - a.rank).slice(0, Math.min(5, hand.length))
      for (const c of picks) sx.toggleCardSelect(c.id)
      try { sx.playSelected() } catch {
        for (const id of [...sx.selectedCardIds]) sx.toggleCardSelect(id)
        try { sx.toggleCardSelect(hand[0].id); sx.discardSelected() } catch { break }
      }
    }
    if (sx.screen === 'shop') {
      sawShop = true
      const items = sx.run.shop.cards.filter(c => c.kind !== 'playing')
      ok(items.length > 0 && items.every(c => sx.collection.discovered.includes(c.id)),
        `商店 ${items.length} 件陈列卡全部标记发现`)
      if (sx.run.shop.voucher) {
        ok(sx.collection.discovered.includes(sx.run.shop.voucher), '陈列优惠券已标记发现')
      }
    }
  }
  ok(sawShop, '40 局内至少抵达一次商店（随机性冒烟）')
}

// ============ 3. localStorage 存档往返（§5.5 浏览器降级） ============
console.log('== localStorage 存档往返 ==')
{
  setActivePinia(createPinia())
  const sa = useBalatroStore()
  mem.clear()
  await sa.init()
  sa.settings.volume = 0.8
  sa.settings.muted = true
  sa.settings.animations = false
  for (let k = 0; k < 3; k++) sa.grantProductivityReward({ source: 'task' })
  await sa.saveNow()
  ok(mem.has('balatro:state'), '存档写入 localStorage（键 balatro:state）')

  setActivePinia(createPinia())
  const sb = useBalatroStore()
  await sb.init()
  ok(sb.settings.volume === 0.8 && sb.settings.muted === true && sb.settings.animations === false,
    '设置（音量/静音/减少动效）随存档往返')
  ok(sb.productivity.count === 3 && sb.productivity.pendingMoney === 0,
    `生产力计数随存档往返（n=${sb.productivity.count}，无金钱暂存）`)
  ok(Array.isArray(sb.collection.discovered), '图鉴发现随存档往返')
}

// ============ 4. 收藏模式独立开包（§11 → §16 全收+NEW 徽章） ============
console.log('== 收藏开包：无需 Run，全部收下 + NEW 徽章 ==')
{
  setActivePinia(createPinia())
  const sc = useBalatroStore()
  mem.clear()
  await sc.init()
  for (let k = 0; k < 10; k++) sc.grantProductivityReward({ source: 'task' })
  ok(sc.productivity.pendingPacks.length === 1, '10 次任务 → 1 个待开卡包')
  ok(sc.openCollectionPack() === true && sc.collectionPack, '无 Run 独立开包成功')
  const ps = sc.collectionPack
  const withId = ps.options.filter(o => o.id)
  ok(withId.length > 0 && withId.every(o => sc.collection.discovered.includes(o.id)),
    `开包 ${ps.options.length} 个选项全部见过即发现`)
  ok(Array.isArray(ps.firstNew) && ps.firstNew.length === withId.length,
    `首开标记 firstNew 覆盖全部新 id（首包 ${withId.length} 张全新）`)
  // §16① 全部收下：不再强制选 N 张
  ok(sc.collectAllPackCards() === true, '全部收下成功')
  ok(sc.collectionPack === null, '收下即关包')
  const owned = sc.collection.ownedCards
  ok(owned.length === withId.length &&
     owned.every(o => typeof o.obtainedAt === 'string' &&
       withId.some(w => w.id === o.id && (w.edition || null) === (o.edition || null))),
    `全部 ${withId.length} 张收入 ownedCards（id/版本/obtainedAt 完整）`)
  const newIds = sc.collection.newIds || []
  ok(newIds.length === ps.firstNew.length && ps.firstNew.every(id => newIds.includes(id)),
    `首开 id 全部入 newIds（${newIds.length} 张 NEW）`)
  // §16② 3D 细看已读：markCollectionSeen 清除单卡 NEW
  const seenId = newIds[0]
  const seenBefore = newIds.length
  sc.markCollectionSeen(seenId)
  ok(!sc.collection.newIds.includes(seenId) && sc.collection.newIds.length === seenBefore - 1,
    'markCollectionSeen 清除该卡 NEW 标记')
  // 重复卡不 NEW：第二包 firstNew 只含此前未发现的 id
  for (let k = 0; k < 10; k++) sc.grantProductivityReward({ source: 'task' })
  const discoveredBefore = new Set(sc.collection.discovered)
  const newBefore = sc.collection.newIds.length
  sc.openCollectionPack()
  const ps2 = sc.collectionPack
  ok((ps2.firstNew || []).every(id => !discoveredBefore.has(id)),
    `第二包 firstNew ${ps2.firstNew.length} 张均为真正首开（重复卡不 NEW）`)
  sc.collectAllPackCards()
  const newAfter2 = sc.collection.newIds
  ok(newAfter2.length === newBefore + ps2.firstNew.length &&
     newAfter2.length === new Set(newAfter2).size,
    `第二包收下后 newIds 净增 ${ps2.firstNew.length} 且无重复`)
  sc.markAllCollectionSeen()
  ok((sc.collection.newIds || []).length === 0, '全部标记已读清空 newIds')

  console.log('== 收藏开包：跳过与存档往返 ==')
  const ownedCount = sc.collection.ownedCards.length
  for (let k = 0; k < 10; k++) sc.grantProductivityReward({ source: 'task' })
  sc.openCollectionPack()
  sc.skipCollectionPack()
  ok(sc.collectionPack === null && sc.productivity.pendingPacks.length === 0, '跳过即放弃卡包')
  ok(sc.collection.ownedCards.length === ownedCount && (sc.collection.newIds || []).length === 0,
    '放弃包不产生 ownedCards/newIds')
  await sc.saveNow()
  setActivePinia(createPinia())
  const sd = useBalatroStore()
  await sd.init()
  ok((sd.collection.ownedCards || []).length === ownedCount,
    'ownedCards 随存档往返')
}

console.log('== §15 Mod 卡：真实 Mod 复刻（Pampa/JellyMod/7DeadlySins/Olympus/PiJoker/MikasBalatro）数据 + Buffoon 包 25% 混入 ==')
{
  const { MOD_JOKERS, MOD_JOKERS_BY_ID } = await import('../src/balatro/data/modJokers.js')
  const { BY_ID } = await import('../src/balatro/data/index.js')
  ok(MOD_JOKERS.length === 135, `Mod 卡共 135 张（实际 ${MOD_JOKERS.length}）`)
  const ids = new Set(MOD_JOKERS.map(j => j.id))
  ok(ids.size === 135 && [...ids].every(id => id.startsWith('mj_')), '135 个 mj_* id 唯一')
  ok(MOD_JOKERS.every(j => j.mod && j.type === 'joker' && j.name && j.nameEn && j.text && j.art && j.pos), '字段完整（mod/type/name/text/art/pos）')
  const mods = [...new Set(MOD_JOKERS.map(j => j.mod))].sort()
  ok(mods.length === 6 && MOD_JOKERS.filter(j => j.mod === 'Pampa').length === 30 &&
     MOD_JOKERS.filter(j => j.mod === 'JellyMod').length === 30 &&
     MOD_JOKERS.filter(j => j.mod === '7DeadlySins').length === 8 &&
     MOD_JOKERS.filter(j => j.mod === 'Olympus').length === 6 &&
     MOD_JOKERS.filter(j => j.mod === 'PiJoker').length === 1 &&
     MOD_JOKERS.filter(j => j.mod === 'MikasBalatro').length === 60,
    `来源构成 Pampa 30 / JellyMod 30 / 7DeadlySins 8 / Olympus 6 / PiJoker 1 / MikasBalatro 60（${mods.join('/')}）`)
  ok(!ids.has('mj_pam2_jazztrio') && MOD_JOKERS.filter(j => j.id.startsWith('mj_pam_')).length === 30,
    'Pampa 重复仓库（batabata3 同源）未重复导入，mj_pam_* 仍为 30 张')
  ok(MOD_JOKERS.every(j => BY_ID[j.id] === j) && Object.keys(MOD_JOKERS_BY_ID).length === 135, 'BY_ID 全局查找表已合入 135 张 Mod 卡')

  setActivePinia(createPinia())
  const sm = useBalatroStore()
  mem.clear()
  await sm.init()
  for (let k = 0; k < 30; k++) sm.productivity.pendingPacks.push('pack_buffoon_jumbo')
  let totalOpts = 0, modOpts = 0, modNamed = true, firstModName = '', packsCollected = 0
  for (let k = 0; k < 30; k++) {
    if (!sm.openCollectionPack()) break
    const ps = sm.collectionPack
    for (const o of ps.options) {
      totalOpts++
      if (o.id && o.id.startsWith('mj_')) {
        modOpts++
        if (!BY_ID[o.id]?.name) modNamed = false
        else if (!firstModName) firstModName = BY_ID[o.id].name
      }
    }
    if (sm.collectAllPackCards() === true) packsCollected++ // §16 全部收下
  }
  const modOwned = sm.collection.ownedCards.filter(o => o.id.startsWith('mj_')).length
  ok(packsCollected === 30, `30 包全部收下（实际 ${packsCollected}）`)
  ok(modOwned === modOpts && modOwned > 0,
    `见过的 ${modOpts} 张 Mod 卡全部收入 ownedCards`)
  ok(modNamed, `所有 Mod 选项均可经 BY_ID 解析名称（首个：${firstModName}）`)
  const ratio = totalOpts ? modOpts / totalOpts : 0
  ok(modOpts > 0 && ratio > 0.05 && ratio < 0.5,
    `30 个小丑包 ${totalOpts} 选项中 Mod 出现 ${modOpts} 次（${(ratio * 100).toFixed(1)}%，期望 ~25%）`)
  ok(sm.collection.ownedCards.some(o => o.id.startsWith('mj_')), 'ownedCards 含 Mod 卡')
  ok(sm.collection.discovered.some(id => id.startsWith('mj_')), 'discovered 含 Mod 卡（见过即发现）')
  ok(sm.run === null || !(sm.run.jokers || []).some(j => j.id.startsWith('mj_')), 'Mod 卡不进 Run 小丑栏')
}

// ============ 5. 纯金币经济 ============
console.log('== 经济：三来源金币 / 迁移幂等 / 余额非负 ==')
{
  setActivePinia(createPinia())
  const se = useBalatroStore()
  mem.clear()
  await se.init()
  ok(se.economy.gold === 0 && se.economy.packsOpened === 0, '旧档迁移：economy 默认 0 金币 0 开包')
  se.grantProductivityReward({ source: 'checkin' })
  se.grantProductivityReward({ source: 'task' })
  se.grantProductivityReward({ source: 'project_task' })
  ok(se.economy.gold === 10, `三来源金币 2+3+5=10（实际 ${se.economy.gold}）`)
  se.grantProductivityReward({ source: 'unknown' })
  ok(se.economy.gold === 10, '未知来源不发金币')
  await se.saveNow()
  setActivePinia(createPinia())
  const se2 = useBalatroStore()
  await se2.init()
  ok(se2.economy.gold === 10, '金币随存档往返')
  await se2.saveNow()
  setActivePinia(createPinia())
  const se3 = useBalatroStore()
  await se3.init()
  ok(se3.economy.gold === 10, '二次迁移幂等（economy 不丢不重）')

  const r1 = se3.buyShopPack('pack_arcana_normal')
  ok(r1.ok === false && r1.reason === 'gold' && se3.economy.gold === 10, '金币不足拒售（余额不变、非负）')
  se3.economy.gold = 100
  const r2 = se3.buyShopPack('pack_celestial_jumbo')
  ok(r2.ok && r2.price === 60 && se3.economy.gold === 40 &&
     se3.productivity.pendingPacks.includes('pack_celestial_jumbo'),
    '购买巨型包：-60 金币入待开队列')
  const r3 = se3.buyShopPack('pack_spectral_mega')
  ok(!r3.ok && r3.reason === 'gold' && se3.economy.gold === 40, '余额 40 买 80 被拒（余额不变）')
  const r4 = se3.buyShopPack('pack_buffoon_normal')
  ok(r4.ok && r4.price === 40 && se3.economy.gold === 0, '恰好花光：余额归 0 不为负')
}

// ============ 6. 卡池梯度 ============
console.log('== 卡池梯度：稀有 ≥10 包 / 核心 ≥20 包 / 传奇不锁 ==')
{
  const { gatedByPacks, lockHint, CORE_JOKERS, RARE_MIN_PACKS, CORE_MIN_PACKS } = await import('../src/balatro/data/packGating.js')
  const { BY_ID } = await import('../src/balatro/data/index.js')
  ok(RARE_MIN_PACKS === 10 && CORE_MIN_PACKS === 20 && CORE_JOKERS.length === 10, '梯度常量 10/20 + 核心 10 张')
  ok(CORE_JOKERS.every(id => BY_ID[id]?.rarity === 3), '核心 10 张均为 rarity 3（吸血鬼 rarity 2 不在列）')
  ok(gatedByPacks('j_blueprint', BY_ID.j_blueprint, 19) && !gatedByPacks('j_blueprint', BY_ID.j_blueprint, 20), '核心卡 19 锁 / 20 放')
  const rare = Object.values(BY_ID).find(d => d.rarity === 3 && !CORE_JOKERS.includes(d.id) && !d.id.startsWith('mj_'))
  ok(gatedByPacks(rare.id, rare, 9) && !gatedByPacks(rare.id, rare, 10), `非核心稀有卡 9 锁 / 10 放（${rare.id}）`)
  const mjRare = Object.values(BY_ID).find(d => d.id.startsWith('mj_') && d.rarity === 3)
  ok(mjRare && gatedByPacks(mjRare.id, mjRare, 0), `Mod 稀有卡同规则锁定（${mjRare?.id}）`)
  const leg = Object.values(BY_ID).find(d => d.rarity === 4 && !d.id.startsWith('mj_'))
  ok(!gatedByPacks(leg.id, leg, 0), '传奇永不锁定')
  ok(lockHint('j_blueprint', BY_ID.j_blueprint) === 20 && lockHint(rare.id, rare) === 10, 'lockHint 提示包数正确')
}
{
  // 100 包模拟：每个选项都不得违反「开包当时」的梯度
  setActivePinia(createPinia())
  const sg = useBalatroStore()
  mem.clear()
  await sg.init()
  const { BY_ID } = await import('../src/balatro/data/index.js')
  const { gatedByPacks, CORE_JOKERS } = await import('../src/balatro/data/packGating.js')
  for (let k = 0; k < 100; k++) sg.productivity.pendingPacks.push('pack_buffoon_jumbo')
  let checked = 0, leak = 0, rareAfterUnlock = 0, coreAfterUnlock = 0
  for (let k = 0; k < 100; k++) {
    const openedAt = sg.economy.packsOpened
    if (!sg.openCollectionPack()) break
    for (const o of sg.collectionPack.options) {
      const d = o.id && BY_ID[o.id]
      if (!d || d.rarity == null) continue
      checked++
      if (gatedByPacks(o.id, d, openedAt)) leak++
      else if (openedAt >= 10 && d.rarity === 3 && !CORE_JOKERS.includes(o.id)) rareAfterUnlock++
      else if (openedAt >= 20 && CORE_JOKERS.includes(o.id)) coreAfterUnlock++
    }
    sg.collectAllPackCards()
  }
  ok(checked > 300 && leak === 0, `100 包 ${checked} 个小丑选项零梯度泄漏（实际泄漏 ${leak}）`)
  ok(sg.economy.packsOpened === 100, `packsOpened 累计 100（实际 ${sg.economy.packsOpened}）`)
  ok(rareAfterUnlock > 0, `≥10 包后稀有可开出（命中 ${rareAfterUnlock} 次）`)
  ok(coreAfterUnlock > 0, `≥20 包后核心可开出（命中 ${coreAfterUnlock} 次）`)
}

// ============ 7. 重复卡出售（首张保护 / 点亮保留） ============
console.log('== 出售：稀有度价 + 版本加成 + 首张保护 ==')
{
  setActivePinia(createPinia())
  const ss = useBalatroStore()
  mem.clear()
  await ss.init()
  ss.collection.ownedCards = [
    { id: 'j_joker', edition: null, obtainedAt: 'a' },
    { id: 'j_joker', edition: null, obtainedAt: 'b' },
    { id: 'j_blueprint', edition: 'holo', obtainedAt: 'c' },
  ]
  ss.collection.discovered.push('j_joker', 'j_blueprint')
  const g0 = ss.economy.gold
  const r1 = ss.sellOwnedCard(1)
  ok(r1.ok && r1.value === 8 && ss.economy.gold === g0 + 8 && ss.collection.ownedCards.length === 2, '普通重复卡 +8 金币')
  const r2 = ss.sellOwnedCard(0)
  ok(!r2.ok && r2.reason === 'last', '仅剩 1 张 → 首张保护拒售')
  const r3 = ss.sellOwnedCard(1)
  ok(!r3.ok && r3.reason === 'last', '单张稀有·全息同样首张保护')
  ss.collection.ownedCards.push({ id: 'j_blueprint', edition: 'holo', obtainedAt: 'd' })
  const g1 = ss.economy.gold
  const idx = ss.collection.ownedCards.findIndex(o => o.id === 'j_blueprint')
  const r4 = ss.sellOwnedCard(idx)
  ok(r4.ok && r4.value === 44 && ss.economy.gold === g1 + 44, '稀有 40 + 全息 4 = 44 金币')
  ok(ss.collection.discovered.includes('j_joker') && ss.collection.discovered.includes('j_blueprint'), '出售后点亮保留')
  ok(ss.ownedSellValue({ id: 'j_blueprint', edition: 'negative' }) === 40 + 16, '负片加成 +16（ownedSellValue 预览）')
}

// ============ 8. 扑克入收藏 ============
console.log('== 扑克入收藏：标准包 52 格点亮 + 变体出售 ==')
{
  setActivePinia(createPinia())
  const sp = useBalatroStore()
  mem.clear()
  await sp.init()
  for (let k = 0; k < 6; k++) sp.productivity.pendingPacks.push('pack_standard_jumbo')
  for (let k = 0; k < 6; k++) {
    ok(sp.openCollectionPack(), `标准包 ${k + 1} 打开`)
    ok(sp.collectAllPackCards(), `标准包 ${k + 1} 全部收下（playing 也计入）`)
  }
  const pcs = sp.collection.ownedCards.filter(o => o.kind === 'playing')
  ok(pcs.length === 30, `6 个巨型标准包 → 30 张扑克入藏（实际 ${pcs.length}）`)
  ok(pcs.every(o => o.rank >= 2 && o.rank <= 14 && o.suit &&
    'enhancement' in o && 'seal' in o && 'edition' in o && typeof o.obtainedAt === 'string'),
    '扑克条目字段完整（rank/suit/enhancement/seal/edition/obtainedAt）')
  ok(sp.collection.discovered.some(id => id.startsWith('pc_')), 'pc_ 键见过即点亮')
  ok(sp.economy.packsOpened === 6, `packsOpened 累计 6（实际 ${sp.economy.packsOpened}）`)
  // 扑克出售：素牌 +2；首张保护
  // 先清掉开包随机扑克，出售断言只面对构造卡（消除随机同变体干扰）
  sp.collection.ownedCards = sp.collection.ownedCards.filter(o => o.kind !== 'playing')
  sp.collection.ownedCards.push(
    { kind: 'playing', rank: 14, suit: 'spades', enhancement: null, seal: null, edition: null, obtainedAt: 'x' },
    { kind: 'playing', rank: 14, suit: 'spades', enhancement: null, seal: null, edition: null, obtainedAt: 'y' },
    { kind: 'playing', rank: 14, suit: 'spades', enhancement: 'gold', seal: 'red', edition: 'poly', obtainedAt: 'z' },
    { kind: 'playing', rank: 14, suit: 'spades', enhancement: 'gold', seal: 'red', edition: 'poly', obtainedAt: 'w' },
  )
  const g0 = sp.economy.gold
  const idxPlain = sp.collection.ownedCards.findIndex(o => o.kind === 'playing' && !o.enhancement && o.obtainedAt === 'y')
  const rp = sp.sellOwnedCard(idxPlain)
  ok(rp.ok && rp.value === 2 && sp.economy.gold === g0 + 2, '素牌扑克出售 +2')
  const idxLast = sp.collection.ownedCards.findIndex(o => o.kind === 'playing' && !o.enhancement && o.obtainedAt === 'x')
  const rl = sp.sellOwnedCard(idxLast)
  ok(!rl.ok && rl.reason === 'last', '仅剩 1 张同变体扑克拒售（首张保护）')
  const g1 = sp.economy.gold
  const idxFull = sp.collection.ownedCards.findIndex(o => o.kind === 'playing' && o.enhancement === 'gold' && o.obtainedAt === 'z')
  const rf = sp.sellOwnedCard(idxFull)
  ok(rf.ok && rf.value === 2 + 1 + 2 + 3 && sp.economy.gold === g1 + 8, '黄金+红蜡封+多彩 = 2+1+2+3 = 8 金币')
}

// ============ 9. 一键卖出重复 / 角标规则 / 免确认 / 文案复核 ============
console.log('== 一键卖出重复（页签范围，各留 1 张） ==')
{
  setActivePinia(createPinia())
  const sd = useBalatroStore()
  mem.clear()
  await sd.init()
  sd.collection.ownedCards = [
    { id: 'j_joker', edition: null, obtainedAt: 'a' },
    { id: 'j_joker', edition: null, obtainedAt: 'b' },
    { id: 'j_joker', edition: null, obtainedAt: 'c' },
    { id: 'j_joker', edition: 'foil', obtainedAt: 'd' },
    { id: 'j_greedy_joker', edition: null, obtainedAt: 'e' },
    { kind: 'playing', rank: 14, suit: 'spades', enhancement: null, seal: null, edition: null, obtainedAt: 'f' },
    { kind: 'playing', rank: 14, suit: 'spades', enhancement: null, seal: null, edition: null, obtainedAt: 'g' },
  ]
  sd.collection.discovered.push('j_joker', 'j_greedy_joker')
  const { JOKERS } = await import('../src/balatro/data/index.js')
  const jokerIds = new Set(JOKERS.map(j => j.id))
  const matchJoker = o => o.kind !== 'playing' && jokerIds.has(o.id)
  const info = sd.duplicateOwnedInfo(matchJoker)
  ok(info.sold === 2 && info.gold === 16,
    `小丑页签预览：素小丑×3 卖 2 张 +16（实际 sold=${info.sold} gold=${info.gold}）`)
  const g0 = sd.economy.gold
  const res = sd.sellDuplicateOwned(matchJoker)
  ok(res.sold === 2 && sd.economy.gold === g0 + 16, '执行批量卖出：金币入账正确')
  const left = sd.collection.ownedCards
  ok(left.length === 5 &&
    left.filter(o => o.id === 'j_joker' && !o.edition).length === 1 &&
    left.filter(o => o.id === 'j_joker' && o.edition === 'foil').length === 1 &&
    left.filter(o => o.id === 'j_greedy_joker').length === 1,
    '各留 1 张：素/闪箔/贪婪各 1')
  ok(left.filter(o => o.kind === 'playing').length === 2, '页签范围隔离：扑克不受影响')
  ok(sd.collection.discovered.includes('j_joker') && sd.collection.discovered.includes('j_greedy_joker'), '批量卖出后点亮保留')
  const info2 = sd.duplicateOwnedInfo(matchJoker)
  ok(info2.sold === 0 && info2.gold === 0, '卖出后无重复可售（幂等）')
  const infoP = sd.duplicateOwnedInfo(o => o.kind === 'playing')
  ok(infoP.sold === 1 && infoP.gold === 2, `扑克范围预览：素 A♠×2 卖 1 张 +2（实际 sold=${infoP.sold} gold=${infoP.gold}）`)
}

console.log('== 变体矩阵数据（同 rank+suit 按增强/蜡封/版本分组） ==')
{
  setActivePinia(createPinia())
  const sv = useBalatroStore()
  mem.clear()
  await sv.init()
  sv.collection.ownedCards = [
    { kind: 'playing', rank: 13, suit: 'hearts', enhancement: null, seal: null, edition: null, obtainedAt: 'a' },
    { kind: 'playing', rank: 13, suit: 'hearts', enhancement: null, seal: null, edition: null, obtainedAt: 'b' },
    { kind: 'playing', rank: 13, suit: 'hearts', enhancement: null, seal: null, edition: null, obtainedAt: 'c' },
    { kind: 'playing', rank: 13, suit: 'hearts', enhancement: 'gold', seal: 'red', edition: 'poly', obtainedAt: 'd' },
    { kind: 'playing', rank: 13, suit: 'hearts', enhancement: 'gold', seal: 'red', edition: 'poly', obtainedAt: 'e' },
    { kind: 'playing', rank: 13, suit: 'hearts', enhancement: 'steel', seal: null, edition: null, obtainedAt: 'f' },
  ]
  const info = sv.duplicateOwnedInfo(o => o.kind === 'playing')
  ok(info.sold === 3 && info.gold === 12,
    `变体分组：素×3 卖 2、黄金+红蜡封+多彩×2 卖 1（+8）、钢铁×1 保留（实际 sold=${info.sold} gold=${info.gold}）`)
}

console.log('== UI 规则源码锚点：角标 ≥2 / 单售免确认 / 内部术语清除 ==')
{
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(new URL('../src/views/CardCollectionView.vue', import.meta.url), 'utf8')
  ok(src.includes('ownedCount(def.id) >= 2'), '角标 ×n 仅 n≥2 显示（n=1 不显示）')
  const confirmCount = (src.match(/window\.confirm/g) || []).length
  ok(confirmCount === 1, `单张出售免确认（window.confirm 仅批量 1 处，实际 ${confirmCount}）`)
  ok(!src.includes('首张保护'), '界面无「首张保护」内部术语')
  ok(!src.includes('初始可用'), '详情无「✓ 初始可用」冗余行')
  ok(!src.includes('不进 Run 卡池'), '界面无「不进 Run 卡池」内部说明')
  ok(!src.includes('卡池梯度'), '锁定提示无「卡池梯度」术语（保留累计开包表述）')
  ok(src.includes('.cv-shadowcard:not(.fragment) :deep(.pc-front)'), '半张碎片显示真实彩色卡面，未持有卡才显示黑色剪影')
  ok(!src.includes('cv-frag-badge'), '图鉴格不显示右上角 ½ 碎片徽标')
}

// ============ 7. §19 金币 bug 修复：全链路 / 启动竞态 / 合并保存 / MCP 发放器 ============
console.log('== §19 金币：integration.js 全链路（init → notify → 入账 → 持久化 → 重载） ==')
{
  const { readFileSync } = await import('node:fs')
  const habitView = readFileSync(new URL('../src/views/HabitView.vue', import.meta.url), 'utf8')
  ok((habitView.match(/await rewardCheckin\(created\)/g) || []).length === 2,
    '习惯页今日打卡与日历补打均接入金币奖励')
  const { notifyHabitCheckin, notifyDailyTaskCompleted, notifyProjectTaskCompleted } =
    await import('../src/balatro/integration.js')
  setActivePinia(createPinia())
  const sg = useBalatroStore()
  mem.clear()
  await sg.init()
  const g0 = sg.economy.gold
  await notifyHabitCheckin({ habitId: 1, date: '2026-07-19', streak: 1 })
  ok(sg.economy.gold === g0 + 2, `打卡 +2（${g0}→${sg.economy.gold}）`)
  await notifyDailyTaskCompleted({ taskId: 1 })
  ok(sg.economy.gold === g0 + 5, `每日任务 +3（累计 ${sg.economy.gold}）`)
  await notifyProjectTaskCompleted({ taskId: 2 })
  ok(sg.economy.gold === g0 + 10, `项目任务 +5（累计 ${sg.economy.gold}）`)
  ok(sg.productivity.count === 3, `生产力计数 3（实际 ${sg.productivity.count}）`)
  await sg.saveNow()
  const saved = JSON.parse(mem.get('balatro:state'))
  ok(saved.economy.gold === g0 + 10, `磁盘存档金币已持久化（${saved.economy.gold}）`)
  // 重载（全新 pinia + init）后仍在
  setActivePinia(createPinia())
  const sg2 = useBalatroStore()
  await sg2.init()
  ok(sg2.economy.gold === g0 + 10, `重载后金币仍在（${sg2.economy.gold}）`)
}

console.log('== §19 金币：启动窗口竞态（未 init 先发奖，必须以磁盘为基数） ==')
{
  const { notifyHabitCheckin } = await import('../src/balatro/integration.js')
  // 预置磁盘存档：金币 100
  mem.clear()
  mem.set('balatro:state', JSON.stringify({
    version: 1, savedAt: new Date().toISOString(), run: null,
    collection: { discovered: ['j_joker'], ownedCards: [{ id: 'j_joker', edition: null, obtainedAt: 'x' }] },
    settings: {}, productivity: { count: 5, pendingMoney: 0, pendingPacks: [], streak: 0 },
    economy: { gold: 100, packsOpened: 7 },
  }))
  setActivePinia(createPinia())
  const sr = useBalatroStore() // 注意：刻意不调用 init()
  await notifyHabitCheckin({ habitId: 1, date: '2026-07-19', streak: 1 }) // reward() 内部先 await init
  ok(sr.economy.gold === 102, `未 init 先发奖：100+2=102（非 0 基数的 2，实际 ${sr.economy.gold}）`)
  ok(sr.collection.ownedCards.length === 1, `收藏未被空状态覆盖（${sr.collection.ownedCards.length} 张）`)
  await sr.saveNow()
  const saved = JSON.parse(mem.get('balatro:state'))
  ok(saved.economy.gold === 102 && saved.collection.ownedCards.length === 1, '落盘保持 102 与收藏完整')
  // 未加载守卫：loaded=false 时 saveNow 不落盘
  setActivePinia(createPinia())
  const sr2 = useBalatroStore()
  mem.set('balatro:state', JSON.stringify({ version: 1, economy: { gold: 77, packsOpened: 1 } }))
  await sr2.saveNow()
  ok(JSON.parse(mem.get('balatro:state')).economy.gold === 77, 'loaded=false 时 saveNow 跳过（不覆盖磁盘）')
}

console.log('== §19 三方合并保存：消费落盘且并发奖励不丢 ==')
{
  const { mergeBalatroState } = await import('../electron/services/balatro-state-merge.cjs')
  const base = {
    version: 1, savedAt: 'a', run: null,
    collection: { discovered: ['j_joker', 'c_fool'], ownedCards: [{ id: 'j_joker' }, { id: 'c_fool' }], newIds: ['c_fool'] },
    productivity: { count: 60, pendingMoney: 0, pendingPacks: ['pack_buffoon_normal', 'pack_arcana_normal'], streak: 0 },
    economy: { gold: 100, packsOpened: 21 },
  }
  const disk = structuredClone(base)
  disk.economy.gold = 102
  disk.productivity.count = 61
  disk.productivity.pendingPacks.push('pack_celestial_normal')
  // 场景 1：旧版本写入（无 economy 字段）→ 磁盘 economy 完整保留
  const oldBlob = {
    version: 1, savedAt: 'b', run: null,
    collection: { discovered: ['j_joker'], ownedCards: [{ id: 'j_joker' }] },
    productivity: { count: 55, pendingMoney: 0, pendingPacks: [], streak: 0 },
  }
  const m1 = mergeBalatroState(disk, oldBlob)
  ok(m1.economy.gold === 102 && m1.economy.packsOpened === 21, '旧版无 economy 写入不丢 economy')
  ok(m1.collection.discovered.includes('c_fool'), '旧版写入不丢已点亮（discovered 并集）')
  // 场景 2：前台花 40 金币并开掉一个包；后台同时奖励 +2 金币、+1 包。
  const incoming = structuredClone(base)
  incoming.economy.gold = 60
  incoming.economy.packsOpened = 22
  incoming.productivity.pendingPacks.shift()
  incoming.collection.ownedCards.pop()
  incoming.collection.newIds = []
  const m2 = mergeBalatroState(disk, incoming, base)
  ok(m2.economy.gold === 62 && m2.economy.packsOpened === 22, '消费变化量落盘且并发 +2 金币保留')
  ok(m2.productivity.pendingPacks.length === 2 &&
     m2.productivity.pendingPacks.includes('pack_celestial_normal') &&
     !m2.productivity.pendingPacks.includes('pack_buffoon_normal'),
  '开掉一个包且保留并发新增卡包')
  ok(m2.collection.ownedCards.length === 1 && m2.collection.newIds.length === 0,
    '出售卡片和 NEW 已读状态可持久化')
  ok(m2.productivity.count === 61, '无前台计数变化时保留后台新增计数')
  // 场景 3：磁盘为空 → 原样写入；incoming 为空 → 保留磁盘
  ok(mergeBalatroState(null, oldBlob) === oldBlob && mergeBalatroState(disk, null) === disk, '空侧兜底')
}

console.log('== §19 MCP 侧发放器：balatro-reward.cjs（node:sqlite 真实落库） ==')
{
  const { DatabaseSync } = await import('node:sqlite')
  const { mkdtempSync, rmSync } = await import('node:fs')
  const { join } = await import('node:path')
  const { tmpdir } = await import('node:os')
  const dir = mkdtempSync(join(tmpdir(), 'bm-reward-'))
  const db = new DatabaseSync(join(dir, 'test.db'))
  db.exec('CREATE TABLE balatro_state (key TEXT PRIMARY KEY, value TEXT)')
  const svc = {
    getBalatroState: (k = 'main') => db.prepare('SELECT value FROM balatro_state WHERE key = ?').get(k)?.value ?? null,
    saveBalatroState: (v, k = 'main') => {
      db.prepare('INSERT INTO balatro_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
        .run(k, String(v))
      return true
    },
    getHabitCheckins: () => [],
  }
  const { grantBalatroReward } = await import('../electron/services/balatro-reward.cjs')
  const r1 = grantBalatroReward(svc, 'checkin', { habitId: 1, date: '2026-07-19' })
  ok(r1.gold === 2 && r1.count === 1, `打卡发放 +2（返回 ${JSON.stringify(r1)}）`)
  grantBalatroReward(svc, 'task', {})
  const r3 = grantBalatroReward(svc, 'project_task', {})
  ok(r3.gold === 5, `三来源金额正确（task+3 project+5）`)
  let s = JSON.parse(svc.getBalatroState())
  ok(s.economy.gold === 10, `落库累计 10（实际 ${s.economy.gold}）`)
  for (let i = 0; i < 7; i++) grantBalatroReward(svc, 'checkin', { habitId: 1, date: '2026-07-19' })
  s = JSON.parse(svc.getBalatroState())
  ok(s.productivity.count === 10 && s.productivity.pendingPacks.includes('pack_buffoon_normal'),
    `每 10 次送小丑包（count=${s.productivity.count} pending=${s.productivity.pendingPacks.join('/')}）`)
  const before = s.productivity.pendingPacks.length
  grantBalatroReward(svc, 'checkin', { streak: 7 })
  grantBalatroReward(svc, 'checkin', { streak: 8 })
  s = JSON.parse(svc.getBalatroState())
  ok(s.productivity.pendingPacks.filter(p => p === 'pack_celestial_normal').length === 1,
    `连打 7 天送天体包且仅一次（pending=${s.productivity.pendingPacks.join('/')}）`)
  ok(grantBalatroReward(svc, 'unknown_source', {}) === null, '未知来源不发放')
  db.close(); rmSync(dir, { recursive: true, force: true })
}

// ============ 8. §19 出率调优：重复权重 ============
console.log('== §19 出率：owned 命中权重生效（塔罗 ×3）+ 集齐分布对比 ==')
{
  const { drawWithDuplicateWeight, PACK_DUPLICATE_WEIGHT } = await import('../src/balatro/data/economy.js')
  const { TAROT } = await import('../src/balatro/data/index.js')
  const { Rng } = await import('../src/balatro/engine/rng.js')
  ok(PACK_DUPLICATE_WEIGHT.tarot === 3 && PACK_DUPLICATE_WEIGHT.planet === 3 &&
     PACK_DUPLICATE_WEIGHT.joker === 1.5 && PACK_DUPLICATE_WEIGHT.spectral === 1.5,
    '权重常量集中 economy.js（塔罗/星球 ×3，小丑/幻灵 ×1.5）')
  // 命中率：拥有 11/22 时加权命中 ≈ 33/44=0.75，均匀 = 0.5
  {
    const owned = new Set(TAROT.slice(0, 11).map(t => t.id))
    const rng = new Rng('dupe-rate')
    let hit = 0
    const N = 4000
    for (let i = 0; i < N; i++) if (owned.has(drawWithDuplicateWeight(TAROT, owned, 3, () => rng.next()))) hit++
    const rate = hit / N
    ok(rate > 0.68 && rate < 0.82, `拥有 11/22 时 owned 命中率 ${(rate * 100).toFixed(1)}%（期望 ~75%，均匀 50%）`)
  }
  // 集齐 22 塔罗所需秘术包数：均匀 vs owned×3（每包 3 个选项、包内不重）
  const simulate = (weighted, seed) => {
    const rng = new Rng(seed)
    const owned = new Set()
    let packs = 0
    while (owned.size < TAROT.length && packs < 5000) {
      packs++
      const seen = new Set()
      for (let s = 0; s < 3; s++) {
        let id = null
        for (let k = 0; k < 8; k++) {
          id = weighted
            ? drawWithDuplicateWeight(TAROT, owned, 3, () => rng.next())
            : TAROT[Math.floor(rng.next() * TAROT.length)].id
          if (!seen.has(id)) break
        }
        seen.add(id); owned.add(id)
      }
    }
    return packs
  }
  const T = 400
  const us = [], ws = []
  for (let i = 0; i < T; i++) { us.push(simulate(false, `u${i}`)); ws.push(simulate(true, `w${i}`)) }
  const med = a => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)]
  const mean = a => a.reduce((s, x) => s + x, 0) / a.length
  const [mu, mw] = [med(us), med(ws)]
  const [au, aw] = [mean(us), mean(ws)]
  console.log(`  集齐 22 塔罗：均匀 中位 ${mu} 包 / 均值 ${au.toFixed(1)}；owned×3 中位 ${mw} 包 / 均值 ${aw.toFixed(1)}`)
  ok(mw > mu, `owned×3 后集齐更慢（中位 ${mu}→${mw} 包）`)
  ok(aw > au * 1.3, `均值显著拉大（${au.toFixed(1)}→${aw.toFixed(1)} 包，×${(aw / au).toFixed(2)}）`)
  // store 级：11 张已拥有塔罗下开秘术包，owned 命中率显著过半
  {
    setActivePinia(createPinia())
    const sp = useBalatroStore()
    mem.clear()
    await sp.init()
    const owned11 = TAROT.slice(0, 11)
    sp.collection.ownedCards = owned11.map(t => ({ id: t.id, edition: null, obtainedAt: 'x' }))
    let total = 0, hits = 0
    for (let k = 0; k < 30; k++) {
      sp.productivity.pendingPacks.push('pack_arcana_normal')
      if (!sp.openCollectionPack()) break
      for (const o of sp.collectionPack.options) {
        if (!o.id) continue
        total++
        if (owned11.some(t => t.id === o.id)) hits++
      }
      sp.skipCollectionPack() // 不收入，保持 11 张持有不变
    }
    const rate = total ? hits / total : 0
    ok(total === 90 && rate > 0.62,
      `store 开包链路权重生效：90 选项 owned 命中 ${(rate * 100).toFixed(1)}%（期望 ~75%，均匀 50%）`)
  }
}

// ============ 9. §19 音效分层合成 ============
console.log('== §19 音效：分层合成接口与参数断言 ==')
{
  const { sound, setSoundSettings } = await import('../src/balatro/sound.js')
  const names = ['flip', 'deal', 'chips', 'mult', 'xmult', 'coin', 'coinCascade', 'pack', 'crinkle',
    'zip', 'thump', 'tick', 'slam', 'lose', 'win', 'select', 'click', 'glassBreak', 'suspense',
    'rareReveal', 'shimmer']
  ok(names.every(n => typeof sound[n] === 'function'), `21 个音效函数齐全（含新增 thump/coinCascade/shimmer）`)
  // 无 AudioContext 环境全部安全 no-op
  let threw = false
  try { for (const n of names) sound[n]() ; sound.coinCascade(4); setSoundSettings({ muted: true, volume: 0.3 }); setSoundSettings({ muted: false, volume: 0.5 }) } catch { threw = true }
  ok(!threw, '无 AudioContext 环境全部音效安全 no-op（静音/音量设置兼容）')
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(new URL('../src/balatro/sound.js', import.meta.url), 'utf8')
  ok(src.includes('function adsr') && src.includes('function oscLayer') && src.includes('function noiseLayer') && src.includes('function perform'),
    '分层引擎存在（ADSR 包络 + 音高体 + 噪声体 + 多层调度）')
  ok((src.match(/noise:/g) || []).length >= 12, `噪声体层 ≥12（实际 ${(src.match(/noise:/g) || []).length}）`)
  ok(src.includes('f1:') && src.includes('ftype:') && src.includes('detune'), '扫频/滤波/失谐参数在层定义中启用')
  const hooks = readFileSync(new URL('../src/views/CardCollectionView.vue', import.meta.url), 'utf8')
  ok(hooks.includes('sound.coinCascade(') && hooks.includes('sound.shimmer()'),
    '挂接：一键卖出连续 coin + 梯度解锁 shimmer')
  ok((hooks.match(/sound\.coin\(\); sound\.click\(\)/g) || []).length === 2,
    '挂接：出售 coin+click（细看 + 变体两处）')
  const pm = readFileSync(new URL('../src/balatro/components/PackModal.vue', import.meta.url), 'utf8')
  ok(pm.includes('sound.thump()'), '挂接：开包爆开低频 thump')
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
