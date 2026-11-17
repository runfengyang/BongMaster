# BongMaster-Vue 项目规则

## 项目定位

本项目是纯本地的 Electron + Vue 3 + better-sqlite3 桌面应用。**iOS 配套应用（BongMaster-ios）和同步服务器已删除**，项目不再支持、也不计划支持多设备同步。

## 修改规则

1. **不要考虑 iOS 或同步。** 任何功能修改、重构、数据库变更都不需要兼容 iOS 端，也不需要维护同步逻辑。不要提议重新引入同步或多设备功能。
2. **残留的 sync 代码按死代码对待。** `electron/services/sync-service.js`、`electron/services/database-service.js` 里的 `sync_changes`/`sync_cursors`/`sync_devices` 表和 `_recordSyncChange`、`sync_state`、`sync_version`、`device_id` 等字段属于已被删除功能的遗留。改动相关代码时可以顺手删除，但不要为了它们增加新代码。
3. **数据库即本地 SQLite**（`~/Library/Application Support/bongmaster-vue/database.db`）。新增表/字段按普通本地 SQLite 设计即可，不需要 uuid、sync_version、device_id 这类同步簿记字段。
4. **不要恢复已删除的目录。** `BongMaster-ios` 已删除；若发现仍有旧进程引用它（如 sync-server），提醒用户即可，不要试图重建。

## 技术栈（现状）

- Electron 主进程：`electron/main.js`、`electron/services/`
- 前端：Vue 3 + Pinia + Vue Router + Bootstrap 5 + Quill.js
- MCP 模式：`electron/services/mcp-server.js`（`--mcp-server` 启动）
