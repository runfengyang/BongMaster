<template>
  <div class="update-wrap">
    <button
      type="button"
      class="bm-update-toggle"
      :class="{ 'has-update': available }"
      :title="buttonTitle"
      aria-label="检查更新"
      :aria-expanded="open"
      @click.stop="toggle"
    >
      <i class="fas fa-download" aria-hidden="true"></i>
      <span v-if="available" class="bm-update-dot" aria-hidden="true"></span>
    </button>

    <Transition name="update-pop">
      <section v-if="open" class="update-panel" role="dialog" aria-label="软件更新" @click.stop>
        <header class="update-head">
          <div>
            <strong>软件更新</strong>
            <small>当前版本 v{{ currentVersion || '—' }}</small>
          </div>
          <button type="button" class="update-close" aria-label="关闭" @click="open = false">
            <i class="fas fa-times" aria-hidden="true"></i>
          </button>
        </header>

        <div v-if="checking" class="update-state">正在检查更新…</div>

        <div v-else-if="progress.phase === 'downloading'" class="update-state">
          <div class="update-progress-label">
            <span>正在下载新版本</span>
            <span>{{ progress.percent || 0 }}%</span>
          </div>
          <div class="update-bar"><span :style="{ width: `${progress.percent || 0}%` }"></span></div>
        </div>

        <div v-else-if="progress.phase === 'extracting'" class="update-state">正在解压更新包…</div>
        <div v-else-if="progress.phase === 'installing'" class="update-state">正在安装，应用即将自动重启…</div>

        <template v-else>
          <div v-if="installError" class="update-state error">{{ installError }}</div>
          <div v-else-if="result?.error" class="update-state error">{{ result.error }}</div>
          <div v-else-if="result?.reason === 'no-release'" class="update-state">还没有可用的 Release。</div>
          <div v-else-if="result?.available" class="update-available">
            <div class="update-version">
              <span class="update-badge">新版本</span>
              <strong>v{{ result.latestVersion }}</strong>
            </div>
            <div v-if="result.notes" class="update-notes">{{ result.notes }}</div>
            <p v-if="!canInstall" class="update-hint">
              {{ result.platform !== 'darwin' ? '当前版本仅支持 macOS 自动安装。' : '开发模式不自动安装，请使用打包版本。' }}
            </p>
            <div class="update-actions">
              <button type="button" class="update-primary" :disabled="!canInstall" @click="install">
                下载并安装
              </button>
              <button type="button" class="update-secondary" @click="openRelease">查看 Release</button>
            </div>
          </div>
          <div v-else-if="result" class="update-state">已是最新版本 v{{ result.currentVersion }}</div>
          <div v-else class="update-state">暂时无法获取版本信息。</div>
        </template>

        <footer v-if="!checking && progress.phase === 'idle'" class="update-footer">
          <button type="button" class="update-link" @click="checkNow">重新检查</button>
          <button v-if="result?.releaseUrl" type="button" class="update-link" @click="openRelease">打开 Releases</button>
        </footer>
      </section>
    </Transition>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'

const open = ref(false)
const checking = ref(false)
const currentVersion = ref('')
const result = ref(null)
const installError = ref('')
const progress = ref({ phase: 'idle', percent: 0 })
let offProgress = null

const available = computed(() => Boolean(result.value?.available))
const canInstall = computed(() => Boolean(
  result.value?.packaged
  && result.value?.platform === 'darwin'
  && result.value?.asset
))
const buttonTitle = computed(() => (
  available.value ? `发现新版本 v${result.value?.latestVersion}` : '检查更新'
))

const checkNow = async () => {
  if (checking.value) return
  checking.value = true
  installError.value = ''
  progress.value = { phase: 'idle', percent: 0 }
  try {
    result.value = await window.electronAPI.checkForUpdates()
  } catch (error) {
    installError.value = error.message || '检查更新失败'
  } finally {
    checking.value = false
  }
}

const install = async () => {
  if (!canInstall.value || progress.value.phase !== 'idle') return
  installError.value = ''
  progress.value = { phase: 'downloading', percent: 0 }
  try {
    await window.electronAPI.downloadUpdate()
  } catch (error) {
    installError.value = error.message || '更新失败'
    progress.value = { phase: 'idle', percent: 0 }
  }
}

const openRelease = () => {
  const url = result.value?.releaseUrl
  if (url) window.electronAPI.openExternal(url)
}

const toggle = () => {
  open.value = !open.value
  if (open.value && !result.value && !checking.value) checkNow()
}

const onDocumentClick = event => {
  if (open.value && !event.target?.closest?.('.update-wrap')) open.value = false
}

