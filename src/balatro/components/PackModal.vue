<template>
  <div class="pm-overlay" :class="[phase === 'burst' ? shakeClass : '', { 'pm-pulse': pulseShake }]">
    <div class="pm-stage">
      <div class="pm-title">{{ packState.def.name }}</div>

      <!-- 未拆封 / 撕裂 / 爆开（§14：锯齿裂缝 zip → 两瓣分离 + 白闪 + 碎屑 + 震屏） -->
      <div
        v-if="phase === 'sealed' || phase === 'tearing' || phase === 'burst'"
        class="pm-sealed-wrap"
        @click="tear"
      >
        <div class="pm-pack" :class="{ tearing: phase === 'tearing', bursting: phase === 'burst' }">
          <template v-if="packSprite">
            <!-- 包体（tearing 时被锯齿裂缝从左上啃到右） -->
            <div v-if="phase !== 'burst'" class="pm-pack-part bottom" :style="[packSprite, bodyClipStyle, bodyStretchStyle]"></div>
            <!-- 上半撕条（tearing：锯齿 clip + 绕附着点揉皱；burst：旋转飞走） -->
            <div v-if="phase !== 'sealed'" class="pm-pack-part top" :style="[packSprite, topClipStyle, topCrumpleStyle]"></div>
            <!-- 爆开：包体左右两瓣分离坠落 -->
            <template v-if="phase === 'burst'">
              <div class="pm-pack-part half half-l" :style="[packSprite, { clipPath: halfClips.L }]"></div>
              <div class="pm-pack-part half half-r" :style="[packSprite, { clipPath: halfClips.R }]"></div>
              <div class="pm-flash"></div>
            </template>
            <!-- 撕裂前沿光点（裂缝 zip 的刀尖） -->
            <div v-if="phase === 'tearing'" class="pm-tear-front" :style="tearFrontStyle"></div>
            <!-- 裂缝两侧拉伸高光/暗边（1-2px 锯齿条带，随撕裂进度延伸） -->
            <template v-if="phase === 'tearing' && crackEdges">
              <div class="pm-pack-part pm-crack-light" :style="[packSprite, { clipPath: crackEdges.light }]"></div>
              <div class="pm-pack-part pm-crack-shadow" :style="[packSprite, { clipPath: crackEdges.shadow }]"></div>
            </template>
            <div v-if="phase === 'sealed'" class="pm-glint"></div>
            <!-- 爆开塑料碎屑（重力坠落） -->
            <span v-for="p in plastics" :key="p.i" class="pm-plastic" :style="p.style"></span>
          </template>
          <!-- 兜底：无精灵时退回渐变 + motif -->
          <template v-else>
            <div class="pm-pack-fallback" :style="{ background: `linear-gradient(160deg, ${packState.def.art?.bg || '#4a3a6a'}, #14101c 140%)` }">
              <span class="pm-pack-motif">{{ motif }}</span>
              <span class="pm-pack-name">{{ packState.def.nameEn }}</span>
            </div>
          </template>
        </div>
        <div class="pm-hint">{{ phase === 'sealed' ? '点击撕开' : phase === 'tearing' ? '撕开封条…' : '砰！' }}</div>
      </div>

      <!-- 已展开 -->
      <template v-else>
        <div class="pm-fan" :class="{ 'pm-t4wait': suspenseIdx >= 0 && suspenseTier === 4 }" :style="{ '--n': packState.options.length }">
          <div
            v-for="(opt, i) in packState.options"
            :key="i"
            class="pm-slot"
            :class="{
              taken: packState.picked.includes(i),
              selected: pickMode && pickSel.includes(i),
              suspense: suspenseIdx === i,
              ['sus-t' + suspenseTier]: suspenseIdx === i,
              flying: flying,
            }"
            :style="slotStyle(i, opt)"
          >
            <PlayingCard
              :card="opt.kind === 'playing' ? opt.card : null"
              :def="opt.kind === 'playing' ? null : BY_ID[opt.id]"
              :kind="cardKind(opt)"
              :edition="opt.kind === 'playing' ? opt.card.edition : opt.edition"
              :back="packBack"
              :fragment="!!opt.fragment"
              :face-down="!flipped.has(i)"
              :dealt="dealtIn"
              :deal-delay="i * 70"
              :width="cardWidth"
              @click="onCardClick(i, opt, $event)"
            />
            <!-- §16② 首开 NEW 徽章（像素贴纸：pop-in + 抖动） -->
            <div v-if="flipped.has(i) && firstNewSet.has(opt.id)" class="pm-new-badge">NEW!</div>
            <!-- §15 分级揭晓粒子（t2 6 绿 / t3 10 混色 / t4 20 金，动态生成） -->
            <div v-if="particles.idx === i" class="pm-particles">
              <span v-for="p in particles.list" :key="p.k" class="pm-particle" :style="p.style"></span>
            </div>
            <div v-if="flipped.has(i)" class="pm-opt-name">{{ optName(opt) }}</div>
          </div>
        </div>

        <div class="pm-bar">
          <div class="pm-actions">
            <template v-if="pickMode">
              <button
                class="bt-btn primary"
                :disabled="flying || pickSel.length < 1"
                @click="confirmPick"
              >收下所选（{{ pickSel.length }}/{{ packState.choose }}）</button>
              <button
                class="bt-btn"
                :disabled="flying"
                @click="emit('skip')"
              >跳过</button>
            </template>
            <button
              v-else
              class="pm-collect-btn"
              :disabled="flying || collecting"
              @click="collectAllNow"
            >{{ collecting ? '翻牌中…' : '全部收下' }}</button>
          </div>
        </div>
      </template>
    </div>

    <!-- §14 细看视图：FLIP 从扇形位飞入居中 3x，速度倾斜 + 版本着色器 live（§16：纯 3D 细看，无选卡） -->
    <div v-if="inspect" class="pm-inspect" :class="{ in: inspectIn }" @click.self="closeInspect">
      <div class="pm-inspect-mover" :style="moverStyle">
        <PlayingCard
          :card="inspect.opt.kind === 'playing' ? inspect.opt.card : null"
          :def="inspect.opt.kind === 'playing' ? null : BY_ID[inspect.opt.id]"
          :kind="cardKind(inspect.opt)"
          :edition="inspect.opt.kind === 'playing' ? inspect.opt.card.edition : inspect.opt.edition"
          :back="packBack"
          :fragment="!!inspect.opt.fragment"
          :width="INSPECT_W"
          :tilt-scale="1.8"
          :selectable="false"
          @click="closeInspect"
        />
      </div>
      <div class="pm-inspect-info">
        <div class="pm-inspect-name">{{ optName(inspect.opt) }}</div>
        <div v-if="inspectText" class="pm-inspect-text">{{ inspectText }}</div>
        <div v-if="inspectTextEn" class="pm-inspect-text-en">{{ inspectTextEn }}</div>
        <div class="pm-inspect-actions">
          <button class="pm-ibtn" @click="closeInspect">返回</button>
        </div>
        <div class="pm-inspect-tip">移动鼠标 3D 细看 · 点击卡面或空白处返回</div>
      </div>
    </div>
  </div>
