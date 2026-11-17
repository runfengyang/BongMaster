# BongMaster iOS 打包迁移计划

## 项目现状分析

### 当前技术架构
- **前端框架**: Vue 3 + Composition API
- **状态管理**: Pinia
- **路由**: Vue Router 4
- **构建工具**: Vite
- **桌面壳**: Electron
- **数据库**: better-sqlite3 (原生 Node.js 模块)
- **UI 框架**: Bootstrap 5
- **富文本编辑器**: Quill.js
- **拖拽库**: vuedraggable

### 核心功能模块
1. **项目管理** - 创建、编辑、删除项目
2. **任务管理** - 看板式任务状态管理
3. **每日任务** - 日历视图日常任务
4. **习惯追踪** - 打卡记录和统计
5. **桌面便签** - 富文本笔记 + Apple Notes 同步
6. **AI 助手** - OpenAI API 集成
7. **数据导入/导出** - ZIP 备份
8. **MCP Server** - Claude AI 集成

### 原生依赖分析

| 依赖 | 用途 | iOS 兼容性 | 替代方案 |
|------|------|-----------|---------|
| better-sqlite3 | 本地数据库 | ❌ 不支持 | Capacitor SQLite 插件 |
| Electron IPC | 主渲染通信 | ❌ 不支持 | Capacitor 插件系统 |
| Node.js fs | 文件系统 | ❌ 不支持 | Capacitor Filesystem |
| AppleScript | Apple Notes 同步 | ❌ 不支持 | 移除或替换为 iOS 原生分享 |
| Electron dialog | 文件选择 | ❌ 不支持 | Capacitor File Picker |
| archiver | ZIP 压缩 | ❌ 不支持 | 使用 Capacitor + JSZip |
| extract-zip | ZIP 解压 | ❌ 不支持 | JSZip 纯 JS 方案 |

---

## iOS 打包方案

### 推荐方案: Capacitor + Vue 3

**选择理由**:
- 保留现有 Vue 3 代码库（最小化改动）
- 官方支持，社区活跃
- 可以使用 Capacitor 插件替代原生功能
- 支持 iOS 原生功能访问（相机、文件系统、本地通知等）
- 可以发布到 App Store

**架构对比**:

```
当前架构:
┌─────────────────────────────────────────┐
│  Vue 3 Frontend                         │
├─────────────────────────────────────────┤
│  Electron Preload (IPC Bridge)          │
├─────────────────────────────────────────┤
│  Node.js (better-sqlite3, fs, etc.)     │
└─────────────────────────────────────────┘

iOS 架构:
┌─────────────────────────────────────────┐
│  Vue 3 Frontend (保持大部分不变)         │
├─────────────────────────────────────────┤
│  Capacitor WebView Bridge               │
├─────────────────────────────────────────┤
│  iOS Native (SQLite, Filesystem, etc.)  │
└─────────────────────────────────────────┘
```

---

## 迁移计划

### 阶段 1: 准备与评估 (1-2 天)

**任务清单**:
- [ ] 创建新的 Capacitor 分支
- [ ] 安装 Capacitor CLI 和核心依赖
- [ ] 评估 UI 移动端适配工作量
- [ ] 确定需要移除/替换的功能列表

**技术准备**:
```bash
# 安装 Capacitor
npm install @capacitor/core @capacitor/cli
npm install @capacitor/ios

# 数据库插件
npm install @capacitor-community/sqlite

# 文件系统
npm install @capacitor/filesystem

# 分享功能（替代 Apple Notes）
npm install @capacitor/share

# 本地通知
npm install @capacitor/local-notifications
```

### 阶段 2: 数据库迁移 (3-4 天)

**当前实现**:
```javascript
// electron/services/database-service.js
const Database = require('better-sqlite3')
```

**迁移到 Capacitor SQLite**:
```typescript
// 新的 database-service-capacitor.ts
import { CapacitorSQLite } from '@capacitor-community/sqlite'

class DatabaseService {
  private db: any

  async initialize() {
    this.db = await CapacitorSQLite.createConnection({
      database: 'bongmaster.db'
    })
    await this.runMigrations()
  }

  // API 保持与原来一致，内部实现改为异步
  async getAllProjects() {
    const result = await this.db.query(
      'SELECT * FROM projects ORDER BY updated_at DESC'
    )
    return result.values || []
  }
}
```

