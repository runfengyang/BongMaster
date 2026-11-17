<template>
  <div id="app">
    <!-- Navigation -->
    <nav class="bm-navbar">
      <div class="bm-navbar-brand">
        <div class="bm-brand-link">
          <button
            type="button"
            class="bm-brand-icon"
            aria-label="BongMaster 主页"
            title="BongMaster"
            @click="handleBrandIconClick"
            @dblclick.stop.prevent="playBrandEasterEgg"
          >
            <svg class="bm-brand-mark" viewBox="0 0 32 32" aria-hidden="true">
              <path class="bm-brand-mark-ghost" d="M9.5 6.5H18c4 0 6.5 2.1 6.5 5.2 0 2.3-1.4 3.8-3.5 4.5 3 .6 5 2.6 5 5.5 0 3.4-2.7 5.6-7 5.6H9.5Z" />
              <path class="bm-brand-mark-path" d="M9.5 6.5H18c4 0 6.5 2.1 6.5 5.2 0 2.3-1.4 3.8-3.5 4.5 3 .6 5 2.6 5 5.5 0 3.4-2.7 5.6-7 5.6H9.5Z" />
              <circle class="bm-brand-mark-dot" cx="25.6" cy="7.2" r="1.5" />
            </svg>
          </button>
          <router-link to="/" class="bm-brand-text-link">
            <span class="bm-brand-wordmark" role="img" aria-label="BongMaster">
              <span class="bm-brand-word"><span class="bm-brand-letter" style="--i:0">B</span><span class="bm-brand-letter" style="--i:1">o</span><span class="bm-brand-letter" style="--i:2">n</span><span class="bm-brand-letter" style="--i:3">g</span></span>
              <span class="bm-brand-word bm-brand-word-master"><span class="bm-brand-letter bm-brand-accent" style="--i:4">M</span><span class="bm-brand-letter" style="--i:5">a</span><span class="bm-brand-letter" style="--i:6">s</span><span class="bm-brand-letter" style="--i:7">t</span><span class="bm-brand-letter" style="--i:8">e</span><span class="bm-brand-letter" style="--i:9">r</span></span>
              <span class="bm-brand-sup" aria-hidden="true"></span>
            </span>
          </router-link>
        </div>
      </div>

      <div ref="navRef" class="bm-navbar-nav">
        <span class="bm-nav-glider" :style="navGliderStyle"></span>
        <router-link
          v-for="item in navItems"
          :key="item.path"
          :ref="el => setNavLinkRef(el, item.path)"
          :to="item.path"
          class="bm-nav-link"
          :class="{ active: isActive(item.path) }"
        >
          <i :class="item.icon"></i>
          <span>{{ item.name }}</span>
        </router-link>
      </div>

      <div class="bm-navbar-actions">
        <SalaryWidget v-if="salaryStore.visible" />

        <button
          class="bm-theme-toggle"
          @click="toggleThemeMenu"
          title="切换主题"
        >
          <i class="fas fa-palette"></i>
        </button>

        <transition name="theme-dropdown">
          <div v-if="showThemeMenu" class="bm-theme-menu" @click.stop>
            <div class="bm-theme-header">选择主题</div>
            <button
              v-for="theme in themeStore.themes"
              :key="theme.id"
              class="bm-theme-option"
              :class="{ active: themeStore.currentTheme === theme.id }"
              @click="selectTheme(theme.id)"
            >
              <span class="bm-theme-dot" :style="{ background: theme.color }"></span>
              <span class="bm-theme-copy">
                <span class="bm-theme-name">{{ theme.name }}</span>
                <span class="bm-theme-tone">{{ theme.tone }}</span>
              </span>
              <i v-if="themeStore.currentTheme === theme.id" class="fas fa-check"></i>
            </button>

            <button
              type="button"
              class="bm-theme-option bm-theme-visibility"
              :aria-pressed="salaryStore.visible"
              @click="toggleSalaryBar"
            >
              <span class="bm-theme-checkbox" :class="{ checked: salaryStore.visible }" aria-hidden="true">
                <i v-if="salaryStore.visible" class="fas fa-check"></i>
              </span>
              <span>显示收入条</span>
            </button>
          </div>
        </transition>
      </div>
    </nav>

    <!-- Main Content -->
    <div class="bm-main">
      <router-view v-slot="{ Component }" v-if="route.path !== '/entertainment'">
        <component :is="Component" />
      </router-view>

      <!-- Entertainment layer: persistent -->
      <div
        v-if="hasOpenedEntertainment"
        class="bm-entertainment-layer"
        :class="{ hidden: route.path !== '/entertainment' }"
      >
        <EntertainmentView />
      </div>
    </div>

    <UndoToast />

    <div v-if="storageNotice" class="bm-salary-notice" role="status" aria-live="polite">
      <span>{{ salaryStore.storageError }}</span>
      <button
        type="button"
        class="bm-salary-notice-close"
        title="关闭"
        aria-label="关闭提示"
        @click="storageNotice = false"
      >
        <i class="fas fa-times" aria-hidden="true"></i>
      </button>
    </div>

    <div v-if="brandEggVisible" class="bm-brand-egg" aria-hidden="true" @click="closeBrandEgg">
      <div class="bm-brand-egg-stage">
        <div class="bm-brand-egg-halo"></div>
        <svg class="bm-brand-egg-frame" viewBox="0 0 320 320">
          <circle class="egg-ring egg-ring-outer" cx="160" cy="160" r="148" />
          <circle class="egg-ring egg-ring-inner" cx="160" cy="160" r="128" />
          <path class="egg-diamond" d="M160 12 308 160 160 308 12 160Z" />
          <path class="egg-flourish" d="M160 32v20M160 268v20M32 160h20M268 160h20" />
        </svg>
        <div class="bm-brand-egg-initial">
          <span class="bm-brand-egg-letter">B</span>
        </div>
        <p class="bm-brand-egg-word">BONGMASTER</p>
        <span v-for="index in 8" :key="index" class="bm-brand-egg-spark" :style="{ '--i': index }"></span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, nextTick, onMounted, onUnmounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useThemeStore } from '@stores/theme-store'