</template>

<script setup>
// PackModal（§3.4 → §14 动画重做 → §15③ 稀有度差异化翻卡 → §16① 取消强制选卡/② NEW 徽章）：开包演出
// sealed（锯齿撕条区 + 呼吸/扫光）→ tearing（锯齿裂缝 zip 500ms，crinkle 同步）
// → burst（撕条旋转飞走 + 包体两瓣分离 + 白闪 + 16 碎屑重力坠落 + 震屏 轻/中/强）
// → open（爆开发牌 overshoot 扇形）→ 点击翻牌（t1 秒翻 / t2 绿边光 200ms / t3 悬念 400ms+槽抖动
// / t4 金脉冲 700ms+兄弟变暗+金爆 20 粒子+小震屏；foil+ 升 1 档封顶；首开卡翻开后挂 NEW! 贴纸）
// → 点击已翻牌 = 纯 3D 细看 →「全部收下」所有卡一起飞入图鉴（或「跳过」放弃整包）
// FIDELITY: 原作秘术/幻灵包内卡牌可当场立即使用，此处统一先飞入消耗牌栏
import { ref, computed } from 'vue'
import PlayingCard from './PlayingCard.vue'
import { BY_ID } from '../data/index.js'
import { SPRITE_MAP, ATLAS_META } from '../data/spriteMap.js'
import { sound } from '../sound.js'

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

// §20④ 卡背按包类型区分（官方卡背精灵：秘术=紫 b_magic / 天体=青 b_nebula
//   / 标准=经典蓝 b_blue / 幻灵=黑紫 b_ghost / 小丑=红 b_red）
const PACK_BACKS = { arcana: 'b_magic', celestial: 'b_nebula', standard: 'b_blue', spectral: 'b_ghost', buffoon: 'b_red' }

const props = defineProps({
  packState: { type: Object, required: true },   // { packId, def, options, choose, picked }
  jokersFull: { type: Boolean, default: false },
  consumablesFull: { type: Boolean, default: false },
  // E3 远征局内开包：true 时点击已翻卡 = 选中/取消（上限 choose），底栏变「收下所选/跳过」
  pickMode: { type: Boolean, default: false },
})
const emit = defineEmits(['collectAll', 'skip', 'pick'])

const phase = ref('sealed') // 'sealed'|'tearing'|'burst'|'open'|'flying'
const dealtIn = ref(false)
const flipped = ref(new Set())
const chosen = ref([])
const pickSel = ref([])     // pickMode：已选中的槽位下标
const suspenseIdx = ref(-1)
const suspenseTier = ref(0) // §15 悬念中的翻卡档位 2/3/4
const particles = ref({ idx: -1, list: [] }) // §15 动态粒子 { idx, list:[{k,style}] }
const pulseShake = ref(false) // §15 传奇揭晓小震屏
const flying = ref(false)

const MOTIFS = { arcana: '🔮', celestial: '🪐', standard: '🂠', spectral: '👻', buffoon: '🃏' }
const motif = computed(() => MOTIFS[props.packState.def.packType] || props.packState.def.art?.motif || '📦')
const packBack = computed(() => PACK_BACKS[props.packState.def.packType] || 'b_red')

// ---- §13 官方卡包精灵（boosters 图集，3x 渲染 213×285） ----
const PACK_SCALE = 3
const packSprite = computed(() => {
  const s = SPRITE_MAP[props.packState.packId]
  if (!s) return null
  const m = ATLAS_META[s.atlas]
  const T = PACK_SCALE
  return {
    backgroundImage: `url(${m.url})`,
    backgroundSize: `${m.cols * 71 * T}px ${m.rows * 95 * T}px`,
    backgroundPosition: `-${s.x * 71 * T}px -${s.y * 95 * T}px`,
  }
})

// ================= §14① 锯齿裂缝撕裂（§20⑥ 结构升级） =================
// 裂缝路径：36 段细密不规则锯齿（百分比坐标，y = 距顶高度）
// 细齿为主 + 偶发大缺口；撕裂前沿带垂直 jitter
// §20⑥ 三层手感：薄膜拉伸（起手撕条被拉长再断裂）→ 断裂点沿锯齿逐个爆开
//   （perforation 步进：每齿 45% 时间快速推进、55% 停顿咬合）→ 全程先慢后快
//   （p^1.65 阻力曲线，起手有拉扯感）+ 断裂瞬间包体回弹下沉
const JAG_N = 36
const jag = ref([])
const tearP = ref(0)    // 0→1 撕裂进度（经阻力曲线+步进后的实际裂缝位置）
const rawP = ref(0)     // 0→1 原始线性时间进度（拉伸相位用）
const tearPulse = ref(1) // 爆齿脉冲：刚爆开时前沿光点放大发亮，停顿期衰减
const clampN = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

