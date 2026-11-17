export const platform = typeof window !== 'undefined' ? (window.electronAPI?.platform || '') : ''
export const isMac = platform === 'darwin'
