<template>
  <div class="eb-wrap">
    <slot v-if="!err" />
    <div v-else class="eb-fallback" role="alert">
      <div class="eb-icon">🃏</div>
      <div class="eb-title">牌桌临时出了点问题</div>
      <div class="eb-msg">{{ err }}</div>
      <button class="eb-retry" @click="retry">重新加载牌桌</button>
    </div>
  </div>
</template>

<script setup>
// 错误边界（§11 闪退防护）：收藏页/开包演出任何渲染异常都不炸毁整个应用
import { ref, onErrorCaptured } from 'vue'

const err = ref('')
onErrorCaptured((e) => {
  err.value = e?.message || String(e)
  console.error('[Balatro UI] 组件异常已被边界捕获:', e)
  return false // 阻止继续向上传播
})
function retry() { err.value = '' }
</script>

<style scoped>
.eb-wrap { display: contents; }
.eb-fallback {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 10px; padding: 60px 20px;
  color: #cfd8dc; text-align: center;
}
.eb-icon { font-size: 42px; filter: grayscale(0.4); }
.eb-title { font-size: 16px; font-weight: 800; color: #eceff1; }
.eb-msg {
  font-size: 12px; color: #90a4ae; max-width: 420px;
  word-break: break-all;
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 8px; padding: 8px 12px;
}
.eb-retry {
  margin-top: 4px; height: 32px; padding: 0 18px;
  background: rgba(110, 198, 255, 0.12);
  border: 1px solid rgba(110, 198, 255, 0.45);
  border-radius: 8px; color: #6ec6ff;
  font-size: 13px; font-weight: 700; cursor: pointer;
}
.eb-retry:hover { background: rgba(110, 198, 255, 0.22); }
</style>