// 阻力曲线 + perforation 步进
const TEAR_SEGS = 22
function tearAdvance(p) {
  // 起手慢（膜有拉伸阻力），中后段加速释放
  const base = Math.pow(p, 1.65)
  // 逐个爆开：每齿段 45% 时间快速推进，55% 停顿（齿间咬合感）
  const s = base * TEAR_SEGS
  const si = Math.min(TEAR_SEGS, Math.floor(s))
  const sf = s - si
  const pop = Math.min(1, sf / 0.45)
  const f = (si + pop) / TEAR_SEGS
  // 爆开瞬间脉冲 1.45 → 停顿末 0.85
  const pulse = pop < 1 ? 1.45 - pop * 0.6 : 0.8
  return { f, pulse }
}
// 薄膜拉伸相位：起手 0~30% 时间内撕条被拉长 ~13% 再随断裂释放（sin 包络）
const stretchAmt = computed(() => {
  if (phase.value !== 'tearing') return 0
  const p = rawP.value
  return p < 0.3 ? Math.sin((p / 0.3) * Math.PI) : 0
})

function genJag() {
  const pts = []
  const base = 13 + Math.random() * 6 // 撕条区 13-19%
  // 偶发大缺口：随机 2-3 个齿位加深
  const gapAt = new Set()
  const gaps = 2 + Math.floor(Math.random() * 2)
  while (gapAt.size < gaps) gapAt.add(2 + Math.floor(Math.random() * (JAG_N - 3)))
  for (let i = 0; i <= JAG_N; i++) {
    const x = (i / JAG_N) * 100
    let y = base
    if (i > 0) {
      if (gapAt.has(i)) {
        // 大缺口：单向深咬 4.5-8%
        y = base + 4.5 + Math.random() * 3.5
      } else {
        // 细齿：±0.7-2.4% 快交替
        const tooth = (i % 2 === 0 ? 1 : -1) * (0.7 + Math.random() * 1.7)
        y = base + tooth + (Math.random() - 0.5) * 1.4
      }
      y = clampN(y, 6, 32)
    }
    pts.push({ x, y })
  }
  jag.value = pts
}
function jagYAt(fx) {
  const pts = jag.value
  if (!pts.length) return 16
  for (let i = 0; i < pts.length - 1; i++) {
    if (fx <= pts[i + 1].x) {
      const t = (fx - pts[i].x) / (pts[i + 1].x - pts[i].x)
      return pts[i].y + t * (pts[i + 1].y - pts[i].y)
    }
  }
  return pts[pts.length - 1].y
}
// 撕裂前沿垂直 jitter：确定性强抖动（进度驱动，每帧可复现）
function frontJitter() {
  const p = tearP.value
  return Math.sin(p * 61) * 0.55 + Math.sin(p * 143 + 1.7) * 0.3
}
// 包体：裂缝以下（已撕开段）+ 裂缝右侧未撕段整体保留
const bodyClipStyle = computed(() => {
  if (phase.value !== 'tearing' || jag.value.length < 2) return {}
  const fx = tearP.value * 100
  const fy = jagYAt(fx) + frontJitter()
  const pts = jag.value.filter(p => p.x <= fx).map(p => `${p.x}% ${p.y}%`).join(', ')
  return { clipPath: `polygon(0% ${jag.value[0].y}%, ${pts}, ${fx}% ${fy}%, ${fx}% 0%, 100% 0%, 100% 100%, 0% 100%)` }
})
// 上半撕条：裂缝以上、撕裂前沿以左
const topClipStyle = computed(() => {
  if (jag.value.length < 2) return {}
  const fx = tearP.value * 100
  const fy = jagYAt(fx) + frontJitter()
  const pts = jag.value.filter(p => p.x <= fx).reverse().map(p => `${p.x}% ${p.y}%`).join(', ')
  return { clipPath: `polygon(0% 0%, ${fx}% 0%, ${fx}% ${fy}%${pts ? ', ' + pts : ''})` }
})
// 裂缝两侧拉伸高光/暗边：沿已撕段的 1-2px 锯齿条带（包高 285px，0.55% ≈ 1.6px）
const crackEdges = computed(() => {
  if (phase.value !== 'tearing' || jag.value.length < 2) return null
  const BAND = 0.55
  const fx = tearP.value * 100
  if (fx < 2) return null
  const fy = jagYAt(fx) + frontJitter()
  const seg = jag.value.filter(p => p.x <= fx)
  const up = seg.map(p => `${p.x}% ${p.y - BAND}%`).join(', ')
  const mid = seg.map(p => `${p.x}% ${p.y}%`).join(', ')
  const down = seg.map(p => `${p.x}% ${p.y + BAND}%`).reverse().join(', ')
  return {
    // 高光带：裂缝上缘（撕条下缘的亮边）
    light: `polygon(0% ${jag.value[0].y - BAND}%, ${up}, ${fx}% ${fy - BAND}%, ${fx}% ${fy}%, ${mid})`,
    // 暗边带：裂缝下缘（包体上缘的投影）
    shadow: `polygon(0% ${jag.value[0].y}%, ${mid}, ${fx}% ${fy}%, ${fx}% ${fy + BAND}%, ${down})`,
  }
})
// 揉皱：绕撕裂前沿附着点 多角度扭曲 + 边缘明暗交替（§20⑥ 叠加薄膜拉伸）
const topCrumpleStyle = computed(() => {
  if (phase.value === 'burst') return {} // 飞走交给 CSS 动画
  const p = tearP.value
  const fx = p * 100
  const fy = jagYAt(fx) + frontJitter()
  const st = stretchAmt.value
  return {
    transformOrigin: `${fx}% ${fy}%`,
    transform: `translate(${-p * 16}px, ${-p * 10 - st * 9}px) rotate(${-p * 15}deg) skew(${p * 7}deg, ${-p * 4}deg) scale(${1 + p * 0.02}, ${(1 - p * 0.03) * (1 + st * 0.13)})`,
    // 明暗交替：揉皱的塑料反光随进度抖动；拉伸期额外提亮（膜被拉薄泛白）
    filter: `brightness(${1 + p * 0.22 + st * 0.3 + Math.sin(p * 34) * 0.09})`,
  }
})
// §20⑥ 包体薄膜拉伸：起手撕条被拉长时，包体上半被轻微向上带起（反向张力）
const bodyStretchStyle = computed(() => {
  const st = stretchAmt.value
  if (st <= 0.01 || phase.value !== 'tearing') return {}
  return { transform: `translateY(${st * 3}px) scaleY(${1 + st * 0.02})`, transformOrigin: '50% 100%' }
})
const tearFrontStyle = computed(() => {
  const fx = tearP.value * 100
  const s = tearPulse.value
  return {
    left: fx + '%',
    top: (jagYAt(fx) + frontJitter()) + '%',
    // §20⑥ 爆齿脉冲：刚爆开时前沿光点放大发亮，停顿期收回
    transform: `scale(${s})`,
    opacity: 0.55 + s * 0.3,
  }
})

