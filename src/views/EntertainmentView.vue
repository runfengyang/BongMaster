<template>
  <div class="fade-in entertainment-view">
    <div class="entertainment-remote">
      <div class="remote-primary">
        <div ref="siteSwitcherRef" class="site-switcher" aria-label="娱乐平台">
          <span class="site-switcher-glider" :style="siteGliderStyle"></span>
          <button
            v-for="site in visibleSites"
            :key="site.id"
            :ref="el => setSiteTabRef(el, site.id)"
            class="tab-btn"
            :class="{ active: currentSite === site.id }"
            @click="switchSite(site.id)"
          >
            <img v-if="site.iconUrl" :src="site.iconUrl" class="site-favicon" alt="">
            <i v-else :class="site.icon"></i>
            <span>{{ site.name }}</span>
          </button>
        </div>

        <div class="browser-controls">
          <button class="ctrl-btn" @click="goBack" :disabled="!canGoBack" title="后退">
            <i class="fas fa-arrow-left"></i>
          </button>
          <button class="ctrl-btn" @click="goForward" :disabled="!canGoForward" title="前进">
            <i class="fas fa-arrow-right"></i>
          </button>
          <button class="ctrl-btn" @click="reload" title="刷新">
            <i :class="isLoading ? 'fas fa-spinner fa-spin' : 'fas fa-sync-alt'"></i>
          </button>
          <button class="ctrl-btn" @click="goHome" title="主页">
            <i class="fas fa-home"></i>
          </button>
        </div>

        <div class="address-bar">
          <i class="fas fa-link address-icon"></i>
          <input
            type="text"
            :value="currentUrl"
            readonly
            :placeholder="activeSite?.name || '娱乐网站'"
          />
        </div>
      </div>

      <div class="leisure-boundary">
        <div class="site-settings-wrap">
          <button
            type="button"
            class="ctrl-btn"
            title="管理显示的平台"
            aria-haspopup="dialog"
            :aria-expanded="settingsOpen"
            @click.stop="toggleSettings"
          >
            <i class="fas fa-sliders-h"></i>
          </button>
          <Transition name="site-settings-pop">
            <div v-if="settingsOpen" class="site-settings" role="dialog" aria-label="显示的平台">
              <div class="site-settings-head">
                <span>内置平台</span>
                <button v-if="hiddenIds.length" type="button" class="site-settings-reset" @click="showAllSites">
                  全部显示
                </button>
              </div>
              <label
                v-for="site in builtinSites"
                :key="site.id"
                class="site-settings-row"
                :class="{ disabled: isLastVisible(site) }"
              >
                <input
                  type="checkbox"
                  :checked="!hiddenIds.includes(site.id)"
                  :disabled="isLastVisible(site)"
                  @change="toggleSite(site.id)"
                >
                <i :class="site.icon" :style="{ color: site.color }"></i>
                <span>{{ site.name }}</span>
              </label>

              <div class="site-settings-divider"></div>
              <div class="site-settings-head">
                <span>自定义主页</span>
                <button v-if="!customForm.open" type="button" class="site-settings-reset" @click="startAddCustomSite">
                  添加
                </button>
              </div>
              <label
                v-for="site in customSites"
                :key="site.id"
                class="site-settings-row custom-site-row"
                :class="{ disabled: isLastVisible(site) }"
              >
                <input
                  type="checkbox"
                  :checked="!hiddenIds.includes(site.id)"
                  :disabled="isLastVisible(site)"
                  @change="toggleSite(site.id)"
                >
                <img v-if="site.iconUrl" :src="site.iconUrl" class="site-settings-icon" alt="">
                <i v-else :class="site.icon"></i>
                <span class="custom-site-name" :title="site.url">{{ site.name }}</span>
                <button type="button" class="custom-site-action" title="编辑" @click.prevent.stop="startEditCustomSite(site)">
                  <i class="fas fa-pen"></i>
                </button>
                <button type="button" class="custom-site-action danger" title="删除" @click.prevent.stop="removeCustomSite(site)">
                  <i class="fas fa-trash"></i>
                </button>
              </label>
              <p v-if="!customSites.length && !customForm.open" class="custom-site-empty">还没有自定义主页</p>
              <form v-if="customForm.open" class="custom-site-form" @submit.prevent="saveCustomSite">
                <input v-model="customForm.name" type="text" placeholder="名称（可选）" :disabled="customForm.saving">
                <input
                  ref="customUrlInput"
                  v-model="customForm.url"
                  type="text"
                  placeholder="https://example.com"
                  required
                  :disabled="customForm.saving"
                >
                <p v-if="customForm.error" class="custom-site-error">{{ customForm.error }}</p>
                <div class="custom-site-form-actions">
                  <button type="button" :disabled="customForm.saving" @click="cancelCustomSite">取消</button>
                  <button type="submit" :disabled="customForm.saving">
                    {{ customForm.saving ? '读取图标…' : '保存' }}
                  </button>
                </div>
              </form>
            </div>
          </Transition>
        </div>
        <div class="usage-wrap">
          <button
            type="button"
            class="usage-pill"
            :class="{ active: usageOpen }"
            title="今日休闲时间（前台且窗口有焦点时累计）"
            aria-haspopup="dialog"
            :aria-expanded="usageOpen"
            @click.stop="toggleUsagePanel"
          >
            <span>今日休闲</span>
            <strong>{{ formatDuration(todayUsageSeconds) }}</strong>
          </button>
          <Transition name="site-settings-pop">
            <div v-if="usageOpen" class="usage-panel" role="dialog" aria-label="今日休闲统计" @click.stop>
              <div class="usage-panel-head">
                <span>今日休闲</span>
                <strong>{{ formatDuration(todayUsageSeconds) }}</strong>
              </div>

              <div class="usage-limit-row">
                <span>每日上限</span>
                <select v-model.number="dailyLimitMinutes" aria-label="每日娱乐上限">
                  <option :value="0">不提醒</option>
                  <option :value="30">30 分钟</option>
                  <option :value="45">45 分钟</option>
                  <option :value="60">60 分钟</option>
                  <option :value="90">90 分钟</option>
                  <option :value="120">120 分钟</option>
                </select>
              </div>
              <div v-if="dailyLimitMinutes > 0" class="usage-limit-meter">
                <div class="usage-limit-bar"><span :class="{ over: usageLimitPercent >= 100 }" :style="{ width: `${usageLimitPercent}%` }"></span></div>
                <small>{{ usageLimitPercent }}%</small>
              </div>

              <div class="usage-panel-section">
                <div class="usage-panel-title">分平台</div>
                <div v-if="siteUsageRows.length" class="usage-site-list">
                  <div v-for="row in siteUsageRows" :key="row.id" class="usage-site-row">
                    <img v-if="row.iconUrl" :src="row.iconUrl" class="usage-site-icon" alt="">
                    <i v-else :class="row.icon" :style="{ color: row.color }"></i>
                    <span class="usage-site-name">{{ row.name }}</span>
                    <strong>{{ formatDuration(row.seconds) }}</strong>
                  </div>
                </div>
                <p v-else class="usage-empty">今天还没有记录</p>
              </div>

              <div class="usage-panel-section">
                <div class="usage-panel-title">近 7 天</div>
                <div class="usage-week">
                  <div v-for="day in weekUsage" :key="day.key" class="usage-day" :class="{ today: day.isToday }">
                    <div class="usage-day-track">
                      <span :style="{ height: `${day.percent}%` }"></span>
                    </div>
                    <small>{{ day.label }}</small>
                  </div>
                </div>
              </div>
            </div>
          </Transition>
        </div>
      </div>
    </div>

    <Transition name="usage-notice">
      <div v-if="limitNoticeVisible" class="usage-notice" role="status">
        <i class="fas fa-mug-hot" aria-hidden="true"></i>
        <span>今天娱乐已经 {{ formatDuration(todayUsageSeconds) }}，起来活动一下吧。</span>
        <button type="button" class="usage-notice-snooze" @click="snoozeLimitNotice">再玩 15 分钟</button>
        <button type="button" class="usage-notice-close" aria-label="知道了" @click="dismissLimitNotice">知道了</button>
      </div>
    </Transition>

    <!-- Webview Container -->
    <div class="webview-container">
      <webview
        v-for="site in mountedSites"
        :key="site.id"
        :ref="(el) => setWebviewRef(el, site.id)"
        :src="site.url"
        class="entertainment-webview"
        :class="{ active: currentSite === site.id }"
        :partition="`persist:${site.id}`"
        webpreferences="contextIsolation=true,nodeIntegration=false,nodeIntegrationInSubFrames=false,sandbox=true,webSecurity=true,allowRunningInsecureContent=false"
      ></webview>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, nextTick, onMounted, onUnmounted, reactive, watch } from 'vue'
