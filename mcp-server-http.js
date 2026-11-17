#!/usr/bin/env node
/**
 * BongMaster MCP Server (HTTP + SSE 模式)
 *
 * 使用官方 @modelcontextprotocol/sdk 的 SSEServerTransport 提供标准 MCP
 * JSON-RPC over HTTP/SSE，工具逻辑通过 electron/services/mcp-server.js 中的
 * McpServerService 路由。
 *
 * 启动: node mcp-server-http.js
 * 端口: 3000 (默认)
 *
 * MCP 客户端配置示例:
 * {
 *   "mcpServers": {
 *     "bongmaster": {
 *       "url": "http://localhost:3000"
 *     }
 *   }
 * }
 *
 * 不同 MCP 客户端的配置文件位置和重载方式可能不同，请以客户端说明为准。
 */

const express = require('express')
const cors = require('cors')
const { SSEServerTransport } = require('@modelcontextprotocol/sdk/server/sse.js')
const path = require('path')
const os = require('os')
const fs = require('fs')

const { DatabaseService } = require('./electron/services/database-service')
const { McpServerService } = require('./electron/services/mcp-server')

const PORT = process.env.PORT || 3000

// 数据目录
const userDataPath = path.join(os.homedir(), 'Library/Application Support/bongmaster-vue')
if (!fs.existsSync(userDataPath)) {
  fs.mkdirSync(userDataPath, { recursive: true })
}

const dbPath = path.join(userDataPath, 'database.db')
const uploadsDir = path.join(userDataPath, 'uploads')

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true })
}

// 初始化数据库服务
const dbService = new DatabaseService(dbPath, uploadsDir)
dbService.initialize()
console.log(`[MCP] Database initialized at ${dbPath}`)

// 创建 Express 应用
const app = express()
app.use(cors())
app.use(express.json({ limit: '4mb' }))

// 按 sessionId 保存 SSE transport
const transports = new Map()

// MCP SSE 端点：建立 SSE 连接并创建独立的 McpServerService + transport
app.get('/sse', async (req, res) => {
  const transport = new SSEServerTransport('/message', res, {
    enableDnsRebindingProtection: false
  })

  const mcpServer = new McpServerService(dbService)
  await mcpServer.connect(transport)

  transports.set(transport.sessionId, transport)

  req.on('close', () => {
    transports.delete(transport.sessionId)
    transport.close().catch(err => {
      console.error('[MCP] Error closing transport:', err)
    })
  })

  // SSEServerTransport.start() 已由 Server.connect() 自动调用，
  // 并发送 endpoint 事件给客户端。
})

// MCP JSON-RPC 消息端点：将 POST 请求路由到对应 session 的 transport
app.post('/message', async (req, res) => {
  const sessionId = req.query.sessionId
  if (!sessionId || typeof sessionId !== 'string') {
    res.status(400).json({ error: 'Missing or invalid sessionId' })
    return
  }

  const transport = transports.get(sessionId)
  if (!transport) {
    res.status(404).json({ error: 'Session not found' })
    return
  }

  await transport.handlePostMessage(req, res, req.body)
})

// 健康检查
app.get('/health', (req, res) => {
  res.json({ status: 'ok', sessions: transports.size })
})

// 启动服务器
app.listen(PORT, () => {
  console.log(`[MCP] HTTP server listening on port ${PORT}`)
  console.log(`[MCP] Health check: http://localhost:${PORT}/health`)
  console.log(`[MCP] SSE endpoint: http://localhost:${PORT}/sse`)
  console.log(`[MCP] Message endpoint: http://localhost:${PORT}/message`)
})