// ================= §14② 爆开 + 震屏 =================
const halfClips = ref({ L: '', R: '' })
function computeHalfClips() {
  const midY = jagYAt(50)
  const left = jag.value.filter(p => p.x <= 50).map(p => `${p.x}% ${p.y}%`).join(', ')
  const right = jag.value.filter(p => p.x >= 50).map(p => `${p.x}% ${p.y}%`).join(', ')
  halfClips.value = {
    L: `polygon(0% ${jag.value[0].y}%, ${left}, 50% 100%, 0% 100%)`,
    R: `polygon(50% ${midY}%, ${right}, 100% 100%, 50% 100%)`,
  }
}
// 震屏强度：normal 轻 / jumbo 中 / mega 强
const shakeClass = computed(() => {
  const id = props.packState.packId || ''
  if (id.includes('mega')) return 'pm-shake-strong'
  if (id.includes('jumbo')) return 'pm-shake-mid'
  return 'pm-shake-light'
})
// 塑料碎屑（爆开时生成：向外抛射 + 重力坠落）
const plastics = ref([])
function genPlastics() {
  plastics.value = Array.from({ length: 16 }, (_, i) => {
    const ang = Math.random() * Math.PI * 2
    const dist = 70 + Math.random() * 140
    return {
      i,
      style: {
        left: `${18 + Math.random() * 64}%`,
        top: `${6 + Math.random() * 18}%`,
        width: `${5 + Math.random() * 9}px`,
        height: `${4 + Math.random() * 7}px`,
        '--dx': `${Math.cos(ang) * dist}px`,
        '--dy': `${Math.sin(ang) * dist - 90}px`,
        '--fall': `${150 + Math.random() * 170}px`,
        '--rot': `${(Math.random() - 0.5) * 720}deg`,
        '--dur': `${0.6 + Math.random() * 0.35}s`,
      },
    }
  })
}

function tear() {
  if (phase.value !== 'sealed') return
  phase.value = 'tearing'
  tearP.value = 0
  rawP.value = 0
  tearPulse.value = 1
  genJag()
  sound.crinkle()
  // 音效同步收紧：三簇揉纸声压在撕裂窗口内（540ms：起手 / 拉伸释放 / 尾段）
  setTimeout(() => { if (phase.value === 'tearing') sound.crinkle() }, 210)
  setTimeout(() => { if (phase.value === 'tearing') sound.crinkle() }, 390)
  const T0 = performance.now()
  const DUR = 540
  const step = (t) => {
    if (phase.value !== 'tearing') return
    const p = Math.min(1, (t - T0) / DUR)
    rawP.value = p
    const adv = tearAdvance(p)
    tearP.value = adv.f
    tearPulse.value = adv.pulse
    if (p < 1) requestAnimationFrame(step)
    else burst()
  }
  requestAnimationFrame(step)
}
function burst() {
  computeHalfClips()
  genPlastics()
  phase.value = 'burst'
  sound.zip()
  sound.thump() // §19 爆开低频 thump（开包=撕裂+低频爆开 分层听感）
  setTimeout(() => {
    phase.value = 'open'
    plastics.value = []
    // 触发爆开发牌（overshoot 扇形）
    requestAnimationFrame(() => { dealtIn.value = true })
  }, 520)
}

// ================= §14③ 3D 细看 =================
const INSPECT_W = 240
const inspect = ref(null)    // { opt, i, from: { dx, dy, s } }
const inspectIn = ref(false) // FLIP 第二帧置 true → 飞入居中

function openInspect(i, opt, ev) {
  if (phase.value !== 'open' || !flipped.value.has(i) || props.packState.picked.includes(i)) return
  const el = ev?.currentTarget || ev?.target?.closest?.('.pc-wrap')
  const r = el?.getBoundingClientRect?.()
  const from = r
    ? {
        dx: r.left + r.width / 2 - window.innerWidth / 2,
        dy: r.top + r.height / 2 - window.innerHeight / 2,
        s: r.width / INSPECT_W,
      }
    : { dx: 0, dy: 60, s: 0.3 }
  inspect.value = { opt, i, from }
  inspectIn.value = false
  sound.flip()
  requestAnimationFrame(() => requestAnimationFrame(() => { inspectIn.value = true }))
}
function closeInspect() {
  if (!inspect.value) return
  inspectIn.value = false
  sound.click()
  setTimeout(() => { inspect.value = null }, 280)
}
const moverStyle = computed(() => {
  if (!inspect.value || inspectIn.value) return {}
  const f = inspect.value.from
  return { transform: `translate(${f.dx}px, ${f.dy}px) scale(${f.s})`, opacity: 0.35 }
})
const PLAYING_TEXTS = {
  bonus: '奖励牌：+30 筹码', mult: '倍率牌：+4 倍率', wild: '万能牌：视为任意花色',
  glass: '玻璃牌：×2 倍率，1/4 概率碎裂', steel: '钢铁牌：手持时 ×1.5 倍率',
  stone: '石头牌：无点数无花色，+50 筹码', gold: '黄金牌：回合结束 +$3',
  lucky: '幸运牌：1/5 +20 倍率，1/15 +$20',
}
const inspectText = computed(() => {
  const opt = inspect.value?.opt
  if (!opt) return ''
  if (opt.kind === 'playing') return PLAYING_TEXTS[opt.card.enhancement] || '扑克牌'
  return BY_ID[opt.id]?.text || ''
})
const inspectTextEn = computed(() => {
  const opt = inspect.value?.opt
  if (!opt || opt.kind === 'playing') return ''
  return BY_ID[opt.id]?.textEn || ''
})