import { useRoute } from 'vue-router'
import { formatDuration, pickWebviewsToKeep, shouldCountUsage, usageBarPercent } from '@utils/entertainment'

const builtinSites = [
  {
    id: 'xiaohongshu',
    name: '小红书',
    url: 'https://www.xiaohongshu.com',
    icon: 'fas fa-book-open',
    color: '#ff2442'
  },
  {
    id: 'bilibili',
    name: 'Bilibili',
    url: 'https://www.bilibili.com',
    icon: 'fas fa-tv',
    color: '#00a1d6'
  },
  {
    id: 'youtube',
    name: 'Youtube',
    url: 'https://www.youtube.com',
    icon: 'fab fa-youtube',
    color: '#ff0000'
  },
  {
    id: 'instagram',
    name: 'Instagram',
    url: 'https://www.instagram.com',
    icon: 'fab fa-instagram',
    color: '#e1306c'
  },
  {
    id: 'x',
    name: 'X',
    url: 'https://x.com',
    icon: 'fab fa-x-twitter',
    color: '#111827'
  },
  {
    id: 'douyin',
    name: '抖音',
    url: 'https://www.douyin.com/jingxuan',
    icon: 'fab fa-tiktok',
    color: '#fe2c55'
  }
]

const HIDDEN_SITES_KEY = 'bongmaster:entertainment:hidden-sites'
const CUSTOM_SITES_KEY = 'bongmaster:entertainment:custom-sites'
const SITE_USAGE_KEY = 'bongmaster:entertainment-usage-sites'
const DAILY_LIMIT_KEY = 'bongmaster:entertainment:daily-limit'
const LIMIT_DISMISSED_KEY = 'bongmaster:entertainment:limit-dismissed'
const MAX_WARM_WEBVIEWS = 3
const IDLE_DESTROY_MS = 10 * 60 * 1000
const IDLE_AWAY_SECONDS = 300
const LIMIT_SNOOZE_MS = 15 * 60 * 1000

