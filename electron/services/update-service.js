const { app } = require('electron')
const fs = require('fs')
const fsp = require('fs/promises')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')
const { Readable } = require('stream')
const { finished } = require('stream/promises')

const REPO_OWNER = 'runfengyang'
const REPO_NAME = 'BongMaster'
const RELEASE_API = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`
const USER_AGENT = 'BongMaster-Updater'
const REQUEST_TIMEOUT_MS = 20000

let latestRelease = null
let lastCheck = null

const parseVersion = value => String(value || '')
  .replace(/^v/i, '')
  .split(/[.+-]/)
  .map(part => Number.parseInt(part, 10) || 0)

const isNewer = (latest, current) => {
  const a = parseVersion(latest)
  const b = parseVersion(current)
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if ((a[i] || 0) > (b[i] || 0)) return true
    if ((a[i] || 0) < (b[i] || 0)) return false
  }
  return false
}

const fetchWithTimeout = async (url, options = {}) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        ...(options.headers || {})
      }
    })
  } finally {
    clearTimeout(timer)
  }
}

const pickAsset = assets => (Array.isArray(assets) ? assets : []).find(asset => (
  /arm64.*\.zip$/i.test(asset.name || '') && !/blockmap|\.yml$/i.test(asset.name || '')
)) || (Array.isArray(assets) ? assets : []).find(asset => (
  /-mac\.zip$/i.test(asset.name || '') && !/blockmap|\.yml$/i.test(asset.name || '')
))

const releasePayload = (release, currentVersion) => {
  const latestVersion = String(release.tag_name || release.name || '').replace(/^v/i, '')
  const asset = pickAsset(release.assets)
  return {
    available: Boolean(asset && latestVersion && isNewer(latestVersion, currentVersion)),
    currentVersion,
    latestVersion,
    releaseUrl: release.html_url || `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases`,
    notes: release.body || '',
    publishedAt: release.published_at || '',
    asset: asset
      ? {
          id: asset.id,
          name: asset.name,
          size: asset.size,
          url: asset.url
        }
      : null,
    packaged: app.isPackaged,
    platform: process.platform
  }
}

const checkForUpdates = async () => {
  if (lastCheck && Date.now() - lastCheck.at < 60 * 1000) return lastCheck.result
  const currentVersion = app.getVersion()
  try {
    const response = await fetchWithTimeout(RELEASE_API, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    })
    if (response.status === 404) {
      const result = {
        available: false,
        currentVersion,
        latestVersion: '',
        releaseUrl: `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases`,
        notes: '',
        asset: null,
        packaged: app.isPackaged,
        platform: process.platform,
        reason: 'no-release'
      }
      lastCheck = { at: Date.now(), result }
      return result
    }
    if (!response.ok) throw new Error(`GitHub 返回 ${response.status}`)
    const release = await response.json()
    const result = releasePayload(release, currentVersion)
    latestRelease = result
    lastCheck = { at: Date.now(), result }
    return result
  } catch (error) {
    const result = {
      available: false,
      currentVersion,
      latestVersion: '',
      releaseUrl: `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases`,
      notes: '',
      asset: null,
      packaged: app.isPackaged,
      platform: process.platform,
      error: error.message || '检查更新失败'
    }
    lastCheck = { at: Date.now(), result }
    return result
  }
}

const sendProgress = (sender, payload) => {
  try {
    if (sender && !sender.isDestroyed()) sender.send('update:progress', payload)
  } catch {}
}

const bundlePathFor = () => {
  const executable = app.getPath('exe')
  return path.resolve(path.dirname(executable), '../..')
}

const downloadAndInstall = async sender => {
  if (!app.isPackaged) throw new Error('开发模式不安装更新，请在打包版本中测试')
  if (process.platform !== 'darwin') throw new Error('当前更新器仅支持 macOS')
  const release = latestRelease || await checkForUpdates()
  if (!release?.available || !release.asset) throw new Error('当前没有可安装的新版本')

  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'bongmaster-update-'))
  const zipPath = path.join(root, 'BongMaster.zip')
  try {
    sendProgress(sender, { phase: 'downloading', percent: 0 })
    const response = await fetchWithTimeout(release.asset.url, {
      headers: { Accept: 'application/octet-stream' }
    })
    if (!response.ok || !response.body) throw new Error(`下载失败 (${response.status})`)
    const total = Number(response.headers.get('content-length')) || Number(release.asset.size) || 0
    let received = 0
    const file = fs.createWriteStream(zipPath)
    const stream = Readable.fromWeb(response.body)
    stream.on('data', chunk => {
      received += chunk.length
      sendProgress(sender, {
        phase: 'downloading',
        percent: total ? Math.min(100, Math.round((received / total) * 100)) : 0,
        received,
        total
      })
    })
    stream.pipe(file)
    await finished(file)

    const appPath = bundlePathFor()
    if (!fs.existsSync(appPath)) throw new Error('找不到当前应用安装位置')

    const scriptPath = path.join(root, 'install.sh')
    const backupPath = `${appPath}.old.${process.pid}`
    const extractDir = path.join(root, 'extract')
    const script = `#!/bin/sh
APP=${JSON.stringify(appPath)}
ZIP=${JSON.stringify(zipPath)}
EXTRACT=${JSON.stringify(extractDir)}
BACKUP=${JSON.stringify(backupPath)}
while pgrep -f "$APP/Contents/MacOS/BongMaster" >/dev/null 2>&1; do sleep 1; done
rm -rf "$EXTRACT"
mkdir -p "$EXTRACT"
if ! /usr/bin/ditto -x -k "$ZIP" "$EXTRACT"; then
  /usr/bin/open "$APP"
  exit 1
fi
NEW="$EXTRACT/BongMaster.app"
if [ ! -d "$NEW/Contents" ]; then
  rm -rf "$EXTRACT"
  /usr/bin/open "$APP"
  exit 1
fi
rm -rf "$BACKUP"
if mv "$APP" "$BACKUP"; then
  if /usr/bin/ditto "$NEW" "$APP"; then
    rm -rf "$BACKUP"
    /usr/bin/xattr -dr com.apple.quarantine "$APP" >/dev/null 2>&1 || true
    /usr/bin/open "$APP"
  else
    rm -rf "$APP"
    mv "$BACKUP" "$APP"
    /usr/bin/open "$APP"
  fi
else
  /usr/bin/open "$APP"
fi
rm -rf "$EXTRACT"
`
    await fsp.writeFile(scriptPath, script, { mode: 0o755 })
    const child = spawn('/bin/sh', [scriptPath], { detached: true, stdio: 'ignore' })
    child.unref()
    sendProgress(sender, { phase: 'installing' })
    setTimeout(() => app.quit(), 1200)
    return { ok: true }
  } catch (error) {
    sendProgress(sender, { phase: 'error', message: error.message || '更新失败' })
    fs.rm(root, { recursive: true, force: true }, () => {})
    throw error
  }
}

module.exports = {
  checkForUpdates,
  downloadAndInstall
}