// §16② 首开 NEW 徽章集合（store 开包时计算，见过即发现之前）
const firstNewSet = computed(() => new Set(props.packState.firstNew || []))

const cardWidth = computed(() => (props.packState.options.length >= 5 ? 72 : 82))

function cardKind(opt) {
  if (opt.kind === 'playing') return 'playing'
  if (opt.kind === 'joker') return 'joker'
  return BY_ID[opt.id]?.type || opt.kind
}
function optName(opt) {
  if (opt.kind === 'playing') {
    const R = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' }
    const S = { spades: '♠', hearts: '♥', clubs: '♣', diamonds: '♦' }
    return `${R[opt.card.rank] || opt.card.rank}${S[opt.card.suit] || ''}`
  }
  return BY_ID[opt.id]?.name || ''
}
function flyTarget(opt) {
  if (opt.kind === 'joker') return 'joker'
  if (opt.kind === 'playing') return 'deck'
  return 'consumable'
}
// 飞行动画目标：栏位方向（小丑→上左，消耗→上右，扑克→下中牌堆）
// §14 --bx：爆开发牌时各槽位到扇形中心的水平偏移（边位飞得更远）
function slotStyle(i, opt) {
  const style = { '--bx': ((props.packState.options.length - 1) / 2 - i) * 44 + 'px' }
  if (flying.value && chosen.value.includes(i)) {
    const t = flyTarget(opt)
    if (t === 'joker') style.transform = 'translate(-38vw, -42vh) scale(0.4) rotate(-14deg)'
    else if (t === 'consumable') style.transform = 'translate(38vw, -42vh) scale(0.4) rotate(14deg)'
    else style.transform = 'translate(0, 46vh) scale(0.35) rotate(6deg)'
    style.opacity = '0'
    style.transition = 'transform 0.6s cubic-bezier(0.5, -0.1, 0.3, 1), opacity 0.6s'
  }
  return style
}

// ================= §15③ 稀有度差异化翻卡 =================
// 档位：t1 普通秒翻 / t2 罕见 200ms 绿边光+6 绿粒子 / t3 稀有 400ms 悬念+10 粒子+槽抖动
//       / t4 传奇 700ms 兄弟变暗+金脉冲+20 金粒子+小震屏；foil+ 版本升 1 档（传奇封顶）
const FLIP_WAIT = { 2: 200, 3: 400, 4: 700 }
const PARTICLE_CONF = {
  2: { n: 6, colors: ['#81c784', '#c8e6c9', '#4caf50'] },
  3: { n: 10, colors: ['#ffd54f', '#ffffff', '#ffab91'] },
  4: { n: 20, colors: ['#ffd54f', '#fff176', '#ffecb3', '#ffb300'] },
}
function flipTier(opt) {
  let t = 1
  if (opt.kind === 'joker') {
    t = Math.min(4, Math.max(1, BY_ID[opt.id]?.rarity || 1))
  } else if (opt.kind === 'spectral' && BY_ID[opt.id]?.rare) {
    t = 3 // 灵魂/黑洞等稀世幻灵维持稀有档
  }
  const ed = opt.kind === 'playing' ? opt.card?.edition : opt.edition
  if (ed && ed !== 'base') t = Math.min(4, t + 1) // foil+ 升 1 档，封顶
  return t
}
function genParticles(n, colors) {
  return Array.from({ length: n }, (_, k) => {
    const ang = Math.random() * Math.PI * 2
    const dist = 38 + Math.random() * 44
    return {
      k,
      style: {
        '--dx': `${Math.cos(ang) * dist}px`,
        '--dy': `${Math.sin(ang) * dist}px`,
        background: colors[k % colors.length],
      },
    }
  })
}

// §20⑤ 翻牌提取为可等待单元：tier1 秒翻；t2-t4 悬念档结束后 resolve
function flipCard(i, opt) {
  const tier = flipTier(opt)
  if (tier === 1) {
    flipped.value = new Set([...flipped.value, i])
    sound.flip()
    return Promise.resolve()
  }
  suspenseIdx.value = i
  suspenseTier.value = tier
  if (tier >= 3) sound.suspense()
  return new Promise((resolve) => setTimeout(() => {
    suspenseIdx.value = -1
    suspenseTier.value = 0
    flipped.value = new Set([...flipped.value, i])
    const conf = PARTICLE_CONF[tier]
    particles.value = { idx: i, list: genParticles(conf.n, conf.colors) }
    if (tier === 2) sound.flip()
    else sound.rareReveal()
    if (tier === 4) {
      pulseShake.value = true
      setTimeout(() => { pulseShake.value = false }, 320)
    }
    setTimeout(() => { if (particles.value.idx === i) particles.value = { idx: -1, list: [] } }, 900)
    resolve()
  }, FLIP_WAIT[tier]))
}

function onCardClick(i, opt, ev) {
  if (phase.value !== 'open' || collecting.value || props.packState.picked.includes(i)) return
  // 未翻开 → 翻牌（按档位差异化演出）
  if (!flipped.value.has(i)) {
    if (suspenseIdx.value >= 0) return // 一次只悬念一张
    flipCard(i, opt)
    return
  }
  // 已翻开：pickMode = 选中/取消；否则 §14 3D 细看
  if (props.pickMode) {
    togglePick(i)
    return
  }
  openInspect(i, opt, ev)
}

// pickMode：选中/取消（上限 choose，满后再点新卡 = 替换最早选择）
function togglePick(i) {
  const idx = pickSel.value.indexOf(i)
  if (idx >= 0) {
    pickSel.value.splice(idx, 1)
    sound.click()
    return
  }
  if (pickSel.value.length >= (props.packState.choose || 1)) pickSel.value.shift()
  pickSel.value.push(i)
  sound.click()
}

