<template>
  <div
    ref="wrap"
    class="pc-wrap"
    :class="{ dealt, selectable, inview }"
    :style="{ '--card-w': cardW + 'px', '--card-s': cardScale, transitionDelay: dealt ? dealDelay + 'ms' : '0ms' }"
    @pointermove="onMove"
    @pointerleave="onLeave"
    @click.stop="$emit('click', $event)"
  >
    <div class="pc-bob" :style="bobStyle">
      <div class="pc-tilt" :style="tiltStyle">
        <div
          class="pc-card"
          :class="[
            edition ? 'ed-' + edition : '',
            { selected, faceDown, fragment, shaking, debuffed: card?.debuffed }
          ]"
        >
          <!-- 正面 -->
          <div class="pc-face pc-front" :style="frontStyle">
            <!-- 内部固定 142×190（2x）版式，整体缩放输出 -->
            <div class="pc-inner">
              <!-- 扑克牌面（防御：kind=playing 但无 card 时不渲染牌面） -->
              <template v-if="kind === 'playing' && card">
                <template v-if="card.enhancement !== 'stone'">
                  <div class="pc-corner tl" :style="{ color: suitColor }">
                    <span class="rk">{{ card.rankLabel }}</span><span class="st">{{ suitGlyph }}</span>
                  </div>
                  <div class="pc-corner br" :style="{ color: suitColor }">
                    <span class="rk">{{ card.rankLabel }}</span><span class="st">{{ suitGlyph }}</span>
                  </div>
                  <div class="pc-pips" :style="{ color: suitColor }">{{ suitGlyph }}</div>
                </template>
                <div v-else class="pc-pips stone">🪨</div>
                <div v-if="card.enhancement" class="pc-enh-badge">{{ enhLabel }}</div>
                <div v-if="card.seal" class="pc-seal" :class="'seal-' + card.seal"></div>
                <div v-if="card.debuffed" class="pc-debuff">✕</div>
              </template>
              <!-- 小丑/塔罗/星球/幻灵/卡包/优惠券：官方精灵优先，无映射回退程序化像素 -->
              <template v-else>
                <template v-if="spriteInfo">
                  <div class="pc-sprite" :style="spriteStyle"></div>
                  <div v-if="spriteInfo.sx !== undefined" class="pc-sprite pc-sprite-soul" :style="soulStyle"></div>
                </template>
                <template v-else>
                  <div class="pc-name-banner">{{ def?.name || '???' }}</div>
                  <div class="pc-art-window" :style="artWindowStyle">
                    <canvas ref="pix" class="pc-pix" width="36" height="36"></canvas>
                  </div>
                  <div v-if="rarityName" class="pc-rarity-strip" :style="{ background: rarityColor }">
                    {{ rarityName }}
                  </div>
                </template>
              </template>
            </div>
            <div class="pc-gloss" :style="glossStyle"></div>
            <div v-if="edition" class="pc-edition-layer" :style="editionStyle"></div>
          </div>
          <!-- 背面：官方卡背精灵（§20 按包类型选 BACK_SPRITES 键），程序化纹兜底 -->
          <div class="pc-face pc-backside" :style="backTintStyle">
            <div class="pc-back-pattern"></div>
            <div class="pc-back-sprite" :style="backSpriteStyle"></div>
          </div>
        </div>
      </div>
    </div>
    <!-- 飘字层 -->
    <div class="pc-floats">
      <div v-for="f in floats" :key="f.id" class="pc-float" :class="'fk-' + f.kind">{{ f.text }}</div>
    </div>
  </div>
</template>

<script setup>
// PlayingCard（§3.2，§11 1:1 视觉复刻重写）
// 71×95 比例：内部固定 142×190（2x）版式按 width 整体缩放
// 速度感应 3D 倾斜（位置倾斜 + 指针速度加成，弹簧阻尼）
// idle 浮动：共享单 rAF ticker + IntersectionObserver 门控（离屏/减动效即停）
// 版本着色：canvas 噪点叠加 + CSS 渐变动画（离屏暂停）
// 程序化像素卡面（emoji motif 低分辨率绘制 + pixelated 放大）与红底菱形交叉纹卡背
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { SPRITE_MAP, BACK_SPRITES, ATLAS_META } from '../data/spriteMap.js'