const normalizeHomeUrl = value => {
  const text = String(value || '').trim()
  if (!text) return ''
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`
  try {
    const url = new URL(withScheme)
    return ['http:', 'https:'].includes(url.protocol) ? url.href : ''
  } catch {
    return ''
  }
}

const readCustomSites = () => {
  try {
    const parsed = JSON.parse(localStorage.getItem(CUSTOM_SITES_KEY) || '[]')
    if (!Array.isArray(parsed)) return []
    const seen = new Set()
    return parsed.map(item => {
      const url = normalizeHomeUrl(item?.url)
      const id = typeof item?.id === 'string' ? item.id : ''
      if (!url || !id || seen.has(id)) return null
      seen.add(id)
      return {
        id,
        name: String(item.name || '').trim() || new URL(url).hostname,
        url,
        icon: 'fas fa-globe',
        iconUrl: typeof item.iconUrl === 'string' && item.iconUrl.startsWith('data:image/') ? item.iconUrl : '',
        color: '#64748b',
        custom: true
      }
    }).filter(Boolean)
  } catch {
    return []
  }
}

const customSites = ref(readCustomSites())
const sites = computed(() => [...builtinSites, ...customSites.value])

const readHiddenSites = () => {
  try {
    const parsed = JSON.parse(localStorage.getItem(HIDDEN_SITES_KEY) || '[]')
    if (!Array.isArray(parsed)) return []
    const known = new Set(sites.value.map(site => site.id))
    const hidden = parsed.filter(id => known.has(id))
    return hidden.length >= known.size ? [] : hidden
  } catch {
    return []
  }
}

const hiddenIds = ref(readHiddenSites())
const visibleSites = computed(() => sites.value.filter(site => !hiddenIds.value.includes(site.id)))
const settingsOpen = ref(false)
const currentSite = ref(visibleSites.value[0]?.id || 'xiaohongshu')
const webviewRefs = ref({})
const siteSwitcherRef = ref(null)
const siteTabRefs = ref({})
const siteGliderStyle = ref({})
const canGoBack = ref(false)
const canGoForward = ref(false)
const currentUrl = ref(visibleSites.value[0]?.url || '')
const isLoading = ref(false)
const todayUsageSeconds = ref(0)
const siteUsage = ref({})
const mountedSiteIds = ref([])
const recentSiteIds = ref([])
const siteLastActive = ref({})
const windowFocused = ref(true)
const systemIdleSeconds = ref(0)
const usageOpen = ref(false)
const dailyLimitMinutes = ref(45)
const limitNoticeVisible = ref(false)
const limitDismissedDate = ref('')
let limitSnoozeUntil = 0

const route = useRoute()

const activeSite = computed(() => sites.value.find(s => s.id === currentSite.value))
const isEntertainmentActive = computed(() => route.path === '/entertainment')
const mountedSites = computed(() => visibleSites.value.filter(site => mountedSiteIds.value.includes(site.id)))
const usageLimitPercent = computed(() => usageBarPercent(todayUsageSeconds.value, dailyLimitMinutes.value))
const siteUsageRows = computed(() => Object.entries(siteUsage.value)
  .map(([id, seconds]) => {
    const site = sites.value.find(item => item.id === id)
    return {
      id,
      name: site?.name || '已移除的主页',
      icon: site?.icon || 'fas fa-globe',
      iconUrl: site?.iconUrl || '',
      color: site?.color || 'var(--bm-text-muted)',
      seconds: Number(seconds) || 0
    }
  })
  .filter(row => row.seconds > 0)
  .sort((a, b) => b.seconds - a.seconds))
const weekUsage = computed(() => {
  // 依赖今天的秒数，保证计时变化时重新计算。
  const todaySeconds = todayUsageSeconds.value
  const days = []
  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = new Date()
    date.setDate(date.getDate() - offset)
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    let seconds = 0
    if (offset === 0) seconds = todaySeconds
    else {
      try { seconds = Number(localStorage.getItem(`bongmaster:entertainment-usage:${key}`) || 0) || 0 } catch {}
    }
    days.push({
      key,
      label: '日一二三四五六'[date.getDay()],
      seconds,
      isToday: offset === 0
    })
  }
  const max = Math.max(60, ...days.map(day => day.seconds))
  return days.map(day => ({ ...day, percent: Math.max(day.seconds > 0 ? 6 : 0, Math.round((day.seconds / max) * 100)) }))
})

const toggleUsagePanel = () => {
  usageOpen.value = !usageOpen.value
  if (usageOpen.value) settingsOpen.value = false
}

const toggleSettings = () => {
  settingsOpen.value = !settingsOpen.value
  if (settingsOpen.value) usageOpen.value = false
}

let usageTicker = null
let idleTicker = null
let sweepTicker = null

const setWebviewRef = (el, siteId) => {
  if (el) webviewRefs.value[siteId] = el
  else delete webviewRefs.value[siteId]
}

const setSiteTabRef = (el, siteId) => {
  if (el) siteTabRefs.value[siteId] = el
  else delete siteTabRefs.value[siteId]
}

const updateSiteGlider = () => {
  const switcher = siteSwitcherRef.value
  const activeTab = siteTabRefs.value[currentSite.value]
  if (!switcher || !activeTab) return

  const switcherRect = switcher.getBoundingClientRect()
  const activeRect = activeTab.getBoundingClientRect()
  siteGliderStyle.value = {
    width: `${activeRect.width}px`,
    transform: `translateX(${activeRect.left - switcherRect.left}px)`
  }
}

const scheduleSiteGliderUpdate = () => {
  nextTick(() => {
    window.requestAnimationFrame(updateSiteGlider)
  })
}

const getActiveWebview = () => webviewRefs.value[currentSite.value]

const applyWebviewMute = () => {
  Object.entries(webviewRefs.value).forEach(([siteId, webview]) => {
    try {
      webview?.setAudioMuted?.(siteId !== currentSite.value)
    } catch {}
  })
}

const trimMountedSites = () => {
  const keep = pickWebviewsToKeep({
    mounted: mountedSiteIds.value,
    recent: recentSiteIds.value,
    current: currentSite.value,
    max: MAX_WARM_WEBVIEWS
  })
  if (keep.length !== mountedSiteIds.value.length) {
    mountedSiteIds.value = keep
    recentSiteIds.value = recentSiteIds.value.filter(id => keep.includes(id))
  }
}

const ensureSiteMounted = (siteId) => {
  if (!visibleSites.value.some(site => site.id === siteId)) return
  if (!mountedSiteIds.value.includes(siteId)) {
    mountedSiteIds.value = [...mountedSiteIds.value, siteId]
  }
  recentSiteIds.value = [siteId, ...recentSiteIds.value.filter(id => id !== siteId)]
  siteLastActive.value = { ...siteLastActive.value, [siteId]: Date.now() }
  trimMountedSites()
  nextTick(() => {
    bindAllMounted()
    applyWebviewMute()
  })
}

const removeMountedSite = (siteId) => {
  mountedSiteIds.value = mountedSiteIds.value.filter(id => id !== siteId)
  recentSiteIds.value = recentSiteIds.value.filter(id => id !== siteId)
}

const sweepIdleWebviews = () => {
  const now = Date.now()
  const idleIds = mountedSiteIds.value.filter(id => (
    id !== currentSite.value
    && now - Number(siteLastActive.value[id] || 0) > IDLE_DESTROY_MS
  ))
  if (!idleIds.length) return
  mountedSiteIds.value = mountedSiteIds.value.filter(id => !idleIds.includes(id))
  recentSiteIds.value = recentSiteIds.value.filter(id => !idleIds.includes(id))
}

const switchSite = (siteId) => {
  if (!visibleSites.value.some(site => site.id === siteId)) return
  currentSite.value = siteId
  ensureSiteMounted(siteId)
  scheduleSiteGliderUpdate()
  const site = sites.value.find(s => s.id === siteId)
  if (site) currentUrl.value = site.url
  const webview = webviewRefs.value[siteId]
  const webviewUrl = webview?.getURL?.()
  if (webviewUrl && webviewUrl !== 'about:blank') currentUrl.value = webviewUrl
  applyWebviewMute()
  setTimeout(updateNavigationState, 100)
}

const isLastVisible = site => (
  visibleSites.value.length <= 1 && !hiddenIds.value.includes(site.id)
)

const toggleSite = (siteId) => {
  if (!sites.value.some(site => site.id === siteId)) return
  const next = new Set(hiddenIds.value)
  if (next.has(siteId)) {
    next.delete(siteId)
  } else {
    if (visibleSites.value.length <= 1) return
    next.add(siteId)
  }
  hiddenIds.value = [...next]
  try {
    localStorage.setItem(HIDDEN_SITES_KEY, JSON.stringify(hiddenIds.value))
  } catch {}
  if (next.has(siteId)) removeMountedSite(siteId)
  if (!visibleSites.value.some(site => site.id === currentSite.value)) {
    const fallback = visibleSites.value[0]
    if (fallback) switchSite(fallback.id)
  }
  scheduleSiteGliderUpdate()
}

const showAllSites = () => {
  hiddenIds.value = []
  try {
    localStorage.removeItem(HIDDEN_SITES_KEY)
  } catch {}
  scheduleSiteGliderUpdate()
}

const customForm = reactive({ open: false, id: null, name: '', url: '', saving: false, error: '' })
const customUrlInput = ref(null)

const persistCustomSites = () => {
  try {
    localStorage.setItem(CUSTOM_SITES_KEY, JSON.stringify(
      customSites.value.map(({ id, name, url, iconUrl }) => ({ id, name, url, iconUrl }))
    ))
    return true
  } catch {
    return false
  }
}

const focusCustomUrl = () => {
  nextTick(() => customUrlInput.value?.focus())
}

const startAddCustomSite = () => {
  Object.assign(customForm, { open: true, id: null, name: '', url: '', saving: false, error: '' })
  focusCustomUrl()
}

const startEditCustomSite = site => {
  Object.assign(customForm, { open: true, id: site.id, name: site.name, url: site.url, saving: false, error: '' })
  focusCustomUrl()
}

const cancelCustomSite = () => {
  Object.assign(customForm, { open: false, id: null, name: '', url: '', saving: false, error: '' })
}

const saveCustomSite = async () => {
  if (customForm.saving) return
  const url = normalizeHomeUrl(customForm.url)
  if (!url) {
    customForm.error = '请输入有效的 http/https 地址'
    return
  }
  customForm.saving = true
  customForm.error = ''
  try {
    const existing = customForm.id
      ? customSites.value.find(site => site.id === customForm.id)
      : null
    let iconUrl = existing && existing.url === url ? existing.iconUrl : ''
    if (!iconUrl) {
      try {
        const result = await window.electronAPI.fetchFavicon(url)
        if (result?.success && result.iconUrl) iconUrl = result.iconUrl
      } catch {}
    }
    const name = customForm.name.trim() || new URL(url).hostname
    if (existing) {
      existing.name = name
      existing.url = url
      existing.iconUrl = iconUrl
      customSites.value = [...customSites.value]
    } else {
      customSites.value = [...customSites.value, {
        id: `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        name,
        url,
        icon: 'fas fa-globe',
        iconUrl,
        color: '#64748b',
        custom: true
      }]
    }
    if (!persistCustomSites()) {
      customForm.error = '保存失败：本地存储空间不足'
      return
    }
    const savedId = existing?.id || customSites.value.at(-1).id
    cancelCustomSite()
    await nextTick()
    if (currentSite.value === savedId || !existing) switchSite(savedId)
    scheduleSiteGliderUpdate()
  } catch (err) {
    customForm.error = err.message || '保存失败'
  } finally {
    customForm.saving = false
  }
}

