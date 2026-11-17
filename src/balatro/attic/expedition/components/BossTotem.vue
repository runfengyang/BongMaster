<template>
  <div class="btotem" :class="[`bt-${bossState}`, { 'bt-compact': compact }]">
    <!-- 像素图腾（pixelMap 数据驱动，canvas 逐像素上色 + 3x 放大） -->
    <div class="bt-canvas-wrap" :style="{ '--accent': accent }">
      <canvas ref="cv" class="bt-canvas" :width="size" :height="size"></canvas>
      <div v-if="bossState === 'casting'" class="bt-cast-ring"></div>
      <div v-if="hitFlash" class="bt-hit-flash"></div>
      <!-- 碎裂：像素碎屑 -->
      <template v-if="bossState === 'shatter'">
        <span v-for="p in shards" :key="p.i" class="bt-shard" :style="p.style"></span>
      </template>
    </div>

    <!-- chunky HP 条 -->
    <div class="bt-hp" :title="`${hp} / ${hpMax}`">
      <div class="bt-hp-chunks">
        <span
          v-for="i in CHUNKS"
          :key="i"
          class="bt-chunk"
          :class="{ on: i <= filledChunks, low: hpRatio <= 0.25 }"
        ></span>
      </div>
      <div class="bt-hp-num">{{ hp }}<span class="bt-hp-max">/{{ hpMax }}</span></div>
    </div>

    <!-- 意图横幅 -->
    <div v-if="intent" class="bt-intent" :class="{ casting: bossState === 'casting' }">
      <span class="bt-intent-tag">意图</span>
      <span class="bt-intent-name">{{ intent.name }}</span>
      <span class="bt-intent-text">{{ intent.text }}</span>
    </div>
  </div>
</template>

<script setup>
// BossTotem（契约 §4.3）：Boss 像素图腾 + chunky HP 条 + 意图横幅
// 四状态：casting 施法（意图生效光环）/ hit 受击（震屏白闪）/ pressure 施压（红脉冲）/ shatter 碎裂（像素崩解）
// 战报播放时由父组件 defineExpose 触发，组件自身只负责视觉。
import { ref, computed, watch, onMounted } from 'vue'

const props = defineProps({
  boss: { type: Object, required: true },      // EXPEDITION_BOSSES_BY_ID[bossId]
  hp: { type: Number, required: true },
  hpMax: { type: Number, required: true },
  intent: { type: Object, default: null },     // { id, name, text }
  compact: { type: Boolean, default: false },  // 摘要条等窄场景
})

const cv = ref(null)
const bossState = ref('idle') // idle|casting|hit|pressure|shatter
const hitFlash = ref(false)
const shards = ref([])
let stateTimer = null

const CHUNKS = 24
const hpRatio = computed(() => (props.hpMax > 0 ? Math.max(0, props.hp / props.hpMax) : 0))
const filledChunks = computed(() => Math.ceil(hpRatio.value * CHUNKS))
const accent = computed(() => props.boss?.art?.accent || '#7a8cff')
const size = computed(() => (props.compact ? 64 : 64)) // canvas 内部分辨率恒 64，CSS 放大

// ---------- pixelMap → canvas ----------
function draw () {
  const el = cv.value
  const pm = props.boss?.art?.pixelMap
  if (!el || !pm) return
  const ctx = el.getContext('2d')
  ctx.clearRect(0, 0, el.width, el.height)
  const rows = pm.rows || []
  const n = rows.length
  const w = n ? rows[0].length : 0
  if (!n || !w) return
  const sx = el.width / w
  const sy = el.height / n
  for (let y = 0; y < n; y++) {
    const row = rows[y]
    for (let x = 0; x < row.length; x++) {
      const c = pm.palette[row[x]]
      if (!c || c === 'transparent') continue
      ctx.fillStyle = c
      ctx.fillRect(Math.floor(x * sx), Math.floor(y * sy), Math.ceil(sx), Math.ceil(sy))
    }
  }
}

onMounted(draw)
watch(() => props.boss, draw)

// ---------- 四状态触发（战报播放驱动） ----------
function setState (s, ms = 700) {
  bossState.value = s
  if (stateTimer) clearTimeout(stateTimer)
  if (s !== 'shatter' && ms > 0) {
    stateTimer = setTimeout(() => { bossState.value = 'idle' }, ms)
  }
}
function hit () {
  setState('hit', 520)
  hitFlash.value = true
  setTimeout(() => { hitFlash.value = false }, 220)
}
function pressure () { setState('pressure', 900) }
function casting () { setState('casting', 900) }
function shatter () {
  shards.value = Array.from({ length: 26 }, (_, i) => {
    const ang = Math.random() * Math.PI * 2
    const dist = 50 + Math.random() * 110
    return {
      i,
      style: {
        left: `${30 + Math.random() * 40}%`,
        top: `${30 + Math.random() * 40}%`,
        width: `${4 + Math.random() * 6}px`,
        height: `${4 + Math.random() * 6}px`,
        background: i % 3 === 0 ? accent.value : (i % 3 === 1 ? '#f2f2ff' : '#343458'),
        '--dx': `${Math.cos(ang) * dist}px`,
        '--dy': `${Math.sin(ang) * dist}px`,
        '--rot': `${(Math.random() - 0.5) * 540}deg`,
      },
    }
  })
  setState('shatter', 0)
}
function reset () {
  if (stateTimer) clearTimeout(stateTimer)
  bossState.value = 'idle'
  shards.value = []
}
defineExpose({ hit, pressure, casting, shatter, reset })
</script>