import { useProjectStore } from '@stores/project-store'
import { useSalaryStore } from '@stores/salary-store'
import EntertainmentView from '@views/EntertainmentView.vue'
import UndoToast from '@components/UndoToast.vue'
import SalaryWidget from '@components/SalaryWidget.vue'
import { startMacAutoSync, stopMacAutoSync } from '@composables/useMacAutoSync'

const themeStore = useThemeStore()
const projectStore = useProjectStore()
const salaryStore = useSalaryStore()
const route = useRoute()
const router = useRouter()
const showThemeMenu = ref(false)
const navRef = ref(null)
const navLinkRefs = ref({})
const navGliderStyle = ref({})
const hasOpenedEntertainment = ref(route.path === '/entertainment')
const storageNotice = ref(false)
let storageNoticeTimer = null
const brandEggVisible = ref(false)
let brandEggTimer = null
let brandClickTimer = null

const navItems = [
  { path: '/', name: '首页', icon: 'fas fa-home' },
  { path: '/projects', name: '项目', icon: 'fas fa-folder' },
  { path: '/calendar', name: '日历', icon: 'fas fa-calendar-alt' },
  { path: '/tasks', name: '任务', icon: 'fas fa-tasks' },
  { path: '/reminders', name: '提醒', icon: 'fas fa-bell' },
  { path: '/habits', name: '习惯', icon: 'fas fa-fire' },
  { path: '/notepad', name: '便签', icon: 'fas fa-sticky-note' },
  { path: '/entertainment', name: '娱乐', icon: 'fas fa-gamepad' }
]

const isActive = (path) => {
  if (path === '/') return route.path === '/'
  return route.path.startsWith(path)
}

const closeBrandEgg = () => {
  brandEggVisible.value = false
  if (brandEggTimer) {
    clearTimeout(brandEggTimer)
    brandEggTimer = null
  }
}

const playBrandEasterEgg = () => {
  if (brandClickTimer) {
    clearTimeout(brandClickTimer)
    brandClickTimer = null
  }
  if (brandEggVisible.value) return
  brandEggVisible.value = true
  if (brandEggTimer) clearTimeout(brandEggTimer)
  brandEggTimer = setTimeout(() => {
    brandEggVisible.value = false
    brandEggTimer = null
  }, 2800)
}

const handleBrandIconClick = () => {
  if (brandClickTimer) clearTimeout(brandClickTimer)
  brandClickTimer = setTimeout(() => {
    brandClickTimer = null
    router.push('/')
  }, 280)
}

