import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

const THEME_STORAGE_KEY = 'bongmaster-theme'

const themes = [
  {
    id: 'sketch',
    name: '手绘白板',
    tone: '明亮 / 手绘',
    color: '#7da7d9'
  },
  {
    id: 'times',
    name: 'Bong Times',
    tone: '报纸 / 衬线',
    color: '#326891'
  },
  {
    id: 'paper',
    name: 'Claude Paper',
    tone: '暖纸 / 陶土',
    color: '#c96442'
  },
  {
    id: 'focus',
    name: 'Blue Focus',
    tone: '清爽 / 专注',
    color: '#5f93c7'
  }
]

const themeIds = new Set(themes.map((theme) => theme.id))

function getInitialTheme() {
  try {
    const savedTheme = localStorage.getItem(THEME_STORAGE_KEY)
    if (themeIds.has(savedTheme)) return savedTheme
  } catch (error) {
    // Local storage can be unavailable in restricted browser contexts.
  }

  return 'sketch'
}

export const useThemeStore = defineStore('theme', () => {
  const currentTheme = ref(getInitialTheme())

  const currentThemeMeta = computed(() => (
    themes.find((theme) => theme.id === currentTheme.value) || themes[0]
  ))

  function setTheme(themeId) {
    if (!themeIds.has(themeId)) return
    currentTheme.value = themeId

    try {
      localStorage.setItem(THEME_STORAGE_KEY, themeId)
    } catch (error) {
      // Theme switching should still work for the current session.
    }
  }

  return {
    themes,
    currentTheme,
    currentThemeMeta,
    setTheme
  }
})
