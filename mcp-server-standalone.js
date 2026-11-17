#!/usr/bin/env node
/**
 * BongMaster MCP Server standalone launcher.
 *
 * The app uses better-sqlite3 compiled for Electron, so this Node entrypoint
 * only launches Electron's MCP mode and proxies stdio for MCP clients.
 */

const { spawn } = require('child_process')

const electronPath = require('electron')
const appPath = __dirname

const child = spawn(electronPath, [appPath, '--mcp-server'], {
  stdio: ['inherit', 'inherit', 'inherit']
})

const forwardSignal = (signal) => {
  if (!child.killed) {
    child.kill(signal)
  }
}

process.on('SIGINT', () => forwardSignal('SIGINT'))
process.on('SIGTERM', () => forwardSignal('SIGTERM'))

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 0)
})

child.on('error', (err) => {
  console.error('[MCP] Failed to launch Electron MCP mode:', err)
  process.exit(1)
})