const setNavLinkRef = (el, path) => {
  const node = el?.$el || el
  if (node) navLinkRefs.value[path] = node
}

const updateNavGlider = () => {
  const nav = navRef.value
  const activeItem = navItems.find(item => isActive(item.path))
  const activeLink = activeItem ? navLinkRefs.value[activeItem.path] : null
  if (!nav || !activeLink) return

  const navRect = nav.getBoundingClientRect()
  const linkRect = activeLink.getBoundingClientRect()
  navGliderStyle.value = {
    width: `${linkRect.width}px`,
    // nav 可横向滚动后，绝对定位的滑块的参照点是未滚动的 padding box。
    transform: `translateX(${linkRect.left - navRect.left + nav.scrollLeft}px) translateY(-50%)`
  }
}

const scheduleNavGliderUpdate = () => {
  nextTick(() => {
    window.requestAnimationFrame(updateNavGlider)
  })
}

const toggleThemeMenu = () => {
  showThemeMenu.value = !showThemeMenu.value
  document.querySelector('#salary-panel')?.hidePopover()
}

const toggleSalaryBar = () => {
  salaryStore.setVisible(!salaryStore.visible)
}

const selectTheme = (themeId) => {
  themeStore.setTheme(themeId)
  showThemeMenu.value = false
}

watch(
  () => themeStore.currentTheme,
  (themeId) => {
    document.documentElement.dataset.theme = themeId
  },
  { immediate: true }
)

const handleClickOutside = (event) => {
  if (event.target.closest('.salary-bar')) {
    showThemeMenu.value = false
    return
  }
  const dropdown = event.target.closest('.bm-navbar-actions')
  if (!dropdown) {
    showThemeMenu.value = false
  }
}

watch(
  () => salaryStore.storageError,
  (message) => {
    if (!message) return
    storageNotice.value = true
    if (storageNoticeTimer) clearTimeout(storageNoticeTimer)
    storageNoticeTimer = setTimeout(() => {
      storageNoticeTimer = null
      storageNotice.value = false
    }, 6000)
  },
  { immediate: true }
)

onMounted(() => {
  scheduleNavGliderUpdate()
  window.addEventListener('resize', scheduleNavGliderUpdate)
  document.addEventListener('click', handleClickOutside)
  projectStore.fetchProjects()
  startMacAutoSync()
})

onUnmounted(() => {
  window.removeEventListener('resize', scheduleNavGliderUpdate)
  document.removeEventListener('click', handleClickOutside)
  stopMacAutoSync()
  if (storageNoticeTimer) clearTimeout(storageNoticeTimer)
  if (brandEggTimer) clearTimeout(brandEggTimer)
  if (brandClickTimer) clearTimeout(brandClickTimer)
})

watch(() => route.path, (path) => {
  if (path === '/entertainment') {
    hasOpenedEntertainment.value = true
  }
  scheduleNavGliderUpdate()
})
</script>

<style>
/* ============================================
   App Root Styles
   ============================================ */
#app {
  min-height: 100vh;
  background: var(--bm-bg-page);
  color: var(--bm-text-primary);
}

/* ============================================
   Navigation Bar
   ============================================ */
.bm-navbar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: var(--bm-navbar-height);
  display: flex;
  align-items: center;
  padding: 0 18px;
  background: var(--bm-navbar-overlay);
  background-size: cover;
  background-position: var(--bm-navbar-position);
  background-repeat: no-repeat;
  border-bottom: 1px solid var(--bm-border-default);
  z-index: 1000;
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.28), 0 6px 18px rgba(55, 53, 47, 0.035);
  backdrop-filter: blur(14px) saturate(1.06);
  overflow: visible;
}

.bm-navbar::before,
.bm-navbar::after {
  content: '';
  position: absolute;
  pointer-events: none;
}

.bm-navbar::before {
  inset: 0;
  background:
    linear-gradient(90deg, transparent 0 18%, rgba(255, 255, 255, 0.34) 38%, transparent 58%),
    repeating-linear-gradient(90deg, rgba(55, 53, 47, 0.035) 0 1px, transparent 1px 18px);
  opacity: 0.4;
  mix-blend-mode: soft-light;
}