// ================= 官方精灵映射（§12） =================
// 组件内部 142×190（2x）渲染：图集按 2 倍尺寸定位，pixelated 保持像素锐利
const spriteInfo = computed(() => {
  if (!props.def?.id) return null
  const s = SPRITE_MAP[props.def.id]
  if (!s) return null
  const meta = ATLAS_META[s.atlas]
  if (!meta) return null
  return { ...s, meta }
})
function tileStyle(atlasMeta, x, y) {
  return {
    backgroundImage: `url(${atlasMeta.url})`,
    backgroundSize: `${atlasMeta.cols * 142}px ${atlasMeta.rows * 190}px`,
    backgroundPosition: `-${x * 142}px -${y * 190}px`,
  }
}
const spriteStyle = computed(() => spriteInfo.value ? tileStyle(spriteInfo.value.meta, spriteInfo.value.x, spriteInfo.value.y) : {})
const soulStyle = computed(() => spriteInfo.value?.sx !== undefined ? tileStyle(spriteInfo.value.meta, spriteInfo.value.sx, spriteInfo.value.sy) : {})
const enhancersMeta = ATLAS_META.enhancers
// §20 卡背按包类型区分 + 半张卡修复：背面层不在 .pc-inner（142×190 2x 版式）内，
// 其盒子是 cardW × cardW·95/71 逻辑 px，背景必须乘 cardScale（= cardW/142），
// 否则 2x 背景只显示瓦片左上 1/4 =「半张卡背」。
const backSpriteStyle = computed(() => {
  const b = BACK_SPRITES[props.back] || BACK_SPRITES.b_red
  if (!b) return {}
  const k = cardScale.value
  return {
    backgroundImage: `url(${enhancersMeta.url})`,
    backgroundSize: `${enhancersMeta.cols * 142 * k}px ${enhancersMeta.rows * 190 * k}px`,
    backgroundPosition: `-${b.x * 142 * k}px -${b.y * 190 * k}px`,
  }
})
// 卡背底色兜底（精灵缺失时保持类型差异）
const BACK_TINTS = {
  b_red: '#a02418', b_blue: '#1a4a8a', b_magic: '#4a2a6a',
  b_nebula: '#1a3a4a', b_ghost: '#2a1a3a', b_black: '#1a1a1e',
}
const backTintStyle = computed(() => ({ background: BACK_TINTS[props.back] || '#a02418' }))

const props = defineProps({
  card: { type: Object, default: null },        // 扑克牌对象
  def: { type: Object, default: null },         // 数据层 def（小丑/塔罗/星球/幻灵/卡包）
  kind: { type: String, default: 'playing' },   // 'playing'|'joker'|'tarot'|'planet'|'spectral'|'pack'|'voucher'
  edition: { type: String, default: null },
  back: { type: String, default: 'b_red' },      // §20 卡背 id（BACK_SPRITES 键，按包类型区分）
  fragment: { type: Boolean, default: false },   // §21 半张碎片：正面右半锯齿撕掉
  selected: { type: Boolean, default: false },
  faceDown: { type: Boolean, default: false },
  dealt: { type: Boolean, default: false },     // 发牌飞入
  dealDelay: { type: Number, default: 0 },
  selectable: { type: Boolean, default: true },
  width: { type: Number, default: 71 },
  tiltScale: { type: Number, default: 1 },      // §14 细看视图放大倾斜范围（1.8）
})
defineEmits(['click'])

const cardW = computed(() => props.width)
const cardScale = computed(() => props.width / 142) // 2x 版式 → 逻辑尺寸
const wrap = ref(null)
const pix = ref(null)

// ================= 共享 idle ticker（全部可见卡共用一个 rAF） =================
const tickerSubs = new Set()
let tickerRaf = 0
function tickerLoop(ts) {
  for (const fn of tickerSubs) fn(ts)
  tickerRaf = tickerSubs.size ? requestAnimationFrame(tickerLoop) : 0
}
function tickerSub(fn) {
  tickerSubs.add(fn)
  if (!tickerRaf) tickerRaf = requestAnimationFrame(tickerLoop)
}
function tickerUnsub(fn) {
  tickerSubs.delete(fn)
}