**关键变更**:
- better-sqlite3 是同步 API，Capacitor SQLite 是异步 API
- 需要将所有数据库调用改为 async/await
- 更新所有 Store 中的方法为异步

**受影响的文件**:
- `src/stores/project-store.js` → 改为异步 actions
- `src/stores/task-store.js` → 改为异步 actions
- `src/stores/daily-task-store.js` → 改为异步 actions
- `src/stores/habit-store.js` → 改为异步 actions

### 阶段 3: 文件系统迁移 (2-3 天)

**当前实现**:
```javascript
// 使用 Node.js fs
const fs = require('fs')
const path = require('path')
```

**迁移到 Capacitor Filesystem**:
```typescript
import { Filesystem, Directory } from '@capacitor/filesystem'

// 文档上传
async uploadDocument(projectId: number, fileData: any) {
  const fileName = `${uuidv4()}.${fileData.ext}`
  await Filesystem.writeFile({
    path: `uploads/${fileName}`,
    data: fileData.buffer,
    directory: Directory.Data,
    recursive: true
  })
  // ...保存到数据库
}
```

**附件存储变更**:
- iOS 使用沙盒文件系统
- 需要迁移导出/导入功能使用 JSZip 纯 JS 实现

### 阶段 4: UI 移动端适配 (5-7 天)

**主要改动**:

#### 导航栏改造
```vue
<!-- 当前 Desktop 导航 -->
<nav class="bm-navbar">
  <router-link v-for="item in navItems" :to="item.path">
    <i :class="item.icon"></i>
    <span>{{ item.name }}</span>
  </router-link>
</nav>

<!-- 改为 Mobile Tab Bar -->
<ion-tab-bar>
  <ion-tab-button v-for="item in navItems" :tab="item.path">
    <ion-icon :name="item.icon"></ion-icon>
    <ion-label>{{ item.name }}</ion-label>
  </ion-tab-button>
</ion-tab-bar>
```

#### 响应式布局优化
- 任务看板改为垂直滚动列表
- 项目详情页改为卡片式布局
- 便签编辑器全屏编辑模式
- AI 聊天改为底部输入框

#### 触摸交互适配
- 拖拽功能改为滑动操作
- 添加滑动手势（删除、归档）
- 长按菜单替代右键菜单

### 阶段 5: 功能调整 (2-3 天)

#### 需要移除的功能
| 功能 | 原因 | 替代方案 |
|------|------|---------|
| Apple Notes 同步 | iOS 不支持 AppleScript | 使用 Capacitor Share 分享 |
| MCP Server 模式 | iOS 无法运行后台服务 | 仅保留桌面端 |
| 数据目录打开 | iOS 文件系统限制 | 使用 Filesystem 插件浏览 |
| AI 菜单配置 | 移动端使用设置页面 | 设置页面内嵌 AI 配置 |

#### 新增 iOS 特性
- 本地通知提醒任务截止日期
- iCloud 备份支持
- 分享扩展到其他应用
- 3D Touch 快捷操作

### 阶段 6: 构建与测试 (3-4 天)

**构建配置**:
```javascript
// capacitor.config.ts
import { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.bongmaster.app',
  appName: 'BongMaster',
  webDir: 'dist',
  server: {
    androidScheme: 'https'
  },
  plugins: {
    SQLite: {
      iosDatabaseLocation: 'Library/LocalDatabase'
    }
  }
}

export default config
```

**构建流程**:
```bash
# 1. 构建 Vue 应用
npm run build

# 2. 同步到 iOS 项目
npx cap sync ios

# 3. 打开 Xcode
npx cap open ios

# 4. 在 Xcode 中构建并测试
```

---

## 文件变更清单

### 新增文件
```
capacitor.config.ts          # Capacitor 配置
ios/                          # iOS 原生项目目录
src/services/
  ├── database-capacitor.ts   # Capacitor 数据库服务
  ├── filesystem-capacitor.ts # Capacitor 文件服务
  └── platform-service.ts     # 平台检测
```

### 修改文件
```
src/main.js                   # 添加 Capacitor 初始化
src/App.vue                   # 移动端导航适配
src/stores/*                  # 所有 store 改为异步
src/views/*.vue               # 响应式布局调整
electron/preload.js           # 添加平台检测
```

