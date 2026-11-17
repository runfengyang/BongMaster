# BongMaster × Balatro 卡牌游戏系统 · 设计文档（实施契约）

> 目标：在 BongMaster（Electron + Vue 3 + Pinia）中嵌入一个**尽量忠实还原原作**的
> Balatro 式 Roguelite 卡牌游戏，替换已删除的奖牌系统。
> 核心机制全量保留：扑克牌型计分、盲注推进（小盲/大盲/Boss + Ante）、
> 150 张小丑、商店（购买/重掷/卡包/出售/利息）、星球牌升级、塔罗/幻灵消耗牌、
> 卡包开启、版本(Edition)/增强(Enhancement)/蜡封(Seal)系统。
> 本文件是所有实施阶段的**唯一契约**。阶段之间通过本文件对齐接口。

---

## 1. 信息架构

| 路由 | 视图 | 说明 |
|---|---|---|
| `/entertainment` | `BalatroView.vue`（替换 EntertainmentPlaceholder 的内容） | 游戏主入口：继续Run / 新Run（选牌组） |
| `/entertainment/play` | 同上（内部状态切换即可，不强制子路由） | 牌桌：盲注选择 → 对战 → 商店 循环 |
| `/cards` | `CardCollectionView.vue` | 收藏图鉴（替代原 `/medals`）：小丑/塔罗/星球/幻灵/扑克增强，发现进度 |

- App.vue 顶部导航在原来奖牌入口位置新增「图鉴」入口（图标用像素小丑/卡牌元素），指向 `/cards`。
- 侧边/顶部主导航的「娱乐」入口保持指向 `/entertainment`，即游戏。
- 未发现的卡在图鉴中显示剪影 + `???`，发现后显示完整卡面与说明（发现 = 在任意 Run 中见过/获得过）。

## 2. 目录结构（新增）

```
src/balatro/
  data/
    hands.js          # 12 种牌型：基础筹码/倍率、每级成长、对应星球
    planets.js        # 12 张星球牌
    tarot.js          # 22 张塔罗牌
    spectral.js       # 18 张幻灵牌
    jokers.js         # 150 张小丑（见 §4）
    blinds.js         # 小盲/大盲 + 28 个 Boss 盲注 + Ante 分数表
    packs.js          # 5 类卡包 × 3 规格（Normal/Jumbo/Mega）
    decks.js          # 15 个牌组（Red/Blue/.../Erratic）
    editions.js       # 5 种版本（Base/Foil/Holographic/Polychrome/Negative）
    enhancements.js   # 8 种增强 + 4 种蜡封
    index.js          # 聚合导出 + 全局查找表 BY_ID
  engine/
    rng.js            # 可播种随机数（mulberry32）+ 加权抽取
    deck.js           # 扑克牌构建/洗牌/增强牌堆操作
    evaluate.js       # 牌型判定（含 Four Fingers/Shortcut/Smeared 等修正钩子）
    score.js          # 计分管线（见 §5.3）
    jokerEffects.js   # 小丑效果事件系统（见 §5.4）
    consumables.js    # 塔罗/星球/幻灵使用效果
    shop.js           # 商店生成/重掷/卡包/利息
    run.js            # Run 状态机（盲注选择/回合/结算/失败/胜利）
  store.js            # Pinia store：引擎实例 + 响应式桥接 + 持久化
  integration.js      # 与 BongMaster 生产力系统联动（见 §7）
  sound.js            # WebAudio 程序化音效
  components/
    CrtBackground.vue # WebGL 漩涡背景
    PlayingCard.vue   # 单张卡（3D 倾斜/版本着色器/翻面/悬停）
    CardHand.vue      # 手牌区（扇形排布/选择/排序）
    JokerBar.vue      # 小丑栏 + 消耗牌栏
    ScorePanel.vue    # 左侧信息面板（Ante/盲注/得分/出牌次数/牌型等级）
    BlindSelect.vue   # 盲注选择
    ShopPanel.vue     # 商店
    PackModal.vue     # 开包动画
    RoundScore.vue    # 计分演出层（飘字/抖动/累计动画）
    RunEndModal.vue   # Run 结束/胜利
  views 内嵌于 BalatroView.vue / CardCollectionView.vue
docs/balatro/01-design.md  # 本文件
```

**复用约束**：游戏内 UI 不依赖 bm-* 主题变量（Balatro 深色牌桌自成体系），
但图鉴页页头与导航入口要与 bm-* 风格协调。

## 3. 视觉与动效规范（重点）

### 3.1 CRT 漩涡背景（CrtBackground.vue）
- WebGL fragment shader 复刻原作旋转色块背景：两层旋转的正弦色带
  （主色 #004d40 系绿 + 辅色 #263238 深蓝灰），叠加轻微 CRT 扫描线 + 暗角。
- 纯 shader 实现，无图片资源；`prefers-reduced-motion` 时退化为静态渐变。
- 用于游戏页与开包/结算全屏层。参考开源社区对 Balatro 背景的 shader 复刻思路
  （极坐标扭曲 + 时间驱动的色相混合），自行实现，不复制任何代码。

### 3.2 PlayingCard.vue（所有卡的基座）
- 尺寸基准 71×95（原作比例），CSS 变量 `--card-w` 缩放。
- **3D 倾斜**：pointermove 时根据光标在卡面内的相对位置计算 rotateX/rotateY
  （最大 ±12°），带弹簧回弹（requestAnimationFrame 阻尼插值），倾斜时
  高光层（径向渐变）跟随光标移动 → 原作"拿在手里"的手感。
- **悬停上浮**：translateY(-8px) + 阴影加深 + 轻微放大 1.06，150ms。
- **翻面**：preserve-3d 双面翻转（600ms cubic-bezier），开包与发牌使用。
- **版本着色器**（叠加在卡面之上，均用 CSS 实现）：
  - Foil 闪箔：45° 线性高光带 3s 循环扫过。
  - Holographic 全息：彩虹线性渐变以 12% 透明度持续流动 + 色相微移。
  - Polychrome 多彩：全卡 `hue-rotate` 4s 无限循环 + 彩虹描边。
  - Negative 负片：`filter: invert(1) hue-rotate(180deg)` 作用于卡面图层 + 微光晕。
- **选中态**（手牌中点击选中）：上浮 12px + 蓝色描边。
- **触发抖动**（小丑/卡牌参与计分时）：快速小振幅 translateX 震动 300ms，
  同时弹出 `+N` 飘字（飘字上飘 40px 渐隐，chips 蓝色 / mult 红色 / money 金色）。

### 3.3 卡面美术
- 无外部素材，全部程序化渲染：
  - 扑克牌：标准牌面（角标 + 中央花色阵列，像素化处理）。
  - 小丑/塔罗/星球/幻灵：每张卡一个**像素画描述**（8-bit 风格网格图或
    emoji/几何组合 + 专属底色），存于数据文件的 `art` 字段
    （如 `{ bg: '#3b2f4f', motif: '...' }` 或小尺寸像素矩阵）。
    优先方案：每类卡一个基底模板 + 每卡差异化中心图案与配色。
- 卡牌边框按稀有度/类型着色（普通灰蓝 / 罕见绿 / 稀有红 / 传奇紫；
  塔罗紫、星球青、幻灵黑紫）。

### 3.4 关键演出
- **发牌**：牌从牌堆位置 stagger 飞入手牌区（每张延迟 40ms，ease-out）。
- **出牌计分序列**（RoundScore.vue 编排，严格还原原作节奏）：
  1. 选中牌上移成一排 → 牌型标签弹出（如「对子 Lv.2」）。
  2. 逐张计分：每张牌跳起 → 显示 `+筹码` 飘字 → 左侧筹码数累加。
  3. 增强/蜡封触发（玻璃 ×2 闪烁、钢铁在手中发光、红蜡封重复触发等）。
  4. 小丑从左到右依次触发：抖动 + 效果飘字（`+4 倍率` / `×3 倍率`）。
  5. 最终 `筹码 × 倍率` 大字撞击屏幕中央 → 总分计入盲注进度条，条满时
     盲注徽章碎裂/亮起。
  6. 大分数（超过目标 50% 以上单次）触发轻微震屏。
- **开包（PackModal.vue）**：卡包居中 → 点击后抖动撕裂 → 5 张（或按规格）
  背朝上扇形展开 → 点击逐张翻开（稀有/Boss 级有 0.4s 停顿 + 粒子 + 音效上扬）
  → 「选 N 张」确认按钮 → 选中卡飞入对应栏位。
- **音效**（sound.js，WebAudio 振荡器程序化合成，无音频文件）：
  翻牌（短噪声 burst）、筹码（高频方波双音）、倍率（上行琶音）、
  金币（正弦滑音）、开包撕裂（滤波噪声）、失败（下行锯齿波）。全部可静音。

## 4. 数据层规范

### 4.1 通用卡面字段
```js
{
  id: 'j_joker',            // 前缀：j_=小丑 c_=塔罗 p_=星球 s_=幻灵
  name: '小丑',             // 中文名（官方译名优先）
  nameEn: 'Joker',
  type: 'joker'|'tarot'|'planet'|'spectral',
  rarity: 1|2|3|4,          // 1普通 2罕见 3稀有 4传奇（仅小丑）
  cost: 2,                  // 商店售价（$），按原作
  sell: 1,                  // 卖出价（默认 floor(cost/2)，至少 1）
  text: '…效果描述（中文，忠实原作）…',
  textEn: '…English effect text…',
  unlock: null | { type: '...', ... },  // 原作解锁条件（图鉴显示用；引擎可简化为初始全可用，传奇除外）
  art: { bg: '#...', motif: '...', accent: '#...' },  // 程序化像素卡面
  effect: { handler: 'addMult', params: { mult: 4 } } // 见 §5.4
}
```

### 4.2 小丑（150 张，全量）
- **数据来源**：以 Balatro 官方 Wiki（balatrowiki.org 或 balatrogame.fandom.com
  的 Jokers 列表）为准核对全部 150 张的名称、稀有度、价格、效果、解锁条件；
  网络不可用时按模型内置知识实现，并在 `dataVerified: false` 标注。
- 稀有度分布（核对用）：普通 61 / 罕见 64? —— 以 wiki 实际数据为准，总数必须 = 150。
- 传奇 5 张（Canio/Triboulet/Yorick/Chicot/Perkeo）：正常卡池不出现，
  仅通过幻灵牌「灵魂 The Soul」开出。
- 效果文本保留原作数值（如「+4 倍率」「每张打出的 2/3/4/5 +30 筹码」）。

### 4.3 牌型（hands.js）
12 种，含基础筹码/倍率、升级增量、对应星球，按原作数值：
高牌/对子/两对/三条/顺子/同花/葫芦/四条/五条/同花葫芦/同花五条
（Lv.1 基础值如：同花 35×4，每级 +15/+2 —— 以原作数值表为准）。
Four Fingers、Shortcut、Smeared Joker、Splash 等对判定的修正通过
`evaluate(hand, modifiers)` 的 modifiers 参数注入。