// ================= 版本噪点纹理（模块级单例 canvas） =================
let noiseURL = null
function getNoiseURL() {
  if (noiseURL) return noiseURL
  const c = document.createElement('canvas')
  c.width = 64; c.height = 64
  const ctx = c.getContext('2d')
  const img = ctx.createImageData(64, 64)
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.floor(Math.random() * 255)
    img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v
    img.data[i + 3] = 26 // 弱噪点
  }
  ctx.putImageData(img, 0, 0)
  noiseURL = c.toDataURL()
  return noiseURL
}
const editionStyle = computed(() => props.edition
  ? { '--noise-url': `url(${getNoiseURL()})` }
  : {})

// ================= 速度感应 3D 倾斜 =================
const tilt = ref({ x: 0, y: 0, r: 0, gx: 50, gy: 50 })
const target = { x: 0, y: 0, r: 0 }
const vel = { x: 0, y: 0 } // 指针速度加成（随时间衰减）
let tiltRaf = 0
function tiltLoop() {
  const k = 0.16 // 阻尼插值
  const ts = props.tiltScale
  // 速度加成每帧衰减
  vel.x *= 0.88
  vel.y *= 0.88
  const tx = target.x + clamp(-vel.y * 7 * ts, -9 * ts, 9 * ts)
  const ty = target.y + clamp(vel.x * 7 * ts, -9 * ts, 9 * ts)
  const tr = target.r + clamp(vel.x * 3.2 * ts, -5 * ts, 5 * ts)
  tilt.value = {
    x: tilt.value.x + (tx - tilt.value.x) * k,
    y: tilt.value.y + (ty - tilt.value.y) * k,
    r: tilt.value.r + (tr - tilt.value.r) * k,
    gx: tilt.value.gx + (target.gx - tilt.value.gx) * k,
    gy: tilt.value.gy + (target.gy - tilt.value.gy) * k,
  }
  const settled =
    Math.abs(tx - tilt.value.x) < 0.05 &&
    Math.abs(ty - tilt.value.y) < 0.05 &&
    Math.abs(tr - tilt.value.r) < 0.05 &&
    Math.abs(vel.x) < 0.01 && Math.abs(vel.y) < 0.01
  tiltRaf = settled ? 0 : requestAnimationFrame(tiltLoop)
}
function kickTilt() { if (!tiltRaf) tiltRaf = requestAnimationFrame(tiltLoop) }
function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)) }

let lastMove = { x: 0, y: 0, t: 0 }
function onMove(e) {
  const el = wrap.value
  if (!el) return
  const now = performance.now()
  const dt = Math.max(1, now - lastMove.t)
  if (lastMove.t) {
    // 瞬时速度（px/ms），低通平滑
    vel.x = vel.x * 0.5 + ((e.clientX - lastMove.x) / dt) * 0.5
    vel.y = vel.y * 0.5 + ((e.clientY - lastMove.y) / dt) * 0.5
  }
  lastMove = { x: e.clientX, y: e.clientY, t: now }
  const r = el.getBoundingClientRect()
  const px = (e.clientX - r.left) / r.width
  const py = (e.clientY - r.top) / r.height
  const ts = props.tiltScale
  target.x = (0.5 - py) * 20 * ts // 位置倾斜 ±10°（细看 ×tiltScale）
  target.y = (px - 0.5) * 20 * ts
  target.gx = px * 100
  target.gy = py * 100
  kickTilt()
}
function onLeave() {
  target.x = 0; target.y = 0; target.r = 0; target.gx = 50; target.gy = 50
  kickTilt()
}

const tiltStyle = computed(() => ({
  transform: `rotateX(${tilt.value.x.toFixed(2)}deg) rotateY(${tilt.value.y.toFixed(2)}deg) rotateZ(${tilt.value.r.toFixed(2)}deg)`,
}))
const glossStyle = computed(() => ({
  background: `radial-gradient(circle at ${tilt.value.gx}% ${tilt.value.gy}%, rgba(255,255,255,0.22), transparent 55%)`,
}))

// ================= idle 浮动（IO 门控） =================
const inview = ref(false)
const bob = ref({ y: 0, r: 0 })
const bobPhase = Math.random() * Math.PI * 2
const reducedMotion = typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