.bm-navbar::after {
  right: var(--bm-space-xl);
  bottom: -1px;
  left: var(--bm-space-xl);
  height: 1px;
  background:
    linear-gradient(90deg, transparent, color-mix(in srgb, var(--bm-accent-blue) 42%, transparent), transparent);
  animation: navFineScan 5200ms steps(12, end) infinite;
}

.bm-navbar-brand {
  position: relative;
  z-index: 2;
  margin-right: 20px;
}

.bm-brand-link {
  display: flex;
  align-items: center;
  gap: 3px;
  text-decoration: none;
  color: var(--bm-text-primary);
}

.bm-brand-icon {
  position: relative;
  overflow: hidden;
  width: 27px;
  height: 27px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  background: transparent;
  border-radius: var(--bm-radius-md);
  color: var(--bm-accent-blue);
  font: inherit;
  border: 1px solid transparent;
  box-shadow: none;
  cursor: pointer;
}

.bm-brand-icon::after {
  content: '';
  position: absolute;
  inset: 5px;
  border: 1px dashed color-mix(in srgb, var(--bm-accent-blue) 42%, transparent);
  border-radius: 4px;
  opacity: 0;
  transform: rotate(0deg) scale(0.82);
  transition: all 260ms cubic-bezier(0.34, 1.56, 0.64, 1);
}

.bm-brand-link:hover .bm-brand-icon::after {
  opacity: 0.9;
  transform: rotate(45deg) scale(1);
}

.bm-brand-mark {
  position: relative;
  z-index: 1;
  width: 18px;
  height: 18px;
  display: block;
  transition: transform 260ms cubic-bezier(0.34, 1.56, 0.64, 1);
}

.bm-brand-mark-ghost,
.bm-brand-mark-path {
  fill: none;
  stroke: currentColor;
  stroke-width: 2.1;
  stroke-linejoin: round;
  stroke-linecap: round;
}

.bm-brand-mark-ghost {
  opacity: 0.16;
  transform: translate(0.8px, 0.8px);
}

.bm-brand-mark-dot {
  fill: currentColor;
  opacity: 0.55;
}

.bm-brand-link:hover .bm-brand-mark {
  transform: rotate(-6deg) scale(1.08);
}

.bm-brand-text-link {
  display: flex;
  align-items: center;
  color: inherit;
  text-decoration: none;
}

.bm-brand-wordmark {
  display: inline-block;
  color: var(--bm-text-primary);
  font-family: var(--bm-font-display);
  font-size: 1.125rem;
  font-weight: 600;
  letter-spacing: -0.03em;
  line-height: 1.1;
  white-space: nowrap;
}

.bm-brand-word { display: inline; }
.bm-brand-word-master { margin-left: 0.1em; font-style: italic; font-weight: 500; }
.bm-brand-letter { display: inline-block; }

.bm-brand-accent {
  color: var(--bm-accent-blue);
  transition: transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1);
}

.bm-brand-link:hover .bm-brand-accent {
  transform: translateY(-1px) scale(1.06);
}

.bm-brand-sup {
  display: inline-block;
  width: max(4px, 0.18em);
  height: max(4px, 0.18em);
  margin-left: 0.16em;
  border-radius: 50%;
  background: var(--bm-accent-blue);
  opacity: 0;
  visibility: hidden;
  transform: translateY(-0.3em) scale(0.4) rotate(-30deg);
  transition:
    opacity 180ms ease,
    transform 260ms cubic-bezier(0.2, 0.8, 0.2, 1),
    visibility 0s linear 260ms;
}

.bm-brand-link:hover .bm-brand-sup,
.bm-brand-link:focus-within .bm-brand-sup {
  opacity: 1;
  visibility: visible;
  transform: translateY(-0.6em) rotate(45deg) scale(1.25);
  transition:
    opacity 160ms ease,
    transform 260ms cubic-bezier(0.2, 0.8, 0.2, 1),
    visibility 0s;
}

@media (hover: none) {
  .bm-brand-sup {
    opacity: 1;
    visibility: visible;
    transform: translateY(-0.52em);
  }
}

@media (prefers-reduced-motion: no-preference) {
  .bm-brand-letter {
    animation: bmBrandLetterIn 380ms cubic-bezier(0.2, 0.8, 0.2, 1) backwards;
    animation-delay: calc(var(--i) * 16ms);
  }
}