// pickMode：收下所选（选中槽位起飞后 emit pick）
function confirmPick() {
  if (flying.value || pickSel.value.length < 1) return
  flying.value = true
  phase.value = 'flying'
  chosen.value = [...pickSel.value]
  sound.coin()
  const indices = [...pickSel.value]
  setTimeout(() => emit('pick', indices), 640)
}

// §16① 全部收下：所有卡一起飞入图鉴（不再强制选 N 张）
// §20⑤ 强制翻完再收：存在未翻卡时先自动逐张翻开（stagger 180ms + 沿用稀有度
//   悬念档，一次只悬念一张），全部翻开后再起飞收下；collecting 期间锁按钮与
//   点卡，竞态安全（连点不重复触发）
// §20③ 音效：按钮反馈改为干净单音 coin（移除 click+coin 叠音与尾段 cascade）
const collecting = ref(false)
async function collectAllNow() {
  if (flying.value || collecting.value) return
  const pending = props.packState.options
    .map((_, i) => i)
    .filter(i => !flipped.value.has(i) && !props.packState.picked.includes(i))
  if (pending.length) {
    collecting.value = true
    const jobs = []
    for (const i of pending) {
      // 等上一张悬念揭晓完再翻下一张（一次只悬念一张）
      while (suspenseIdx.value >= 0) await sleep(50)
      jobs.push(flipCard(i, props.packState.options[i]))
      await sleep(180) // stagger 翻牌节奏
    }
    await Promise.all(jobs)
    await sleep(220) // 全部翻开后稍作停留再收
    collecting.value = false
  }
  sound.coin()
  flying.value = true
  phase.value = 'flying'
  chosen.value = props.packState.options.map((_, i) => i) // 全部槽位起飞
  setTimeout(() => emit('collectAll'), 640)
}
</script>

<style scoped>
.pm-overlay {
  position: absolute; inset: 0; z-index: 50;
  display: flex; align-items: center; justify-content: center;
  background: rgba(4, 9, 8, 0.72);
  backdrop-filter: blur(3px);
}
.pm-stage {
  display: flex; flex-direction: column; align-items: center; gap: 20px;
  padding: 26px 34px;
}
.pm-title {
  font-size: 24px; font-weight: 900; letter-spacing: 3px; color: #ffd54f;
  text-shadow: 0 2px 0 rgba(0,0,0,0.5);
}