const removeCustomSite = site => {
  if (!window.confirm(`删除自定义主页“${site.name}”？`)) return
  customSites.value = customSites.value.filter(item => item.id !== site.id)
  persistCustomSites()
  if (hiddenIds.value.includes(site.id)) {
    hiddenIds.value = hiddenIds.value.filter(id => id !== site.id)
    try {
      localStorage.setItem(HIDDEN_SITES_KEY, JSON.stringify(hiddenIds.value))
    } catch {}
  }
  removeMountedSite(site.id)
  if (customForm.id === site.id) cancelCustomSite()
  if (currentSite.value === site.id) {
    const fallback = visibleSites.value[0]
    if (fallback) switchSite(fallback.id)
  }
  scheduleSiteGliderUpdate()
}

const onGlobalPointerDown = event => {
  if (settingsOpen.value && !event.target?.closest?.('.site-settings-wrap')) settingsOpen.value = false
  if (usageOpen.value && !event.target?.closest?.('.usage-wrap')) usageOpen.value = false
}

const onSettingsKeydown = event => {
  if (event.key !== 'Escape') return
  settingsOpen.value = false
  usageOpen.value = false
}

const goBack = () => {
  const webview = getActiveWebview()
  if (webview) webview.goBack()
}

const goForward = () => {
  const webview = getActiveWebview()
  if (webview) webview.goForward()
}

const reload = () => {
  const webview = getActiveWebview()
  if (webview) webview.reload()
}

const goHome = () => {
  const webview = getActiveWebview()
  const site = activeSite.value
  if (webview && site) {
    webview.loadURL(site.url)
    currentUrl.value = site.url
  }
}

const updateNavigationState = () => {
  const webview = getActiveWebview()
  if (webview) {
    try {
      canGoBack.value = webview.canGoBack()
      canGoForward.value = webview.canGoForward()
      isLoading.value = Boolean(webview.isLoading?.())
    } catch {}
  }
}

const updateCurrentUrl = (url) => {
  if (url && url !== 'about:blank') {
    currentUrl.value = url
  }
  updateNavigationState()
}

const shouldOpenInsideWebview = (url) => {
  if (!url || url === 'about:blank') return false
  try {
    const parsed = new URL(url)
    return ['http:', 'https:'].includes(parsed.protocol)
  } catch {
    return false
  }
}

const openInsideWebview = (webview, url) => {
  if (!webview || !shouldOpenInsideWebview(url)) return
  webview.loadURL(url)
  updateCurrentUrl(url)
}