### 4.4 塔罗（22）/ 星球（12）/ 幻灵（18）
- 全量按原作：塔罗（愚者/魔术师/女祭司/女皇/皇帝/教皇/恋人/战车/正义/
  隐者/命运之轮/力量/倒吊人/死神/节制/恶魔/塔/星星/月亮/太阳/审判/世界），
  效果如「死神：选 2 张牌，左变右」「倒吊人：销毁至多 2 张选中牌」。
- 星球：每张升级对应牌型 1 级（原作新增的 Mars=四条? —— 以 wiki 核对
  12 张与 12 牌型一一对应，含 Ceres/Eris/Planet X 对应隐藏牌型）。
- 幻灵：含 灵魂（随机传奇小丑）、黑洞（所有牌型 +1 级）等 18 张。

### 4.5 盲注（blinds.js）
- 小盲注/大盲注 + **28 个 Boss 盲注**全量（The Hook/The Ox/The House/
  The Wall/The Wheel/The Arm/The Club/The Fish/The Psychic/The Goad/
  The Water/The Window/The Manacle/The Eye/The Mouth/The Plant/
  The Serpent/The Pillar/The Needle/The Head/The Tooth/The Flint/
  The Mark/The Amber Acorn/The Verdant Leaf/The Violet Vessel/
  The Crimson Heart/The Cerulean Bell），效果按原作。
- Ante 基础分表按原作（Ante 1 小盲 300 / 大盲 450 / Boss 600 … 指数增长，
  Green/Purple stake 不影响，先做 White stake 数值）。
- 每个 Ante：小盲（可跳过）→ 大盲（可跳过）→ Boss（必选）→ Ante+1。
- 跳过盲注获得对应 Tag（原作 Tag 系统：实现常用 10 个即可，如
  经济 Tag/免费卡包 Tag/双倍 Tag；其余可后续补）。

### 4.6 卡包（packs.js）
5 类 × 3 规格（Normal 3 张选 1 / Jumbo 5 张选 1 / Mega 5 张选 2）：
- Arcana（塔罗）、Celestial（星球）、Standard（扑克牌，可带增强/蜡封/版本）、
  Spectral（幻灵）、Buffoon（小丑）。
价格按原作（4/6/8$ 档）。

### 4.7 版本 / 增强 / 蜡封
- Editions：Foil(+50 筹码) / Holographic(+10 倍率) / Polychrome(×1.5 倍率) /
  Negative(+1 栏位，小丑/消耗牌)。出现于商店卡与卡包，概率按原作档位。
- Enhancements（8）：Bonus(+30 筹码) / Mult(+4 倍率) / Wild(任意花色) /
  Glass(×2 倍率，1/4 概率碎) / Steel(在手牌中 ×1.5) / Stone(无点数花色，
  +50 筹码) / Gold(回合结束若在手 +$3) / Lucky(1/5 +20 倍率，1/15 +$20)。
- Seals（4）：Red(重触发 1 次) / Blue(回合结束在手 → 对应星球) /
  Purple(弃掉 → 随机塔罗) / Gold(计分时 +$3)。

### 4.8 牌组（decks.js，15 个全量）
Red(+1 弃牌) / Blue(+1 出牌) / Yellow(+$10) / Green(利息无上限? 按原作) /
Black(+1 小丑栏，-1 出牌) / Magic(开局 2 张水晶球+? 按原作) /
Nebula(开局望远镜，-1 消耗栏) / Ghost(幻灵入商店) / Abandoned(40 张无花脸牌) /
Checkered(26 黑桃+26 红心) / Zodiac(商店必出塔罗+星球) /
Painted(+2 手牌，-1 小丑栏) / Anaglyph(每个 Boss 后双倍 Tag) /
Plasma(计分时筹码×倍率取平均后平方? 按原作：chips 与 mult 平均后相乘) /
Erratic(随机点数花色)。

## 5. 引擎规范

### 5.1 Run 状态机（engine/run.js）
```
idle → deckSelect → blindSelect(small|big|boss) → round(playing)
     → roundEnd(结算奖励) → shop → blindSelect(next) → …
     → runOver(失败) | victory(Ante 8 Boss 通关)
```
- 回合内：抽满手牌（默认 8 张）→ 玩家选 ≤5 张出牌 或 ≤5 张弃牌，
  次数有限（默认 4 出牌 / 3 弃牌）→ 累计得分 ≥ 盲注目标即回合胜利。
- 回合结束：剩余出牌次数 ×$1 + 盲注奖励金 + 利息（每 $5 得 $1，上限 $5，
  Green deck 例外）+ 小丑经济效果 → 进商店。
- 失败/胜利后可看本局统计，可一键新 Run。

### 5.2 计分管线（engine/score.js）
输入：打出的牌组 + 当前手牌 + 小丑阵列 + 牌型等级 + 盲注修正。
严格按原作顺序：
1. `evaluate()` 判定牌型（取能组成的最高牌型），确定参与计分的牌。
2. 基础 筹码/倍率 = 牌型当前等级值。
3. 逐张计分牌：加点数筹码 → 增强效果（含 Lucky 概率、Glass ×2）→
   蜡封（Red 重触发整步）→ 版本加成。
4. 手牌中触发（Steel、Blue seal? 蓝封在回合结束、Baron 类小丑钩）。
5. 小丑阵列从左到右：每个可触发小丑执行 handler（可修改 chips/mult、
   ×mult、给钱、重触发指定牌等），触发顺序 = 玩家排列顺序。
6. Plasma deck 修正 / Boss 盲注修正。
7. `total = chips × mult`，返回完整事件流（见下）。
- **事件流**：管线产出有序事件数组
  `[{type:'cardScore', cardId, chips}, {type:'jokerTrigger', jokerId, mult}, ...]`
  UI 层按事件流做演出（这是动效与逻辑解耦的关键，必须实现）。

### 5.3 小丑效果事件系统（engine/jokerEffects.js）
数据驱动：jokers.js 中每张卡的 `effect.handler` 指向注册表中的处理器，
`params` 传数值。处理器签名统一：
```js
handler(ctx, params) // ctx = { run, round, played, scored, held, joker, hand, emit, rng }
```
必须覆盖的效果类别（注册表 key，供 150 张复用）：
- 静态加成：`addChips` `addMult` `multMult`（如 Joker/抽象小丑）
- 条件加成：`handTypeBonus`（牌型类小丑 Jolly/Zany…）、`suitBonus`（贪婪四小丑）、
  `rankBonus`（Even/Odd/Scholar/Fibonacci/WalkieTalkie）、`faceCardBonus`（Scary Face 等）
- 成长型：`scalingOnTrigger`（Runner/IceCream/GreenJoker/Constellation/Square 等，
  状态存 `joker.state`）
- 重触发：`retrigger`（Hack/Dusk/Sock and Buskin/Hanging Chad/Blueprint/Brainstorm 特例）
- 经济：`economy`（GoldenJoker/ToTheMoon/DelayedGratification/Mail-In-Rebate…）
- 卡牌操控：`deckModify`（Marble/Stone/DNA/Certificate/Vampire/Midas…）
- 生成型：`createCard`（RiffRaff/Seance/Hallucination/SixthSense/Space/Cartomancer…）
- 规则修改：`ruleMod`（FourFingers/Shortcut/Smeared/Splash/Showman/Mime 被动标记，
  由 evaluate/计分管线读取 `run.modifiers`）
- 特殊：`copyRight`（Blueprint）、`copyLeftRight`（Brainstorm）、
  `destroyAndGain`（Madness/Ceremonial Dagger/Obelisk 等）
- 传奇 5 张各自专用 handler。
- Blueprint/Brainstorm 通过读取相邻小丑的 handler 二次执行实现（禁止复制自身）。

### 5.4 商店（engine/shop.js）
- 每回合商店：2 张卡牌位（小丑/塔罗/星球，权重按原作）+ 1 卡包位 +
  1 优惠券位（Voucher：实现原作 32 张 Voucher 全量，每 Ante 商店刷新 1 张，
  购买后本 Run 永久生效）。
- 重掷 $5 起、每次 +$1（重掷只刷卡牌位）。
- 出售：小丑/消耗牌可拖出或在面板点出售，得 sell 价。
- 优惠券位为原作机制，不可省略（含 Overstock/Reroll Surplus/Grabber 等，
  分基础版与升级版）。

### 5.5 持久化
- Electron：新增 `balatro_state` 表（key TEXT PRIMARY KEY, value TEXT），
  IPC：`balatro:load` / `balatro:save`（electron/main.js + preload 暴露
  `window.electronAPI.balatroLoad()/balatroSave(state)`）。
- 浏览器降级：`window.electronAPI` 不存在时用 localStorage（键 `balatro:state`），
  保证 `npm run dev:vite` 纯网页预览可玩。
- 存档内容：当前 Run（如有）+ 图鉴发现记录 + 统计 + 设置（音量/动效开关）。
  防抖 500ms 自动保存。

## 6. Pinia Store 公共 API（src/balatro/store.js）
```js
useBalatroStore = {
  // state
  screen,            // 'menu'|'deckSelect'|'blind'|'round'|'shop'|'pack'|'runEnd'|'collection'
  run,               // 当前 run 引擎状态（响应式快照）
  collection,        // 图鉴发现进度
  settings,
  scoreEvents,       // 最近一次计分事件流（供 RoundScore 播放）
  // actions
  newRun(deckId), continueRun(), abandonRun(),
  selectBlind(blindId), skipBlind(),
  toggleCardSelect(cardId), sortHand(byRank|bySuit),
  playSelected(), discardSelected(),
  buyShopItem(slotIndex), rerollShop(), buyVoucher(), sellCard(type, index),
  openPack(packId), pickPackCards(indices),
  useConsumable(index, targets), sellConsumable(index),
  reorderJokers(from, to),
  // 联动
  grantProductivityReward(payload)   // 见 §7
}
```
引擎为纯 JS 类，store 持有引擎实例并在每次操作后同步响应式快照 —
— UI 永远不直接 import engine 内部。

## 7. 与 BongMaster 生产力系统联动（integration.js）
轻量、低打扰：
1. **打卡/完成日任务 → 游戏资源**：每次习惯打卡或完成每日任务，
   调用 `grantProductivityReward({source:'checkin'|'task'})`：
   累计计数；每 3 次 = 游戏内 $1（下次 Run 或当前 Run 直接入账），
   每 10 次 = 免费 Buffoon 包 1 个（存入「待领取」，游戏主菜单可见）。
   连续打卡 7 天里程碑：免费 Celestial 包。