/* ================= 未拆封：官方像素塑料卡包（boosters 图集 3x） ================= */
.pm-sealed-wrap { display: flex; flex-direction: column; align-items: center; gap: 14px; cursor: pointer; }
.pm-pack {
  position: relative;
  width: 213px; height: 285px;
  animation: packBreath 2.8s ease-in-out infinite;
  filter: drop-shadow(0 12px 18px rgba(0, 0, 0, 0.55));
  user-select: none;
}
.pm-sealed-wrap:hover .pm-pack { filter: drop-shadow(0 14px 22px rgba(0, 0, 0, 0.6)) brightness(1.12); }
.pm-pack-part {
  position: absolute; inset: 0;
  image-rendering: pixelated;
  background-repeat: no-repeat;
}
.pm-pack-part.top { z-index: 2; }
.pm-pack-part.half { z-index: 2; }
/* 裂缝两侧拉伸高光/暗边（条带 clip 复用包体贴图，提亮/压暗即纸边反光） */
.pm-crack-light {
  z-index: 3;
  filter: brightness(2.1) saturate(0.6);
  pointer-events: none;
}
.pm-crack-shadow {
  z-index: 3;
  filter: brightness(0.35);
  pointer-events: none;
}
/* 塑料扫光 */
.pm-glint { position: absolute; inset: 0; z-index: 4; pointer-events: none; overflow: hidden; }
.pm-glint::before {
  content: ""; position: absolute; top: -30%; bottom: -30%; width: 36%; left: -60%;
  background: linear-gradient(105deg, transparent, rgba(255, 255, 255, 0.32), transparent);
  transform: skewX(-18deg);
  animation: glintSweep 3s ease-in-out infinite;
}
/* 撕裂中：整包抖动；撕裂前沿光点 */
.pm-pack.tearing { animation: packShake 0.5s; }
.pm-pack.tearing .pm-glint { display: none; }
.pm-tear-front {
  position: absolute; z-index: 5;
  width: 16px; height: 16px; margin: -8px 0 0 -8px;
  border-radius: 50%;
  background: radial-gradient(circle, #fff 0%, rgba(255, 255, 255, 0.45) 45%, transparent 70%);
  pointer-events: none;
}
/* 爆开：撕条旋转飞走（从揉皱姿态续接）；§20⑥ 断裂瞬间包体回弹下沉 */
.pm-pack.bursting { animation: packRebound 0.36s ease-out; }
@keyframes packRebound {
  0% { transform: translateY(0) scale(1); }
  30% { transform: translateY(7px) scale(0.99); }
  62% { transform: translateY(-2.5px) scale(1.004); }
  100% { transform: translateY(0) scale(1); }
}
.pm-pack.bursting .pm-pack-part.top {
  animation: topFlySpin 0.58s cubic-bezier(0.3, 0.5, 0.6, 1) forwards;
}
@keyframes topFlySpin {
  0% { transform: translate(-14px, -9px) rotate(-13deg) skewX(5deg); opacity: 1; }
  100% { transform: translate(170px, -380px) rotate(560deg) scale(0.6); opacity: 0; }
}
/* 爆开：包体两瓣分离坠落（重力感：先外抛后下落） */
.pm-pack.bursting .half-l { animation: halfL 0.6s cubic-bezier(0.45, 0.05, 0.8, 0.4) forwards; }
.pm-pack.bursting .half-r { animation: halfR 0.6s cubic-bezier(0.45, 0.05, 0.8, 0.4) forwards; }
@keyframes halfL {
  0% { transform: none; opacity: 1; }
  25% { transform: translate(-30px, -16px) rotate(-8deg); }
  100% { transform: translate(-80px, 210px) rotate(-26deg); opacity: 0; }
}
@keyframes halfR {
  0% { transform: none; opacity: 1; }
  25% { transform: translate(30px, -16px) rotate(8deg); }
  100% { transform: translate(80px, 210px) rotate(26deg); opacity: 0; }
}
/* 白闪 */
.pm-flash {
  position: absolute; inset: -60px; z-index: 6; pointer-events: none;
  background: radial-gradient(circle, rgba(255, 255, 255, 0.95) 0%, rgba(255, 255, 255, 0.35) 40%, transparent 70%);
  animation: flashFade 0.38s ease-out forwards;
}
@keyframes flashFade {
  from { opacity: 1; transform: scale(0.6); }
  to { opacity: 0; transform: scale(1.5); }
}
/* 塑料碎屑：抛射 + 重力坠落 */
.pm-plastic {
  position: absolute; z-index: 5;
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.9), rgba(190, 220, 255, 0.3));
  clip-path: polygon(0 0, 100% 22%, 72% 100%, 8% 76%);
  opacity: 0;
  animation: plasticFly var(--dur) ease-out forwards;
}
@keyframes plasticFly {
  0% { opacity: 0; transform: translate(0, 0) rotate(0deg); }
  10% { opacity: 0.95; }
  38% { transform: translate(calc(var(--dx) * 0.75), var(--dy)) rotate(calc(var(--rot) * 0.55)); }
  100% { opacity: 0; transform: translate(var(--dx), var(--fall)) rotate(var(--rot)); }
}
/* 震屏：轻 / 中 / 强（作用于整层 overlay，~300-420ms 衰减） */
.pm-shake-light { animation: shakeLight 0.32s linear; }
.pm-shake-mid { animation: shakeMid 0.36s linear; }
.pm-shake-strong { animation: shakeStrong 0.42s linear; }
@keyframes shakeLight {
  0%, 100% { transform: none; }
  20% { transform: translate(-4px, 2px) rotate(-0.3deg); }
  45% { transform: translate(3px, -2px) rotate(0.25deg); }
  70% { transform: translate(-2px, 1px); }
}
@keyframes shakeMid {
  0%, 100% { transform: none; }
  15% { transform: translate(-8px, 4px) rotate(-0.6deg); }
  35% { transform: translate(7px, -4px) rotate(0.5deg); }
  55% { transform: translate(-5px, 3px) rotate(-0.3deg); }
  75% { transform: translate(3px, -2px); }
}
@keyframes shakeStrong {
  0%, 100% { transform: none; }
  12% { transform: translate(-14px, 8px) rotate(-1.1deg); }
  28% { transform: translate(12px, -7px) rotate(0.9deg); }
  45% { transform: translate(-9px, 5px) rotate(-0.6deg); }
  62% { transform: translate(6px, -4px) rotate(0.4deg); }
  80% { transform: translate(-3px, 2px); }
}
@keyframes packBreath {
  0%, 100% { transform: scale(1) rotate(0deg); }
  50% { transform: scale(1.025) rotate(0.7deg); }
}
@keyframes packShake {
  0%, 100% { transform: translateX(0) rotate(0); }
  20% { transform: translateX(-6px) rotate(-1.6deg); }
  40% { transform: translateX(5px) rotate(1.3deg); }
  60% { transform: translateX(-4px) rotate(-0.8deg); }
  80% { transform: translateX(3px) rotate(0.5deg); }
}
@keyframes glintSweep {
  0%, 55% { left: -60%; }
  90%, 100% { left: 135%; }
}
/* 无图兜底：渐变塑料包 */
.pm-pack-fallback {
  position: absolute; inset: 24px 12px;
  border-radius: 14px;
  border: 3px solid #8a6d9e;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px;
  box-shadow: 0 10px 34px rgba(0, 0, 0, 0.6), inset 0 0 40px rgba(255, 255, 255, 0.05);
}
.pm-pack-motif { font-size: 72px; filter: drop-shadow(0 4px 8px rgba(0,0,0,0.5)); }
.pm-pack-name { font-size: 13px; font-weight: 800; letter-spacing: 1px; color: #d8c9e8; }

/* ================= 扇形展开 ================= */
.pm-fan { display: flex; gap: 14px; align-items: flex-start; }
.pm-slot {
  position: relative;
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  border-radius: 12px; padding: 6px;
  border: 2px solid transparent;
  transition: transform 0.18s, border-color 0.18s, background 0.18s, opacity 0.18s, filter 0.25s;
}
.pm-slot:not(.taken):hover { transform: translateY(-4px); }
.pm-slot.taken { opacity: 0.22; pointer-events: none; }
/* pickMode 选中态：金色描边 + 微抬升 */
.pm-slot.selected {
  border-color: #ffd54f;
  background: rgba(255, 213, 79, 0.10);
  transform: translateY(-6px);
  box-shadow: 0 0 14px rgba(255, 213, 79, 0.35);
}
.pm-slot.suspense { animation: suspensePulse 0.4s infinite; }
@keyframes suspensePulse {
  0%, 100% { filter: brightness(1); }
  50% { filter: brightness(1.5) drop-shadow(0 0 14px rgba(255, 213, 79, 0.7)); }
}
/* §15 t2 罕见：绿边光（200ms 短悬念） */
.pm-slot.suspense.sus-t2 { animation: suspensePulseGreen 0.2s infinite; }
@keyframes suspensePulseGreen {
  0%, 100% { filter: brightness(1); }
  50% { filter: brightness(1.35) drop-shadow(0 0 12px rgba(129, 199, 132, 0.85)); }
}
/* §15 t3 稀有：金脉冲 + 槽位小抖动 */
.pm-slot.suspense.sus-t3 { animation: suspensePulse 0.4s infinite, slotJitter 0.28s infinite; }
@keyframes slotJitter {
  0%, 100% { transform: translate(0, 0); }
  25% { transform: translate(-1.5px, 1px); }
  50% { transform: translate(1.5px, -1px); }
  75% { transform: translate(-1px, -1.5px); }
}
/* §15 t4 传奇：金脉冲（兄弟槽变暗由 .pm-t4wait 负责） */
.pm-slot.suspense.sus-t4 { animation: suspensePulseGold 0.35s infinite; }
@keyframes suspensePulseGold {
  0%, 100% { filter: brightness(1); }
  50% { filter: brightness(1.65) drop-shadow(0 0 20px rgba(255, 179, 0, 0.9)); }
}
.pm-fan.pm-t4wait .pm-slot:not(.suspense):not(.taken) {
  filter: brightness(0.35);
}
/* §15 t4 揭晓小震屏（复用 shakeLight 轨迹，~300ms） */
.pm-overlay.pm-pulse { animation: shakeLight 0.3s linear; }
.pm-slot.flying { pointer-events: none; z-index: 5; }
/* §16② NEW! 像素贴纸（游戏贴纸风：黄底红字、斜贴、pop-in + 抖动） */
.pm-new-badge {
  position: absolute; top: -10px; left: -12px; z-index: 7;
  font-family: 'm6x11', 'PingFang SC', monospace;
  font-size: 13px; font-weight: 900; letter-spacing: 1px;
  color: #b03327;
  background: linear-gradient(160deg, #ffd54f, #f0a830);
  border: 2px solid #7a5a10;
  border-radius: 4px; padding: 2px 7px;
  box-shadow: 0 2px 0 #5c4708, 0 4px 10px rgba(0, 0, 0, 0.55);
  transform: rotate(-9deg);
  animation: newPop 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) both, newWiggle 1.5s ease-in-out 0.45s infinite;
  pointer-events: none;
  text-shadow: 0 1px 0 rgba(255, 255, 255, 0.35);
}
@keyframes newPop {
  from { transform: scale(0.3) rotate(-22deg); opacity: 0; }
}
@keyframes newWiggle {
  0%, 100% { transform: rotate(-9deg) translateY(0); }
  50% { transform: rotate(-5deg) translateY(-3px); }
}
.pm-opt-name { font-size: 11px; color: #cfd8dc; max-width: 88px; text-align: center; }

/* 粒子（§15 动态生成：--dx/--dy/颜色由 JS 注入） */
.pm-particles { position: absolute; inset: 0; pointer-events: none; }
.pm-particle {
  position: absolute; left: 50%; top: 50%;
  width: 6px; height: 6px; border-radius: 50%;
  background: #ffd54f;
  animation: particleFly 0.85s ease-out forwards;
}
@keyframes particleFly {
  0% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
  100% { opacity: 0; transform: translate(calc(-50% + var(--dx)), calc(-50% + var(--dy))) scale(0.3); }
}

.pm-bar { display: flex; flex-direction: column; align-items: center; gap: 10px; }
.pm-hint { font-size: 13px; color: #b0bec5; }
.pm-actions { display: flex; gap: 12px; }

/* ---- 「全部收下」像素按钮（m6x11 金体系，scoped 不污染全局 bt-btn） ---- */
.pm-collect-btn {
  font-family: 'm6x11', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', monospace;
  height: 42px; padding: 0 30px;
  font-size: 16px; font-weight: 900; letter-spacing: 3px;
  color: #4a3200;
  background: linear-gradient(180deg, #ffd968 0%, #f4c14f 55%, #e0a820 100%);
  border: 2px solid #7a5a10;
  border-radius: 6px;
  box-shadow:
    0 3px 0 #5c4708,
    inset 0 2px 0 rgba(255, 255, 255, 0.55),
    inset 0 -3px 0 rgba(122, 90, 16, 0.35);
  text-shadow: 0 1px 0 rgba(255, 255, 255, 0.4);
  cursor: pointer;
  transition: transform 0.08s, filter 0.12s, box-shadow 0.08s;
}
.pm-collect-btn:hover:not(:disabled) {
  filter: brightness(1.08);
  transform: translateY(-1px);
}
.pm-collect-btn:active:not(:disabled) {
  transform: scale(0.94, 0.86);
  box-shadow:
    0 1px 0 #5c4708,
    inset 0 2px 0 rgba(255, 255, 255, 0.4);
}
.pm-collect-btn:disabled { opacity: 0.5; cursor: default; }

/* ================= §14③ 3D 细看覆盖层 ================= */
.pm-inspect {
  position: fixed; inset: 0; z-index: 90;
  display: flex; align-items: center; justify-content: center; gap: 32px;
  background: radial-gradient(ellipse at center, rgba(2, 6, 5, 0.55) 0%, rgba(2, 6, 5, 0.9) 78%);
  opacity: 0;
  transition: opacity 0.25s;
}
.pm-inspect.in { opacity: 1; }
.pm-inspect-mover {
  transition: transform 0.34s cubic-bezier(0.3, 1.35, 0.45, 1), opacity 0.3s;
  filter: drop-shadow(0 18px 30px rgba(0, 0, 0, 0.6));
}
.pm-inspect-info {
  display: flex; flex-direction: column; gap: 10px;
  max-width: 300px;
  font-family: 'm6x11', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', monospace;
}
.pm-inspect-name {
  font-size: 24px; font-weight: 900; letter-spacing: 1px;
  color: #f4c14f;
  text-shadow: 0 2px 0 rgba(0, 0, 0, 0.6);
}
.pm-inspect-text { font-size: 13px; color: #e8f0ec; line-height: 1.6; }
.pm-inspect-text-en { font-size: 11px; color: #6f8a80; line-height: 1.5; }
.pm-inspect-actions { display: flex; gap: 10px; margin-top: 6px; }
.pm-ibtn {
  height: 34px; padding: 0 16px;
  border-radius: 8px;
  border: 2px solid #3d5a54;
  background: rgba(14, 26, 23, 0.9);
  color: #9fc0b4;
  font-family: inherit; font-size: 13px; font-weight: 800;
  cursor: pointer;
  transition: transform 0.1s, filter 0.12s;
}
.pm-ibtn:hover { filter: brightness(1.25); }
.pm-ibtn:active { transform: scale(0.93, 0.87); }
.pm-ibtn.pick {
  border-color: #f4c14f;
  color: #f4c14f;
  background: rgba(58, 46, 14, 0.9);
  box-shadow: 0 0 12px rgba(244, 193, 79, 0.2);
}
.pm-inspect-tip { font-size: 10.5px; color: #54706a; }
</style>