<style scoped>
.btotem {
  display: flex; flex-direction: column; align-items: center; gap: 10px;
  font-family: 'm6x11', 'PingFang SC', monospace;
}
.bt-canvas-wrap {
  position: relative;
  width: 192px; height: 192px;
  border-radius: 10px;
  filter: drop-shadow(0 10px 18px rgba(0, 0, 0, 0.55));
}
.bt-compact .bt-canvas-wrap { width: 72px; height: 72px; }
.bt-canvas {
  width: 100%; height: 100%;
  image-rendering: pixelated;
  border-radius: 10px;
  animation: btBreath 3.2s ease-in-out infinite;
}
@keyframes btBreath {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.02); }
}

/* 施法：意图光环 */
.bt-cast-ring {
  position: absolute; inset: -10px;
  border-radius: 14px;
  border: 3px solid var(--accent, #7a8cff);
  animation: castPulse 0.5s ease-in-out infinite;
  pointer-events: none;
}
@keyframes castPulse {
  0%, 100% { opacity: 0.25; transform: scale(0.98); }
  50% { opacity: 0.9; transform: scale(1.03); }
}
.bt-casting .bt-canvas { animation: btBreath 3.2s ease-in-out infinite, castShake 0.4s linear infinite; }
@keyframes castShake {
  0%, 100% { translate: 0 0; }
  25% { translate: -2px 1px; }
  75% { translate: 2px -1px; }
}

/* 受击：震动 + 白闪 */
.bt-hit .bt-canvas { animation: hitShake 0.32s linear; }
@keyframes hitShake {
  0%, 100% { transform: none; }
  20% { transform: translate(-9px, 4px) rotate(-1.4deg); }
  45% { transform: translate(8px, -4px) rotate(1.1deg); }
  70% { transform: translate(-5px, 2px); }
}
.bt-hit-flash {
  position: absolute; inset: 0; border-radius: 10px;
  background: rgba(255, 255, 255, 0.75);
  animation: flashOut 0.22s ease-out forwards;
  pointer-events: none;
}
@keyframes flashOut { from { opacity: 1; } to { opacity: 0; } }

/* 施压：红色脉冲 */
.bt-pressure .bt-canvas { animation: pressurePulse 0.45s ease-in-out infinite; filter: drop-shadow(0 0 18px rgba(255, 60, 60, 0.8)); }
@keyframes pressurePulse {
  0%, 100% { filter: brightness(1); }
  50% { filter: brightness(1.5) saturate(1.6) hue-rotate(-25deg); }
}

/* 碎裂：像素崩解 */
.bt-shatter .bt-canvas { animation: shatterFall 1.1s ease-in forwards; }
@keyframes shatterFall {
  0% { opacity: 1; transform: none; filter: none; }
  35% { filter: brightness(2.2); }
  100% { opacity: 0; transform: translateY(26px) scale(0.86); filter: brightness(0.4); }
}
.bt-shard {
  position: absolute; z-index: 3;
  animation: shardFly 1s cubic-bezier(0.2, 0.6, 0.4, 1) forwards;
  pointer-events: none;
}
@keyframes shardFly {
  0% { opacity: 1; transform: none; }
  100% { opacity: 0; transform: translate(var(--dx), var(--dy)) rotate(var(--rot)); }
}

/* chunky HP 条 */
.bt-hp { display: flex; flex-direction: column; align-items: center; gap: 4px; width: 100%; max-width: 320px; }
.bt-hp-chunks {
  display: flex; gap: 2px; width: 100%;
  padding: 3px;
  background: rgba(0, 0, 0, 0.5);
  border: 2px solid rgba(255, 255, 255, 0.18);
  border-radius: 6px;
}
.bt-chunk {
  flex: 1; height: 12px;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 1px;
  transition: background 0.25s;
}
.bt-chunk.on { background: linear-gradient(180deg, #ff6b6b, #c92a2a); box-shadow: 0 0 4px rgba(255, 80, 80, 0.5); }
.bt-chunk.on.low { background: linear-gradient(180deg, #ffd54f, #c89018); animation: lowBlink 0.8s ease-in-out infinite; }
@keyframes lowBlink { 0%, 100% { opacity: 1; } 50% { opacity: 0.45; } }
.bt-hp-num { font-size: 14px; font-weight: 900; color: #ff8787; text-shadow: 0 1px 0 #000; }
.bt-hp-max { font-size: 11px; color: #a58a8a; font-weight: 700; }

/* 意图横幅 */
.bt-intent {
  display: flex; align-items: center; gap: 8px;
  max-width: 100%;
  padding: 6px 12px;
  background: rgba(10, 8, 20, 0.82);
  border: 2px solid var(--accent, #7a8cff);
  border-radius: 8px;
  box-shadow: 0 0 12px rgba(0, 0, 0, 0.5);
}
.bt-intent.casting { animation: intentGlow 0.5s ease-in-out infinite; }
@keyframes intentGlow {
  0%, 100% { box-shadow: 0 0 8px rgba(122, 140, 255, 0.3); }
  50% { box-shadow: 0 0 22px rgba(122, 140, 255, 0.75); }
}
.bt-intent-tag {
  font-size: 10px; font-weight: 900; letter-spacing: 2px;
  color: #14142a; background: var(--accent, #7a8cff);
  padding: 2px 6px; border-radius: 3px;
}
.bt-intent-name { font-size: 13px; font-weight: 900; color: #fff; white-space: nowrap; }
.bt-intent-text { font-size: 11px; color: #b9bde0; }
</style>