2. **挂接点**：`habit-store.js` 的 checkin 成功处 与 `daily-task-store.js`
   状态变更为完成处，各加一行调用（动态 import，避免循环依赖；
   electronAPI 不可用时静默跳过）。
3. **导航**：App.vue 恢复一个入口按钮（替代原奖牌入口），文案「图鉴」，
   指向 `/cards`；图标为像素卡牌。Dashboard 不改动（避免范围蔓延）。
4. 生产力奖励不影响游戏内平衡数值主线（奖励量级 ≤ 原作正常经济波动）。

## 8. 数值忠实度红线
- 所有卡牌数值、盲注分数表、价格、概率以官方 Wiki 为准；
  与原作有出入时以 wiki 修正代码，禁止凭感觉调数。
- 做不到 1:1 的机制（如特定 Boss 与特定小丑的极端交互）允许简化，
  但必须在代码注释 `// FIDELITY:` 标注差异点。

## 9. 分期与验收

### Phase 1（数据 + 引擎 + 持久化）
- 交付：§4 全部数据文件（150 小丑全量）、§5 引擎（状态机/计分/效果注册表/
  商店/卡包）、store.js、electron IPC + localStorage 持久化。
- 验收：`node scripts/balatro-engine-test.mjs`（新写脚本）模拟一局：
  新 Run → 出牌计分 → 回合结算 → 商店购买 → 下一盲注，断言计分正确性
  （至少覆盖：对子/同花/葫芦判定、Glass 碎裂、Red seal 重触发、
  Blueprint 复制、Plasma deck 修正、Boss 盲注效果各一例）。脚本全绿。

### Phase 2（核心 UI）
- 交付：CrtBackground、PlayingCard（倾斜/版本/翻面）、CardHand、JokerBar、
  ScorePanel、BlindSelect、RoundScore 演出、BalatroView（菜单→牌桌全流程）、
  sound.js。路由 `/entertainment` 指向 BalatroView。
- 验收：`npm run build:vite` 通过；手动/自动冒烟：可完成一个完整回合
  （选盲注→出牌→结算→商店→下一盲注），动效按 §3 呈现。

### Phase 3（商店/卡包/消耗牌/Boss/Tag/Voucher 完整化）
- 交付：ShopPanel、PackModal 演出、消耗牌使用交互（选牌目标 UI）、
  28 Boss 效果全部生效、Tag、Voucher 全量。
- 验收：引擎测试追加 Boss/Voucher/消耗牌用例全绿；UI 可完整打通 Ante 1→3。

### Phase 4（图鉴 + 联动 + 收尾）
- 交付：CardCollectionView（`/cards`）、App.vue 图鉴入口、integration.js
  挂接、设置（音量/动效）、Run 统计页。
- 验收：构建通过；`npm run dev:vite` 纯网页可玩（localStorage 存档）；
  全仓无 medal/奖牌 残留引用（备份目录除外）。

---

## 10. 实施完成记录（2025 实装）

四个阶段全部交付并验收通过。

### Phase 1（数据 + 引擎 + 持久化）
- `src/balatro/data/*`：12 牌型 / 12 星球 / 22 塔罗 / 18 幻灵 / **150 小丑**（已核对
  wiki，普通 61 / 罕见 64 / 稀有 20 / 传奇 5）/ 小盲大盲 + 28 Boss / 5 类卡包 × 3 规格 /
  15 牌组 / 5 版本 / 8 增强 + 4 蜡封 / 32 优惠券 / 标签。
- `src/balatro/engine/*`：rng / deck / evaluate / score / jokerEffects / consumables /
  shop / run（状态机 + 序列化）。
- `src/balatro/store.js`：Pinia 桥接 + 快照注入（派生栏位、商店价格）；Electron
  `balatro_state` 表 + `balatro:load/save` IPC，浏览器降级 localStorage（防抖 500ms）。
- 验收：`scripts/balatro-engine-test.mjs` 61/61 绿。

### Phase 2（核心 UI）
- `CrtBackground`（WebGL 漩涡）、`PlayingCard`（3D 倾斜/版本着色器/翻面/shake+floatText）、
  `CardHand`、`JokerBar`（拖拽重排）、`ScorePanel`、`BlindSelect`、`RoundScore`
  （事件流计分演出，UI 不重算分数）、`sound.js`（WebAudio 合成）、`BalatroView` 全流程。
- 路由 `/entertainment` → BalatroView；App.vue 持久娱乐层组件同步替换为 BalatroView
  （原 webview 版 EntertainmentView 与 EntertainmentPlaceholder 留仓不再引用）。
- 验收：构建通过；`scripts/balatro-ui-smoke.mjs` 无头冒烟全绿。

### Phase 3（商店/卡包/消耗牌/Boss/Tag/Voucher 完整化）
- `ShopPanel`（售罄空槽/悬停详情/重掷递进价/已持券展示）、`PackModal`（撕裂 → 扇形
  展开 → 逐张翻开（稀有 0.4s 悬念+粒子+上扬音效）→ 选 N 张 → 分向飞入栏位）、
  `playRules.js`（Boss 约束/选牌规格纯函数）、消耗牌目标选择模式（死神按手牌位置
  排序 targets）、Boss 效果全部 surfacing（出牌 gating + 削弱标记 + 小丑变灰）、
  标签 chips、灵魂/黑洞全屏演出、32 优惠券购买即永久生效。
- 验收：`scripts/balatro-phase3-test.mjs` 59/59 绿。

### Phase 4（图鉴 + 联动 + 收尾）
- `CardCollectionView`（`/cards`，bm-* 页头 + 剪影/??? + 详情弹层 + 稀有度筛选 +
  增强/蜡封/版本参考页）；App.vue 导航「图鉴」pill 入口（CSS 像素卡牌图标）。
- 图鉴「见过即发现」：商店陈列/卡包选项/获得物均入发现集并随存档持久化。
- `integration.js`：打卡/任务完成 → 每 3 次 $1、每 10 次免费小丑包、7 天连打卡
  免费天体包；已挂接 `habit-store.js`（createCheckin 成功处，含 streak 计算）与
  `daily-task-store.js`（toggleComplete 变为完成处），动态 import + 静默跳过。
- 主菜单设置（音量/静音/减少动效，CrtBackground 联动）+ 待领取角标；Run 结算页
  （Ante/回合数/最佳一手/最常牌型/累计金钱）。
- 验收：`scripts/balatro-integration-test.mjs` 20/20 绿；`medal|Medal|奖牌` 全仓
  （src + electron）零残留；`npm run dev:vite` 纯网页 localStorage 链路测试通过。

### 已知 `// FIDELITY:` 偏差汇总
1. `engine/shop.js`：幻术优惠券的版本概率不受磨砺/焕彩影响且不出蜡封（原作 bug 复刻）。
2. `engine/run.js` Boss 轮换：原作「最少出场优先」简化为「不连续重复」。
3. `engine/run.js`：house/wheel/fish/mark（面朝下抽取）、ceruleanBell（强制选中）、
   amberAcorn（翻面洗混）为纯 UI 表现差异，引擎层无计分影响，按无操作处理。
4. `engine/run.js` 骨头先生：原作免死后按未获奖励进入下一阶段，此处按正常获胜结算。
5. `components/PackModal.vue`：原作秘术/幻灵包内卡牌可当场立即使用，此处统一先飞入
   消耗牌栏。

### 其他实现层简化（未影响数值）
- RoundScore 播放计分时底层界面已切到下一状态，靠覆盖层遮挡弱化（原作原地演完再过渡）。
- 计分数字累积用 pop 动画，未做逐位 count-up；点击任意处加速代替专用跳过按钮。

## §11 方向调整记录（娱乐中心恢复 + 纯收藏开包重定位 + 1:1 视觉复刻）

### 背景与决策
业主方向大改：Run 玩法整体下线，系统重定位为「生产力打卡赢卡包 → 即开即收」的
纯收藏循环；`/entertainment` 恢复原 webview 娱乐中心；卡牌视觉向原作 1:1 靠拢。

### ① 娱乐中心恢复（Run UI 归档）
- 路由 `/entertainment` 回到 `EntertainmentPlaceholder`（空占位，真实内容仍由
  App.vue 持久娱乐层渲染，保持 webview 跨导航存活）；App.vue 持久层 import 回到
  `@views/EntertainmentView.vue`（小红书/B站/YouTube webview + 休闲计时器，未改动）。
- `src/views/BalatroView.vue` + 6 个纯 Run 组件（BlindSelect/ScorePanel/RoundScore/
  ShopPanel/JokerBar/CardHand）移至 `src/balatro/attic/`（不删档、不被编译）。
- 保留：`PlayingCard/PackModal/CrtBackground/ErrorBoundary`（components/）、
  `sound.js`、`playRules.js`（PackModal 引用 `packOptionRare`）、
  `data/`、`engine/`、`store.js`、`integration.js` 及全部测试脚本。

### ② 纯收藏 + 开卡包
- 金钱滴灌删除：`grantProductivityReward` 不再每 3 次发 $1（Run 内/暂存均删），
  `newRun` 不再做 pendingMoney 入账；奖励仅剩卡包（每 10 次小丑包、7 天连打卡
  天体包）。`integration.js` 挂接点不变，自然只发包。
- store 新增收藏开包链路：`collectionPack` 快照 + `openCollectionPack()` /
  `pickCollectionCards(indices)` / `skipCollectionPack()`。实现用一次性
  `BalatroRun` 实例调官方 `openPack`——版本/稀有度概率全走引擎官方档位
  （`Shop.generateJoker` 等）；选项「见过即发现」；开包失败自动返还卡包。
- 收藏持久化：`collection.ownedCards: [{ id, edition, obtainedAt }]`，随
  collection 字段一起走 IPC/localStorage 存档（旧存档缺字段时 init 自动补 []）。
- `/cards` 顶部「🎁 卡包」区：同款合并计数、点击即开（PackModal 独立复用，
  无需 Run，CRT 漩涡衬底）；网格 ×n 持有角标 + 版本徽章圆点（基础/闪箔/全息/
  多彩/负片）；详情弹层显示持有清单；App.vue 图鉴按钮加 🎁n 脉动角标。

### ③ 1:1 视觉复刻
- m6x11 官方像素字体：`public/fonts/m6x11.ttf`（18KB，自由许可，来源
  balatrowiki.org/w/File:M6x11.ttf），`src/balatro/balatro.css` @font-face，
  main.js 引入；牌面拉丁/数字走 m6x11，CJK 回落系统字体。