@keyframes bmBrandLetterIn {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}

@media (prefers-reduced-motion: reduce) {
  .bm-brand-link:hover .bm-brand-mark { transform: none; }
  .bm-brand-link:hover .bm-brand-accent { transform: none; }
  .bm-brand-sup {
    transform: translateY(-0.52em);
    transition: opacity 120ms ease, visibility 0s linear 120ms;
  }
  .bm-brand-link:hover .bm-brand-sup,
  .bm-brand-link:focus-within .bm-brand-sup {
    transform: translateY(-0.52em);
    transition: opacity 120ms ease, visibility 0s;
  }
}

/* Navigation Links */
.bm-navbar-nav {
  position: relative;
  display: flex;
  align-items: center;
  gap: 1px;
  flex: 1;
  min-width: 0;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
  z-index: 2;
}

.bm-navbar-nav::-webkit-scrollbar {
  display: none;
}

.bm-nav-glider {
  position: absolute;
  top: 50%;
  left: 0;
  z-index: 0;
  height: 30px;
  background: color-mix(in srgb, var(--bm-bg-hover) 72%, transparent);
  border: 1px solid transparent;
  border-radius: var(--bm-radius-md);
  box-shadow: none;
  transform: translateY(-50%);
  transition:
    transform 280ms cubic-bezier(0.22, 1, 0.36, 1),
    width 280ms cubic-bezier(0.22, 1, 0.36, 1);
  pointer-events: none;
}

.bm-nav-link {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
  min-height: 30px;
  padding: 4px 9px;
  color: var(--bm-text-secondary);
  text-decoration: none;
  font-size: 0.78125rem;
  font-weight: 500;
  white-space: nowrap;
  border-radius: var(--bm-radius-md);
  transition: all var(--bm-transition-fast);
}

.bm-nav-link:hover {
  color: var(--bm-text-primary);
  transform: translateY(-1px);
}

.bm-nav-link.active {
  color: var(--bm-text-primary);
}

.bm-nav-link i {
  font-size: 0.8125rem;
  transition:
    transform 260ms cubic-bezier(0.34, 1.56, 0.64, 1),
    color 180ms ease;
}

.bm-nav-link.active i {
  transform: translateX(2px) scale(1.08);
  color: var(--bm-accent-blue);
}

/* Actions */
.bm-navbar-actions {
  position: relative;
  display: flex;
  align-items: center;
  flex-shrink: 0;
  gap: 7px;
  z-index: 3;
}

.bm-theme-toggle {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: var(--bm-radius-md);
  color: var(--bm-text-secondary);
  font-size: 0.9375rem;
  cursor: pointer;
  transition: all var(--bm-transition-fast);
}

.bm-theme-toggle:hover {
  background: var(--bm-bg-hover);
  color: var(--bm-text-primary);
  transform: rotate(-8deg) scale(1.04);
}

/* Theme Dropdown */
.bm-theme-menu {
  position: absolute;
  top: calc(100% + var(--bm-space-sm));
  right: 0;
  min-width: 220px;
  overflow: hidden;
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--bm-bg-hover) 42%, transparent), transparent 42%),
    var(--bm-bg-card);
  border: 1px solid var(--bm-border-default);
  border-radius: var(--bm-radius-md);
  box-shadow: var(--bm-shadow-md);
  padding: var(--bm-space-sm);
  z-index: 1001;
}

.bm-theme-menu::before {
  content: '';
  position: absolute;
  inset: 0 0 auto;
  height: 2px;
  background:
    linear-gradient(90deg, var(--bm-accent-blue), var(--bm-accent-teal), var(--bm-accent-yellow), var(--bm-accent-orange));
  opacity: 0.74;
}

.bm-theme-header {
  padding: var(--bm-space-sm) var(--bm-space-md);
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--bm-text-muted);
  border-bottom: 1px solid var(--bm-border-subtle);
  margin-bottom: var(--bm-space-sm);
}

.bm-theme-option {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--bm-space-sm);
  width: 100%;
  padding: 10px var(--bm-space-md);
  background: transparent;
  border: none;
  border-radius: var(--bm-radius-sm);
  color: var(--bm-text-secondary);
  font-size: 0.875rem;
  cursor: pointer;
  transition: all var(--bm-transition-fast);
  text-align: left;
}