const injectPopupInterceptor = (webview) => {
  if (!webview) return

  webview.executeJavaScript(`
    (() => {
      if (window.__bongMasterPopupInterceptorInstalled) return;
      window.__bongMasterPopupInterceptorInstalled = true;

      const shouldHandle = (url) => {
        if (!url) return false;
        try {
          const parsed = new URL(url, window.location.href);
          return parsed.protocol === 'http:' || parsed.protocol === 'https:';
        } catch {
          return false;
        }
      };

      const navigateHere = (url) => {
        if (!shouldHandle(url)) return null;
        window.location.href = new URL(url, window.location.href).href;
        return null;
      };

      const originalOpen = window.open;
      window.open = function(url, target, features) {
        if (url && shouldHandle(url)) {
          return navigateHere(url);
        }
        return originalOpen.call(window, url, target, features);
      };

      document.addEventListener('click', (event) => {
        const link = event.target?.closest?.('a[href]');
        if (!link) return;
        const target = link.getAttribute('target');
        const href = link.href;
        if (target && target !== '_self' && shouldHandle(href)) {
          event.preventDefault();
          event.stopPropagation();
          navigateHere(href);
        }
      }, true);

      document.addEventListener('auxclick', (event) => {
        const link = event.target?.closest?.('a[href]');
        if (!link || event.button !== 1 || !shouldHandle(link.href)) return;
        event.preventDefault();
        event.stopPropagation();
        navigateHere(link.href);
      }, true);
    })();
  `).catch(() => {})
}

const bindWebviewEvents = (siteId) => {
  const webview = webviewRefs.value[siteId]
  if (!webview || webview._eventsBound) return
  webview.addEventListener('dom-ready', () => {
    injectPopupInterceptor(webview)
    applyWebviewMute()
  })
  webview.addEventListener('did-navigate', (e) => {
    if (currentSite.value === siteId) updateCurrentUrl(e.url)
  })
  webview.addEventListener('did-navigate-in-page', (e) => {
    if (currentSite.value === siteId) updateCurrentUrl(e.url)
  })
  webview.addEventListener('did-start-loading', () => {
    if (currentSite.value === siteId) isLoading.value = true
  })
  webview.addEventListener('did-stop-loading', () => {
    if (currentSite.value === siteId) {
      isLoading.value = false
      updateNavigationState()
    }
  })
  webview.addEventListener('did-finish-load', () => {
    injectPopupInterceptor(webview)
    if (currentSite.value === siteId) updateNavigationState()
    applyWebviewMute()
  })
  webview.addEventListener('new-window', (e) => {
    e.preventDefault()
    openInsideWebview(webview, e.url)
  })
  webview.addEventListener('will-navigate', (e) => {
    if (!shouldOpenInsideWebview(e.url)) {
      e.preventDefault()
      return
    }
    if (currentSite.value === siteId) updateCurrentUrl(e.url)
  })
  webview._eventsBound = true
}

const bindAllMounted = () => {
  mountedSiteIds.value.forEach(siteId => bindWebviewEvents(siteId))
  applyWebviewMute()
}

const getDateKey = () => {
  const date = new Date()
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const getUsageStorageKey = () => `bongmaster:entertainment-usage:${getDateKey()}`
const getSiteUsageStorageKey = () => `${SITE_USAGE_KEY}:${getDateKey()}`
const getLimitDismissedKey = () => `${LIMIT_DISMISSED_KEY}:${getDateKey()}`

let usageDateKey = ''

const readDailyLimit = () => {
  try {
    const raw = localStorage.getItem(DAILY_LIMIT_KEY)
    if (raw === null || raw === '') return 45
    const value = Number(raw)
    if ([0, 30, 45, 60, 90, 120].includes(value)) return value
  } catch {}
  return 45
}

const loadSiteUsage = () => {
  try {
    const parsed = JSON.parse(localStorage.getItem(getSiteUsageStorageKey()) || '{}')
    if (!parsed || typeof parsed !== 'object') return {}
    return Object.fromEntries(Object.entries(parsed)
      .map(([id, seconds]) => [id, Math.max(0, Math.min(86400, Number(seconds) || 0))])
      .filter(([, seconds]) => seconds > 0))
  } catch {
    return {}
  }
}

const saveSiteUsage = () => {
  if (usageDateKey !== getDateKey()) return
  try {
    localStorage.setItem(getSiteUsageStorageKey(), JSON.stringify(siteUsage.value))
  } catch {}
}

const loadTodayUsage = () => {
  usageDateKey = getDateKey()
  dailyLimitMinutes.value = readDailyLimit()
  try {
    const parsed = Number(localStorage.getItem(getUsageStorageKey()) || 0)
    todayUsageSeconds.value = Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 86400) : 0
  } catch {
    todayUsageSeconds.value = 0
  }
  siteUsage.value = loadSiteUsage()
  try {
    limitDismissedDate.value = localStorage.getItem(getLimitDismissedKey()) || ''
  } catch {
    limitDismissedDate.value = ''
  }
}

const saveTodayUsage = () => {
  if (usageDateKey !== getDateKey()) return
  try {
    localStorage.setItem(getUsageStorageKey(), String(todayUsageSeconds.value))
  } catch {}
  saveSiteUsage()
}

const maybeShowLimitNotice = () => {
  const limit = Number(dailyLimitMinutes.value) || 0
  if (limit <= 0 || todayUsageSeconds.value < limit * 60) {
    limitNoticeVisible.value = false
    return
  }
  if (limitDismissedDate.value === getDateKey()) return
  if (Date.now() < limitSnoozeUntil) return
  limitNoticeVisible.value = true
}

const dismissLimitNotice = () => {
  limitNoticeVisible.value = false
  limitDismissedDate.value = getDateKey()
  try {
    localStorage.setItem(getLimitDismissedKey(), getDateKey())
  } catch {}
}

const snoozeLimitNotice = () => {
  limitNoticeVisible.value = false
  limitSnoozeUntil = Date.now() + LIMIT_SNOOZE_MS
}

const onWindowFocus = () => {
  windowFocused.value = true
}

const onWindowBlur = () => {
  windowFocused.value = false
  saveTodayUsage()
}