- PlayingCard 重写（公共 API 全保：card/def/kind/edition/selected/faceDown/
  dealt/dealDelay/selectable/width + click + shake/floatText）：
  - 71×95 版式：内部固定 142×190（2x）按 width 整体缩放，任意渲染尺寸一致清晰。
  - 小丑/消耗牌：名牌横幅 + 像素画窗 + 稀有度色条（稀有度即边框色）。
  - 程序化像素画：emoji motif 绘入 36×36 canvas，pixelated 放大 84px，复古像素感。
  - 程序化卡背：红底 + 双向 45° 菱形交叉纹 + 点阵 + 米白描边（纯 CSS）。
  - 速度感应倾斜：位置倾斜 ±10° + 指针速度加成（低通平滑、逐帧衰减、弹簧阻尼），
    附带速度联动 rotateZ；光泽跟随指针。
  - idle 浮动：全卡共用单个 rAF ticker（注册/注销制），相位随机错开。
  - 版本着色：canvas 噪点纹理（模块级单例 dataURL）叠加 CSS 渐变动画。
- 精灵图集决策：已在 ≤5 次 fetch 内拿到官方 2x 图集（1420×3040，10×16 瓦片），
  但原作按 jokers.lua 显式 `pos={x,y}` 排布（实测 Lucky Cat=(5,14)、Jj 占位=(0,15)
  等），注册顺序 ≠ 图集顺序；预算内未取得可靠 id→pos 映射，按预定决策回退
  程序化像素化方案，版式优先。
- CRT 调色：主色偏墨绿 #004a38、辅色深海军蓝 #1c2933，扫描线/色带对比加强；
  静态降级渐变同步；开包弹层衬底接入并与「减少动效」设置联动。

### ④ 闪退防护
- store.init 全体 try/catch：读档反序列化任何异常都降级为空收藏，永不抛。
- `/cards` 全页 ErrorBoundary（onErrorCaptured + 重试按钮），本次真机验证中
  实际兜住一次渲染异常（def.type 误用，已修：网格/详情 kind 改由页签上下文给出，
  PlayingCard playing 分支加 `&& card` 防御）。
- PlayingCard rAF 双重保障：倾斜弹簧收敛即停；idle ticker 仅在
  IntersectionObserver 可视 + 非减动效时运行，离屏/卸载即注销；版本动画
  `animation-play-state` 随 inview 门控。

### ⑤ 验收结果
- 无头：engine 61/61、phase3 59/59、ui-smoke 14~24/0 败（随机波动）、
  integration 29/29（金钱用例按 §11 改写为「不再发钱只发包」+ 新增收藏开包
  9 断言）；`npm run build:vite` ✓；router/App.vue 无 Balatro 视图残留。
- 真机（vite 5173 + `electron . --remote-debugging-port=9222` +
  `scripts/cdp-collect-drive.mjs`）：19/19 绿、NO PAGE ERRORS——存档 IPC 注入
  → 图鉴网格/角标/版本徽章 → 开包全流程（撕开→翻牌→选卡→入收藏→角标递减→
  持久化 3 张）→ 跳过一个包 → /entertainment 3 个 webview 且无 Run UI →
  大网格滚动存活；测后全部进程杀净、测试注入存档已从 SQLite 删除。
- 已知随机波动：phase3 商店冒烟在 6 次全量回归中出现 1 次 58/1（随机开局未达
  断言路径），连跑 4 次均 59/59，属既有随机性而非回归。

## §12 官方素材 1:1 接入 + 社区 Mod 致敬卡（2025 实装）

### ① 素材来源（全部公开渠道）
- 卡面图集：Balatro 官方 `textures`（jokers/tarots/vouchers/enhancers 四张 webp，
  71×95 瓦片，存 `public/sprites/`）。
- 卡面坐标与官方简中：GladdonT/balatro-source-code（1.0.1o-FULL `game.lua` 单行
  卡牌定义 + `localization/zh_CN.lua`），存 `work/balatro-source/`。
- Mod 数据：Cryptid（MathIsFun0/Cryptid）、Pokermon（InertSteak/Pokermon）、
  KCVanilla（kcgidw/kcvanilla）三仓库 `localization/en-us.lua` 原文。
- 社区索引：awesome-balatro README（中文）。

### ② spriteMap（scripts/gen-sprite-map.mjs → src/balatro/data/spriteMap.js）
- 解析 game.lua 的 `name`/`pos`/`soul_pos`，按 nameEn 与游戏 key 双层匹配，
  **覆盖率 234/234**：小丑 150 + 塔罗 22(c_*) + 星球 12(p_*) + 幻灵 18(s_*) + 优惠券 32。
- 游戏 key 与本作 id 有 40+ 处不一致（如 j_jolly vs j_jolly_joker），靠 nameEn 归一；
  `j_canio` 别名（游戏拼写 Caino）；传奇 5 张带 `soul_pos`（底帧 y=8 + 真身 y=9
  透明叠加，spriteMap 条目含 sx/sy）；`BACK_SPRITES` 16 卡背（b_red @ enhancers(0,0)）。

### ③ PlayingCard 精灵渲染（src/balatro/components/PlayingCard.vue）
- `spriteInfo` 命中 → `.pc-sprite`：background-image 图集 + backgroundSize
  cols×142/rows×190 + backgroundPosition -x·142/-y·190（组件内 2x 渲染，pixelated）；
  传奇额外 `.pc-sprite-soul` 叠加层。
- 未命中（Mod 卡）→ 回退原程序化横幅 + emoji motif 像素 canvas。
- 卡背 `.pc-back-sprite`（b_red 官方红背菱形纹）盖程序化纹兜底。
- 图鉴未发现卡：有 sprite 者渲染 `.cv-shadowcard`（:deep(.pc-front) brightness(0)
  + opacity .55，藏 gloss/edition 层）作原作式剪影；无 sprite 的 Mod 卡保留 ? 盒。

### ④ zh_CN 官方简中校对（4 个数据文件）
- name 官方化 66 条；text 规则＝官方无 #n# 变量→用官方、恰 1 变量且本作恰 1 数→替换、
  多变量→恢复 dist bundle 底本（校对前原始数据），共官方化 56 条 + 底本恢复 68 条。
- 教训：位置替换曾误伤 j_8_ball（"8/8几率"），已用底本规则修复。
- 残留标签/变量 grep = 0；校对后 engine 61/61、phase3 59/59、integration 全绿。

### ⑤ 社区 Mod 致敬卡 50 张（src/balatro/data/modJokers.js，id 前缀 mj_）
- 构成：**Cryptid 26 / Pokermon 14 / KCVanilla 10**。效果文本按各 Mod 官方 en-us
  本地化原文翻译；原文 #n# 且本地化文件无法确定取值者以「X」原样保留（不臆造数值）；
  稀有度/cost 为本作收藏体系映射（Mod 原版稀有度体系不同）。
- 清单（中文名／来源）：
  - Cryptid：M、古戈尔游戏卡、厌倦、画布、马力欧、猛男、同步催化剂、全能一体、Nice、
    负片小丑、:D、开心小丑？、安慰奖、怀旧糖果、棉花糖、后翼弃兵、狩猎季、纵火犯、
    吞牌兽、击掌、极简化、双子、南瓜、迷宫、瓦力欧、瓦路易吉
  - Pokermon：急冻鸟、火焰鸟、凤王、超梦、梦幻、索罗亚克、百变怪、基拉祈、阿勃梭鲁、
    谜拟丘、冰伊布、叶伊布、超级耿鬼、大岩蛇
  - KCVanilla：五日预报、小丑酱、电网、机宝、替罪羊、老鼠！、松动的牙、落语、
    十瓶保龄、红包
- 原计划含 Ortalab/Bunco/MoreFluff，因研究抓取预算（≤8 次）耗尽且仓库路径多次 404
  未取到数据，为不臆造而割爱；Ortalab 仅剩补丁说明级信息，不足成卡。
- 图鉴新增「Mod」页签（cardTabs + MOD_JOKERS，稀有度子筛选复用），详情面板加
  🧩 来源标签与来源说明（「不进 Run 卡池」）；totalAll 202→252。
- `data/index.js` BY_ID 合入 MOD_JOKERS_BY_ID：BY_ID 仅 UI 查找（PackModal/图鉴），
  引擎卡池均从具体数据文件构建，Mod 卡永不进 Run。
- Buffoon 包混入：仅 `store.openCollectionPack`（收藏模式）——joker 包每个选项
  25% 概率替换为随机 mj_ 卡（edition 保留引擎官方 roll 出值）；引擎/shop/
  claimPendingPack 完全不动，Run 模式保持纯官方。

### ⑥ 验收结果
- 无头：engine 61/61、phase3 59/59、sprite-test 22/22（图集尺寸/覆盖率/坐标越界/
  传奇 soul 层/抽样坐标）、integration 40/40（新增 §12 断言：50 张/id 唯一/字段完整/
  来源构成/BY_ID 合入/30 包 120 选项混入 36 次=30%∈(5%,50%)/Mod 可选入收藏并发现/
  不进 Run）；`npm run build:vite` ✓。
- 真机（scripts/cdp-mod-verify.mjs）：13/13 绿、NO PAGE ERRORS——4 图集可达；
  小丑页签 .pc-sprite ×156（背景图指向 jokers.webp）+ 传奇 soul 层 ×6；
  Mod 页签 50 张全渲染、0 精灵（回退 motif）、三来源代表卡在、持有角标 ×1；
  详情 🧩 Cryptid 标签 + 来源说明；巨型小丑包真机混入「梦幻」并选入收藏
  （balatroLoad 持久化 mj_pk_mew）。截图存 work/cdp-shots/（4 张）。
- 进程与数据：测后 vite/electron 全杀净（pgrep 复核为空）；真机数据库先备份
  work/mods/database.db.bak、测后原样恢复，零数据污染。


---

## §13 官方卡包图集 + 撕开演出 + 图鉴全面小丑牌化 + 闪退根因修复

### ① 闪退 / 预览超时根因
- **预览「网站启动超时」根因**：package.json `dev` 原为 concurrently 编排
  （`vite` + `wait-on 5173` + `electron`），Electron 在预览沙箱无法启动，编排层
  拖垮端口就绪。修复：`"dev": "vite"` 纯前端；Electron 流程原样挪到 `dev:desktop`。
  验证 `npm run dev -- --port 7199 --strictPort` 0.6s 返回 200。
- **渲染进程闪退**：CDP 复现（scripts/cdp-crash-repro.mjs，注入全种类存档后遍历
  点击每种卡 + 快速连点开关详情 ×6 + 开包后立即点击新获得卡）→ 13/13 绿、
  crashes none、NO CONSOLE ERRORS；scripts/cdp-mem-stress.mjs 40 轮详情开关 +
  页签轮换 + 堆采样（--js-flags=--expose-gc）→ 堆稳定 23-26MB、DOM 1024 节点，
  无泄漏无崩溃。结论：dev 模式 /cards 全链路无异常无泄漏；所见「闪退」最可能
  就是预览编排死亡导致的页面消失（与超时同根因），已随 dev 脚本修复。
  ErrorBoundary 保留未动。