### 删除/禁用（iOS 构建时）
```
electron/services/
  └── apple-notes-service.js  # Apple Notes 同步
```

---

## 技术风险与解决方案

### 风险 1: 数据库性能
**问题**: better-sqlite3 是同步的，Capacitor SQLite 是异步的
**影响**: 可能影响 UI 响应性
**解决**: 
- 使用 Vue 的 `shallowRef` 减少不必要的渲染
- 添加加载状态
- 考虑使用 IndexedDB 作为前端缓存

### 风险 2: 文件大小限制
**问题**: iOS 应用大小限制，SQLite 插件增加体积
**预估**: 
- 当前 Electron 构建: ~150MB
- Capacitor iOS 预计: ~80-100MB
**解决**:
- 启用代码分割
- 按需加载主题 CSS
- 压缩图片资源

### 风险 3: 后台任务
**问题**: iOS 对后台任务限制严格
**影响**: MCP Server 无法运行
**解决**:
- MCP 功能仅在桌面端可用
- iOS 端禁用 MCP Server 启动选项

### 风险 4: 数据迁移
**问题**: 用户现有数据在 Electron 中
**解决**:
- 提供数据导出功能
- iOS 端支持导入 ZIP 备份

---

## 时间预估

| 阶段 | 工作量 | 预估天数 |
|------|--------|---------|
| 阶段 1: 准备与评估 | 低 | 1-2 天 |
| 阶段 2: 数据库迁移 | 高 | 3-4 天 |
| 阶段 3: 文件系统迁移 | 中 | 2-3 天 |
| 阶段 4: UI 移动端适配 | 高 | 5-7 天 |
| 阶段 5: 功能调整 | 中 | 2-3 天 |
| 阶段 6: 构建与测试 | 中 | 3-4 天 |
| **总计** | | **16-23 天** |

---

## 维护策略

### 代码共享方案
推荐 **Monorepo 分离方案**:

```
BongMaster/
├── packages/
│   ├── shared/              # 共享代码
│   │   ├── components/      # 通用组件
│   │   ├── stores/          # 通用 store 逻辑
│   │   └── utils/           # 工具函数
│   ├── desktop/             # Electron 版本
│   │   ├── electron/
│   │   └── src/
│   └── mobile/              # Capacitor 版本
│       ├── ios/
│       └── src/
```

### 版本管理
- 桌面版和 iOS 版独立版本号
- 共享核心逻辑使用 npm workspace
- 数据库 Schema 保持同步

---

## App Store 发布准备

### 需要准备的内容
1. **开发者账号**: Apple Developer Program ($99/年)
2. **应用图标**: 所有尺寸规格
3. **截图**: iPhone 和 iPad 各尺寸
4. **隐私政策**: 网站托管
5. **应用描述**: 关键词优化

### iOS 特定配置
```xml
<!-- Info.plist 需要添加 -->
<key>NSPhotoLibraryUsageDescription</key>
<string>需要访问相册以上传附件</string>
<key>NSCameraUsageDescription</key>
<string>需要访问相机以拍摄附件照片</string>
<key>UIBackgroundModes</key>
<array>
  <string>fetch</string>
  <string>remote-notification</string>
</array>
```

---

## 结论

### 可行性评估: ✅ **可行**

**优势**:
- Vue 3 代码可以大部分复用
- Capacitor 生态成熟
- 性能可以满足需求

**劣势**:
- 需要大量异步化改造
- Apple Notes 同步功能无法移植
- MCP Server 无法在 iOS 运行
- 维护两套代码库

**建议**:
1. **短期**: 先发布功能精简的 MVP 版本
2. **中期**: 根据用户反馈迭代核心功能
3. **长期**: 考虑使用 React Native 或 SwiftUI 完全重写以获得最佳体验

---

## 下一步行动

1. **决策确认**: 确认是否继续 iOS 迁移
2. **分支创建**: 从主分支创建 `feature/ios-capacitor` 分支
3. **环境准备**: 安装 Xcode、CocoaPods、Capacitor CLI
4. **PoC 开发**: 先完成数据库迁移 POC 验证可行性

---

*计划制定时间: 2025年6月24日*
*版本: v1.0*
