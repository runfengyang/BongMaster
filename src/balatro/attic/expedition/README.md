# 远征模式（Expedition）归档

- **归档日期**：2026-07-18
- **撤回原因**：业主决定撤回远征模式，恢复到「收藏 + 开卡包」模式（§11–§15 状态）。代码全部归档保留，**未删除任何文件**。
- **实施契约**：`docs/balatro/02-expedition.md`（保留在 docs/ 中，未随档移动）。复活前先读它。

## 归档内容清单

| 归档路径 | 原位置 | 说明 |
|---|---|---|
| `engine/expedition/`（7 文件） | `src/balatro/engine/expedition/` | E1/E2 引擎：stateMachine / dayScore / actionCards / economy / consumables / adapter / balance |
| `data/expedition/`（3 文件） | `src/balatro/data/expedition/` | Boss 数据（含 64×64 pixelMap 像素图腾）/ 消耗牌翻译表 / 小丑适配表 |
| `components/`（6 文件） | `src/balatro/components/expedition/` | E3 UI：BossTotem / NodeRoute / LineupBar / DraftModal / SlotReportModal / ExpeditionSummaryBar |
| `expeditionStore.js` | `src/balatro/expeditionStore.js` | Pinia 桥接（快照 + `expedition:*` 三键持久化 + 降级） |
| `ExpeditionView.vue` | `src/views/ExpeditionView.vue` | `/expedition` 主战场视图 |
| `scripts/`（8 文件） | `scripts/` | 测试与工具：expedition-engine-test(93) / expedition-e2-test(184) / expedition-ui-smoke(55) / expedition-stats / expedition-monte-carlo / expedition-seed-pack-save / cdp-expedition-e3(+pack) |

归档时全部 import 路径已修正为新位置，**测试从归档处直接可跑**（项目根目录执行）：

```bash
node src/balatro/attic/expedition/scripts/expedition-engine-test.mjs   # 93 绿
node src/balatro/attic/expedition/scripts/expedition-e2-test.mjs       # 184 绿
node src/balatro/attic/expedition/scripts/expedition-ui-smoke.mjs      # 55 绿
```

## 保留在活体代码中的 additive 改动（复活时直接复用，勿重复建设）

1. **`src/balatro/components/PackModal.vue` 的 `pickMode` prop**（默认 `false`，收藏页开包行为零变化）：
   pickMode 时点击已翻卡 = 选中/取消（上限 `choose`），底栏变「收下所选 / 跳过」，`emit('pick', indices)`。复活局内开包选牌直接用。
2. **带键存档 IPC**：`electron/main.js` 的 `balatro:loadKey` / `balatro:saveKey`（键名白名单 `/^[a-z0-9:_-]{1,64}$/i`），`electron/preload.js` 的 `balatroLoadKey(key)` / `balatroSaveKey(key, state)`。expeditionStore 的持久化（`expedition:run/meta/report`）依赖它们。

## 已回退的 E3 改动（复活时需要重做）

- **`balatro.css` 的 `.bt-btn` 按钮族**：E3 曾把 attic/BalatroView.vue 的全局 `.bt-btn`（primary/sm/lg/xl/danger/buy/skip）上收进 `balatro.css`，但它改变了收藏页 PackModal「全部收下」按钮的既有视觉，已按业主要求回退。归档组件（DraftModal/LineupBar/ExpeditionView 等）大量引用 `.bt-btn`，**复活时需把该样式族重新加回 `balatro.css`**（样式源码见 `src/balatro/attic/BalatroView.vue` 的未 scoped `<style>` 块，575–609 行附近）。
- **UI 接线**：`/expedition` 路由、App.vue 导航 pill + 角标 + store init、DashboardView 摘要条、CardCollectionView「出征」按钮均已拆除；复活时按契约 §6 重新接线。

## 复活指引

1. 读契约 `docs/balatro/02-expedition.md`（§4.3 Boss 视觉 / §6 信息架构 / §7 持久化 / §9 验收）。
2. 把本目录的 `engine/expedition/`、`data/expedition/` 移回 `src/balatro/` 对应位置（或直接在归档位置被引用，二选一；import 路径按所选方案调整）。
3. `.bt-btn` 样式族加回 `balatro.css`。
4. 重新接线：路由、`/expedition` 导航、Dashboard 摘要条、图鉴出征入口。
5. 跑通归档三套测试 + `npm run build:vite` + CDP（`scripts/cdp-expedition-e3*.mjs`，需 electron `--remote-debugging-port=9222`）。
6. E4 待办：真实 integration（习惯打卡/任务完成事件 → `settleToday`），替换 E3 的模拟行动三档；消耗牌目标选择 UI；战报 Boss 血条精确分配。

## 备注

- 真机 `balatro_state` 表中若存在 `expedition:*` 键属 E3 试运行残留，活体代码不再读写，可保留（复活后自动续用）或由业主手动清理。
- E3 CDP 截图存于 `work/cdp-shots/e3-*.png`（15 张），供复活时视觉对照。