const refreshSystemIdle = async () => {
  try {
    const value = await window.electronAPI?.getSystemIdleSeconds?.()
    systemIdleSeconds.value = Number.isFinite(value) ? Math.max(0, value) : 0
  } catch {
    systemIdleSeconds.value = 0
  }
}

const activeWebviewAudible = () => {
  try {
    return Boolean(getActiveWebview()?.isCurrentlyAudible?.())
  } catch {
    return false
  }
}

const tickUsage = () => {
  const dateKey = getDateKey()
  if (dateKey !== usageDateKey) {
    usageDateKey = dateKey
    todayUsageSeconds.value = 0
    siteUsage.value = {}
    limitDismissedDate.value = ''
    limitNoticeVisible.value = false
  }
  const shouldCount = shouldCountUsage({
    pageActive: isEntertainmentActive.value,
    hidden: document.hidden,
    focused: windowFocused.value,
    idleSeconds: systemIdleSeconds.value,
    audible: activeWebviewAudible(),
    idleAwaySeconds: IDLE_AWAY_SECONDS
  })
  if (!shouldCount) return
  todayUsageSeconds.value += 1
  const siteId = currentSite.value
  if (siteId) {
    siteUsage.value = { ...siteUsage.value, [siteId]: (siteUsage.value[siteId] || 0) + 1 }
  }
  if (todayUsageSeconds.value % 5 === 0) saveTodayUsage()
  maybeShowLimitNotice()
}

watch(dailyLimitMinutes, value => {
  try {
    localStorage.setItem(DAILY_LIMIT_KEY, String(value))
  } catch {}
  if (Number(value) <= 0) limitNoticeVisible.value = false
  else maybeShowLimitNotice()
})

const handleVisibilityChange = () => {
  if (document.hidden) saveTodayUsage()
}

watch(visibleSites, list => {
  const ids = new Set(list.map(site => site.id))
  mountedSiteIds.value = mountedSiteIds.value.filter(id => ids.has(id))
  recentSiteIds.value = recentSiteIds.value.filter(id => ids.has(id))
  if (!ids.has(currentSite.value) && list.length) switchSite(list[0].id)
  scheduleSiteGliderUpdate()
  nextTick(bindAllMounted)
})

watch(mountedSiteIds, () => {
  nextTick(() => {
    bindAllMounted()
    applyWebviewMute()
  })
}, { flush: 'post' })

onMounted(() => {
  scheduleSiteGliderUpdate()
  windowFocused.value = document.hasFocus()
  loadTodayUsage()
  maybeShowLimitNotice()
  ensureSiteMounted(currentSite.value)
  refreshSystemIdle()
  window.addEventListener('resize', scheduleSiteGliderUpdate)
  window.addEventListener('focus', onWindowFocus)
  window.addEventListener('blur', onWindowBlur)
  document.addEventListener('pointerdown', onGlobalPointerDown)
  document.addEventListener('keydown', onSettingsKeydown)
  usageTicker = window.setInterval(tickUsage, 1000)
  idleTicker = window.setInterval(refreshSystemIdle, 5000)
  sweepTicker = window.setInterval(sweepIdleWebviews, 60000)
  document.addEventListener('visibilitychange', handleVisibilityChange)
})

onUnmounted(() => {
  window.removeEventListener('resize', scheduleSiteGliderUpdate)
  window.removeEventListener('focus', onWindowFocus)
  window.removeEventListener('blur', onWindowBlur)
  document.removeEventListener('pointerdown', onGlobalPointerDown)
  document.removeEventListener('keydown', onSettingsKeydown)
  if (usageTicker) window.clearInterval(usageTicker)
  if (idleTicker) window.clearInterval(idleTicker)
  if (sweepTicker) window.clearInterval(sweepTicker)
  saveTodayUsage()
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  Object.values(webviewRefs.value).forEach(webview => {
    if (webview) webview._eventsBound = false
  })
})
</script>

<style scoped>
.entertainment-view {
  position: relative;
  height: calc(100vh - var(--bm-navbar-height));
  display: flex;
  flex-direction: column;
  gap: var(--bm-space-sm);
  padding: 10px;
  background: var(--bm-bg-page);
}

.entertainment-remote {
  position: relative;
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--bm-space-sm);
  padding: 5px 7px;
  background: color-mix(in srgb, var(--bm-bg-card) 82%, transparent);
  border: 1px solid var(--bm-border-subtle);
  border-radius: var(--bm-radius-md);
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.025);
}

.remote-primary {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: var(--bm-space-sm);
}

.site-switcher {
  position: relative;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  background: color-mix(in srgb, var(--bm-bg-hover) 62%, transparent);
  border-radius: var(--bm-radius-md);
  flex-shrink: 0;
}

.site-switcher-glider {
  position: absolute;
  top: 2px;
  bottom: 2px;
  left: 0;
  z-index: 0;
  background: var(--bm-bg-card);
  border-radius: var(--bm-radius-sm);
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.07);
  transition:
    transform 260ms cubic-bezier(0.22, 1, 0.36, 1),
    width 260ms cubic-bezier(0.22, 1, 0.36, 1);
  pointer-events: none;
}

.tab-btn {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 6px;
  height: 27px;
  padding: 0 9px;
  background: transparent;
  border: none;
  border-radius: var(--bm-radius-sm);
  color: var(--bm-text-secondary);
  font-size: 0.78125rem;
  font-weight: 500;
  cursor: pointer;
  transition: all var(--bm-transition-fast);
}

.tab-btn:hover {
  color: var(--bm-text-primary);
}

.tab-btn.active {
  color: var(--bm-text-primary);
}

.tab-btn i {
  font-size: 0.78125rem;
  filter: saturate(0.52);
  opacity: 0.72;
  transition:
    transform 260ms cubic-bezier(0.34, 1.56, 0.64, 1),
    filter 260ms ease,
    opacity 180ms ease;
}

.site-favicon {
  width: 13px;
  height: 13px;
  flex: 0 0 13px;
  border-radius: 3px;
  object-fit: contain;
  filter: saturate(0.85);
  opacity: 0.8;
  transition: transform 260ms cubic-bezier(0.34, 1.56, 0.64, 1), opacity 180ms ease;
}