const onKeydown = event => {
  if (event.key === 'Escape' && open.value) open.value = false
}

onMounted(async () => {
  try {
    currentVersion.value = await window.electronAPI.getAppVersion()
  } catch {}
  offProgress = window.electronAPI.onUpdateProgress?.(payload => {
    progress.value = payload || { phase: 'idle', percent: 0 }
    if (payload?.phase === 'error') installError.value = payload.message || '更新失败'
  })
  document.addEventListener('click', onDocumentClick)
  document.addEventListener('keydown', onKeydown)
  window.setTimeout(checkNow, 1500)
})

onUnmounted(() => {
  document.removeEventListener('click', onDocumentClick)
  document.removeEventListener('keydown', onKeydown)
  if (offProgress) offProgress()
})
</script>

<style scoped>
.update-wrap {
  position: relative;
  display: flex;
}

.bm-update-toggle {
  position: relative;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 1px solid transparent;
  border-radius: var(--bm-radius-md);
  background: transparent;
  color: var(--bm-text-secondary);
  font-size: 0.75rem;
  cursor: pointer;
  transition: all var(--bm-transition-fast);
}

.bm-update-toggle:hover {
  background: var(--bm-bg-hover);
  color: var(--bm-text-primary);
}

.bm-update-toggle.has-update {
  color: var(--bm-accent-blue);
}

.bm-update-dot {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #ff3b30;
  box-shadow: 0 0 0 1.5px var(--bm-bg-card);
}

.update-panel {
  position: absolute;
  top: calc(100% + 9px);
  right: 0;
  z-index: 1400;
  width: 336px;
  max-width: calc(100vw - 28px);
  padding: 12px;
  border: 1px solid var(--bm-border-default);
  border-radius: 11px;
  background: var(--bm-bg-card);
  color: var(--bm-text-primary);
  box-shadow: 0 16px 40px rgb(0 0 0 / 0.18);
}

.update-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--bm-border-subtle);
}

.update-head strong {
  display: block;
  font-size: 13px;
}

.update-head small {
  display: block;
  margin-top: 2px;
  color: var(--bm-text-muted);
  font-size: 10.5px;
}

.update-close {
  width: 22px;
  height: 22px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--bm-text-muted);
  cursor: pointer;
}

.update-close:hover {
  background: var(--bm-bg-hover);
  color: var(--bm-text-primary);
}

.update-state {
  padding: 14px 2px;
  color: var(--bm-text-secondary);
  font-size: 12px;
}

.update-state.error {
  color: #d70015;
}

.update-progress-label {
  display: flex;
  justify-content: space-between;
  margin-bottom: 7px;
  font-size: 11.5px;
}

.update-bar {
  height: 6px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--bm-bg-hover);
}

.update-bar span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--bm-accent-blue);
  transition: width 160ms ease;
}

.update-available {
  padding-top: 10px;
}

.update-version {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-bottom: 8px;
  font-size: 13px;
}

.update-badge {
  padding: 1px 6px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--bm-accent-blue) 13%, transparent);
  color: var(--bm-accent-blue);
  font-size: 10px;
  font-weight: 600;
}

.update-notes {
  max-height: 210px;
  overflow: auto;
  padding: 8px 9px;
  border: 1px solid var(--bm-border-subtle);
  border-radius: 8px;
  background: color-mix(in srgb, var(--bm-bg-hover) 46%, transparent);
  color: var(--bm-text-secondary);
  font-size: 11px;
  line-height: 1.55;
  white-space: pre-wrap;
}

.update-hint {
  margin: 7px 0 0;
  color: var(--bm-text-muted);
  font-size: 10.5px;
}

.update-actions {
  display: flex;
  gap: 7px;
  margin-top: 10px;
}

.update-primary,
.update-secondary {
  height: 29px;
  padding: 0 11px;
  border-radius: 7px;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.update-primary {
  border: 1px solid var(--bm-accent-blue);
  background: var(--bm-accent-blue);
  color: #fff;
}

.update-primary:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.update-secondary {
  border: 1px solid var(--bm-border-default);
  background: var(--bm-bg-card);
  color: var(--bm-text-secondary);
}

.update-secondary:hover,
.update-close:hover {
  background: var(--bm-bg-hover);
}

.update-footer {
  display: flex;
  gap: 12px;
  margin-top: 9px;
  padding-top: 8px;
  border-top: 1px solid var(--bm-border-subtle);
}

.update-link {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--bm-accent-blue);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}

.update-pop-enter-active,
.update-pop-leave-active {
  transition: opacity 120ms ease, transform 120ms ease;
}

.update-pop-enter-from,
.update-pop-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