### ② 官方 Booster 图集 + 像素塑料卡包 + 撕开演出
- **图集来源**：Signez/balatro-sprites-i18n 仓库 `test/reference/boosters.png`
  （官方参考图，568×1710 = 4 列 × 18 行、142×190 的 2x 瓦片），BOX 降采样到
  284×855（4×9 格 71×95）→ `public/sprites/boosters.webp`，与另 4 张 1x 图集同构。
- **映射规则**：game.lua Booster 坐标 33 条已解析；本作 `pack_<type>_<size>` →
  游戏 `p_<type>_<size>_1`（首变体）；jumbo/mega 与 normal 同排 y 行
  （arcana y=2 / celestial y=3 / spectral 全在 y=4 / standard y=7 / buffoon y=8）。
  gen-sprite-map.mjs §3b 展开 5 类 × 3 规格 → SPRITE_MAP 249 条（234 + 15 卡包）；
  ATLAS_META 加 `boosters: { url, cols: 4, rows: 9 }`。
- **PackModal 重做**：sealed = 双 `.pm-pack-part`（bottom `clip-path: inset(22% 0 0 0)`
  / top `inset(0 0 78% 0)`）PACK_SCALE=3 渲染 213×285，`image-rendering: pixelated`；
  idle 呼吸 packBreath + 斜向扫光 glintSweep 3s；点击 → packShake 0.38s +
  白锯齿撕条 tearAcross 0.45s（从左展开）+ 上半 topFly 0.6s（rotate+飞走+淡出）+
  12 片塑料碎屑 plasticFly（随机 --dx/--dy/--rot/--dur）；音效 sound.crinkle()
  （5 簇高频噪声）→ 220ms 后 sound.zip()（带通 900→4200 上扫拉锁声）→ 940ms open。
  无精灵兜底 `.pm-pack-fallback`（渐变 + motif）保留。
- **图鉴卡包瓷砖**：emoji motif 换成 `.cv-pack-sprite`（SPRITE_MAP + ATLAS_META
  原生 71×95 1x 定位，pixelated）。

### ③ 图鉴全面小丑牌化（CardCollectionView 整文件重写）
- 页级 CrtBackground 衬底（fixed 包裹层 z-index 0 + 内容层 z-index 1）；
  全局 `balatro-font`（m6x11，CJK 回落系统字体）。
- 暗绿/海军蓝游戏面板 `.cv-panel`（rgba(14,26,23,.88) + 2px #3d5a54 + inset 高光）；
  金 #f4c14f 主强调；bm-* 页头降饱和融入面板体系。
- 像素页签按钮（小丑/塔罗/星球/幻灵/Mod/增强·蜡封·版本）：2px 描边、active 金框
  金字发光、squish 按压 `:active scale(.94,.86)` + sound.click()；稀有度 chips 同款。
- chunky 进度条：金斜纹填充 + inset 暗边 + 像素 % 数字叠层。
- 格子 stagger pop-in（`:key="tab"` 重挂载 + `--i = i % 24` × 14ms animation-delay）；
  已发现格 `@pointerenter` → sound.tick()（990Hz 0.03s 悬停滴答）。
- 持有角标金贴纸（2px 棕边 + 6° 旋转）；版本点加描边光晕。
- 详情面板游戏化：左大卡 detailFloat 浮动 + 金色像素名 + 像素 chips +
  红色 squish 关闭钮（#e05548→#b03327，3px 暗边，:active scale(.9)）。
- sound.js 新增 `crinkle()` / `zip()` / `tick()`。

### ④ 验收结果
- 无头：engine 61/61、phase3 59/59、sprite-test 30/30（新增 boosters 图集尺寸
  284×855 / 15 卡包全覆盖 / 5 坐标抽样断言）、integration 40/40；
  `npm run build:vite` ✓。
- 真机 CDP（vite 5173 + `NODE_ENV=development electron . --remote-debugging-port=9222`）：
  - cdp-crash-repro.mjs 改版后复跑：13/13 绿、crashes none、NO CONSOLE ERRORS；
  - cdp-shots-13.mjs（新增）：7/7 绿、crashes none、NO CONSOLE ERRORS，
    11 张截图存 `work/cdp-shots/`（01-05 图鉴各页签、06 传奇详情、07 未拆封
    官方卡包、08 撕条中段帧、09 上半飞走帧、10 扇形背面、11 全翻开）。
- 进程与数据：测后 vite/electron 全杀净（pgrep 复核为空）；真机数据库先备份
  `work/mods/database.db.bak4`、测后原样恢复，零数据污染。


---

## §14 开包动画重做：锯齿撕裂 / 爆开震屏 / 3D 细看

范围：PackModal.vue、PlayingCard.vue、CardCollectionView.vue 三处。

### ① 锯齿裂缝撕裂（替换旧"横线撕条"）
- 裂缝路径：`genJag()` 生成 16 段不规则锯齿（百分比坐标，基线 13-19% 高，
  交替齿 ±1.6-5.4%，偶发抖动），一次撕开一随机样。
- 双片 clip-path：包体 `bodyClipStyle` = 裂缝以下 ∪ 前沿右侧未撕段；
  上半撕条 `topClipStyle` = 裂缝以上 ∩ 前沿以左；均由 rAF 驱动的 `tearP`（0→1，
  500ms）逐帧重算 polygon —— 裂缝沿微颤路径从左 zip 到右。
- 撕条揉皱：`topCrumpleStyle` 绕撕裂前沿附着点（transform-origin = 前沿坐标）
  rotate(-13°·p)/skewX/translate + brightness 提亮。
- 撕裂前沿光点 `.pm-tear-front`（径向白晕）标记刀尖；idle 态 `.pm-pack-perf`
  白色 perforated 虚线提示撕条区；音效 crinkle ×2（0ms/240ms）与 zip 同步。

### ② 爆开 + 震屏（burst 相位 520ms）
- 撕条 `topFlySpin`：从揉皱姿态续接，rotate 560° + translate(170,-380) 飞出。
- 包体两瓣 `half-l/half-r`：沿裂缝 polygon 分左右，`halfL/halfR` keyframes
  先外抛（25%）再重力坠落（translateY +210px, rotate ±26°, 淡出）。
- 白闪 `.pm-flash`（radial 白晕 .38s 扩散淡出）。
- 16 片塑料碎屑 `plasticFly` 两段式：38% 抛射（--dx·0.75, --dy）→ 100% 重力坠落
  （--fall 150-320px）+ 旋转 --rot ±360°。
- 震屏作用于 `.pm-overlay` 整体，按包型分级：normal `.pm-shake-light` .32s ±4px /
  jumbo `.pm-shake-mid` .36s ±8px / mega `.pm-shake-strong` .42s ±14px+rotate 1.1°，
  振幅逐帧衰减。
- 爆开发牌：PlayingCard `dealIn` 改为 scale(.22) + `--bx`（父级注入的槽位到
  扇形中心水平偏移，边位飞得更远）+ overshoot `cubic-bezier(.2,1.3,.35,1)` .48s，
  stagger 70ms 保留。

### ③ 3D 细看视图
- PlayingCard：`$emit('click', $event)` 透传事件（FLIP 取源 rect 用，向后兼容）；
  新增 `tiltScale` prop（默认 1，细看用 1.8，位置倾斜 ±10°→±18°、速度加成
  ±9°→±16° 同步放大）。
- PackModal 扇形：已翻开卡点击 → `openInspect`（不再直接选中）。`.pm-inspect`
  固定覆盖层：暗色 vignette + FLIP（`moverStyle` 记录源 rect 偏移/缩放，双帧后
  置空 → CSS transition .34s overshoot 飞入居中 240px ≈ 3x）+ 版本着色器 live +
  m6x11 名字/效果文本 + 「选这张/取消选择」（choose 模式）与「返回」；点击卡面或
  空白关闭，关闭时 mover 飞回源位。`chooseInspect` 复用 chooseLeft/slotOk 校验，
  拿走流不受影响（CDP 实测：选满 → 拿走 → 弹层关闭）。
- CardCollectionView 详情卡点击 → 同款 `.cv-inspect` 细看；新增 `detailEdition`
  （按持有版本取最高稀有着色：negative > poly > holo > foil），详情面板卡与细看
  卡均按此着色。
- 扇形提示文案：全部翻开后 barHint = 「点击卡片放大细看，细看里『选这张』」。

### ④ 验收结果
- 无头：`npm run build:vite` ✓；engine 61/61、phase3 59/59、sprite 30/30、
  integration 40/40 全绿（纯动画改动，未动测试）。
- 真机 file:// 生产模式（`electron . --remote-debugging-port=9222`，无 vite）：
  scripts/cdp-shots-14.mjs **19/19 绿**、crashes none、NO CONSOLE ERRORS ——
  idle perforated 虚线在、撕裂中段 top 为锯齿 clip-path、爆开白闪在、
  mega = 强震屏 class、mega 小丑包 4 张扇形（官方 [4,2]，断言以
  PACKS_BY_ID.count 为准）、细看 FLIP 打开 + 「选这张」→ ✓ 角标 → 选满拿走 →
  弹层关闭、收藏详情细看（传奇卡尼奥 + .ed-poly 多彩着色）全流程存活。
- 截图存 `work/cdp-shots/`：20-pack-sealed-perf（idle 撕条区）、21/22-tear-jag-*
  （锯齿裂缝中/后段）、23-burst-shake（两瓣分离+撕条飞走+碎屑）、24-fan-burst
  （爆开发牌扇形）、25-inspect-fan（选择模式细看）、26-inspect-legendary
  （传奇+闪箔）、27-inspect-poly（多彩着色器）。
- 进程与数据：测后 electron 杀净（pgrep 复核为空）；数据库先备份
  work/mods/database.db.bak5/bak6、测后原样恢复。

---

## §15 真实 Mod 复刻 + 图鉴/开包体验四件套

### ① 三个真实 Mod 源码复刻 Mod 卡（替换 §12 的 50 张自绘致敬卡）

**来源**（均为老式 Steamodded 0.9.x 结构，work/mods/ 下克隆）：

| Mod | 导入卡数 | 图集（1x 实测，PIL） | 瓦片 |
|---|---|---|---|
| Pampa | 30 | 710×570（10×6）→ `mod_pampa.webp` | 71×95 原生 ✓ |
| JellyMod | 30 | 710×1710（10×18）→ `mod_jelly.webp` | 71×95 原生 ✓ |
| 7DeadlySins | 8 | 568×190（8×2）→ `mod_yuni.webp` | 71×95 原生 ✓ |