.tab-btn:hover .site-favicon { opacity: 0.95; }
.tab-btn.active .site-favicon { transform: scale(1.08); opacity: 1; }

.tab-btn:hover i {
  filter: saturate(0.9);
  opacity: 0.9;
}

.tab-btn.active i {
  transform: translateX(1px) scale(1.1);
  filter: saturate(1);
  opacity: 1;
}

.browser-controls {
  display: flex;
  align-items: center;
  gap: 1px;
  padding: 1px;
  background: color-mix(in srgb, var(--bm-bg-hover) 52%, transparent);
  border-radius: var(--bm-radius-md);
  flex-shrink: 0;
}

.ctrl-btn {
  width: 25px;
  height: 25px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: var(--bm-radius-sm);
  color: var(--bm-text-secondary);
  font-size: 0.6875rem;
  cursor: pointer;
  transition: all var(--bm-transition-fast);
}

.ctrl-btn:hover:not(:disabled) {
  background: var(--bm-bg-card);
  color: var(--bm-text-primary);
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.06);
}

.ctrl-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.ctrl-btn:focus-visible,
.tab-btn:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--bm-accent-blue) 72%, transparent);
  outline-offset: 1px;
}

.address-bar {
  flex: 1;
  min-width: 160px;
  position: relative;
  display: flex;
  align-items: center;
}

.address-icon {
  position: absolute;
  left: 10px;
  color: var(--bm-text-muted);
  font-size: 0.6875rem;
  z-index: 1;
}

.address-bar input {
  width: 100%;
  height: 28px;
  padding: 0 0.65rem 0 1.9rem;
  background: color-mix(in srgb, var(--bm-bg-hover) 42%, transparent);
  border: 1px solid var(--bm-border-subtle);
  border-radius: var(--bm-radius-md);
  color: var(--bm-text-secondary);
  font-size: 0.71875rem;
  font-family: var(--bm-font-mono);
  cursor: default;
}

.leisure-boundary {
  display: flex;
  align-items: center;
  gap: var(--bm-space-sm);
  flex-shrink: 0;
}

.site-settings-wrap {
  position: relative;
  display: flex;
}

.site-settings {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 60;
  width: 252px;
  max-height: min(70vh, 520px);
  overflow-y: auto;
  padding: 7px;
  border: 1px solid var(--bm-border-default);
  border-radius: var(--bm-radius-md);
  background: var(--bm-bg-card);
  box-shadow: 0 14px 34px rgb(0 0 0 / 0.18);
}

.site-settings-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 3px 7px 6px;
  color: var(--bm-text-muted);
  font-size: 0.6875rem;
}

.site-settings-reset {
  padding: 0;
  border: 0;
  background: none;
  color: var(--bm-accent-blue);
  font: inherit;
  font-size: 0.6875rem;
  cursor: pointer;
}

.site-settings-row {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 29px;
  padding: 0 7px;
  border-radius: var(--bm-radius-sm);
  color: var(--bm-text-primary);
  font-size: 0.75rem;
  cursor: pointer;
}

.site-settings-row:hover {
  background: var(--bm-bg-hover);
}

.site-settings-row.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.site-settings-row input {
  width: 13px;
  height: 13px;
  margin: 0;
  accent-color: var(--bm-accent-blue);
  cursor: inherit;
}

.site-settings-row i {
  width: 14px;
  text-align: center;
  font-size: 0.75rem;
}

.site-settings-icon {
  width: 14px;
  height: 14px;
  flex: 0 0 14px;
  border-radius: 3px;
  object-fit: contain;
}

.site-settings-divider {
  height: 1px;
  margin: 6px 3px;
  background: var(--bm-border-subtle);
}

.custom-site-row { gap: 6px; }
.custom-site-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.custom-site-action {
  width: 22px;
  height: 22px;
  flex: 0 0 22px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--bm-text-muted);
  font-size: 0.625rem;
  cursor: pointer;
}
.custom-site-action:hover { background: var(--bm-bg-active); color: var(--bm-text-primary); }
.custom-site-action.danger:hover { color: var(--bm-accent-red); }
.custom-site-empty {
  margin: 2px 7px 4px;
  color: var(--bm-text-muted);
  font-size: 0.6875rem;
}
.custom-site-form {
  display: grid;
  gap: 6px;
  padding: 6px 3px 3px;
}
.custom-site-form input {
  width: 100%;
  height: 26px;
  padding: 0 8px;
  border: 1px solid var(--bm-border-default);
  border-radius: 6px;
  background: var(--bm-bg-card);
  color: var(--bm-text-primary);
  font: inherit;
  font-size: 0.6875rem;
}
.custom-site-form input:focus {
  outline: 2px solid color-mix(in srgb, var(--bm-accent-blue) 60%, transparent);
  outline-offset: 0;
  border-color: var(--bm-accent-blue);
}
.custom-site-error {
  margin: 0;
  color: var(--bm-accent-red);
  font-size: 0.65625rem;
  line-height: 1.4;
}
.custom-site-form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}
.custom-site-form-actions button {
  height: 25px;
  padding: 0 9px;
  border: 1px solid var(--bm-border-default);
  border-radius: 6px;
  background: var(--bm-bg-card);
  color: var(--bm-text-secondary);
  font: inherit;
  font-size: 0.6875rem;
  cursor: pointer;
}
.custom-site-form-actions button[type="submit"] {
  border-color: var(--bm-accent-blue);
  background: var(--bm-accent-blue);
  color: #fff;
}
.custom-site-form-actions button:disabled { opacity: 0.55; cursor: default; }

.site-settings-pop-enter-active,
.site-settings-pop-leave-active {
  transition: opacity 130ms ease, transform 130ms ease;
}

.site-settings-pop-enter-from,
.site-settings-pop-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

.usage-pill {
  display: flex;
  align-items: baseline;
  gap: 6px;
  height: 26px;
  padding: 0 4px;
  border: 1px solid transparent;
  border-radius: var(--bm-radius-md);
  background: transparent;
  white-space: nowrap;
}

.usage-pill span {
  font-size: 0.65625rem;
  color: var(--bm-text-muted);
}

.usage-pill strong {
  font-size: 0.78125rem;
  font-weight: 600;
  color: var(--bm-text-primary);
}

.usage-wrap {
  position: relative;
  display: flex;
}

