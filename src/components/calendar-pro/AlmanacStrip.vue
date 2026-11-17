<template>
  <div class="cp-info-strip cp-almanac-strip">
    <span class="cp-info-icon"><i class="fas fa-scroll" aria-hidden="true"></i></span>
    <div class="cp-almanac-lines">
      <div><strong>宜</strong><span>{{ almanac.recommends.length ? almanac.recommends.slice(0, 5).join(' · ') : '诸事不宜' }}</span></div>
      <div><strong>忌</strong><span>{{ almanac.avoids.length ? almanac.avoids.slice(0, 5).join(' · ') : '百无禁忌' }}</span></div>
    </div>
    <span class="cp-almanac-meta">{{ almanac.dutyName }}日 · {{ almanac.naYin }}</span>
  </div>
</template>

<script setup>
defineProps({ almanac: { type: Object, required: true } })
</script>

<style scoped>
.cp-info-strip { display: flex; align-items: center; gap: 7px; min-width: 0; padding: 4px 7px; border: 1px solid var(--cp-mac-border, var(--bm-border-subtle)); border-radius: 8px; background: #f5f5f7; }
.cp-info-icon { width: 20px; height: 20px; flex: 0 0 auto; display: grid; place-items: center; border-radius: 6px; background: rgba(185, 80, 50, 0.08); color: #9c4b37; font-size: 9px; }
.cp-almanac-lines { min-width: 0; flex: 1; display: grid; gap: 1px; font-size: 11px; }
.cp-almanac-lines div { min-width: 0; display: flex; gap: 5px; white-space: nowrap; overflow: hidden; }
.cp-almanac-lines strong { color: #9c4b37; font-weight: 700; flex: 0 0 auto; }
.cp-almanac-lines span { overflow: hidden; text-overflow: ellipsis; color: var(--bm-text-secondary); }
.cp-almanac-meta { flex: 0 0 auto; color: var(--bm-text-muted); font-size: 10px; }
@media (max-width: 720px) { .cp-almanac-meta { display: none; } }
</style>