- 提取方法：自写 Python 平衡大括号解析器解析 `SMODS.Joker` 定义表（name/
  pos/rarity/cost/loc_vars），localization 表按 key join 出英文原文；产出
  `work/mod-extract.json`；7DS 的 626 行单文件人工精读（7 宗罪全 rarity 2
  cost 6 + sin/soul 两张 rarity 3）。
- `src/balatro/data/modJokers.js` 整文件重写：68 条目 `J()` 工厂，
  `mj_pam_*`/`mj_jel_*`/`mj_sds_*` 三前缀；中文名 + 简洁 CN 效果（变量用「X」）
  + `textEn` 源码原文（剥离 {C:} 标记）；每条带 `pos:{x,y}`（可选 `soul`）——
  供 gen-sprite-map §3c 消费的契约字段；art 按 mod 三色兜底；effect 全 noop。
- 传奇：pam_mathurine（玛蒂琳）/ jel_tarlton（塔尔顿）/ jel_pierrot（皮埃罗）
  3 张 rarity 4；soul 叠加层 4 张（上 3 + sds_sin）。
- 图集转换：PIL lossless quality=100 method=6 → `public/sprites/mod_*.webp`，
  ATLAS_META 行列按像素/71×95 验证（sprite-test 断言尺寸吻合）。

### ② Mod 卡并入小丑页签

- 独立 Mod 页签取消，页签 = 小丑/塔罗/星球/幻灵/增强·蜡封·版本（5 个）。
- 小丑页签 list = `JOKER_TAB_LIST`（JOKERS + MOD_JOKERS 排序：稀有度升序 →
  组内官方 id 序在前、mod id 序在后）；稀有度子筛选合并生效（218 张池）。
- renderKind 简化恒等（mod 卡 kind 即 'joker'）；TYPE_NAMES 删 mod 项。

### ③ 稀有度差异化翻卡（PackModal）

`flipTier(opt)`：joker 取 BY_ID rarity 1-4；spectral rare → t3；其余 t1；
foil+ 版本升 1 档，t4 封顶。

| 档 | 条件 | 演出 |
|---|---|---|
| t1 | 普通 | 秒翻 + flip 音 |
| t2 | 罕见 | 200ms 绿边光（suspensePulseGreen）→ 翻 + 6 绿粒子 + flip 音 |
| t3 | 稀有 | 400ms 金脉冲 + 槽位小抖动（slotJitter）+ suspense 音 → 10 混色粒子 + rareReveal |
| t4 | 传奇 | 700ms 金脉冲（suspensePulseGold）+ 兄弟槽 brightness(0.35)（pm-t4wait）→ 20 金粒子 + rareReveal + overlay 小震屏 ~300ms（pm-pulse 复用 shakeLight） |

粒子改动态生成（`particles = { idx, list:[{k,style{--dx,--dy,background}}] }`，
genParticles 按档配数/配色；pp1-pp10 死类已删，particleFly keyframes 保留）。

### ④ 图鉴格子直达 3D 细看 + 增强/蜡封/版本页签真精灵

- 格子点击 `openInspectFromGrid(def, $event)` 直达 §14 cv-inspect（FLIP 从格位
  飞入居中 240px + 速度倾斜 + 版本着色 live）；中间详情弹层删除（markup 与
  openDetail/closeDetail/openInspectFromDetail 全清，.cv-detail* CSS 保留无害）。
- 细看信息区扩充为详情级：名/英文名 + tags（稀有度/类型/🧩mod/售价）+ text/
  textEn + 已持有（含版本）+ 解锁/来源行；detailEdition → inspectEdition。
- 「增强·蜡封·版本」页签：ENH_SPRITES（game.lua set='Enhanced' 单行定义，
  8 张）+ SEAL_SPRITES（`self.shared_seals` 块单独 regex：Gold(2,0)/
  Purple(4,4)/Red(5,4)/Blue(6,4)，centers=enhancers 图集）→ 横排瓦片卡；
  版本 5 项各渲染 `PlayingCard j_joker` 样卡 + 对应 edition 着色器。

### gen-sprite-map.mjs §3c/§4b 扩展

- §3c：`await import modJokers.js` → MOD_ATLAS 映射（Pampa/JellyMod/
  7DeadlySins → mod_pampa/mod_jelly/mod_yuni）+ pos/soul 写入 SPRITE_MAP；
- §4b：ENH_SPRITES（set='Enhanced' 去 m_ 前缀）+ SEAL_SPRITES 两个 export；
- ATLAS_META +3 mod 图集；重跑输出 **317 条**（249 官方+包 + 68 mod），
  数据文件校对幂等 0 改动（md5 前后一致）。
- store.js 新增 CDP 测试钩子：hash `__force_mod=mj_xxx` 时 Buffoon 混入必出
  该 mod 卡（视觉证据确定性驱动；Math.random 注入已证不可行——CrtBackground
  等视觉循环每帧消耗 Math.random，队列必被污染）。

### 验收结果

- 无头：`npm run build:vite` ✓；engine 61/61（ALL GREEN）、phase3 59/59、
  **sprite 43/43**（新增：3 mod 图集尺寸×2、68 mod 全覆盖、soul 4 张、
  增强 8/蜡封 4 坐标、mod 抽样 3 条）、**integration 40/40**（50→68、
  来源构成 Pampa 30/JellyMod 30/7DeadlySins 8、25% 混入实测 24.2%）。
- 真机 file:// 生产模式：scripts/cdp-shots-15.mjs **23/23 绿**、crashes none、
  NO CONSOLE ERRORS —— 无独立 Mod 页签、mod 格用 mod 图集精灵、t3 悬念+
  10 粒子、t4 兄弟变暗+20 金粒子、增强/蜡封 12 瓦片全 enhancers 图集、
  版本 5 样卡含全息/负片着色层、格子直达细看无中间面板、mod 细看含 🧩 标签。
- 截图存 `work/cdp-shots/`：30-joker-tab-mods（mod 真图混入）、
  31-flip-t3-suspense、32-flip-t4-suspense（金脉冲+兄弟变暗）、
  33-flip-t4-burst（玛蒂琳揭晓）、34-mods-tab-sprites（增强/蜡封/版本真精灵）、
  35-gallery-direct-inspect（卡尼奥直达细看）、36-mod-inspect（爵士三重奏细看）。
- 进程与数据：测后 electron 杀净（pgrep 'remote-debugging-port=9222' 复核为空）；
  数据库先备份 `work/database.db.bak15`、测后原样恢复。

---

## §16 开包全收 + NEW 像素徽章

### ① 取消强制选卡：开包全部收入收藏

- 新流程：撕裂 → 爆开 → 扇形（背面）→ 逐张翻（§15 分级演出不变）→「全部收下」
  （爆开后随时可点）→ 所有卡一起飞入图鉴 → 关包。不再有「拿走 N 张」/
  ✓ 选中角标/细看「选这张」；细看保留纯 3D 视图（仅「返回」）。
- store：`pickCollectionCards` 移除，新增
  - `collectAllPackCards()`：全部带 id 选项进 `ownedCards`（版本沿用开包 roll），
    discover 兜底，首开 id 入 `newIds`，关包落盘；playing 类无 id 选项照旧不收。
  - `markCollectionSeen(id)` / `markAllCollectionSeen()`：NEW 已读。
  - `skipCollectionPack`（放弃整包）保留：不产生 ownedCards/newIds。
- PackModal：emits `pick` → `collectAll`；chosen/chooseLeft/chooseInspect/slotOk/
  confirm 全删；「全部收下」点击后所有槽位置 chosen 触发 §14 各自目标位飞走
  （小丑左上/消耗右上/扑克下中），640ms 后 emit。
- 灵魂/黑洞等特殊卡无特殊分支，一律照收。

### ② NEW 像素徽章

- **判定**：`openCollectionPack` 在「见过即发现」**之前**计算 `firstNew`
  （本包中此前未 discovered 的 id），随包态序列化。重复卡（已发现）不得 NEW。
- **持久化**：`collection.newIds`（存档字段）——`collectAllPackCards` 时
  firstNew ∩ 未入列者写入；跳过整包则 firstNew 作废不入列。
- **扇形**：翻开后 `firstNew` 命中槽挂 `.pm-new-badge`（黄底红字像素贴纸，
  m6x11、-9° 斜贴、newPop 弹入 + newWiggle 1.5s 抖动循环）。
- **图鉴格**：`newIds` 命中格挂同款 `.cv-new-badge`（左上角，与右上持有角标
  错位）；`openInspectFromGrid` 打开 3D 细看即 `markCollectionSeen` 已读，
  返回后徽章消失；页头 `cv-mark-read` 小按钮一键 `markAllCollectionSeen`
  （newIds 为空时自动隐藏）。
- 已读时机严格定义：**3D 细看打开瞬间**清除该卡 NEW；仅 grid 悬停/发现不算已读。

### 验收结果

- 无头：`npm run build:vite` ✓；engine 61/61、phase3 59/59、sprite 43/43、
  **integration 48/48**（§4 整段重写：全收 N 张入 ownedCards、firstNew 全覆盖、
  newIds 写入/单卡已读/重复不 NEW/全部已读/跳过零副作用/存档往返；
  mod 段改 collectAll：30 包全收、见过的 mod 卡 100% 入藏）。
- 真机 file:// 生产模式：scripts/cdp-shots-16.mjs **21/21 绿**、crashes none、
  NO CONSOLE ERRORS —— 「拿走」按钮不存在、「全部收下」存在、NEW 徽章数 ==
  firstNew、细看无「选这张」、全收飞行帧 ownedCards +4、图鉴徽章 == newIds、
  细看已读 -1、全部已读清零。
- 截图存 `work/cdp-shots/`：40-fan-new-badges（扇形 4×NEW）、
  41-inspect-no-choose（纯 3D 细看）、42-collect-all-fly（全收飞走帧）、
  43-gallery-new-badge（图鉴格 NEW + 页头按钮）、44-inspect-clears-new（已读）。
- 进程与数据：测后 electron 杀净（pgrep 复核为空）；数据库先备份
  `work/database.db.bak16`、测后原样恢复。

---

## §17 远征模式撤回归档 + 收藏模式六项微调 + 金币经济（2026-07-18 实装）

### ① 远征模式开发后撤回归档

- 本周期曾按契约 `docs/balatro/02-expedition.md` 完成远征模式 E1-E3
  （拉杆老虎机引擎 93+184 测试、UI 55 冒烟、CDP 真机 31 断言全绿）。
- 业主决定撤回，恢复「收藏 + 开卡包」模式。远征代码**全部归档不删除**：
  `src/balatro/attic/expedition/`（引擎 7 文件 / 数据 3 文件 / 组件 6 个 /
  expeditionStore / ExpeditionView / 测试脚本 8 个 + README 复活指引），
  归档位置直接跑测试仍全绿；契约文档 02-expedition.md 保留于 docs/。
