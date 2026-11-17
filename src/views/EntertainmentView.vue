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
            @click.stop="settingsOpen = !settingsOpen"
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
        <div class="usage-pill" title="进入娱乐中心且窗口可见时累计">
          <span>今日休闲</span>
          <strong>{{ formatDuration(todayUsageSeconds) }}</strong>
        </div>
      </div>
    </div>

    <!-- Webview Container -->
    <div class="webview-container">
      <webview
        v-for="site in visibleSites"
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

const route = useRoute()

const activeSite = computed(() => sites.value.find(s => s.id === currentSite.value))
const isEntertainmentActive = computed(() => route.path === '/entertainment')

let usageTicker = null

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

const switchSite = (siteId) => {
  if (!visibleSites.value.some(site => site.id === siteId)) return
  currentSite.value = siteId
  scheduleSiteGliderUpdate()
  const site = sites.value.find(s => s.id === siteId)
  if (site) currentUrl.value = site.url
  const webview = webviewRefs.value[siteId]
  const webviewUrl = webview?.getURL?.()
  if (webviewUrl && webviewUrl !== 'about:blank') currentUrl.value = webviewUrl
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
  if (customForm.id === site.id) cancelCustomSite()
  if (currentSite.value === site.id) {
    const fallback = visibleSites.value[0]
    if (fallback) switchSite(fallback.id)
  }
  scheduleSiteGliderUpdate()
}

const onSettingsPointerDown = event => {
  if (!settingsOpen.value) return
  if (event.target?.closest?.('.site-settings-wrap')) return
  settingsOpen.value = false
}

const onSettingsKeydown = event => {
  if (event.key === 'Escape' && settingsOpen.value) settingsOpen.value = false
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

const bindWebviewEvents = () => {
  sites.value.forEach(site => {
    const webview = webviewRefs.value[site.id]
    if (webview && !webview._eventsBound) {
      webview.addEventListener('dom-ready', () => {
        injectPopupInterceptor(webview)
      })
      webview.addEventListener('did-navigate', (e) => {
        if (currentSite.value === site.id) updateCurrentUrl(e.url)
      })
      webview.addEventListener('did-navigate-in-page', (e) => {
        if (currentSite.value === site.id) updateCurrentUrl(e.url)
      })
      webview.addEventListener('did-start-loading', () => {
        if (currentSite.value === site.id) isLoading.value = true
      })
      webview.addEventListener('did-stop-loading', () => {
        if (currentSite.value === site.id) {
          isLoading.value = false
          updateNavigationState()
        }
      })
      webview.addEventListener('did-finish-load', () => {
        injectPopupInterceptor(webview)
        if (currentSite.value === site.id) updateNavigationState()
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
        if (currentSite.value === site.id) updateCurrentUrl(e.url)
      })
      webview._eventsBound = true
    }
  })
}

const getDateKey = () => {
  const date = new Date()
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const getUsageStorageKey = () => `bongmaster:entertainment-usage:${getDateKey()}`

let usageDateKey = ''

const loadTodayUsage = () => {
  usageDateKey = getDateKey()
  try {
    const parsed = Number(localStorage.getItem(getUsageStorageKey()) || 0)
    todayUsageSeconds.value = Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 86400) : 0
  } catch {
    todayUsageSeconds.value = 0
  }
}

const saveTodayUsage = () => {
  if (usageDateKey !== getDateKey()) return
  try {
    localStorage.setItem(getUsageStorageKey(), String(todayUsageSeconds.value))
  } catch {}
}

const formatDuration = (seconds) => {
  const safeSeconds = Math.max(0, seconds)
  const hours = Math.floor(safeSeconds / 3600)
  const minutes = Math.floor((safeSeconds % 3600) / 60)
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m`
  return `${safeSeconds}s`
}

const tickUsage = () => {
  const dateKey = getDateKey()
  if (dateKey !== usageDateKey) {
    usageDateKey = dateKey
    todayUsageSeconds.value = 0
  }
  if (!isEntertainmentActive.value || document.hidden) return
  todayUsageSeconds.value += 1
  if (todayUsageSeconds.value % 5 === 0) saveTodayUsage()
}

const handleVisibilityChange = () => {
  if (document.hidden) saveTodayUsage()
}

watch(visibleSites, () => {
  scheduleSiteGliderUpdate()
  nextTick(() => {
    window.setTimeout(bindWebviewEvents, 0)
  })
})

onMounted(() => {
  scheduleSiteGliderUpdate()
  window.addEventListener('resize', scheduleSiteGliderUpdate)
  document.addEventListener('pointerdown', onSettingsPointerDown)
  document.addEventListener('keydown', onSettingsKeydown)
  loadTodayUsage()
  setTimeout(bindWebviewEvents, 500)
  usageTicker = window.setInterval(tickUsage, 1000)
  document.addEventListener('visibilitychange', handleVisibilityChange)
})

onUnmounted(() => {
  window.removeEventListener('resize', scheduleSiteGliderUpdate)
  document.removeEventListener('pointerdown', onSettingsPointerDown)
  document.removeEventListener('keydown', onSettingsKeydown)
  if (usageTicker) window.clearInterval(usageTicker)
  saveTodayUsage()
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  Object.values(webviewRefs.value).forEach(webview => {
    if (webview) webview._eventsBound = false
  })
})
</script>

<style scoped>
.entertainment-view {
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
