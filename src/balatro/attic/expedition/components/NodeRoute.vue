<template>
  <div class="nroute">
    <template v-for="(n, i) in nodes" :key="i">
      <!-- 连接线 -->
      <div v-if="i > 0" class="nr-link" :class="{ done: i <= nodeIndex }"></div>
      <!-- 节点 -->
      <div
        class="nr-node"
        :class="[n.kind, { cleared: i < nodeIndex, current: i === nodeIndex, locked: i > nodeIndex }]"
        :title="`${KIND_NAMES[n.kind] || n.kind} · HP ${n.hp}/${n.hpMax} · 最低线 ${n.minDamage}`"
      >
        <span class="nr-icon">{{ KIND_ICONS[n.kind] || '⚔️' }}</span>
        <span class="nr-name">{{ KIND_NAMES[n.kind] || n.kind }}</span>
        <span v-if="i < nodeIndex" class="nr-check">✓</span>
        <span v-else-if="i === nodeIndex" class="nr-hp">{{ n.hp }}</span>
      </div>
    </template>
  </div>
</template>

<script setup>
// NodeRoute（契约 §6）：节点路线进度条
// 路线固定：普通 → 精英 → 商店 → 普通 → Boss；节点 HP 池，溢出 50% 结转
defineProps({
  nodes: { type: Array, required: true },   // [{ kind, hp, hpMax, minDamage }]
  nodeIndex: { type: Number, required: true },
})

const KIND_ICONS = { normal: '⚔️', elite: '💀', shop: '🛒', boss: '👑' }
const KIND_NAMES = { normal: '普通', elite: '精英', shop: '商店', boss: 'Boss' }
</script>

<style scoped>
.nroute {
  display: flex; align-items: center; gap: 0;
  font-family: 'm6x11', 'PingFang SC', monospace;
}
.nr-link {
  width: 34px; height: 3px;
  background: rgba(255, 255, 255, 0.14);
  border-radius: 2px;
}
.nr-link.done { background: linear-gradient(90deg, #4fe0b0, #2a9d8f); box-shadow: 0 0 6px rgba(79, 224, 176, 0.4); }
.nr-node {
  position: relative;
  display: flex; flex-direction: column; align-items: center; gap: 2px;
  min-width: 58px;
  padding: 7px 8px 6px;
  border-radius: 8px;
  border: 2px solid rgba(255, 255, 255, 0.14);
  background: rgba(8, 10, 18, 0.72);
  color: #cfd8dc;
}
.nr-node .nr-icon { font-size: 17px; line-height: 1; }
.nr-node .nr-name { font-size: 10px; font-weight: 700; letter-spacing: 1px; }
.nr-node.locked { opacity: 0.42; filter: grayscale(0.7); }
.nr-node.cleared {
  border-color: rgba(79, 224, 176, 0.55);
  background: rgba(20, 46, 38, 0.72);
}
.nr-node.cleared .nr-icon { filter: grayscale(1) brightness(0.85); }
.nr-check {
  position: absolute; top: -7px; right: -6px;
  font-size: 10px; font-weight: 900; color: #0c2b22;
  background: #4fe0b0; border-radius: 50%;
  width: 15px; height: 15px; line-height: 15px; text-align: center;
}
.nr-node.current {
  border-color: #ffd54f;
  background: rgba(46, 38, 12, 0.8);
  box-shadow: 0 0 14px rgba(255, 213, 79, 0.35);
  animation: curPulse 1.8s ease-in-out infinite;
}
@keyframes curPulse {
  0%, 100% { box-shadow: 0 0 8px rgba(255, 213, 79, 0.25); }
  50% { box-shadow: 0 0 18px rgba(255, 213, 79, 0.55); }
}
.nr-node.boss.current { border-color: #ff6b6b; box-shadow: 0 0 14px rgba(255, 107, 107, 0.4); animation: none; }
.nr-hp { font-size: 10px; font-weight: 900; color: #ff8787; }
.nr-node.boss .nr-hp { color: #ff5252; }
</style>
