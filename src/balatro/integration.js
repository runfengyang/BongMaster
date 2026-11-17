// Balatro × BongMaster 生产力系统联动（§7）
// 挂接点：habit-store.js 打卡成功处 / reminder-store.js 任务完成处，各一行调用。
// 动态 import 避免循环依赖；pinia 未激活、存档不可用等任何异常都静默跳过，
// 绝不影响打卡/任务主流程。

async function reward(source, payload = {}) {
  try {
    const { useBalatroStore } = await import('./store.js')
    const store = useBalatroStore()
    // §19 启动窗口竞态修复：发放前确保存档已加载，否则 +N 会以 0 为基数并整体覆盖落盘
    if (!store.loaded && typeof store.init === 'function') await store.init()
    store.grantProductivityReward({ source, ...payload })
  } catch {
    /* 静默：游戏奖励是附属激励，失败不打断业务 */
  }
}

// 习惯打卡成功（payload 可带 streak：该习惯当前连续打卡天数）
export function notifyHabitCheckin(payload = {}) {
  return reward('checkin', payload)
}

// 每日任务变为完成
export function notifyDailyTaskCompleted(payload = {}) {
  return reward('task', payload)
}

// 项目任务变为完成
export function notifyProjectTaskCompleted(payload = {}) {
  return reward('project_task', payload)
}

// 供 UI 查询待领取奖励（菜单角标等）；不可用时返回空
export async function getPendingRewards() {
  try {
    const { useBalatroStore } = await import('./store.js')
    const store = useBalatroStore()
    return {
      pendingMoney: store.productivity.pendingMoney,
      pendingPacks: [...store.productivity.pendingPacks],
      count: store.productivity.count,
    }
  } catch {
    return { pendingMoney: 0, pendingPacks: [], count: 0 }
  }
}
