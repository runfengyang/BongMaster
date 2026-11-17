# BongMaster - 项目管理桌面应用

基于 Electron + Vue 3 + better-sqlite3 的纯前端桌面项目管理工具。

## 技术栈

- **前端框架**: Vue 3 (Composition API)
- **状态管理**: Pinia
- **路由**: Vue Router 4
- **构建工具**: Vite
- **桌面壳**: Electron
- **数据库**: better-sqlite3 (SQLite)
- **UI 框架**: Bootstrap 5
- **富文本编辑器**: Quill.js
- **拖拽库**: vuedraggable
- **历法**: tyme4ts（与 Calendar Pro 的 tyme4swift 同源，MIT）
- **日历来源**: [yelog/calendar-pro](https://github.com/yelog/calendar-pro) 的月面板与功能模型移植，MIT

## 项目结构

```
BongMaster-Vue/
├── electron/                  # Electron 主进程代码
│   ├── main.js               # 主进程入口
│   ├── preload.js            # 预加载脚本 (IPC 桥梁)
│   └── services/
│       ├── ai-service.js     # AI 聊天服务 (OpenAI API)
│       └── database-service.js # 数据库服务 (SQLite CRUD)
├── src/
│   ├── main.js               # Vue 应用入口
│   ├── App.vue               # 根组件 (导航栏 + 主题切换)
│   ├── router/
│   │   └── index.js          # Vue Router 配置
│   ├── components/
│   │   ├── AiChatModal.vue   # AI 聊天面板 (书签式侧边栏)
│   │   └── AiSettingsModal.vue # AI 设置弹窗
│   ├── views/
│   │   ├── DashboardView.vue     # 首页仪表盘
│   │   ├── ProjectListView.vue   # 项目列表 (含筛选)
│   │   ├── ProjectDetailView.vue # 项目详情 (Quill 编辑器)
│   │   ├── TaskBoardView.vue     # 任务看板 (仅看板 + 拖拽)
│   │   ├── CalendarView.vue      # 日历 (Calendar Pro 风格月面板 + 日程)
│   │   └── DailyTaskView.vue     # 每日任务
│   ├── stores/
│   │   ├── index.js            # Pinia 入口
│   │   ├── project-store.js    # 项目状态管理
│   │   ├── task-store.js       # 任务状态管理
│   │   ├── daily-task-store.js # 每日任务状态管理
│   │   ├── calendar-store.js   # 日历日程/选中日期状态
│   │   ├── calendar-pro-settings.js # 日历设置 (地区/周起始/信息条)
│   │   ├── ai-store.js         # AI 聊天状态管理
│   │   └── theme-store.js      # 主题切换状态管理
│   └── assets/
│       ├── style.css           # 全局基础样式
│       └── themes/
│           ├── default.css     # 默认主题
│           ├── vintage.css     # 复古主题
│           ├── ecomist.css     # Ecomist 主题
│           ├── natgeo.css      # 国家地理主题
│           ├── neobeast.css    # Neobeast 主题
│           ├── editorial.css   # Editorial 主题
│           ├── natural.css     # 自然主题
│           └── old.css         # 旧版主题 (备用)
├── build/
│   └── icon.png              # 应用图标
├── index.html                # HTML 入口
├── vite.config.js            # Vite 配置
├── package.json              # 项目依赖与脚本
└── README.md                 # 本文档
```

## 核心模块说明

### Electron 主进程 (`electron/`)

#### `main.js`
- 应用生命周期管理 (启动、退出、窗口管理)
- 创建主窗口 (1400x900, 开发环境加载 Vite dev server, 生产环境加载构建后的 HTML)
- 注册所有 IPC 处理器 (项目、任务、日历、每日任务、附件、数据导入/导出、AI)
- 创建应用菜单栏 (编辑、AI 助手、数据管理、帮助)
- macOS 特殊处理 (Dock 点击重新创建窗口)

#### `preload.js`
- 通过 `contextBridge` 安全暴露 API 到渲染进程
- 封装所有 IPC 调用为 Promise-based API (`window.electronAPI`)
- 事件监听 (AI 打开设置、打开聊天)

#### `services/database-service.js`
- **数据库连接**: better-sqlite3, WAL 模式, 外键约束
- **表结构**:
  - `projects` (项目: 名称、描述、状态、优先级、起止日期、概况、进展)
  - `tasks` (任务: 项目ID、名称、状态、优先级、负责人、截止日期)
  - `daily_tasks` (每日任务: 标题、日期、完成状态)
  - `calendar_calendars` (日历分类: 名称、颜色、显隐、排序)
  - `calendar_events` (日程/课程: 起止时间、地点、备注、重复规则)
  - `calendar_event_overrides` (重复日程的单次修改/取消)
  - `project_documents` (附件: 项目ID、文件名、原始文件名、大小、MIME类型)
- **数据导入/导出**: ZIP 格式 (完全覆盖/合并导入)
- **附件管理**: 文件系统存储 + 数据库记录
- **迁移**: 自动从旧版应用迁移数据

#### `services/ai-service.js`
- **配置管理**: JSON 文件存储 API Key、端点、模型参数
- **聊天功能**: OpenAI-compatible API 调用, 支持流式响应
- **工具调用**: 11 个工具 (创建/更新/删除项目、任务、每日任务, 查询数据)
- **两阶段执行**: 先返回待确认操作, 用户确认后执行
- **中断机制**: AbortController 支持中途停止生成
- **上下文感知**: 根据当前页面自动注入项目上下文

### Vue 前端 (`src/`)

#### 视图层 (`views/`)

| 视图 | 功能 | 关键特性 |
|------|------|----------|
| `DashboardView.vue` | 仪表盘首页 | 六项指标、完成趋势、状态/优先级分布、项目排行、热力图 |
| `ProjectListView.vue` | 项目列表 | 搜索、状态/优先级筛选、创建/编辑模态框 |
| `ProjectDetailView.vue` | 项目详情 | Quill 富文本编辑器 (概况/进展)、任务列表、附件管理 |
| `CalendarView.vue` | Calendar Pro 风格日历 | 42 格月历、农历/节气/老黄历、地区节假日、Day/Overview、多地点天气、拼假、每周固定时间重复、任务联动 |
| `TaskBoardView.vue` | 任务看板 | 仅看板、拖拽变更状态 (待办/进行中/已完成)、筛选栏 |
| `DailyTaskView.vue` | 每日任务 | 日历选择、增删改查、完成状态切换 |

日历行为说明：

- 月度视图为 macOS Calendar 风格方格月历：日期靠右、农历靠左、今日灰色圆点、事件条按日历颜色显示；跨日事件在格子内渲染为连续条状。
- 不同类型事件带小图标：任务复选框、课程、会议视频、重复、全天、提醒事项圆圈、节假日/节气星标。
- 右键日期格：新建日程、新建提醒事项、粘贴日程（无剪贴内容时置灰）；双击日期格也可新建日程。
- 拖动跨越多天可直接创建跨日全天事件，拖动过程中蓝色条会实时伸缩；已建日程可拖到其他日期（节假日除外）。
- 右键事件条：显示简介、日历子菜单、剪切、拷贝、粘贴、复制、删除；右键提醒事项额外支持“标记为已完成/未完成”，完成状态会填满圆圈。
- 日历标签支持右键管理：修改颜色（macOS 调色板或自定义颜色）、显示/隐藏、删除（内置标签置灰）；也可新增标签。
- 单日事件在月历中只显示底色，不显示类型图标；跨日事件显示日历图标和连续条；节假日/节气显示星标。
- 项目任务按截止日期进入月历，后续补填截止日期或修改日期后也会同步显示。
- 新建事件不再区分“日程/课程”，统一按日程创建；固定上课时间选择“每周”并勾选星期即可，重复会保留开始/结束时间。
- 重复事件按单日事件保存，不显示“结束日期”；需要多日事件时请先选择“不重复”。
- 选择“每周”时默认勾选开始日期对应的星期；修改开始日期会同步星期，避免出现“每天都重复”或开始日不在重复范围内。
- 天气地点支持保存多个：在日历设置中搜索添加、切换当前地点或删除；日历信息条显示当前地点。

#### 状态管理 (`stores/`)

| Store | 职责 | 持久化 |
|-------|------|--------|
| `project-store.js` | 项目 CRUD、当前项目 | - |
| `task-store.js` | 任务 CRUD、按状态分组 | - |
| `calendar-store.js` | 日历分类、日程 CRUD、重复例外 | localStorage (月份、选中日期、Day/Overview) |
| `calendar-pro-settings.js` | 日历地区、周起始、农历格式、信息条、显示选项与多个天气地点 | localStorage |
| `daily-task-store.js` | 每日任务 CRUD | - |
| `ai-store.js` | AI 消息、配置、快捷命令 | localStorage (messages) |
| `theme-store.js` | 当前主题、主题列表 | localStorage |

#### 组件 (`components/`)

| 组件 | 功能 |
|------|------|
| `AiChatModal.vue` | AI 聊天面板 (左侧书签式)、消息渲染、快捷命令、上下文选择 |
| `AiSettingsModal.vue` | AI 配置弹窗 (端点、API Key、模型、温度、Max Tokens) |

### 主题系统

- **切换方式**: 底部主题下拉菜单
- **实现**: CSS 变量 + `data-theme` 属性选择器
- **主题列表**: 默认、复古、Ecomist、国家地理、Neobeast、Editorial、自然
- **主题文件**: `src/assets/themes/*.css`

## 第三方与许可

- 日历月面板、农历/节假日展示、Day/Overview 日程流与信息条模型移植自 [yelog/calendar-pro](https://github.com/yelog/calendar-pro)，MIT License；许可与来源见 `third_party/calendar-pro/`。
- 农历、节气、老黄历算法使用 [tyme4ts](https://github.com/6tail/tyme4ts)，MIT License。
- 日历为 Electron 内 Vue 实现，不运行 Calendar Pro 的 SwiftUI/AppKit 代码，因此菜单栏状态项、登录项、Sparkle 自动更新和 EventKit 系统账户权限不属于本应用移植范围。
- 节假日数据随应用打包（中国大陆 2021–2026，中国香港 2021–2026，美国/英国 2025–2026）。选中未收录年份时，日历会显示数据覆盖提示，不会静默回退到其他地区的数据。

## 数据流

```
用户操作 → Vue Component → Pinia Store → window.electronAPI → IPC → main.js → DatabaseService → SQLite
```

## 开发脚本

```bash
npm run dev          # 启动开发环境 (Vite + Electron)
npm run dev:mcp      # 以 MCP Server 模式启动
npm run build        # 构建生产版本 (Vite + Electron Builder)
npm run build:vite   # 仅构建前端
npm run build:electron # 仅打包 Electron
```

日历与首页回归检查（均使用临时或隔离数据目录）：

```bash
node scripts/calendar-pro-test.mjs
node scripts/calendar-settings-test.mjs
node scripts/dashboard-analytics-test.mjs
ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron scripts/test-calendar-events-db.mjs
ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron scripts/test-daily-task-project-link.mjs
ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron scripts/test-delete-undo-db.mjs
node scripts/cdp-verify-calendar.mjs
```

## MCP Server 配置 (AI Agent 集成)

BongMaster 提供标准 Model Context Protocol (MCP) Server，可供兼容 MCP 的 AI 应用、桌面客户端、命令行工具和其他 MCP 客户端直接操作本地项目数据。

### 支持的 MCP 工具

| 工具名 | 功能 |
|--------|------|
| `list_projects` | 列出所有项目 |
| `get_project` | 获取项目详情 |
| `create_project` | 创建项目 |
| `update_project` | 更新项目信息 |
| `delete_project` | 删除项目 |
| `list_tasks` | 列出项目任务 |
| `create_task` | 创建任务 |
| `update_task` | 更新任务 |
| `delete_task` | 删除任务 |
| `get_daily_tasks` | 获取每日任务（含优先级、预计时长、标签、置顶、完成状态、子任务进度） |
| `create_daily_task` | 创建每日任务（支持优先级、预计时长、标签、备注、置顶） |
| `update_daily_task` | 更新每日任务（支持标题、日期、优先级、预计时长、标签、备注、置顶、完成状态） |
| `update_daily_task_status` | 标记每日任务完成状态 |
| `delete_daily_task` | 删除每日任务 |
| `list_daily_subtasks` | 列出每日任务子任务 |
| `create_daily_subtask` | 创建每日任务子任务 |
| `update_daily_subtask` | 更新每日任务子任务（标题、完成状态） |
| `delete_daily_subtask` | 删除每日任务子任务 |
| `list_project_documents` | 列出项目附件 |
| `create_document` | 创建附件元数据 |
| `update_document` | 修改附件元数据或替换文件内容 |
| `delete_document` | 删除附件 |
| `list_habits` | 列出习惯 |
| `get_habit` | 获取习惯详情 |
| `create_habit` | 创建习惯 |
| `update_habit` | 更新习惯 |
| `delete_habit` | 删除习惯 |
| `archive_habit` | 归档习惯 |
| `list_habit_checkins` | 列出习惯打卡记录 |
| `create_habit_checkin` | 创建习惯打卡记录 |
| `update_habit_checkin` | 更新习惯打卡记录 |
| `delete_habit_checkin` | 删除习惯打卡记录 |
| `checkin_today` | 今日打卡 |
| `list_desktop_notes` | 列出桌面便签 |
| `get_desktop_note` | 获取桌面便签详情 |
| `create_desktop_note` | 创建桌面便签 |
| `update_desktop_note` | 更新桌面便签 |
| `patch_desktop_note` | 对桌面便签正文做精确局部替换（find → replace，默认要求唯一匹配） |
| `delete_desktop_note` | 删除桌面便签 |
| `list_categories` | 列出分类 |
| `create_category` | 创建分类 |
| `delete_category` | 删除分类 |
| `get_statistics` | 获取任务统计 |

### MCP 客户端配置

BongMaster 不会自动修改任何 MCP 客户端的配置文件。请打开应用菜单 **帮助 → MCP 配置说明**，复制通用配置，并按照所使用客户端的说明手动添加。不同客户端的配置文件位置、字段名称或重载方式可能略有不同，请以客户端文档为准。

#### 本地安装版配置

将以下配置添加到客户端用于启动本地 MCP Server 的配置区域：

```json
{
  "mcpServers": {
    "bongmaster": {
      "command": "/Applications/BongMaster.app/Contents/MacOS/BongMaster",
      "args": ["--mcp-server"]
    }
  }
}
```

#### 开发版本配置

```json
{
  "mcpServers": {
    "bongmaster": {
      "command": "node",
      "args": ["/path/to/BongMaster-Vue/electron/main.js", "--mcp-server"]
    }
  }
}
```

保存配置后，按照客户端的说明重新加载 MCP 配置，即可使用 BongMaster 工具。

## 配置文件

- **AI 配置**: `~/Library/Application Support/BongMaster/ai-config.json` (macOS)
- **数据库**: `~/Library/Application Support/BongMaster/database.db` (macOS)
- **附件**: `~/Library/Application Support/BongMaster/uploads/` (macOS)
- **MCP 配置**：由所使用的 MCP 客户端决定配置文件位置，BongMaster 不会自动写入

## 添加新功能指南

### 1. 添加新的 IPC 接口

**主进程** (`electron/main.js`):
```javascript
ipcMain.handle('newChannel', (event, data) => dbService.newMethod(data))
```

**预加载脚本** (`electron/preload.js`):
```javascript
newMethod: (data) => ipcRenderer.invoke('newChannel', data)
```

**前端**:
```javascript
await window.electronAPI.newMethod(data)
```

### 2. 添加新的数据库表

在 `database-service.js` 的 `runMigrations()` 中添加 `CREATE TABLE IF NOT EXISTS` 语句。

### 3. 添加新的 AI 工具

在 `ai-service.js`:
1. `getTools()` 中添加工具定义 (name, description, parameters)
2. `executeTool()` 中添加 case 处理
3. `isValidToolArgs()` 中添加参数验证
4. `extractToolCallFromContent()` 的 `knownTools` 数组中添加工具名

### 4. 添加新主题

1. 创建 `src/assets/themes/new-theme.css`
2. 在 `theme-store.js` 的 `themes` 数组中添加主题信息
3. 在 `src/main.js` 中导入新主题 CSS

## 注意事项

- **主进程修改需要重启 Electron** (Vite HMR 只影响渲染进程)
- **better-sqlite3 是同步 API**, 不需要 async/await
- **文件上传**: 渲染进程读取 ArrayBuffer → 转换为 Uint8Array 数组 → IPC 传递 → 主进程写入文件系统
- **AI 工具调用**: 所有工具操作需要用户确认 (pendingActions 机制)