function bobTick(ts) {
  bob.value = {
    y: Math.sin(ts / 1100 + bobPhase) * 2.4,
    r: Math.sin(ts / 1600 + bobPhase) * 0.7,
  }
}
function startIdle() { if (!reducedMotion) tickerSub(bobTick) }
function stopIdle() {
  tickerUnsub(bobTick)
  bob.value = { y: 0, r: 0 }
}
const bobStyle = computed(() => ({
  transform: `translateY(${bob.value.y.toFixed(2)}px) rotate(${bob.value.r.toFixed(2)}deg)`,
}))

let io = null
onMounted(() => {
  drawPix()
  if (typeof IntersectionObserver !== 'undefined' && wrap.value) {
    io = new IntersectionObserver(
      (entries) => { inview.value = entries[0]?.isIntersecting ?? true },
      { rootMargin: '48px' }
    )
    io.observe(wrap.value)
  } else {
    inview.value = true
  }
})
watch(inview, (v) => { v ? startIdle() : stopIdle() })
onBeforeUnmount(() => {
  stopIdle()
  cancelAnimationFrame(tiltRaf)
  if (io) io.disconnect()
})

// ================= 扑克牌面 =================
const SUIT_GLYPHS = { spades: '♠', hearts: '♥', diamonds: '♦', clubs: '♣' }
const suitGlyph = computed(() => (props.card ? SUIT_GLYPHS[props.card.suit] : ''))
const suitColor = computed(() => {
  if (!props.card) return '#222'
  return props.card.suit === 'hearts' || props.card.suit === 'diamonds' ? '#c62828' : '#1a1a2a'
})
const ENH_LABELS = {
  bonus: '+30', mult: '+4', wild: '万能', glass: '玻璃', steel: '钢铁', stone: '', gold: '黄金', lucky: '幸运',
}
const enhLabel = computed(() => ENH_LABELS[props.card?.enhancement] || '')

// ================= 外观 =================
const RARITY_FRAMES = {
  1: '#7a8a99', 2: '#3fbf6f', 3: '#e04040', 4: '#a050e0',
}
const RARITY_NAMES = { 1: '普通', 2: '罕见', 3: '稀有', 4: '传奇' }
const TYPE_FRAMES = { tarot: '#8a5ac8', planet: '#40b8c8', spectral: '#50308a', pack: '#c8a040', voucher: '#c8c040' }
const rarityColor = computed(() => RARITY_FRAMES[props.def?.rarity || 1])
const rarityName = computed(() => (props.kind === 'joker' ? RARITY_NAMES[props.def?.rarity || 1] : null))

const frontStyle = computed(() => {
  if (props.kind === 'playing') {
    const enhBg = {
      bonus: 'linear-gradient(160deg,#e8f0ff,#c8d8f0)', mult: 'linear-gradient(160deg,#ffe8e8,#f0c8c8)',
      wild: 'linear-gradient(135deg,#ffd9e8,#d9ffe8 50%,#d9e8ff)', glass: 'linear-gradient(160deg,rgba(220,240,255,0.75),rgba(180,220,250,0.55))',
      steel: 'linear-gradient(160deg,#c8d0d8,#98a8b8)', stone: 'linear-gradient(160deg,#9a9a9a,#6a6a6a)',
      gold: 'linear-gradient(160deg,#ffe8a0,#e8c860)', lucky: 'linear-gradient(160deg,#f0e0ff,#d0b8f0)',
    }
    return { background: enhBg[props.card?.enhancement] || 'linear-gradient(160deg,#ffffff,#e8e8e0)' }
  }
  const bg = props.def?.art?.bg || '#3b2f4f'
  const frame = props.kind === 'joker'
    ? RARITY_FRAMES[props.def?.rarity || 1]
    : TYPE_FRAMES[props.kind] || '#7a8a99'
  return { background: `linear-gradient(160deg, ${bg}, #1a1a22 140%)`, boxShadow: `inset 0 0 0 4px ${frame}` }
})
const artWindowStyle = computed(() => {
  const bg = props.def?.art?.bg || '#3b2f4f'
  return { background: `linear-gradient(160deg, rgba(0,0,0,0.28), rgba(0,0,0,0.42)), ${bg}` }
})