- 拆除接线：`/expedition` 路由、App.vue「远征」pill、Dashboard 摘要条、
  图鉴「出征」按钮、balatro.css `bt-btn` 全局族（影响收藏页视觉，回退）。
- 保留的 additive 改动（归档 README 已登记）：`PackModal.vue` `pickMode` prop
  （默认 false，行为零变化）、electron `balatro:loadKey/saveKey` 带键存档 IPC。

### ② PackModal 撕开精修

- 删除 `.pm-pack-perf` perforated 虚线（模板 + CSS）。
- 锯齿 16 段 → **36 段细齿**（±0.7–2.4% 快交替）+ 每包随机 2–3 处大缺口
  （单向深咬 4.5–8%）；撕裂前沿垂直 jitter（双正弦确定性，rAF 逐帧可复现）；
  撕条揉皱 `rotate(-15°)+skew(7°,-4°)` 多角度 + brightness 正弦明暗交替。
- 新增 `.pm-crack-light/.pm-crack-shadow`：复用包体贴图的锯齿条带 clip-path
  （≈1.6px），模拟薄膜拉伸高光/暗边，随撕裂进度延伸。
- 音效收紧：撕裂窗口 500→480ms、crinkle 二簇 240→200ms；仍 rAF + clip-path。
- 底部 hint 提示条整条删除（按钮保留）。
- 「全部收下」像素按钮 `.pm-collect-btn`（scoped，不染全局）：m6x11、
  2px 描边 + 3px 暗边 `#5c4708`、`#f4c14f` 金渐变、inset 高光、
  `:active scale(.94,.86)` + `sound.click()+coin()`。

### ③ 卡池梯度（`src/balatro/data/packGating.js`）

- `economy.packsOpened` 持久化（每次收藏开包 +1，旧存档迁移幂等、非负兜底）。
- 梯度：rarity 3 小丑需累计 ≥10 包；核心 10 张（蓝图/头脑风暴/棒球卡/男爵/
  DNA/篝火/方尖石塔/流浪者/特技演员/隐形小丑）需 ≥20 包；传奇维持灵魂专属。
- 仅过滤**收藏开包池**（官方重 roll ≤20 次有界替换 + Mod 混入池预过滤）；
  Run 模式与 `__force_mod` 测试钩子不受影响。
- 图鉴细看对被锁卡显示「🔒 累计开 N 包后可开出（当前 M 包）」，达标自动消失。

### ④ 纯金币经济（`src/balatro/data/economy.js`，常量集中）

- **收入**：习惯打卡 +2 / 每日任务 +3 / 项目任务 +5（task-store.js 新增
  `notifyProjectTaskCompleted` 挂接，动态 import + 静默容错）。
- **商店**（/cards 顶部 🛒 面板）：5 类 × 3 规格卡包，普通 40 / 巨型 60 /
  超级 80 金币，购买入待开队列，余额不足灰显；显示金币与累计开包。
- **出售（重复卡）**：小丑/消耗牌 普通 8 / 罕见 16 / 稀有 40 / 传奇 120
  （无稀有度按普通档）+ 版本加成 foil+2/holo+4/poly+8/negative+16；
  扑克牌 基础 2 + 增强 1 + 蜡封 2 + 版本 foil1/holo2/poly3/negative4。
  **首张保护**（同 id+版本 ≥2 才可售）、二次确认、点亮（discovered）不受影响。
- 无碎片/无合成体系（业主定调）。

### ⑤ 扑克入收藏

- 标准包扑克进 `ownedCards`（rank/suit/enhancement/seal/edition/obtainedAt），
  `pc_花色_点数` 键见过即点亮。
- 「增强·蜡封·版本」页签顶部新增 52 格扑克区（4 花色 × 13 点；
  变体徽章按 版本>蜡封>增强 优先着色），点击已点亮格查看代表牌 + 变体分组。

### ⑥ 验收结果

- 无头：engine 61 / phase3 59 / sprite 43 / ui-smoke 14 /
  **integration 93**（新增 38 条：金币三来源/迁移幂等/余额非负/购买扣费/
  梯度 100 包 400 选项零泄漏/达标命中/出售全规则/扑克入藏与变体）全绿。
  （修复一处测试随机性缺陷：出售断言原按 enhancement 查找可能命中开包随机
  同类卡，已改为定位构造卡，连跑 5 次稳定全绿。）
- `npm run build:vite` ✓；`npm run build` ✓ →
  `dist-electron/BongMaster-4.1.1-arm64.dmg`（ad-hoc 签名，本机可用）。
- CDP（独立临时 profile，未碰真实数据库）：24/24、零 console error；
  截图 12 张 `work/cdp-shots/ui-tweak-01..12-*.png`（商店/购买/无 perf 撕条/
  撕裂关键帧/像素按钮/收下飞走/细看出售/首张保护/52 格/变体出售）。
- 测后进程杀净；改前代码备份 `work/ui-tweak-backup/`；
  真机数据库注入测试用 30 包前已备份 `work/pack-inject/`。

---

## §18 图鉴体验六件套 + 第二批真实 Mod（Olympus/PiJoker/MikasBalatro）

### A. 体验优化 6 项（CardCollectionView.vue 为主，store.js 配套）

1. **数量角标**：网格持有角标 `×n` 改为 `ownedCount(def.id) >= 2` 才渲染（n=1 不显示）。
2. **一键卖出重复**：页签行（小丑/塔罗/星球/幻灵）与扑克区标题行各挂 `.cv-sell-dupes`
   像素金按钮，文案实时预览「卖出重复 N 张 · +🪙X」（无重复时自动隐藏）。
   store 新增 `duplicateOwnedInfo(match)`（预览）与 `sellDuplicateOwned(match)`
   （执行）：按去重键（卡牌=id+版本；扑克=花色+点数+增强+蜡封+版本）各留 1 张，
   页签范围隔离（小丑页签不动扑克，反之亦然），点亮不受影响，执行后幂等。
   批量保留一次 `window.confirm`（全文件仅此 1 处）。
3. **单张出售免确认**：细看层单张出售（`sellInspectCard` / `sellPlayingVariant`）
   直接执行，仅 coin/click 音效反馈。
4. **扑克增强/蜡封/版本对齐原作视觉层级**：`.cv-mc` 迷你卡三层——
   增强=整卡 enhancers 图集瓦片（`mcFaceStyle` 按目标宽等比缩放，pixelated）；
   蜡封=右上角印章覆盖层（`mcSealStyle`，SEAL_SPRITES 坐标）；
   版本=全卡着色器覆盖（`.cv-mc-ed-foil/holo/poly/negative::after` 伪元素，
   poly 带 hue-rotate 循环，negative 整卡 invert）；点数角标 `.cv-mc-rank`
   左上（石头牌不显示），52 格/细看大图/矩阵小卡/参考卡四级尺寸共用一套渲染。
5. **扑克详情变体收集矩阵**：`buildPcInspect(suit, rank)` 按 增强|蜡封|版本
   组合键分组，行 = 着色小卡缩略图 + 组合名 ×数量 + （≥2 时）出售按钮；
   未拥有组合不列出；卖出后就地重建矩阵。
6. **内部规则文案清除**：「首张保护」「✓ 初始可用」「不进 Run 卡池」
   「卡池梯度」等术语从所有用户可见文案移除（仅存代码注释）；
   商店「累计开包数（卡池梯度依据）」title 改「已开卡包总数」；
   小丑详情「🎴 已持有 N 张（基础）」行整行删除（`.cv-detail-owned` 不复存在）；
   梯度锁定提示「🔒 累计开 N 包后可开出（已开 M 包）」保留。

### B. 第二批真实 Mod 导入（§15 管线复用，work/mods/ 克隆）

| 仓库 | 结果 | 卡数 | 图集 |
|---|---|---|---|
| AbhinavR314/BalatroOlympus | 导入 `mj_oly_*` | 6 | `mod_olympus.webp` 426×95（6×1，单瓦片 PNG 拼接） |
| batabata3/balatro-pampa-joker-pack | **跳过**：与 §15 已导入 Pampa（work/pampa）逐字节相同（Lua 与 assets diff 均 0 差异），未重复进池 | 0 | — |
| erachlin/PiJoker | 导入 `mj_pi_pi` | 1 | `mod_pijoker.webp` 71×95（1×1） |
| MikaSchoenmakers/MikasBalatro | 导入 `mj_mik_*` | 60 | `mod_mika.webp` 710×570（10×6，单瓦片 PNG 拼接） |

- Olympus 用老式 `add_item` 直插 `G.P_CENTERS`（非 SMODS.Joker），按 add_item
  调用点解析 name/rarity/cost；PiJoker/MikasBalatro 为标准 SMODS.Joker 结构
  （Mika 经 `init_joker` 工厂，60 个 j_mmc_* 键全量）。
- modJokers.js 头部注释登记三来源；MOD_JOKERS 68 → **135**（id 全唯一）；
  gen-sprite-map.mjs §3c MOD_ATLAS +3 映射、ATLAS_META +3；
  重跑 SPRITE_MAP 384 条（317 + 67 新）。
- 传奇新增 mj_mik_dagonet / mj_mik_cicero（rarity 4）。

### 验收结果

- 无头：engine 61/61、phase3 59/59（连跑 4 次稳定）、**sprite 55/55**
  （+3 图集尺寸、135 mod 全覆盖、新 mod 抽样 6 条）、**integration 108/108**
  （+15：一键卖出 8 / 变体矩阵 1 / UI 源码锚点 5 / 新 mod 构成与 Pampa 去重 2）、
  ui-smoke 14/14；`npm run build:vite` ✓。