.bm-theme-option:hover {
  background: var(--bm-bg-hover);
  color: var(--bm-text-primary);
  transform: translateX(2px);
}

.bm-theme-option.active {
  color: var(--bm-text-primary);
  background: var(--bm-bg-hover);
}

.bm-theme-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  flex: 0 0 auto;
  border: 1px solid var(--bm-border-subtle);
  box-shadow: 0 0 0 3px color-mix(in srgb, currentColor 7%, transparent);
}

.bm-theme-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  line-height: 1.25;
}

.bm-theme-name {
  color: currentColor;
}

.bm-theme-tone {
  color: var(--bm-text-muted);
  font-size: 0.72rem;
}

.bm-theme-option i {
  margin-left: auto;
  font-size: 0.75rem;
  color: var(--bm-accent-blue);
  flex: 0 0 auto;
  animation: themeCheckIn 220ms cubic-bezier(0.34, 1.56, 0.64, 1);
}

.bm-theme-visibility {
  margin-top: var(--bm-space-xs);
  padding-top: 10px;
  border-top: 1px solid var(--bm-border-subtle);
  border-radius: 0 0 var(--bm-radius-sm) var(--bm-radius-sm);
}

.bm-theme-checkbox {
  flex: 0 0 auto;
  width: 14px;
  height: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bm-bg-card);
  border: 1px solid var(--bm-border-strong);
  border-radius: var(--bm-radius-sm);
  color: var(--bm-accent-blue);
}

.bm-theme-checkbox.checked {
  background: color-mix(in srgb, var(--bm-accent-blue) 12%, transparent);
  border-color: var(--bm-accent-blue);
}

.bm-theme-checkbox i {
  margin-left: 0;
  font-size: 0.5625rem;
  animation: none;
}

.bm-salary-notice {
  position: fixed;
  top: calc(var(--bm-navbar-height) + 12px);
  right: var(--bm-space-xl);
  z-index: 1200;
  display: flex;
  align-items: flex-start;
  gap: var(--bm-space-sm);
  max-width: min(360px, calc(100vw - 32px));
  padding: 10px 10px 10px 12px;
  background: var(--bm-bg-card);
  border: 1px solid var(--bm-border-default);
  border-left: 2px solid var(--bm-accent-orange);
  border-radius: var(--bm-radius-md);
  box-shadow: var(--bm-shadow-md);
  color: var(--bm-text-secondary);
  font-size: 0.8125rem;
  line-height: 1.45;
}

.bm-salary-notice-close {
  flex: 0 0 auto;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-left: auto;
  background: transparent;
  border: 0;
  border-radius: var(--bm-radius-sm);
  color: var(--bm-text-muted);
  font-size: 0.625rem;
  cursor: pointer;
}

.bm-salary-notice-close:hover {
  background: var(--bm-bg-hover);
  color: var(--bm-text-primary);
}

.bm-salary-notice-close:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--bm-accent-blue) 54%, transparent);
  outline-offset: 1px;
}

@keyframes themeCheckIn {
  from {
    opacity: 0;
    transform: translateX(-4px) scale(0.82);
  }
  to {
    opacity: 1;
    transform: translateX(0) scale(1);
  }
}

/* Theme dropdown animation */
.theme-dropdown-enter-active,
.theme-dropdown-leave-active {
  transition: all var(--bm-transition-fast);
}

.theme-dropdown-enter-from,
.theme-dropdown-leave-to {
  opacity: 0;
  transform: translateY(-8px) scale(0.98);
}

/* Main Content */
.bm-main {
  padding-top: var(--bm-navbar-height);
  min-height: 100vh;
  position: relative;
  z-index: 1;
}

/* Entertainment Layer */
.bm-entertainment-layer {
  position: fixed;
  top: var(--bm-navbar-height);
  left: 0;
  width: 100vw;
  height: calc(100vh - var(--bm-navbar-height));
  background: var(--bm-bg-page);
  z-index: 100;
  overflow: hidden;
}

.bm-entertainment-layer.hidden {
  left: -100vw;
  opacity: 0;
  pointer-events: none;
  z-index: -1;
}

/* Responsive */
@media (max-width: 1050px) {
  .bm-brand-wordmark {
    display: none;
  }
}