// ================= 程序化像素画（低分辨率 canvas + pixelated 放大） =================
function drawPix() {
  const cv = pix.value
  if (!cv || props.kind === 'playing') return
  const ctx = cv.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, 36, 36)
  const motif = props.def?.art?.motif || '🃏'
  try {
    ctx.font = '28px "Apple Color Emoji", "Segoe UI Emoji", sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(motif, 18, 20)
  } catch (err) {
    console.warn('[PlayingCard] 像素画绘制失败:', err)
  }
}
watch(() => [props.def, props.kind], drawPix)

// ================= 抖动 + 飘字 hook =================
const shaking = ref(false)
const floats = ref([])
let floatId = 0
function shake() {
  shaking.value = false
  requestAnimationFrame(() => {
    shaking.value = true
    setTimeout(() => (shaking.value = false), 320)
  })
}
function floatText(text, kind = 'chips') {
  const id = ++floatId
  floats.value.push({ id, text, kind })
  setTimeout(() => { floats.value = floats.value.filter(f => f.id !== id) }, 900)
}
defineExpose({ shake, floatText })
</script>

<style scoped>
.pc-wrap {
  --card-w: 71px;
  --card-s: 0.5;
  width: var(--card-w);
  height: calc(var(--card-w) * 95 / 71);
  position: relative;
  perspective: 600px;
  cursor: pointer;
  user-select: none;
  flex: 0 0 auto;
  transition: transform 0.15s ease, opacity 0.3s ease;
}
/* §14 爆开发牌：从包体中心向外 + overshoot 回弹（--bx 由父级按槽位到中心距离注入） */
.pc-wrap.dealt {
  animation: dealIn 0.48s cubic-bezier(0.2, 1.3, 0.35, 1) backwards;
}
@keyframes dealIn {
  from { transform: translate(var(--bx, 0px), -70px) scale(0.22) rotate(14deg); opacity: 0; }
  to { transform: none; opacity: 1; }
}
.pc-wrap:hover { transform: translateY(-8px) scale(1.06); z-index: 5; }
.pc-bob { width: 100%; height: 100%; will-change: transform; }
.pc-tilt {
  width: 100%; height: 100%;
  transform-style: preserve-3d;
  will-change: transform;
}
.pc-card {
  width: 100%; height: 100%;
  position: relative;
  transform-style: preserve-3d;
  transition: transform 0.6s cubic-bezier(0.4, 0.0, 0.2, 1);
}
.pc-card.faceDown { transform: rotateY(180deg); }
.pc-card.selected { transform: translateY(-12px); }
.pc-card.selected .pc-front { box-shadow: 0 0 0 3px #40a0ff, 0 8px 16px rgba(0,0,0,0.5) !important; }
.pc-face {
  position: absolute; inset: 0;
  border-radius: calc(var(--card-w) * 0.09);
  backface-visibility: hidden;
  overflow: hidden;
  box-shadow: 0 2px 6px rgba(0,0,0,0.45), inset 0 0 0 2px rgba(0,0,0,0.25);
  font-family: 'm6x11', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', monospace;
}

/* ============ 内部 2x 版式（142×190 固定，整体缩放） ============ */
.pc-inner {
  position: absolute;
  top: 0; left: 0;
  width: 142px; height: 190px;
  transform: scale(var(--card-s));
  transform-origin: 0 0;
}

/* ---- 扑克牌面 ---- */
.pc-corner {
  position: absolute; display: flex; flex-direction: column; align-items: center;
  line-height: 1; font-weight: 900;
}
.pc-corner .rk { font-size: 30px; letter-spacing: -1px; }
.pc-corner .st { font-size: 26px; }
.pc-corner.tl { top: 8px; left: 10px; }
.pc-corner.br { bottom: 8px; right: 10px; transform: rotate(180deg); }
.pc-pips {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  font-size: 78px;
}
.pc-pips.stone { font-size: 64px; }
.pc-enh-badge {
  position: absolute; bottom: 10px; left: 50%; transform: translateX(-50%);
  font-size: 18px; font-weight: 900; color: #1a3a6a;
  background: rgba(255,255,255,0.78); border-radius: 5px; padding: 2px 8px;
}
.pc-seal {
  position: absolute; top: 72px; left: 50%; transform: translateX(-50%);
  width: 38px; height: 38px; border-radius: 50%;
}
.pc-seal.seal-gold { background: radial-gradient(circle, #ffd700, #b8860b); box-shadow: 0 0 8px #ffd700; }
.pc-seal.seal-red { background: radial-gradient(circle, #ff5050, #a01010); box-shadow: 0 0 8px #ff5050; }
.pc-seal.seal-blue { background: radial-gradient(circle, #5090ff, #1040a0); box-shadow: 0 0 8px #5090ff; }
.pc-seal.seal-purple { background: radial-gradient(circle, #b060ff, #5810a0); box-shadow: 0 0 8px #b060ff; }
.pc-debuff {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  background: rgba(40,40,40,0.55); color: #ff4040;
  font-size: 72px; font-weight: 900;
}

/* ---- 小丑/消耗牌面：名牌横幅 + 像素画窗 + 稀有度条 ---- */
.pc-name-banner {
  position: absolute; top: 8px; left: 10px; right: 10px;
  height: 30px;
  display: flex; align-items: center; justify-content: center;
  background: linear-gradient(180deg, #f5eedd, #e2d8c2);
  border: 2px solid rgba(0, 0, 0, 0.4);
  border-radius: 6px;
  color: #2a2226;
  font-size: 15px; font-weight: 900;
  letter-spacing: 1px;
  white-space: nowrap; overflow: hidden;
  padding: 0 4px;
  box-shadow: 0 2px 0 rgba(0, 0, 0, 0.35);
}
.pc-art-window {
  position: absolute; top: 46px; left: 14px; right: 14px; height: 106px;
  display: flex; align-items: center; justify-content: center;
  border: 3px solid rgba(0, 0, 0, 0.45);
  border-radius: 8px;
  box-shadow: inset 0 3px 10px rgba(0, 0, 0, 0.5), 0 1px 0 rgba(255, 255, 255, 0.14);
  overflow: hidden;
}
.pc-pix {
  width: 84px; height: 84px;
  image-rendering: pixelated;
  filter: drop-shadow(0 3px 0 rgba(0, 0, 0, 0.4));
}
.pc-rarity-strip {
  position: absolute; bottom: 8px; left: 14px; right: 14px;
  height: 20px;
  display: flex; align-items: center; justify-content: center;
  border-radius: 5px;
  border: 2px solid rgba(0, 0, 0, 0.4);
  color: rgba(255, 255, 255, 0.92);
  font-size: 12px; font-weight: 900;
  letter-spacing: 3px;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
}

/* ---- 官方精灵卡面（§12：2x 定位 + pixelated） ---- */
.pc-sprite {
  position: absolute; inset: 0;
  background-repeat: no-repeat;
  image-rendering: pixelated;
}
.pc-sprite-soul { pointer-events: none; }

/* ---- 背面：程序化红底菱形交叉纹 + 官方红背精灵覆盖 ---- */
.pc-backside {
  transform: rotateY(180deg);
  background: #a02418;
}
.pc-back-pattern {
  position: absolute; inset: 6px;
  border-radius: 6px;
  background:
    radial-gradient(circle at 9px 9px, rgba(255, 232, 200, 0.22) 2.5px, transparent 3.5px),
    repeating-linear-gradient(45deg, rgba(60, 8, 4, 0.32) 0 2px, transparent 2px 16px),
    repeating-linear-gradient(-45deg, rgba(60, 8, 4, 0.32) 0 2px, transparent 2px 16px),
    linear-gradient(160deg, #c23a2c, #7e1a10);
  background-size: 18px 18px, auto, auto, auto;
  box-shadow:
    inset 0 0 0 3px rgba(255, 240, 220, 0.28),
    inset 0 0 22px rgba(0, 0, 0, 0.35);
}
.pc-back-sprite {
  position: absolute; inset: 0;
  background-repeat: no-repeat;
  image-rendering: pixelated;
}

/* ---- §21 半张碎片：正面右半锯齿撕掉（只裁正面，背面保持完整不剧透） ---- */
.pc-card.fragment .pc-front {
  clip-path: polygon(
    0% 0%, 50% 0%,
    46% 5%, 53% 11%, 47% 17%, 52% 24%, 46% 31%, 53% 38%, 47% 45%, 52% 52%,
    46% 59%, 53% 66%, 47% 73%, 52% 80%, 46% 87%, 51% 94%, 48% 100%,
    0% 100%
  );
}

/* ---- 高光 ---- */
.pc-gloss { position: absolute; inset: 0; pointer-events: none; }

/* ---- 版本着色（噪点 canvas 叠加 + CSS 动画，离屏暂停） ---- */
.pc-edition-layer {
  position: absolute; inset: 0; pointer-events: none; border-radius: inherit;
  mix-blend-mode: overlay;
}
.pc-wrap:not(.inview) .pc-edition-layer { animation-play-state: paused; }
/* §20① foil 重做：原 4% 窄硬双色带（48%/52% 硬停 + 0.55 高 alpha）被读成
  「斜下移动的矩形框」；改为羽化柔光带（带宽 ≈ 卡面 1/3，亮核 ≈ 8%），
  screen 混合、峰值 0.34，扫过时是柔和斜向高光而非可见边框 */
.ed-foil .pc-edition-layer {
  background-image:
    var(--noise-url),
    linear-gradient(48deg,
      transparent 43%,
      rgba(205, 232, 255, 0.12) 47%,
      rgba(255, 255, 255, 0.34) 50%,
      rgba(205, 232, 255, 0.12) 53%,
      transparent 57%);
  background-size: 64px 64px, 260% 260%;
  animation: foilSweep 3.2s ease-in-out infinite;
  mix-blend-mode: screen;
}
@keyframes foilSweep {
  0% { background-position: 0 0, 130% 130%; }
  100% { background-position: 0 0, -30% -30%; }
}
.ed-holo .pc-edition-layer {
  background-image:
    var(--noise-url),
    linear-gradient(115deg, rgba(255,0,80,0.14), rgba(255,200,0,0.14), rgba(0,255,150,0.14), rgba(0,150,255,0.14), rgba(180,0,255,0.14));
  background-size: 64px 64px, 400% 400%;
  animation: holoFlow 4s linear infinite;
}
@keyframes holoFlow {
  0% { background-position: 0 0, 0% 50%; filter: hue-rotate(0deg); }
  100% { background-position: 0 0, 100% 50%; filter: hue-rotate(40deg); }
}
.ed-poly .pc-edition-layer {
  border: 2px solid transparent;
  background-image:
    var(--noise-url),
    linear-gradient(90deg, rgba(255,80,80,0.25), rgba(255,220,80,0.25), rgba(80,255,120,0.25), rgba(80,160,255,0.25), rgba(200,80,255,0.25));
  background-size: 64px 64px, auto;
  animation: polyHue 4s linear infinite;
}
@keyframes polyHue {
  0% { filter: hue-rotate(0deg); }
  100% { filter: hue-rotate(360deg); }
}
.ed-poly .pc-front { animation: polyHue 4s linear infinite; }
.pc-wrap:not(.inview) .pc-front { animation-play-state: paused; }
.ed-negative .pc-front {
  filter: invert(1) hue-rotate(180deg);
  box-shadow: 0 0 12px rgba(180,120,255,0.6), inset 0 0 0 3px rgba(200,150,255,0.7) !important;
}

/* ---- 触发抖动 ---- */
.pc-card.shaking { animation: trigShake 0.3s linear; }
@keyframes trigShake {
  0%, 100% { transform: translateX(0); }
  20% { transform: translateX(-4px); }
  40% { transform: translateX(4px); }
  60% { transform: translateX(-3px); }
  80% { transform: translateX(3px); }
}

/* ---- 飘字 ---- */
.pc-floats { position: absolute; inset: 0; pointer-events: none; z-index: 10; }
.pc-float {
  position: absolute; top: 20%; left: 50%; transform: translateX(-50%);
  font-family: 'm6x11', 'PingFang SC', monospace;
  font-size: 15px; font-weight: 900;
  text-shadow: 0 2px 3px #000; white-space: nowrap;
  animation: floatUp 0.9s ease-out forwards;
}
.fk-chips { color: #50a0ff; }
.fk-mult { color: #ff5050; }
.fk-money { color: #ffd700; }
.fk-xmult { color: #ff8020; }
@keyframes floatUp {
  0% { opacity: 0; transform: translate(-50%, 10px); }
  15% { opacity: 1; }
  100% { opacity: 0; transform: translate(-50%, -40px); }
}
</style>