- 真机 file:// 生产模式（`electron . --remote-debugging-port=9333
  --user-data-dir=/tmp/bm-uipolish-profile` 独立临时 profile，不碰真机数据库）：
  scripts/cdp-shots-uipolish.mjs **29/29 绿**、crashes none、NO CONSOLE ERRORS——
  角标 ×3 显示与卖出后消失、批量仅 1 次确认文案正确、单张出售零确认入账、
  52 格 4 张点亮迷你卡（蜡封覆盖+版本着色）、A♠ 变体矩阵 2 行出售入账、
  参考区 ≥12 瓦片、稀有筛 Olympus/Pi 点亮、传奇筛 达戈内特/西塞罗点亮。
- 截图 `work/cdp-shots/ui-polish-01..10-*.png`（01 角标+一键卖出、02 卖出后、
  03 愚者细看出售、04 单卖后、05 扑克 52 格、06 变体矩阵、07 变体卖出、
  08 参考区、09 新 mod 稀有、10 新 mod 传奇）。
- CDP 脚本修复 2 处：单卖用例改用塔罗愚者（原宙斯会被上一步批量卖光）；
  A♠ 格查找改 `.cv-mc-rank` + `\\s` 双重转义（innerText 含换行）。
- 测后进程杀净（pgrep bm-uipolish-profile / 9333 复核为 0）；临时 profile 删除；
  业主 5173/真机实例全程未动。改前备份 `work/ui-polish-backup/`。
- 已知问题：无（phase3 既有随机波动见 §11⑤，与本轮无关）。

## §19 金币 bug 修复 + 开包出率调优 + 音效分层重做（2026-07-19 实装）

### 根因（实证）

live db 只读拷贝比对：habit_checkins 已有打卡记录（created_at UTC），而
balatro_state 'main' 最后 savedAt 早 75 秒且 18 分钟后仍无新保存 →
**MCP 路径（mcp-server 进程直接写库）完全绕过渲染进程 integration.js 挂接点**，
打卡/任务完成只写了业务表，balatro 侧永远不发奖。次要风险：
启动窗口竞态（store 未 init 先发奖会以 0 为基数覆盖磁盘）与旧版/多实例
balatro:save 整体覆盖（旧 blob 无 economy 字段会把磁盘金币冲掉）。

### 修复（三路）

1. **MCP 侧补发**：新建 `electron/services/balatro-reward.cjs`
   `grantBalatroReward(dbService, source, opts)`——GOLD_REWARDS
   {checkin:2, task:3, project_task:5}，每 10 次送 buffoon 包、streak≥7
   一次性送天体包（computeStreak 走 getHabitCheckins）；mcp-server.js 以
   withBalatroReward 接线 5 处（create_habit_checkin / checkin_today 仅
   create 分支 / update_daily_task_status 与 update_daily_task 完成跃迁 /
   update_task 已完成跃迁），回复尾附「（🪙 +N 金币）」。
2. **启动竞态**：integration.js reward() 发奖前 `if (!store.loaded) await
   store.init()`；store.saveNow() 加 `if (!loaded.value) return` 守卫。
3. **合并保存**：新建 `electron/services/balatro-state-merge.cjs`
   `mergeBalatroState`——economy.gold/packsOpened 与 productivity.count 取
   max、pendingPacks/ownedCards 取更长、discovered/newIds 并集、其余
   incoming 优先；main.js balatro:save 仅 'main' 键走合并（saveKey 不动，
   异常退化原样写）。

### 出率调优（§19）

- 常量入 `data/economy.js`：PACK_DUPLICATE_WEIGHT {tarot:3, planet:3,
  joker:1.5, spectral:1.5} + `drawWithDuplicateWeight(pool, ownedIds, weight,
  rng)`——已拥有卡权重 ×N，新卡权重 1。
- 落在 store.openCollectionPack 官方 id 选项替换 pass（Mod 混入之前已 roll
  版本沿用；Mod 混入与 `__force_mod` 豁免；joker 池剔 rarity4+梯度未解锁；
  包内 8 次重抽去重；edition 保留）。
- 分布对比（400 trials 模拟，集齐 22 塔罗所需 100 秘术包数）：均匀 中位
  25 包 / 均值 25.8；owned×3 后 中位 57 包 / 均值 60.6（×2.35）——拥有
  11/22 时 owned 命中率 76%（期望 ~75%），全收集明显变慢、重复利用变多。

### 音效分层重做（sound.js 整文件重写）

- 分层合成引擎：adsr 包络 + oscLayer 音高体 + noiseLayer 噪声体 + perform
  多层调度；噪声体层 18 处，扫频/滤波/失谐全启用；无 AudioContext 环境全部
  安全 no-op。
- 21 个音效（旧 API 全保留，新增 thump 低频爆开 / coinCascade 连续金币 /
  shimmer 梯度解锁）；顶部参数总表便于调音。
- 新挂接：PackModal burst() → thump；出售（细看+变体两处）→ coin+click；
  一键卖出重复 → coinCascade(min(sold,4))；全收 → coinCascade(2) +
  跨 10/20 包梯度解锁 shimmer（RARE/CORE_MIN_PACKS 自 packGating 导入）。

### 验收结果

- 无头：engine 61/61、phase3 59/59、sprite 55/55、**integration 144/144**
  （+36：启动竞态 4 / 合并保存 7 / MCP 发放器 node:sqlite 真实落库 6 /
  出率 5 / 音效 7 及全链路回归）、ui-smoke 14/14；`npm run build:vite` ✓。
- 真机 file:// 生产模式（独立临时 profile /tmp/bm-goldfix-profile +
  9333，不碰真机数据库与业主实例）：scripts/cdp-shots-goldfix.mjs
  **10/10 绿**、crashes none、NO CONSOLE ERRORS——注入 gold=100 →
  grantProductivityReward({source:'checkin'}) → 102 且磁盘持久化 →
  刷新仍 102 → 旧 blob（无 economy）写入后磁盘仍 102、ownedCards 取更长
  （合并保护实证）。
- 截图 `work/cdp-shots/gold-fix-01..03-*.png`（01 打卡前、02 打卡后 102、
  03 刷新后 102）。
- CDP 脚本经验：attach 过早会因执行上下文销毁致 Runtime.evaluate 静默
  超时——须等 store.loaded 就绪；触发型 reload 用 fire-and-forget。
- 测后进程杀净（pgrep 9333 / bm-goldfix-profile 复核为 0）；业主
  5173/--mcp-server 真机实例全程未动。改前备份 `work/gold-fix-backup/`。
- 已知问题：无（phase3 recentTags 偶发 58/1 为 §11 已录随机波动）。

## §20 开包体验六件套（2026-07-19 实装）

业主实测开包流程反馈 6 问题的集中修复，主战场 PackModal.vue /
PlayingCard.vue / sound.js / CardCollectionView.vue。

### ① Foil 闪箔动效重做（PlayingCard.vue）

- 根因：原 45° 渐变高光带仅 4% 宽（48%/52% 硬停）且 alpha 0.55 偏高，
  screen 混合下两条硬边被读成「斜下移动的矩形框」。
- 方案：羽化柔光带（43%→47%→50%→53%→57% 五段渐变，带宽 ≈ 卡面 1/3、
  亮核 ≈ 8%、峰值 0.34），260% 背景 3.2s ease-in-out 对角扫过；无硬边即
  无矩形感。holo/poly/negative 三版复核无需改动。

### ② 卡面精灵「半张卡」修复（PlayingCard.vue）

- 根因：`.pc-back-sprite` 直接铺在 `.pc-backside`（cardW × cardW·95/71
  逻辑 px）内，却沿用正面 142×190（2x）版式的 backgroundSize——背面实际
  以 2 倍渲染，只显示卡背瓦片左上 1/4，即业主所见「半张卡」。
- 方案：backSpriteStyle 乘 cardScale（= cardW/142），瓦片尺寸与卡面盒子
  1:1；新增 `back` prop 与 BACK_TINTS 兜底底色。
- CDP 实测：五类包卡背瓦片 82.0×109.7 ≈ 卡面 82.x×110.x（含倾斜测量
  误差），正面 mod 卡 142×190 2x 完整。

### ③ 「全部收下」音效去怪（PackModal.vue + CardCollectionView.vue）

- 根因：按下时 click+coin 同帧叠音，640ms 后 coinCascade(2) 双币上行
  再叠加，三枚 coin 互撞发浑。
- 方案：按下 = 干净单音 coin（移除 click 叠音）；落袋 = 短促 coin +
  90ms 后轻 click（替代 coinCascade(2)）；shimmer 梯度解锁提示保留。
  取舍理由：分离的两个单音是原作式干净反馈，cascade 多币连响在快速
  连收下必然糊成一团，宁可少不要怪。

### ④ 卡背按包类型区分（PackModal.vue + PlayingCard.vue）

- 官方卡背精灵（enhancers 图集，已裁片验色）：秘术=b_magic 紫系涡纹 /
  天体=b_nebula 青系星空 / 标准=b_blue 经典蓝 / 幻灵=b_ghost 黑紫涡纹 /
  小丑=b_red 经典红。PACK_BACKS 映射 → PlayingCard `back` prop；
  扇形背面与发牌背面统一按包型渲染，BACK_TINTS 提供精灵缺失兜底。

### ⑤ 全部收下前强制翻完（PackModal.vue）

- 翻牌逻辑提取为可等待的 flipCard(i, opt)（tier1 秒翻 / t2-t4 悬念档结束
  后 resolve）；collectAllNow 改 async：存在未翻卡时先逐张自动翻开
  （stagger 180ms，一次只悬念一张——while 轮询 suspenseIdx），全部翻开
  +220ms 停留后再起飞收下。
- 竞态安全：collecting 期间按钮锁定（文案「翻牌中…」）且点卡无效；
  CDP 实测连点两次仅入账一次（+3 张整）。

### ⑥ 撕开动效结构升级（PackModal.vue，第三轮）

- 薄膜拉伸：起手 0~30% 时间撕条 scaleY +13% 拉长、提亮 0.3（拉薄泛白），
  包体反向微带 3px（sin 包络随断裂释放）。
- 逐齿爆开：撕裂前沿改 perforation 步进——22 齿段每段 45% 时间快速推进、
  55% 停顿咬合；爆齿瞬间前沿光点放大 1.45x 发亮，停顿期衰减。
- 阻力曲线：p^1.65 先慢后快（起手拉扯感，中后段加速释放），全程
  480→540ms，crinkle 三簇（0/210/390ms）压窗。
- 断裂回弹：burst 瞬间包体 packRebound 0.36s（下沉 7px → 回弹 -2.5px →
  归位）。rAF + clip-path 架构与性能不变。

### 验收结果

- 无头五套全绿：engine 61/61、phase3 59/59、sprite 55/55、
  integration 144/144、ui-smoke 14/14；`npm run build:vite` ✓。
- 真机 file:// 生产模式（独立临时 profile /tmp/bm-packpolish-profile +
  9333，不碰真机数据库与业主实例）：scripts/cdp-shots-packpolish.mjs
  **49/49 绿**、crashes none、NO CONSOLE ERRORS。
- 截图 `work/cdp-shots/pack-polish-*`（01/02 foil 扫光两帧、03 自动翻牌
  中途、04-06 撕开关键帧：拉伸/逐齿爆开/爆开回弹、07 mod 卡正面、
  back-arcana/celestial/standard/spectral/buffoon 五类卡背）。
- CDP 脚本经验：§19 合并保存使注入断言只能断下界（gold 取 max 生效）；
  每步开包后必须 skip 关闭，否则 openCollectionPack 守卫拒绝后续开包。
- 测后进程杀净（pgrep 9333 / bm-packpolish-profile 复核为 0），临时
  profile 删除；业主 5173/--mcp-server 实例全程未动。改前备份
  `work/pack-polish-backup/`（CardCollectionView.vue 的 §19 前状态见
  work/gold-fix-backup/，本轮仅改 onCollectAll 一处）。
- 已知问题：无。