@media (max-width: 768px) {
  .bm-navbar {
    padding: 0 var(--bm-space-md);
  }

  .bm-brand-wordmark {
    display: none;
  }

  .bm-nav-link span {
    display: none;
  }
}

@keyframes navFineScan {
  0%, 100% { opacity: 0.2; transform: translateX(-2%); }
  50% { opacity: 0.78; transform: translateX(2%); }
}

/* BongMaster 彩蛋 */
.bm-brand-egg {
  position: fixed;
  inset: 0;
  z-index: 5000;
  display: grid;
  place-items: center;
  background: radial-gradient(circle at 50% 46%, rgb(255 249 237 / 0.08) 0, rgb(30 24 16 / 0.44) 68%);
  backdrop-filter: blur(2px);
  user-select: none;
  animation: bmEggOverlay 2.8s ease both;
}

.bm-brand-egg-stage {
  position: relative;
  width: min(78vw, 420px);
  aspect-ratio: 1;
  display: grid;
  place-items: center;
  animation: bmEggStage 2.8s cubic-bezier(0.2, 0.8, 0.2, 1) both;
}

.bm-brand-egg-halo {
  position: absolute;
  inset: 9%;
  border-radius: 50%;
  background-image: radial-gradient(circle, rgb(176 138 74 / 0.6) 1px, transparent 1.4px);
  background-size: 6px 6px;
  -webkit-mask: radial-gradient(circle, transparent 57%, #000 58%, #000 67%, transparent 68%);
  mask: radial-gradient(circle, transparent 57%, #000 58%, #000 67%, transparent 68%);
  opacity: 0;
  animation: bmEggHalo 2.6s ease both;
}

.bm-brand-egg-frame {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  color: #a8844a;
  overflow: visible;
}

.egg-ring {
  fill: none;
  stroke: currentColor;
}

.egg-ring-outer {
  stroke-width: 0.8;
  stroke-dasharray: 3 7;
  opacity: 0;
  transform-box: view-box;
  transform-origin: 160px 160px;
  animation: bmEggRing 2.8s linear both;
}

.egg-ring-inner {
  stroke-width: 1.1;
  stroke-dasharray: 810;
  stroke-dashoffset: 810;
  opacity: 0;
  animation: bmEggDraw 1.5s cubic-bezier(0.2, 0.8, 0.2, 1) 0.15s both;
}

.egg-diamond {
  fill: none;
  stroke: currentColor;
  stroke-width: 0.9;
  stroke-dasharray: 900;
  stroke-dashoffset: 900;
  opacity: 0;
  animation: bmEggDraw 1.8s cubic-bezier(0.2, 0.8, 0.2, 1) 0.05s both;
}

.egg-flourish {
  fill: none;
  stroke: currentColor;
  stroke-width: 1.2;
  stroke-linecap: round;
  opacity: 0;
  transform-box: view-box;
  transform-origin: 160px 160px;
  animation: bmEggFlourish 1.4s ease 0.55s both;
}

.bm-brand-egg-initial {
  position: relative;
  z-index: 2;
  display: grid;
  place-items: center;
}

.bm-brand-egg-letter {
  display: block;
  font-family: var(--bm-font-display);
  font-size: clamp(110px, 28vw, 190px);
  font-weight: 700;
  line-height: 0.82;
  letter-spacing: -0.045em;
  background: linear-gradient(105deg, #6f552c 0%, #b88f4f 18%, #fff1cf 34%, #c9a35e 48%, #f8e9c6 62%, #8a6a38 82%, #d8b877 100%);
  background-size: 260% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  filter: drop-shadow(0 2px 0 rgb(255 248 229 / 0.45)) drop-shadow(0 12px 24px rgb(70 48 18 / 0.35));
  animation: bmEggLetter 2.6s cubic-bezier(0.2, 0.8, 0.2, 1) both, bmEggGlint 2.1s ease-in-out 0.35s both;
}

.bm-brand-egg-word {
  position: absolute;
  bottom: 13%;
  margin: 0;
  color: #8a6a38;
  font-family: var(--bm-font-ui);
  font-size: clamp(9px, 1.3vw, 11px);
  font-weight: 600;
  letter-spacing: 0.46em;
  text-indent: 0.46em;
  opacity: 0;
  animation: bmEggWord 2.5s ease both;
}

.bm-brand-egg-spark {
  position: absolute;
  width: 5px;
  height: 5px;
  margin: -2.5px 0 0 -2.5px;
  border-radius: 50%;
  background: #d8b877;
  box-shadow: 0 0 9px rgb(216 184 119 / 0.8);
  opacity: 0;
  animation: bmEggSpark 1.8s ease-out both;
}

.bm-brand-egg-spark:nth-of-type(1) { left: 50%; top: 5%; animation-delay: 0.3s; }
.bm-brand-egg-spark:nth-of-type(2) { left: 79%; top: 21%; animation-delay: 0.36s; }
.bm-brand-egg-spark:nth-of-type(3) { left: 95%; top: 50%; animation-delay: 0.42s; }
.bm-brand-egg-spark:nth-of-type(4) { left: 79%; top: 79%; animation-delay: 0.48s; }
.bm-brand-egg-spark:nth-of-type(5) { left: 50%; top: 95%; animation-delay: 0.54s; }
.bm-brand-egg-spark:nth-of-type(6) { left: 21%; top: 79%; animation-delay: 0.6s; }
.bm-brand-egg-spark:nth-of-type(7) { left: 5%; top: 50%; animation-delay: 0.66s; }
.bm-brand-egg-spark:nth-of-type(8) { left: 21%; top: 21%; animation-delay: 0.72s; }

@keyframes bmEggOverlay {
  0% { opacity: 0; }
  8%, 84% { opacity: 1; }
  100% { opacity: 0; }
}

@keyframes bmEggStage {
  0% { transform: scale(0.9); }
  14% { transform: scale(1.015); }
  26%, 82% { transform: scale(1); }
  100% { transform: scale(1.04); }
}

@keyframes bmEggHalo {
  0% { opacity: 0; transform: scale(0.88); }
  28% { opacity: 0.55; }
  70% { opacity: 0.4; }
  100% { opacity: 0; transform: scale(1.06); }
}

@keyframes bmEggRing {
  0% { opacity: 0; transform: rotate(-8deg); }
  30% { opacity: 0.55; }
  100% { opacity: 0.3; transform: rotate(7deg); }
}

@keyframes bmEggDraw {
  0% { stroke-dashoffset: 900; opacity: 0; }
  22% { opacity: 1; }
  100% { stroke-dashoffset: 0; opacity: 0.65; }
}

@keyframes bmEggFlourish {
  0% { opacity: 0; transform: scale(0.6); }
  45% { opacity: 0.8; }
  100% { opacity: 0.5; transform: scale(1); }
}

@keyframes bmEggLetter {
  0% { opacity: 0; transform: translateY(14px) scale(0.82); }
  16% { opacity: 1; transform: translateY(0) scale(1.035); }
  26% { transform: scale(1); }
  78% { opacity: 1; transform: scale(1); }
  100% { opacity: 0; transform: scale(1.045); }
}

@keyframes bmEggGlint {
  0% { background-position: 180% 50%; }
  100% { background-position: -40% 50%; }
}

@keyframes bmEggWord {
  0%, 18% { opacity: 0; transform: translateY(6px); }
  35%, 76% { opacity: 0.85; transform: translateY(0); }
  100% { opacity: 0; transform: translateY(-4px); }
}

@keyframes bmEggSpark {
  0%, 10% { opacity: 0; transform: scale(0.2); }
  35% { opacity: 1; transform: scale(1); }
  100% { opacity: 0; transform: scale(0.3); }
}

@media (prefers-reduced-motion: reduce) {
  .bm-brand-egg,
  .bm-brand-egg-stage,
  .bm-brand-egg-halo,
  .egg-ring-outer,
  .egg-ring-inner,
  .egg-diamond,
  .egg-flourish,
  .bm-brand-egg-letter,
  .bm-brand-egg-word,
  .bm-brand-egg-spark {
    animation: none !important;
  }

  .bm-brand-egg { opacity: 1; }
  .bm-brand-egg-halo { opacity: 0.4; }
  .egg-ring-inner,
  .egg-diamond { stroke-dashoffset: 0; opacity: 0.55; }
  .egg-ring-outer,
  .egg-flourish { opacity: 0.55; }
  .bm-brand-egg-letter { opacity: 1; background-position: 50% 50%; }
  .bm-brand-egg-word { opacity: 0.85; }
  .bm-brand-egg-spark { display: none; }
}

</style>