.usage-pill {
  border: 0;
  font: inherit;
  cursor: pointer;
  transition: background 120ms ease;
}

.usage-pill:hover,
.usage-pill.active {
  background: var(--bm-bg-hover);
}

.usage-pill:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--bm-accent-blue) 55%, transparent);
  outline-offset: 1px;
}

.usage-panel {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 60;
  width: 300px;
  padding: 10px;
  border: 1px solid var(--bm-border-default);
  border-radius: var(--bm-radius-md);
  background: var(--bm-bg-card);
  box-shadow: 0 14px 34px rgb(0 0 0 / 0.18);
  color: var(--bm-text-primary);
}

.usage-panel-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 2px 4px 8px;
}

.usage-panel-head span {
  color: var(--bm-text-muted);
  font-size: 0.6875rem;
}

.usage-panel-head strong {
  font-size: 1rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.usage-limit-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px;
  color: var(--bm-text-secondary);
  font-size: 0.6875rem;
}

.usage-limit-row select {
  height: 24px;
  padding: 0 6px;
  border: 1px solid var(--bm-border-default);
  border-radius: 6px;
  background: var(--bm-bg-card);
  color: var(--bm-text-primary);
  font: inherit;
  font-size: 0.6875rem;
}

.usage-limit-meter {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 4px 2px;
}

.usage-limit-bar {
  flex: 1;
  height: 6px;
  border-radius: 3px;
  background: var(--bm-bg-active);
  overflow: hidden;
}

.usage-limit-bar span {
  display: block;
  height: 100%;
  border-radius: 3px;
  background: var(--bm-accent-blue);
  transition: width 240ms ease;
}

.usage-limit-bar span.over {
  background: var(--bm-accent-orange);
}

.usage-limit-meter small {
  width: 32px;
  text-align: right;
  color: var(--bm-text-muted);
  font-size: 0.625rem;
  font-variant-numeric: tabular-nums;
}

.usage-panel-section {
  margin-top: 9px;
  padding-top: 8px;
  border-top: 1px solid var(--bm-border-subtle);
}

.usage-panel-title {
  padding: 0 4px 6px;
  color: var(--bm-text-muted);
  font-size: 0.6875rem;
}

.usage-site-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.usage-site-row {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 26px;
  padding: 0 4px;
  border-radius: 5px;
  font-size: 0.75rem;
}

.usage-site-row:hover {
  background: var(--bm-bg-hover);
}

.usage-site-row i {
  width: 14px;
  text-align: center;
  font-size: 0.75rem;
}

.usage-site-icon {
  width: 14px;
  height: 14px;
  border-radius: 3px;
  object-fit: contain;
}

.usage-site-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.usage-site-row strong {
  font-weight: 500;
  color: var(--bm-text-secondary);
  font-variant-numeric: tabular-nums;
}

.usage-empty {
  margin: 0;
  padding: 0 4px 2px;
  color: var(--bm-text-muted);
  font-size: 0.6875rem;
}

.usage-week {
  display: flex;
  align-items: flex-end;
  gap: 6px;
  padding: 2px 4px 0;
  height: 64px;
}

.usage-day {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.usage-day-track {
  width: 100%;
  height: 44px;
  display: flex;
  align-items: flex-end;
  border-radius: 4px;
  background: color-mix(in srgb, var(--bm-bg-hover) 55%, transparent);
  overflow: hidden;
}

.usage-day-track span {
  width: 100%;
  border-radius: 3px 3px 0 0;
  background: color-mix(in srgb, var(--bm-accent-blue) 55%, transparent);
  transition: height 240ms ease;
}

.usage-day.today .usage-day-track span {
  background: var(--bm-accent-blue);
}

.usage-day small {
  color: var(--bm-text-muted);
  font-size: 0.625rem;
}

.usage-notice {
  position: absolute;
  left: 50%;
  bottom: 22px;
  transform: translateX(-50%);
  z-index: 40;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border: 1px solid var(--bm-border-default);
  border-radius: 999px;
  background: var(--bm-bg-card);
  box-shadow: 0 10px 30px rgb(0 0 0 / 0.16);
  color: var(--bm-text-primary);
  font-size: 0.75rem;
  white-space: nowrap;
}

.usage-notice i {
  color: var(--bm-accent-orange);
}

.usage-notice button {
  padding: 3px 8px;
  border: 0;
  border-radius: 999px;
  background: none;
  font: inherit;
  font-size: 0.6875rem;
  cursor: pointer;
}

.usage-notice-snooze {
  color: var(--bm-text-secondary);
}

.usage-notice-snooze:hover {
  background: var(--bm-bg-hover);
}

.usage-notice-close {
  background: var(--bm-accent-blue);
  color: #fff;
}

.usage-notice-close:hover {
  background: var(--bm-accent-blue-hover);
}

.usage-notice-enter-active,
.usage-notice-leave-active {
  transition: opacity 160ms ease, transform 160ms ease;
}

.usage-notice-enter-from,
.usage-notice-leave-to {
  opacity: 0;
  transform: translate(-50%, 6px);
}

.webview-container {
  flex: 1;
  min-height: 0;
  background: var(--bm-bg-card);
  border: 1px solid var(--bm-border-subtle);
  border-radius: var(--bm-radius-lg);
  overflow: hidden;
  position: relative;
  box-shadow: 0 4px 18px rgba(15, 23, 42, 0.055);
}

.entertainment-webview {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  visibility: hidden;
  opacity: 0;
  transition: opacity 0.3s ease, visibility 0.3s ease;
}

.entertainment-webview.active {
  visibility: visible;
  opacity: 1;
}

@media (max-width: 1180px) {
  .entertainment-remote,
  .remote-primary,
  .leisure-boundary {
    flex-wrap: wrap;
  }

  .leisure-boundary {
    width: 100%;
  }

  .address-bar {
    min-width: 240px;
  }
}

@media (max-width: 720px) {
  .entertainment-view {
    padding: var(--bm-space-sm);
  }

  .remote-primary,
  .leisure-boundary {
    align-items: stretch;
    flex-direction: column;
  }

  .site-switcher,
  .browser-controls,
  .address-bar {
    width: 100%;
  }

  .tab-btn {
    flex: 1;
    justify-content: center;
  }
}
</style>
