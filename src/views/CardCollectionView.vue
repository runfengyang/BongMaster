<template>
  <div class="collection-view balatro-font">
    <!-- §13 页级 CRT 漩涡衬底（fixed 定位上下文，内容层 z-index 1） -->
    <div class="cv-bg"><CrtBackground :animated="store.settings.animations" /></div>
    <ErrorBoundary>
      <div class="cv-content">
        <!-- 页头（小丑牌面板风） -->
        <header class="cv-panel cv-header">
          <div class="cv-title-block">
            <h1 class="cv-title">
              <span class="cv-title-icon"><i class="fas fa-clone"></i></span>
              卡牌图鉴
            </h1>
            <p class="cv-subtitle">BALATRO 收藏 · 习惯打卡 / 每日任务赢卡包，开出的卡收入图鉴</p>
          </div>
          <div class="cv-overall">
            <div class="cv-overall-num">
              <strong>{{ totalFound }}</strong>
              <span>/ {{ totalAll }}</span>
              <span v-if="totalOwned" class="cv-owned-total">已持有 {{ totalOwned }} 张</span>
              <button v-if="newCount" class="cv-mark-read" :title="`${newCount} 张新卡标记已读`" @click="store.markAllCollectionSeen()">
                NEW ×{{ newCount }} · 全部已读
              </button>
            </div>
            <div class="cv-progress">
              <div class="cv-progress-fill" :style="{ width: overallPct + '%' }"></div>
              <span class="cv-progress-pct">{{ overallPct }}%</span>
            </div>
            <div class="cv-type-counts">
              <span v-for="t in cardTabs" :key="t.key" class="cv-type-count">
                {{ t.name }} {{ foundOf(t) }}/{{ t.list.length }}
              </span>
            </div>
          </div>
        </header>

        <!-- 🛒 商店（纯金币经济：5 类 × 3 规格，金币价 40/60/80，购入即入待开队列） -->
        <section class="cv-panel cv-shop">
          <div class="cv-shop-head">
            <span class="cv-shop-title">🛒 商店</span>
            <span class="cv-shop-gold" title="金币余额">🪙 {{ store.economy.gold }}</span>
            <span class="cv-shop-opened" title="已开卡包总数">累计开包 {{ store.economy.packsOpened }}</span>
            <span class="cv-shop-tip">打卡 +2 · 每日任务 +3 · 项目任务 +5</span>
          </div>
          <div class="cv-shop-grid">
            <button
              v-for="sp in shopPacks"
              :key="sp.id"
              class="cv-shop-tile"
              :class="{ poor: store.economy.gold < sp.price }"
              :title="`${sp.def.name} · ${sp.price} 金币`"
              @click="buyShopPack(sp)"
            >
              <span v-if="SPRITE_MAP[sp.id]" class="cv-pack-sprite cv-shop-sprite" :style="packTileStyle(sp.id)"></span>
              <span v-else class="cv-pack-motif cv-shop-motif">{{ motifOf(sp.def) }}</span>
              <span class="cv-pack-name">{{ sp.def.name }}</span>
              <span class="cv-shop-price">🪙 {{ sp.price }}</span>
            </button>
          </div>
        </section>

        <!-- 卡包区（§11：生产力奖励只发卡包；§13 官方像素卡包精灵） -->
        <section v-if="pendingPacks.length" class="cv-panel cv-packs">
          <div class="cv-packs-head">
            <span class="cv-packs-title">🎁 卡包 ×{{ packTotal }}</span>
            <span class="cv-packs-tip">点击卡包立即开启</span>
          </div>
          <div class="cv-packs-row">
            <button
              v-for="p in pendingPacks"
              :key="p.id"
              class="cv-pack-tile"
              @click="openPack"
            >
              <span v-if="SPRITE_MAP[p.id]" class="cv-pack-sprite" :style="packTileStyle(p.id)"></span>
              <span v-else class="cv-pack-motif">{{ motifOf(p.def) }}</span>
              <span class="cv-pack-name">{{ p.def.name }}</span>
              <span v-if="p.n > 1" class="cv-pack-n">×{{ p.n }}</span>
            </button>
          </div>
        </section>

        <!-- 像素页签 -->
        <div class="cv-tabs">
          <button
            v-for="t in tabs"
            :key="t.key"
            class="cv-tab"
            :class="{ active: tab === t.key }"
            @click="selectTab(t.key)"
          >{{ t.name }}</button>

          <!-- 小丑稀有度子筛选（§15：mod 已并入小丑页签） -->
          <div v-if="tab === 'joker'" class="cv-rarity-filter">
            <button
              v-for="r in rarityFilters"
              :key="r.value"
              class="cv-rf"
              :class="{ active: rarity === r.value }"
              :style="r.value && rarity === r.value ? { borderColor: r.color, color: r.color } : {}"
              @click="selectRarity(r.value)"
            >{{ r.name }}</button>
          </div>

          <!-- 一键卖出重复（当前页签范围，每种各留 1 张） -->
          <button
            v-if="tab !== 'mods' && dupeInfo(tab).sold > 0"
            class="cv-sell-dupes"
            @click="sellAllDupes(tab)"
          >卖出重复 {{ dupeInfo(tab).sold }} 张 · +🪙{{ dupeInfo(tab).gold }}</button>
        </div>

        <!-- 卡牌网格（:key=tab 重挂载触发 stagger pop-in） -->
        <div v-if="tab !== 'mods'" class="cv-panel cv-body">
          <div class="cv-grid" :key="tab">
            <div
              v-for="(def, i) in filteredList"
              :key="def.id"
              class="cv-cell"
              :class="{ undiscovered: !isFound(def.id) }"
              :style="{ '--i': i % 24 }"
              @click="(isFound(def.id) || fragCount(def.id) > 0) && openInspectFromGrid(def, $event)"
              @pointerenter="onCellEnter(def.id)"
            >
              <template v-if="isFound(def.id)">
                <div class="cv-card-box">
                  <PlayingCard :def="def" :kind="renderKind(activeTab.key)" :width="76" @click="openInspectFromGrid(def, $event)" />
                  <span v-if="ownedCount(def.id) >= 2" class="cv-owned" :title="`已持有 ${ownedCount(def.id)} 张整卡`">×{{ ownedCount(def.id) }}</span>
                  <span v-if="isNewId(def.id)" class="cv-new-badge">NEW!</span>
                </div>
                <span class="cv-name">{{ def.name }}</span>
                <span v-if="ownedEditions(def.id).length" class="cv-eds">
                  <i
                    v-for="ed in ownedEditions(def.id)"
                    :key="ed"
                    class="cv-ed"
                    :class="'ed-' + ed"
                    :title="EDITION_NAMES[ed] || ed"
                  ></i>
                </span>
              </template>
              <!-- §21 未点亮但有碎片：撕裂半张卡（可点开细看合成） -->
              <template v-else-if="hasSprite(def.id)">
                <div class="cv-shadowcard" :class="{ fragment: fragCount(def.id) > 0 }" :title="fragCount(def.id) ? '已持有半张卡，集齐两张可合成' : '未发现（剪影）'">
                  <PlayingCard :def="def" :kind="renderKind(activeTab.key)" :width="76" :selectable="false" :fragment="fragCount(def.id) > 0" />
                </div>
                <span class="cv-name dim">???</span>
              </template>
              <template v-else>
                <div class="cv-silhouette">
                  <span class="cv-sil-q">?</span>
                </div>
                <span class="cv-name dim">???</span>
              </template>
            </div>
          </div>
        </div>

        <!-- 扑克收藏 + 增强 / 蜡封 / 版本 参考页（§15：enhancers 图集真精灵 + 版本着色器样卡） -->
        <div v-else class="cv-panel cv-body">
          <section class="cv-mods-section">
            <h3 class="cv-mods-title">
              扑克（{{ playingFoundCount }}/52）
              <button
                v-if="dupeInfo('playing').sold > 0"
                class="cv-sell-dupes inline"
                @click="sellAllDupes('playing')"
              >卖出重复 {{ dupeInfo('playing').sold }} 张 · +🪙{{ dupeInfo('playing').gold }}</button>
            </h3>
            <div class="cv-pcards">
              <div v-for="suit in PC_SUITS" :key="suit" class="cv-pcards-row">
                <div
                  v-for="rank in PC_RANKS"
                  :key="suit + rank"
                  class="cv-pcell"
                  :class="{ found: isPlayingFound(suit, rank) }"
                  @click="openPcInspect(suit, rank)"
                >
                  <!-- 原作视觉层级：增强=整卡图集卡面 / 蜡封=右上角印章覆盖 / 版本=全卡着色 -->
                  <div v-if="isPlayingFound(suit, rank)" class="cv-mc" :class="cellMc(suit, rank).ed ? 'cv-mc-ed-' + cellMc(suit, rank).ed : ''">
                    <span class="cv-mc-face" :class="{ base: !cellMc(suit, rank).enh }" :style="mcFaceStyle(cellMc(suit, rank))"></span>
                    <span v-if="cellMc(suit, rank).enh !== 'stone'" class="cv-mc-rank" :class="'suit-' + suit">
                      {{ RANK_LABELS[rank] }}<i>{{ SUIT_SYMBOL[suit] }}</i>
                    </span>
                    <span v-if="cellMc(suit, rank).seal" class="cv-mc-seal" :style="mcSealStyle(cellMc(suit, rank).seal)"></span>
                  </div>
                  <!-- §21 未点亮格仍可点开查看碎片与合成 -->
                  <template v-else>
                    <span class="cv-pcell-q">?</span>
                  </template>
                </div>
              </div>
            </div>
            <h3 class="cv-mods-title">增强（8）</h3>
            <div class="cv-mods-grid">
              <div v-for="e in ENHANCEMENTS" :key="e.id" class="cv-mod-card">
                <div class="cv-mc cv-mc-ref">
                  <span class="cv-mc-face" :style="mcEnhStyle(e.id)"></span>
                </div>
                <span class="cv-mod-info">
                  <span class="cv-mod-name">{{ e.name }} <em>{{ e.nameEn }}</em></span>
                  <span class="cv-mod-text">{{ e.text }}</span>
                </span>
              </div>
            </div>
            <h3 class="cv-mods-title">蜡封（4）</h3>
            <div class="cv-mods-grid">
              <div v-for="s in SEALS" :key="s.id" class="cv-mod-card seal" :class="'seal-' + s.id">
                <div class="cv-mc cv-mc-ref">
                  <span class="cv-mc-face base"></span>
                  <span class="cv-mc-seal" :style="mcSealStyle(s.id)"></span>
                </div>
                <span class="cv-mod-info">
                  <span class="cv-mod-name">{{ s.name }} <em>{{ s.nameEn }}</em></span>
                  <span class="cv-mod-text">{{ s.text }}</span>
                </span>
              </div>
            </div>
            <h3 class="cv-mods-title">版本（5）</h3>
            <div class="cv-mods-grid">
              <div v-for="ed in EDITIONS" :key="ed.id" class="cv-mod-card edition" :class="'ed-' + ed.id">
                <PlayingCard
                  :def="EDITION_SAMPLE_DEF"
                  kind="joker"
                  :width="48"
                  :edition="ed.id === 'base' ? null : ed.id"
                  :selectable="false"
                />
                <span class="cv-mod-info">
                  <span class="cv-mod-name">{{ ed.name }} <em>{{ ed.nameEn }}</em></span>
                  <span class="cv-mod-text">{{ ed.text }}<template v-if="ed.costAdd">（售价 +${{ ed.costAdd }}）</template></span>
                </span>
              </div>
            </div>
          </section>
        </div>

        <!-- §14/§15 3D 细看视图（格子点击直达：FLIP 飞入居中 3x + 速度倾斜 + 版本着色器 live；信息区 = 详情级） -->
        <div v-if="inspect" class="cv-inspect" :class="{ in: inspectIn }" @click.self="closeInspect">
          <div class="cv-inspect-mover" :style="moverStyle">
            <PlayingCard
              :def="inspect.def"
              :kind="renderKind(inspect.kind)"
              :width="240"
              :edition="inspectEdition"
              :tilt-scale="1.8"
              :selectable="false"
              @click="closeInspect"
            />
          </div>
          <div class="cv-inspect-info">
            <div class="cv-inspect-name">
              {{ inspect.def.name }}
              <span class="cv-inspect-name-en">{{ inspect.def.nameEn }}</span>
            </div>
            <div class="cv-detail-tags">
              <span v-if="inspect.def.rarity" class="cv-tag" :style="{ color: RARITY[inspect.def.rarity].color, borderColor: RARITY[inspect.def.rarity].color }">
                {{ RARITY[inspect.def.rarity].name }}
              </span>
              <span class="cv-tag type">{{ TYPE_NAMES[inspect.kind] || inspect.kind }}</span>
              <span v-if="inspect.def.mod" class="cv-tag mod">🧩 {{ inspect.def.mod }}</span>
              <span v-if="inspect.def.cost" class="cv-tag cost">售价 ${{ inspect.def.cost }}</span>
            </div>
            <div class="cv-inspect-text">{{ inspect.def.text }}</div>
            <div class="cv-inspect-text-en">{{ inspect.def.textEn }}</div>
            <div v-if="inspect.def.mod || inspect.def.unlock || inspect.def.rarity === 4" class="cv-detail-unlock">
              <template v-if="inspect.def.mod">🧩 来自社区 Mod：{{ inspect.def.mod }}</template>
              <template v-else-if="inspect.def.unlock">🔓 解锁条件：{{ inspect.def.unlock.text }}</template>
              <template v-else-if="inspect.def.rarity === 4">👑 传奇：仅通过幻灵牌「灵魂」出现</template>
            </div>
            <div v-if="inspectGate" class="cv-detail-lock">
              🔒 累计开 {{ inspectGate }} 包后可开出（已开 {{ store.economy.packsOpened }} 包）
            </div>
            <div v-if="inspectSell" class="cv-sell-row">
              <button class="cv-sell-btn" @click.stop="sellInspectCard">
                出售 +🪙{{ inspectSell.value }}
              </button>
            </div>
            <!-- §21 碎片区：≥2 张同版本可合成整卡；1 张显示 ½ 进度并可半价单卖 -->
            <div v-for="g in inspectFragGroups" :key="g.ed" class="cv-frag-row">
              <span class="cv-frag-progress">
                ½ 半张卡{{ g.ed !== 'base' ? `（${g.edName}）` : '' }} ×{{ g.count }}
              </span>
              <button
                v-if="g.count >= 2"
                class="cv-combine-btn"
                @click.stop="combineInspectFragments(g)"
              >合成整卡</button>
              <template v-else>
                <span class="cv-frag-tip">再得 1 张可合成</span>
                <button class="cv-sell-btn small" @click.stop="sellInspectFragment(g)">出售 +🪙{{ g.value }}</button>
              </template>
            </div>
            <div class="cv-inspect-tip">移动鼠标 3D 细看 · 点击卡面或空白处返回</div>
          </div>
        </div>

        <!-- 扑克格细看：代表牌（原作层级卡面）+ 变体收集矩阵（已拥有组合逐条，重复可售） -->
        <div v-if="pcInspect" class="cv-inspect in cv-pc-inspect" @click.self="closePcInspect">
          <div class="cv-inspect-mover">
            <div class="cv-mc cv-mc-big" :class="pcInspect.rep.ed ? 'cv-mc-ed-' + pcInspect.rep.ed : ''" @click="closePcInspect">
              <span class="cv-mc-face" :class="{ base: !pcInspect.rep.enh }" :style="mcFaceStyle(pcInspect.rep, 150)"></span>
              <span v-if="pcInspect.rep.enh !== 'stone'" class="cv-mc-rank" :class="'suit-' + pcInspect.suit">
                {{ pcInspect.rep.rankLabel }}<i>{{ SUIT_SYMBOL[pcInspect.suit] }}</i>
              </span>
              <span v-if="pcInspect.rep.seal" class="cv-mc-seal" :style="mcSealStyle(pcInspect.rep.seal, 150)"></span>
            </div>
          </div>
          <div class="cv-inspect-info">
            <div class="cv-inspect-name">{{ pcInspect.title }}</div>
            <div v-if="!pcInspect.variants.length" class="cv-inspect-text">尚未获得该牌</div>
            <div class="cv-pcmatrix">
              <div v-for="(v, vi) in pcInspect.variants" :key="vi" class="cv-pcvar-row">
                <div class="cv-mc cv-mc-sm" :class="v.mc.ed ? 'cv-mc-ed-' + v.mc.ed : ''">
                  <span class="cv-mc-face" :class="{ base: !v.mc.enh }" :style="mcFaceStyle(v.mc, 34)"></span>
                  <span v-if="v.mc.enh !== 'stone'" class="cv-mc-rank" :class="'suit-' + pcInspect.suit">
                    {{ v.mc.rankLabel }}<i>{{ SUIT_SYMBOL[pcInspect.suit] }}</i>
                  </span>
                  <span v-if="v.mc.seal" class="cv-mc-seal" :style="mcSealStyle(v.mc.seal, 34)"></span>
                </div>
                <span class="cv-pcvar-name">{{ v.label }} ×{{ v.count }}</span>
                <button
                  v-if="v.count >= 2"
                  class="cv-sell-btn small"
                  @click.stop="sellPlayingVariant(v)"
                >出售 +🪙{{ v.value }}</button>
              </div>
              <!-- §21 碎片行：撕裂半张小卡；≥2 合成 / =1 半价单卖 -->
              <div v-for="(v, vi) in pcInspect.fragVariants" :key="'f' + vi" class="cv-pcvar-row frag">
                <div class="cv-mc cv-mc-sm cv-mc-frag" :class="v.mc.ed ? 'cv-mc-ed-' + v.mc.ed : ''">
                  <span class="cv-mc-face" :class="{ base: !v.mc.enh }" :style="mcFaceStyle(v.mc, 34)"></span>
                  <span v-if="v.mc.enh !== 'stone'" class="cv-mc-rank" :class="'suit-' + pcInspect.suit">
                    {{ v.mc.rankLabel }}<i>{{ SUIT_SYMBOL[pcInspect.suit] }}</i>
                  </span>
                  <span v-if="v.mc.seal" class="cv-mc-seal" :style="mcSealStyle(v.mc.seal, 34)"></span>
                </div>
                <span class="cv-pcvar-name">½ {{ v.label }} ×{{ v.count }}</span>
                <button
                  v-if="v.count >= 2"
                  class="cv-combine-btn small"
                  @click.stop="combinePlayingFragments(v)"
                >合成整卡</button>
                <button
                  v-else
                  class="cv-sell-btn small"
                  @click.stop="sellPlayingFragment(v)"
                >出售 +🪙{{ v.value }}</button>
              </div>
            </div>
            <div class="cv-inspect-tip">点击卡面或空白处返回</div>
          </div>
        </div>

        <!-- 收藏模式开包演出（PackModal 复用：sealed → tearing → open → flying；CRT 漩涡衬底） -->
        <div v-if="store.collectionPack" class="cv-pack-modal">
          <CrtBackground :animated="store.settings.animations" />
          <PackModal
            :pack-state="store.collectionPack"
            :jokers-full="false"
            :consumables-full="false"
            @collect-all="onCollectAll"
            @skip="store.skipCollectionPack"
          />
        </div>
      </div>
    </ErrorBoundary>
  </div>
</template>

<script setup>
// CardCollectionView（§1/§9 Phase 4；§11 重定位为纯收藏+开卡包；§13 全面小丑牌化；§15 mod 并入小丑页签 + 格子直达 3D 细看 + 增强/蜡封/版本真精灵）
// 页级 CRT 衬底 + m6x11 像素字 + 暗绿/海军蓝面板 + 像素页签/chips + chunky 进度条
// 卡格 stagger pop-in + 悬停 tick 音；持有角标/版本点做成游戏贴纸风
import { ref, computed } from 'vue'
import { useBalatroStore } from '../balatro/store.js'
import {
  JOKERS, TAROT, PLANETS, SPECTRAL,
  ENHANCEMENTS, SEALS, EDITIONS, PACKS, PACKS_BY_ID, MOD_JOKERS,
} from '../balatro/data/index.js'
import { SUITS as PC_SUITS_ALL, RANK_LABELS } from '../balatro/engine/deck.js'
import { SHOP_PACK_PRICES, fragmentSellValue } from '../balatro/data/economy.js'
import { lockHint, RARE_MIN_PACKS, CORE_MIN_PACKS } from '../balatro/data/packGating.js'
import { SPRITE_MAP, ATLAS_META, ENH_SPRITES, SEAL_SPRITES } from '../balatro/data/spriteMap.js'
import PlayingCard from '../balatro/components/PlayingCard.vue'
import PackModal from '../balatro/components/PackModal.vue'
import ErrorBoundary from '../balatro/components/ErrorBoundary.vue'
import CrtBackground from '../balatro/components/CrtBackground.vue'
import { sound } from '../balatro/sound.js'

const store = useBalatroStore()

const RARITY = {
  1: { name: '普通', color: '#64b5f6' },
  2: { name: '罕见', color: '#81c784' },
  3: { name: '稀有', color: '#e57373' },
  4: { name: '传奇', color: '#ce93d8' },
}
const TYPE_NAMES = { joker: '小丑', tarot: '塔罗', planet: '星球', spectral: '幻灵' }
const EDITION_NAMES = { base: '基础', foil: '闪箔', holo: '全息', poly: '多彩', negative: '负片' }
const PACK_MOTIFS = { arcana: '🔮', celestial: '🪐', standard: '🂠', spectral: '👻', buffoon: '🃏' }

// PlayingCard 的 kind 即四类页签 key（§15：mod 卡已并入小丑页签，直接按 joker 渲染）
const renderKind = (key) => key

// §15② mod 卡并入小丑页签：按稀有度分组混排，组内官方（id 序）在前、mod（id 序）在后
const JOKER_TAB_LIST = [...JOKERS, ...MOD_JOKERS].sort((a, b) =>
  (a.rarity - b.rarity) ||
  ((a.id.startsWith('mj_') ? 1 : 0) - (b.id.startsWith('mj_') ? 1 : 0)) ||
  a.id.localeCompare(b.id))

const cardTabs = [
  { key: 'joker', name: '小丑', list: JOKER_TAB_LIST },
  { key: 'tarot', name: '塔罗', list: TAROT },
  { key: 'planet', name: '星球', list: PLANETS },
  { key: 'spectral', name: '幻灵', list: SPECTRAL },
]
const tabs = [...cardTabs, { key: 'mods', name: '增强·蜡封·版本' }]

const tab = ref('joker')
const rarity = ref(0) // 0 = 全部

const rarityFilters = [
  { value: 0, name: '全部' },
  { value: 1, name: '普通', color: RARITY[1].color },
  { value: 2, name: '罕见', color: RARITY[2].color },
  { value: 3, name: '稀有', color: RARITY[3].color },
  { value: 4, name: '传奇', color: RARITY[4].color },
]

function selectTab(key) {
  if (tab.value === key) return
  tab.value = key
  sound.click()
}
function selectRarity(v) {
  rarity.value = v
  sound.click()
}
// 悬停滴答（仅已发现的卡）
function onCellEnter(id) {
  if (isFound(id)) sound.tick()
}

const foundSet = computed(() => new Set(store.collection.discovered || []))
const isFound = (id) => foundSet.value.has(id)
const hasSprite = (id) => !!SPRITE_MAP[id]

// §16② NEW 徽章：收包首开入 newIds；3D 细看打开即已读；页头可一键全读
const newSet = computed(() => new Set(store.collection.newIds || []))
const isNewId = (id) => newSet.value.has(id)
const newCount = computed(() => (store.collection.newIds || []).length)

// ---- 持有收藏（§11 ownedCards） ----
const ownedById = computed(() => {
  const map = new Map()
  for (const o of store.collection.ownedCards || []) {
    if (!map.has(o.id)) map.set(o.id, [])
    map.get(o.id).push(o)
  }
  return map
})
const ownedCount = (id) => (ownedById.value.get(id) || []).filter(o => !o.fragment).length // §21 角标只数整卡
const ownedEditions = (id) => [...new Set((ownedById.value.get(id) || []).filter(o => !o.fragment).map(o => o.edition || 'base'))]
// §21 碎片计数（全版本合计，½ 角标用）
const fragCount = (id) => (ownedById.value.get(id) || []).filter(o => o.fragment).length
const totalOwned = computed(() => (store.collection.ownedCards || []).length)

// ---- 待开卡包（§11：同款合并计数） ----
const pendingPacks = computed(() => {
  const counts = new Map()
  for (const id of store.productivity.pendingPacks || []) {
    counts.set(id, (counts.get(id) || 0) + 1)
  }
  return [...counts.entries()]
    .map(([id, n]) => ({ id, n, def: PACKS_BY_ID[id] }))
    .filter(p => p.def)
})
const packTotal = computed(() => pendingPacks.value.reduce((n, p) => n + p.n, 0))
const motifOf = (def) => PACK_MOTIFS[def.packType] || def.art?.motif || '📦'

// §13 卡包精灵：boosters 图集原生 1x（71×95）定位
function packTileStyle(id) {
  const s = SPRITE_MAP[id]
  if (!s) return null
  const m = ATLAS_META[s.atlas]
  return {
    backgroundImage: `url(${m.url})`,
    backgroundSize: `${m.cols * 71}px ${m.rows * 95}px`,
    backgroundPosition: `-${s.x * 71}px -${s.y * 95}px`,
  }
}

// ---- 原作视觉层级扑克渲染（增强=整卡图集卡面 / 蜡封=右上印章覆盖 / 版本=全卡着色） ----
// enhancers 图集 71×95 瓦片，按目标宽 w 等比缩放（pixelated 保持像素感）
const MC_W = 46 // 迷你卡统一逻辑宽（CSS 按此比例放大/缩小）
function mcTile(sprite, w = MC_W) {
  const m = ATLAS_META.enhancers
  const k = w / 71
  return {
    backgroundImage: `url(${m.url})`,
    backgroundSize: `${m.cols * 71 * k}px ${m.rows * 95 * k}px`,
    backgroundPosition: `-${sprite.x * 71 * k}px -${sprite.y * 95 * k}px`,
  }
}
// mc = { rank, rankLabel, suit, enh, seal, ed }
const mcFaceStyle = (mc, w = MC_W) => mc?.enh && ENH_SPRITES[mc.enh] ? mcTile(ENH_SPRITES[mc.enh], w) : null
const mcSealStyle = (seal, w = MC_W) => SEAL_SPRITES[seal] ? mcTile(SEAL_SPRITES[seal], w) : null
const mcEnhStyle = (enhId, w = MC_W) => ENH_SPRITES[enhId] ? mcTile(ENH_SPRITES[enhId], w) : null
// 版本样卡：用官方小丑「j_joker」演示着色器
const EDITION_SAMPLE_DEF = JOKERS.find(d => d.id === 'j_joker') || JOKERS[0]

function openPack() {
  sound.click()
  store.openCollectionPack()
}

// §19 开包收下：金币音效 + 梯度解锁提示（累计开包跨过 10/20 包门槛时 shimmer）
// §20③ 收下音效去怪：coinCascade(2) 与 PackModal 按下音叠加后声音发浑，
//   改干净单音组合（短促 coin + 90ms 后轻 click 作落袋确认）
function onCollectAll() {
  const before = store.economy.packsOpened
  const ok = store.collectAllPackCards()
  if (ok) {
    sound.coin()
    setTimeout(() => sound.click(), 90)
    const after = store.economy.packsOpened
    if ((before < RARE_MIN_PACKS && after >= RARE_MIN_PACKS) ||
        (before < CORE_MIN_PACKS && after >= CORE_MIN_PACKS)) {
      setTimeout(() => sound.shimmer(), 250)
    }
  }
}

// ---- 🛒 商店（纯金币经济） ----
const shopPacks = computed(() =>
  PACKS.map(def => ({ id: def.id, def, price: SHOP_PACK_PRICES[def.size] ?? SHOP_PACK_PRICES.normal })))

function buyShopPack(sp) {
  const res = store.buyShopPack(sp.id)
  if (res.ok) sound.coin()
  else sound.click() // 金币不足：哑音反馈（价位灰显已前置提示）
}

const activeTab = computed(() => cardTabs.find(t => t.key === tab.value))
const filteredList = computed(() => {
  const list = activeTab.value?.list || []
  if (tab.value === 'joker' && rarity.value) return list.filter(d => d.rarity === rarity.value)
  return list
})

function foundOf(t) {
  return t.list.filter(d => foundSet.value.has(d.id)).length
}
const totalFound = computed(() => cardTabs.reduce((n, t) => n + foundOf(t), 0))
const totalAll = computed(() => cardTabs.reduce((n, t) => n + t.list.length, 0))
const overallPct = computed(() => totalAll.value ? Math.round((totalFound.value / totalAll.value) * 100) : 0)

// ---- §14③/§15④ 3D 细看（格子点击直达：FLIP 飞入居中 3x，信息区 = 详情级） ----
const ED_RANK = { negative: 4, poly: 3, holo: 2, foil: 1, base: 0 }
// 细看展示版本：取已持有的最高稀有版本着色
const inspectEdition = computed(() => {
  if (!inspect.value) return null
  const eds = ownedEditions(inspect.value.def.id)
  if (!eds.length) return null
  return [...eds].sort((a, b) => (ED_RANK[b] || 0) - (ED_RANK[a] || 0))[0]
})
const INSPECT_W = 240
const inspect = ref(null)    // { def, kind, from: { dx, dy, s } }
const inspectIn = ref(false)
function openInspectFromGrid(def, ev) {
  const cell = ev?.currentTarget
  const el = cell?.querySelector?.('.pc-wrap') || ev?.target?.closest?.('.pc-wrap')
  const r = el?.getBoundingClientRect?.()
  const from = r
    ? {
        dx: r.left + r.width / 2 - window.innerWidth / 2,
        dy: r.top + r.height / 2 - window.innerHeight / 2,
        s: r.width / INSPECT_W,
      }
    : { dx: 0, dy: 60, s: 0.5 }
  inspect.value = { def, kind: activeTab.value?.key || 'joker', from }
  inspectIn.value = false
  store.markCollectionSeen(def.id) // §16② 3D 细看打开即清除 NEW 标记
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

// ---- 开包数门槛锁定提示（稀有 ≥10 包 / 核心 ≥20 包，达标即不显示） ----
const inspectGate = computed(() => {
  const def = inspect.value?.def
  if (!def) return null
  const need = lockHint(def.id, def)
  return need && store.economy.packsOpened < need ? need : null
})

// ---- 重复卡出售（同 id+版本 ≥2 才可售，每种各留 1 张；点亮不受影响） ----
// §21 碎片不计整卡保有量（整卡出售判定只看整卡）
const inspectSell = computed(() => {
  const def = inspect.value?.def
  if (!def) return null
  const ed = inspectEdition.value || 'base'
  const matches = []
  ;(store.collection.ownedCards || []).forEach((o, i) => {
    if (o.kind !== 'playing' && !o.fragment && o.id === def.id && (o.edition || 'base') === ed) matches.push(i)
  })
  if (matches.length < 2) return null
  const entry = store.collection.ownedCards[matches[0]]
  return { count: matches.length, value: store.ownedSellValue(entry), index: matches[0] }
})

// §21 碎片分组（细看层：按版本逐组；≥2 可合成，=1 可半价单卖）
const inspectFragGroups = computed(() => {
  const def = inspect.value?.def
  if (!def) return []
  const groups = new Map()
  ;(store.collection.ownedCards || []).forEach((o, i) => {
    if (o.kind === 'playing' || !o.fragment || o.id !== def.id) return
    const ed = o.edition || 'base'
    if (!groups.has(ed)) groups.set(ed, { ed, count: 0, index: i })
    groups.get(ed).count++
  })
  return [...groups.values()].map(g => ({
    ...g,
    key: `card|${def.id}|${g.ed === 'base' ? '' : g.ed}`,
    value: fragmentSellValue(store.ownedSellValue({ id: def.id, edition: g.ed === 'base' ? null : g.ed })),
    edName: EDITION_NAMES[g.ed] || g.ed,
  }))
})

function combineInspectFragments(g) {
  const res = store.combineFragments(g.key)
  if (res.ok) sound.shimmer() // 合成点亮 = 解锁事件
  else sound.click()
}
function sellInspectFragment(g) {
  const res = store.sellOwnedCard(g.index) // 单张碎片出售免确认（2 张时 store 拒绝，引导合成）
  if (res.ok) { sound.coin(); sound.click() }
  else sound.click()
}

function sellInspectCard() {
  const info = inspectSell.value
  if (!info) return
  const res = store.sellOwnedCard(info.index) // 单张出售免确认
  if (res.ok) { sound.coin(); sound.click() } // §19 出售音效：coin+click 分层
  else sound.click()
}

// ---- 一键卖出重复（当前页签范围；同 id+版本 / 同扑克变体 各留 1 张） ----
function dupeMatch(tabKey) {
  if (tabKey === 'playing') return (o) => o.kind === 'playing'
  const t = cardTabs.find(x => x.key === tabKey)
  if (!t) return () => false
  const ids = new Set(t.list.map(d => d.id))
  return (o) => o.kind !== 'playing' && ids.has(o.id)
}
function dupeInfo(tabKey) {
  return store.duplicateOwnedInfo(dupeMatch(tabKey))
}
function sellAllDupes(tabKey) {
  const info = dupeInfo(tabKey)
  if (!info.sold) return
  // 批量卖出保留一次确认
  if (!window.confirm(`将卖出 ${info.sold} 张重复卡，合计获得 ${info.gold} 金币`)) return
  const res = store.sellDuplicateOwned(dupeMatch(tabKey))
  if (res.sold > 0) sound.coinCascade(Math.min(res.sold, 4)) // §19 一键卖出：连续 coin（上限 4 枚）
}

// ---- 扑克收藏（52 格：花色 × 点数；见过即点亮，原作视觉层级呈现） ----
const PC_SUITS = PC_SUITS_ALL // ['spades','hearts','diamonds','clubs']
const PC_RANKS = [14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2] // A 在前
const SUIT_SYMBOL = { spades: '♠', hearts: '♥', diamonds: '♦', clubs: '♣' }
const ENH_NAMES = Object.fromEntries(ENHANCEMENTS.map(e => [e.id, e.name]))
const SEAL_NAMES = Object.fromEntries(SEALS.map(s => [s.id, s.name]))

// 已拥有扑克按 pc_花色_点数 分格
const playingByCell = computed(() => {
  const map = new Map()
  for (const o of store.collection.ownedCards || []) {
    if (o?.kind !== 'playing') continue
    const key = `pc_${o.suit}_${o.rank}`
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(o)
  }
  return map
})
const isPlayingFound = (suit, rank) => foundSet.value.has(`pc_${suit}_${rank}`)
const playingFoundCount = computed(() => {
  let n = 0
  for (const suit of PC_SUITS) for (let r = 2; r <= 14; r++) if (isPlayingFound(suit, r)) n++
  return n
})

// 代表变体：版本最高 > 有蜡封 > 有增强（52 格小卡与细看大图共用）
const ED_BEST = { negative: 4, poly: 3, holo: 2, foil: 1 }
function repVariant(list) {
  return [...list].sort((a, b) =>
    ((ED_BEST[b.edition] || 0) - (ED_BEST[a.edition] || 0)) ||
    ((b.seal ? 1 : 0) - (a.seal ? 1 : 0)) ||
    ((b.enhancement ? 1 : 0) - (a.enhancement ? 1 : 0)))[0] || null
}
function toMc(o, suit, rank) {
  return {
    rank, rankLabel: RANK_LABELS[rank], suit,
    enh: o?.enhancement || null, seal: o?.seal || null, ed: o?.edition || null,
  }
}
// 52 格小卡：有持有 → 代表变体；仅点亮未持有 → 素牌（§21 碎片不作代表变体）
function cellMc(suit, rank) {
  const list = (playingByCell.value.get(`pc_${suit}_${rank}`) || []).filter(o => !o.fragment)
  return toMc(repVariant(list), suit, rank)
}
// ---- 扑克格细看：代表牌 + 变体收集矩阵（已拥有组合逐条；重复可售；§21 碎片独立成行） ----
const pcInspect = ref(null) // { suit, rank, title, rep, variants:[...], fragVariants:[{label,count,value,entry,mc,combineKey}] }

function buildPcInspect(suit, rank) {
  const list = playingByCell.value.get(`pc_${suit}_${rank}`) || []
  const wholeList = list.filter(o => !o.fragment) // §21 变体矩阵只列整卡
  const rep = toMc(repVariant(wholeList), suit, rank)
  // 变体分组（增强+蜡封+版本 组合键），按版本档排序
  const groups = new Map()
  for (const o of wholeList) {
    const key = `${o.enhancement || ''}|${o.seal || ''}|${o.edition || ''}`
    if (!groups.has(key)) {
      const parts = []
      if (o.enhancement) parts.push(ENH_NAMES[o.enhancement] || o.enhancement)
      if (o.seal) parts.push(`蜡封·${SEAL_NAMES[o.seal] || o.seal}`)
      if (o.edition) parts.push(EDITION_NAMES[o.edition] || o.edition)
      groups.set(key, {
        label: parts.length ? parts.join(' + ') : '素牌',
        count: 0, value: store.ownedSellValue(o), entry: o,
        mc: toMc(o, suit, rank),
      })
    }
    groups.get(key).count++
  }
  const variants = [...groups.values()].sort((a, b) =>
    ((ED_BEST[b.mc.ed] || 0) - (ED_BEST[a.mc.ed] || 0)) ||
    ((b.mc.seal ? 1 : 0) - (a.mc.seal ? 1 : 0)) ||
    ((b.mc.enh ? 1 : 0) - (a.mc.enh ? 1 : 0)))
  // §21 碎片分组（同变体两张可合成；单张半价售）
  const fragGroups = new Map()
  for (const o of list.filter(o => o.fragment)) {
    const key = `${o.enhancement || ''}|${o.seal || ''}|${o.edition || ''}`
    if (!fragGroups.has(key)) {
      const parts = []
      if (o.enhancement) parts.push(ENH_NAMES[o.enhancement] || o.enhancement)
      if (o.seal) parts.push(`蜡封·${SEAL_NAMES[o.seal] || o.seal}`)
      if (o.edition) parts.push(EDITION_NAMES[o.edition] || o.edition)
      fragGroups.set(key, {
        label: parts.length ? parts.join(' + ') : '素牌',
        count: 0, value: fragmentSellValue(store.ownedSellValue(o)), entry: o,
        mc: toMc(o, suit, rank),
        combineKey: store.ownedKey(o),
      })
    }
    fragGroups.get(key).count++
  }
  const fragVariants = [...fragGroups.values()]
  return {
    suit, rank,
    title: `${RANK_LABELS[rank]}${SUIT_SYMBOL[suit]}（已持有 ${wholeList.length}${fragVariants.length ? ` + 碎片 ${list.length - wholeList.length}` : ''}）`,
    rep,
    variants,
    fragVariants,
  }
}

function openPcInspect(suit, rank) {
  // §21 未点亮格有碎片时也允许打开（合成入口）
  if (!isPlayingFound(suit, rank) && !playingFragCount(suit, rank)) return
  pcInspect.value = buildPcInspect(suit, rank)
  sound.flip()
}
function closePcInspect() {
  pcInspect.value = null
  sound.click()
}
function sellPlayingVariant(v) {
  const arr = store.collection.ownedCards || []
  const idx = arr.indexOf(v.entry)
  if (idx < 0) return
  const res = store.sellOwnedCard(idx) // 单张出售免确认
  if (res.ok) {
    sound.coin(); sound.click() // §19 出售音效：coin+click 分层
    if (pcInspect.value) pcInspect.value = buildPcInspect(pcInspect.value.suit, pcInspect.value.rank) // 刷新变体列表
  } else sound.click()
}
// §21 扑克碎片：合成 / 单卖（操作后刷新矩阵）
function combinePlayingFragments(v) {
  const res = store.combineFragments(v.combineKey)
  if (res.ok) {
    sound.shimmer()
    if (pcInspect.value) pcInspect.value = buildPcInspect(pcInspect.value.suit, pcInspect.value.rank)
  } else sound.click()
}
function sellPlayingFragment(v) {
  const arr = store.collection.ownedCards || []
  const idx = arr.indexOf(v.entry)
  if (idx < 0) return
  const res = store.sellOwnedCard(idx) // 单张碎片出售免确认（2 张时 store 拒绝）
  if (res.ok) {
    sound.coin(); sound.click()
    if (pcInspect.value) pcInspect.value = buildPcInspect(pcInspect.value.suit, pcInspect.value.rank)
  } else sound.click()
}
</script>

<style scoped>
.collection-view {
  min-height: calc(100vh - var(--bm-navbar-height, 64px));
  color: #e8f0ec;
  position: relative;
}
.cv-bg {
  position: fixed; inset: 0; z-index: 0;
  pointer-events: none;
}
.cv-content {
  position: relative; z-index: 1;
  padding: var(--bm-space-xl, 24px);
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* ---- 小丑牌面板基座 ---- */
.cv-panel {
  background: rgba(14, 26, 23, 0.88);
  border: 2px solid #3d5a54;
  border-radius: 12px;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.06);
}

/* ---- 页头 ---- */
.cv-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 24px;
  flex-wrap: wrap;
  padding: 18px 24px;
}
.cv-title {
  display: flex; align-items: center; gap: 10px;
  margin: 0;
  font-size: 26px; font-weight: 900; letter-spacing: 3px;
  color: #f4c14f;
  text-shadow: 0 3px 0 rgba(0, 0, 0, 0.55), 0 0 18px rgba(244, 193, 79, 0.25);
}
.cv-title-icon {
  width: 36px; height: 36px;
  display: inline-flex; align-items: center; justify-content: center;
  background: rgba(244, 193, 79, 0.12);
  border: 2px solid rgba(244, 193, 79, 0.45);
  border-radius: 8px;
  color: #f4c14f;
  font-size: 15px;
}
.cv-subtitle { margin: 6px 0 0; font-size: 12px; color: #8fa8a0; letter-spacing: 1px; }
.cv-overall { min-width: 300px; }
.cv-overall-num { font-size: 13px; color: #9fc0b4; margin-bottom: 8px; }
.cv-overall-num strong { font-size: 26px; color: #f4c14f; text-shadow: 0 2px 0 rgba(0, 0, 0, 0.5); }
.cv-owned-total {
  margin-left: 10px;
  font-size: 11px; font-weight: 800; color: #ffd54f;
  background: rgba(244, 193, 79, 0.12);
  border: 1px solid rgba(244, 193, 79, 0.5);
  border-radius: 4px; padding: 1px 8px;
}
/* chunky 像素进度条 */
.cv-progress {
  position: relative;
  height: 16px; border-radius: 4px; overflow: hidden;
  background: #0a1512;
  border: 2px solid #3d5a54;
}
.cv-progress-fill {
  height: 100%;
  background: repeating-linear-gradient(-45deg, #f4c14f 0 10px, #d9a832 10px 20px);
  box-shadow: inset 0 -4px 0 rgba(0, 0, 0, 0.25);
  transition: width 0.4s ease;
}
.cv-progress-pct {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  font-size: 10px; font-weight: 900; letter-spacing: 1px;
  color: #fff; text-shadow: 0 1px 0 #000, 0 0 4px rgba(0, 0, 0, 0.8);
}
.cv-type-counts { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
.cv-type-count {
  font-size: 10px; color: #9fc0b4; letter-spacing: 1px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid #3d5a54;
  border-radius: 4px; padding: 2px 7px;
}

/* ---- 卡包区（官方像素卡包） ---- */
.cv-packs {
  display: flex; flex-direction: column; gap: 12px;
  padding: 16px 20px;
  background: rgba(26, 22, 12, 0.88);
  border-color: rgba(244, 193, 79, 0.4);
}
.cv-packs-head { display: flex; align-items: baseline; gap: 12px; }
.cv-packs-title {
  font-size: 16px; font-weight: 900; color: #f4c14f; letter-spacing: 2px;
  text-shadow: 0 2px 0 rgba(0, 0, 0, 0.5);
}
.cv-packs-tip { font-size: 11px; color: #a89878; }
.cv-packs-row { display: flex; gap: 16px; flex-wrap: wrap; }
.cv-pack-tile {
  position: relative;
  padding: 8px 8px 6px;
  background: rgba(0, 0, 0, 0.35);
  border: 2px solid #6a5a30;
  border-radius: 10px;
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  cursor: pointer;
  font-family: inherit;
  transition: transform 0.16s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.16s;
}
.cv-pack-tile:hover {
  transform: translateY(-5px) rotate(-1.5deg) scale(1.05);
  box-shadow: 0 12px 26px rgba(0, 0, 0, 0.6), 0 0 18px rgba(244, 193, 79, 0.3);
}
.cv-pack-tile:active { transform: scale(0.93, 0.88); }
.cv-pack-sprite {
  width: 71px; height: 95px;
  image-rendering: pixelated;
  background-repeat: no-repeat;
  filter: drop-shadow(0 4px 6px rgba(0, 0, 0, 0.5));
}
.cv-pack-motif { font-size: 40px; filter: drop-shadow(0 3px 5px rgba(0,0,0,0.5)); }
.cv-pack-name {
  font-size: 10px; font-weight: 800; color: #e8d9b0;
  text-align: center; line-height: 1.25;
}
.cv-pack-n {
  position: absolute; top: -9px; right: -9px;
  min-width: 23px; height: 23px; padding: 0 5px;
  border-radius: 12px;
  background: linear-gradient(160deg, #ffd54f, #e0a820);
  border: 2px solid #7a5a10;
  color: #4a3200;
  font-size: 12px; font-weight: 900; line-height: 19px;
  box-shadow: 0 2px 6px rgba(0,0,0,0.5);
}

/* ---- 🛒 商店（纯金币经济） ---- */
.cv-shop {
  display: flex; flex-direction: column; gap: 12px;
  padding: 14px 20px 16px;
  background: rgba(12, 24, 28, 0.88);
  border-color: rgba(128, 216, 255, 0.35);
}
.cv-shop-head { display: flex; align-items: baseline; gap: 14px; flex-wrap: wrap; }
.cv-shop-title {
  font-size: 16px; font-weight: 900; color: #80d8ff; letter-spacing: 2px;
  text-shadow: 0 2px 0 rgba(0, 0, 0, 0.5);
}
.cv-shop-gold {
  font-size: 15px; font-weight: 900; color: #ffd54f;
  background: rgba(66, 50, 10, 0.45);
  border: 2px solid rgba(255, 213, 79, 0.45);
  border-radius: 6px; padding: 1px 10px;
  text-shadow: 0 1px 0 rgba(0, 0, 0, 0.5);
}
.cv-shop-opened { font-size: 11px; color: #9fc0b4; }
.cv-shop-tip { font-size: 10px; color: #54706a; margin-left: auto; }
.cv-shop-grid { display: flex; gap: 12px; flex-wrap: wrap; }
.cv-shop-tile {
  position: relative;
  padding: 6px 8px;
  background: rgba(0, 0, 0, 0.35);
  border: 2px solid #3d5a54;
  border-radius: 8px;
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  cursor: pointer;
  font-family: inherit;
  transition: transform 0.14s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.14s, filter 0.14s;
}
.cv-shop-tile:hover { transform: translateY(-3px); box-shadow: 0 8px 18px rgba(0, 0, 0, 0.5), 0 0 12px rgba(128, 216, 255, 0.25); }
.cv-shop-tile:active { transform: scale(0.94, 0.88); }
.cv-shop-tile.poor { filter: grayscale(0.7) brightness(0.65); cursor: not-allowed; }
.cv-shop-sprite { width: 42px; height: 56px; }
.cv-shop-motif { font-size: 26px; }
.cv-shop-price {
  font-size: 11px; font-weight: 900; color: #ffd54f;
  background: rgba(66, 50, 10, 0.5);
  border: 1px solid rgba(255, 213, 79, 0.4);
  border-radius: 4px; padding: 0 7px;
}

/* ---- 扑克收藏 52 格 + 迷你卡（原作视觉层级：增强整卡面 / 蜡封右上印章 / 版本全卡着色） ---- */
.cv-pcards { display: flex; flex-direction: column; gap: 5px; }
.cv-pcards-row { display: flex; gap: 5px; flex-wrap: wrap; }
.cv-pcell { cursor: default; transition: transform 0.12s; }
.cv-pcell.found { cursor: pointer; }
.cv-pcell.found:hover { transform: translateY(-3px) scale(1.08); }
.cv-pcell-q {
  width: 46px; height: 62px;
  display: flex; align-items: center; justify-content: center;
  border-radius: 5px;
  background: linear-gradient(160deg, #16211d, #0a1210);
  border: 2px dashed rgba(255, 255, 255, 0.1);
  font-size: 18px; font-weight: 900; color: rgba(255, 255, 255, 0.14);
}
/* 迷你卡基座（46×62；图集瓦片 background 由 JS 按宽度缩放） */
.cv-mc {
  position: relative;
  width: 46px; height: 62px;
  border-radius: 5px;
  overflow: hidden;
  background: linear-gradient(160deg, #ffffff, #e8e8e0);
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.5), inset 0 0 0 1.5px rgba(0, 0, 0, 0.22);
}
.cv-mc-face, .cv-mc-seal {
  position: absolute; inset: 0;
  image-rendering: pixelated;
  background-repeat: no-repeat;
}
.cv-mc-face.base { background: linear-gradient(160deg, #ffffff, #e9e9e1); }
.cv-mc-rank {
  position: absolute; top: 3px; left: 5px; z-index: 2;
  display: flex; align-items: baseline; gap: 1px;
  font-size: 13px; font-weight: 900; line-height: 1;
  text-shadow: 0 1px 0 rgba(255, 255, 255, 0.5);
}
.cv-mc-rank i { font-style: normal; font-size: 11px; }
.cv-mc-rank.suit-spades, .cv-mc-rank.suit-clubs { color: #1a1a2a; }
.cv-mc-rank.suit-hearts, .cv-mc-rank.suit-diamonds { color: #c62828; }
/* 版本全卡着色（伪元素覆盖，不遮点数角标可读性） */
.cv-mc::after { content: none; }
.cv-mc-ed-foil::after {
  content: ""; position: absolute; inset: 0; z-index: 3; pointer-events: none;
  background: linear-gradient(45deg, transparent 35%, rgba(180, 230, 255, 0.5) 50%, transparent 65%);
  mix-blend-mode: screen;
}
.cv-mc-ed-holo::after {
  content: ""; position: absolute; inset: 0; z-index: 3; pointer-events: none;
  background: linear-gradient(115deg, rgba(255, 0, 80, 0.15), rgba(255, 200, 0, 0.15), rgba(0, 255, 150, 0.15), rgba(0, 150, 255, 0.15));
}
.cv-mc-ed-poly::after {
  content: ""; position: absolute; inset: 0; z-index: 3; pointer-events: none;
  background: linear-gradient(90deg, rgba(255, 80, 80, 0.26), rgba(255, 220, 80, 0.26), rgba(80, 255, 120, 0.26), rgba(80, 160, 255, 0.26));
  animation: mcPolyHue 4s linear infinite;
}
@keyframes mcPolyHue { 0% { filter: hue-rotate(0deg); } 100% { filter: hue-rotate(360deg); } }
.cv-mc-ed-negative { filter: invert(1) hue-rotate(180deg); }
/* 尺寸变体：细看大卡 / 矩阵小卡 / 参考卡 */
.cv-mc-big { width: 150px; height: 201px; border-radius: 12px; cursor: zoom-in; }
.cv-mc-big .cv-mc-rank { font-size: 30px; top: 9px; left: 13px; }
.cv-mc-big .cv-mc-rank i { font-size: 24px; }
.cv-mc-sm { width: 34px; height: 46px; border-radius: 4px; flex: none; }
.cv-mc-sm .cv-mc-rank { font-size: 10px; top: 2px; left: 3px; }
.cv-mc-sm .cv-mc-rank i { font-size: 8px; }
.cv-mc-ref { width: 46px; height: 62px; flex: none; filter: drop-shadow(0 3px 5px rgba(0, 0, 0, 0.5)); }

/* 一键卖出重复（页签行 / 扑克区标题） */
.cv-sell-dupes {
  margin-left: auto;
  height: 30px; padding: 0 14px;
  font-family: inherit; font-size: 12px; font-weight: 900; letter-spacing: 1px;
  color: #4a3200;
  background: linear-gradient(180deg, #ffd968, #f4c14f 60%, #e0a820);
  border: 2px solid #7a5a10;
  border-radius: 6px;
  box-shadow: 0 2px 0 #5c4708, inset 0 1px 0 rgba(255, 255, 255, 0.5);
  cursor: pointer;
  transition: transform 0.1s, filter 0.12s;
}
.cv-sell-dupes:hover { filter: brightness(1.1); }
.cv-sell-dupes:active { transform: scale(0.94, 0.86); box-shadow: 0 1px 0 #5c4708; }
.cv-sell-dupes.inline { margin-left: 12px; height: 24px; padding: 0 10px; font-size: 11px; vertical-align: middle; }

/* ---- 锁定提示 / 出售 ---- */
.cv-detail-lock {
  font-size: 11.5px; color: #ffcc80;
  background: rgba(62, 39, 12, 0.45);
  border: 2px solid rgba(255, 204, 128, 0.35);
  padding: 6px 10px; border-radius: 6px;
}
.cv-sell-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.cv-sell-btn {
  height: 32px; padding: 0 16px;
  font-family: inherit; font-size: 13px; font-weight: 900; letter-spacing: 1px;
  color: #4a3200;
  background: linear-gradient(180deg, #ffd968, #f4c14f 60%, #e0a820);
  border: 2px solid #7a5a10;
  border-radius: 6px;
  box-shadow: 0 2px 0 #5c4708, inset 0 1px 0 rgba(255, 255, 255, 0.5);
  cursor: pointer;
  transition: transform 0.1s, filter 0.12s;
}
.cv-sell-btn:hover { filter: brightness(1.1); }
.cv-sell-btn:active { transform: scale(0.94, 0.86); box-shadow: 0 1px 0 #5c4708; }
.cv-sell-btn.small { height: 26px; padding: 0 10px; font-size: 11px; }
.cv-pcmatrix { display: flex; flex-direction: column; gap: 6px; }
.cv-pcvar-row {
  display: flex; align-items: center; gap: 10px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid #33504a;
  border-radius: 6px; padding: 5px 10px;
}
.cv-pcvar-name { font-size: 12px; color: #e8f0ec; flex: 1; }
.cv-pc-inspect .cv-inspect-info { min-width: 300px; }

/* ---- 像素页签（squish 按压） ---- */
.cv-tabs {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
}
.cv-tab {
  height: 36px; padding: 0 18px;
  background: rgba(14, 26, 23, 0.9);
  border: 2px solid #3d5a54;
  border-radius: 8px;
  color: #9fc0b4;
  font-family: inherit;
  font-size: 13px; font-weight: 800; letter-spacing: 1px;
  cursor: pointer;
  transition: transform 0.1s, filter 0.12s, color 0.12s;
}
.cv-tab:hover { color: #e8f0ec; filter: brightness(1.2); transform: translateY(-2px); }
.cv-tab:active { transform: scale(0.94, 0.86); }
.cv-tab.active {
  color: #f4c14f;
  border-color: #f4c14f;
  background: rgba(58, 46, 14, 0.9);
  box-shadow: 0 0 14px rgba(244, 193, 79, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.1);
}
.cv-rarity-filter { display: flex; gap: 6px; margin-left: 14px; }
.cv-rf {
  height: 28px; padding: 0 12px;
  background: rgba(14, 26, 23, 0.9);
  border: 2px solid #3d5a54;
  border-radius: 6px;
  color: #8fa8a0;
  font-family: inherit;
  font-size: 11px; font-weight: 800;
  cursor: pointer;
  transition: transform 0.1s, color 0.12s;
}
.cv-rf:hover { color: #e8f0ec; }
.cv-rf:active { transform: scale(0.92, 0.85); }
.cv-rf.active { background: rgba(255, 255, 255, 0.08); border-color: currentColor; }

/* ---- 卡牌网格（stagger pop-in） ---- */
.cv-body {
  flex: 1;
  background: rgba(9, 17, 15, 0.78);
  padding: 20px;
  overflow-y: auto;
}
.cv-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(88px, 1fr));
  gap: 16px 10px;
}
.cv-cell {
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  cursor: pointer;
  transition: transform 0.14s;
  animation: cellPop 0.32s cubic-bezier(0.34, 1.56, 0.64, 1) both;
  animation-delay: calc(var(--i, 0) * 14ms);
}
@keyframes cellPop {
  from { opacity: 0; transform: scale(0.55) translateY(12px); }
}
.cv-cell:hover:not(.undiscovered) { transform: translateY(-5px) scale(1.04); }
.cv-cell.undiscovered { cursor: default; }
.cv-card-box { position: relative; }
/* 原作式黑影：真精灵卡未发现自己 → 全黑半透明 */
.cv-shadowcard {
  position: relative;
  pointer-events: none;
}
.cv-shadowcard:not(.fragment) :deep(.pc-front) {
  filter: brightness(0);
  opacity: 0.55;
}
.cv-shadowcard:not(.fragment) :deep(.pc-gloss),
.cv-shadowcard:not(.fragment) :deep(.pc-edition-layer) { display: none; }
/* 持有角标：游戏贴纸风 */
.cv-owned {
  position: absolute; top: -7px; right: -9px; z-index: 6;
  min-width: 21px; height: 21px; padding: 0 5px;
  border-radius: 11px;
  background: linear-gradient(160deg, #ffd54f, #e0a820);
  border: 2px solid #7a5a10;
  color: #4a3200;
  font-size: 11.5px; font-weight: 900; line-height: 18px; text-align: center;
  box-shadow: 0 2px 6px rgba(0,0,0,0.55);
  transform: rotate(6deg);
  pointer-events: none;
}
/* §21 细看碎片区 / 合成按钮 / 碎片进度 */
.cv-frag-row {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 7px 10px;
  border: 2px dashed rgba(154, 138, 232, 0.55);
  border-radius: 8px;
  background: rgba(80, 60, 160, 0.12);
}
.cv-frag-progress { font-size: 12.5px; font-weight: 900; color: #c8bdf0; }
.cv-frag-tip { font-size: 10.5px; color: #8a7fb8; }
.cv-combine-btn {
  height: 32px; padding: 0 16px;
  font-family: inherit; font-size: 13px; font-weight: 900; letter-spacing: 1px;
  color: #2a1a58;
  background: linear-gradient(180deg, #c8b8ff 0%, #9a8ae8 55%, #7a62d8 100%);
  border: 2px solid #3a2a78;
  border-radius: 6px;
  box-shadow: 0 3px 0 #2a1a58, inset 0 2px 0 rgba(255, 255, 255, 0.5);
  cursor: pointer;
  transition: transform 0.08s, filter 0.12s;
}
.cv-combine-btn:hover { filter: brightness(1.1); transform: translateY(-1px); }
.cv-combine-btn:active { transform: scale(0.94, 0.88); }
.cv-combine-btn.small { height: 26px; padding: 0 10px; font-size: 11px; }
/* §21 撕裂半张小卡（变体矩阵碎片行；与 PlayingCard .frag 同款锯齿） */
.cv-mc.cv-mc-frag {
  clip-path: polygon(
    0% 0%, 50% 0%,
    46% 6%, 53% 12%, 47% 18%, 52% 25%, 46% 32%, 53% 39%, 47% 46%, 52% 53%,
    46% 60%, 53% 67%, 47% 74%, 52% 81%, 46% 88%, 51% 95%, 48% 100%,
    0% 100%
  );
}
.cv-pcvar-row.frag { opacity: 0.9; }

/* §16② NEW! 像素贴纸（与开包扇形同款：黄底红字、斜贴、pop-in + 抖动） */
.cv-new-badge {
  position: absolute; top: -9px; left: -13px; z-index: 6;
  font-size: 11px; font-weight: 900; letter-spacing: 1px;
  color: #b03327;
  background: linear-gradient(160deg, #ffd54f, #f0a830);
  border: 2px solid #7a5a10;
  border-radius: 4px; padding: 1px 6px;
  box-shadow: 0 2px 0 #5c4708, 0 4px 10px rgba(0, 0, 0, 0.55);
  transform: rotate(-10deg);
  animation: newPop 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) both, newWiggle 1.5s ease-in-out 0.45s infinite;
  pointer-events: none;
  text-shadow: 0 1px 0 rgba(255, 255, 255, 0.35);
}
@keyframes newPop {
  from { transform: scale(0.3) rotate(-22deg); opacity: 0; }
}
@keyframes newWiggle {
  0%, 100% { transform: rotate(-10deg) translateY(0); }
  50% { transform: rotate(-6deg) translateY(-3px); }
}
/* 页头「全部已读」小按钮 */
.cv-mark-read {
  margin-left: 10px;
  height: 22px; padding: 0 9px;
  font-family: inherit; font-size: 10px; font-weight: 800; letter-spacing: 1px;
  color: #b03327;
  background: linear-gradient(160deg, #ffd54f, #f0a830);
  border: 2px solid #7a5a10;
  border-radius: 5px;
  cursor: pointer;
  box-shadow: 0 2px 0 #5c4708;
  transition: transform 0.1s, filter 0.12s;
}
.cv-mark-read:hover { filter: brightness(1.1); transform: translateY(-1px); }
.cv-mark-read:active { transform: scale(0.92, 0.85); box-shadow: 0 1px 0 #5c4708; }
.cv-eds { display: flex; gap: 4px; }
.cv-ed {
  width: 9px; height: 9px; border-radius: 50%;
  background: #9e9e9e;
  box-shadow: 0 0 0 1.5px rgba(0, 0, 0, 0.6), 0 0 5px rgba(255, 255, 255, 0.35);
}
.cv-ed.ed-foil { background: #80deea; }
.cv-ed.ed-holo { background: #f48fb1; }
.cv-ed.ed-poly { background: #fff176; }
.cv-ed.ed-negative { background: #b39ddb; }
.cv-name { font-size: 11px; color: #cfe0d8; text-align: center; }
.cv-name.dim { color: #54706a; }
.cv-silhouette {
  width: 76px; height: 102px; border-radius: 8px;
  background: linear-gradient(160deg, #16211d, #0a1210);
  border: 2px dashed rgba(255, 255, 255, 0.1);
  display: flex; align-items: center; justify-content: center;
}
.cv-sil-q {
  font-size: 34px; font-weight: 900; color: rgba(255,255,255,0.14);
  text-shadow: 0 2px 0 rgba(0,0,0,0.4);
}

/* ---- 增强/蜡封/版本 ---- */
.cv-mods-section { display: flex; flex-direction: column; gap: 12px; }
.cv-mods-title {
  margin: 8px 0 0;
  font-size: 15px; color: #f4c14f; letter-spacing: 3px;
  text-shadow: 0 2px 0 rgba(0, 0, 0, 0.5);
}
.cv-mods-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 10px; }
.cv-mod-card {
  display: flex; flex-direction: row; align-items: center; gap: 12px;
  background: rgba(255, 255, 255, 0.04);
  border: 2px solid #33504a;
  border-left: 4px solid #80cbc4;
  border-radius: 6px; padding: 10px 12px;
}
.cv-mod-info { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.cv-mod-card.edition :deep(.pc-wrap) { flex: none; filter: drop-shadow(0 3px 5px rgba(0, 0, 0, 0.5)); }
.cv-mod-card.seal.seal-red { border-left-color: #ef5350; }
.cv-mod-card.seal.seal-blue { border-left-color: #42a5f5; }
.cv-mod-card.seal.seal-purple { border-left-color: #ab47bc; }
.cv-mod-card.seal.seal-gold { border-left-color: #ffd54f; }
.cv-mod-card.edition.ed-foil { border-left-color: #80deea; }
.cv-mod-card.edition.ed-holo { border-left-color: #f48fb1; }
.cv-mod-card.edition.ed-poly { border-left-color: #fff176; }
.cv-mod-card.edition.ed-negative { border-left-color: #b39ddb; }
.cv-mod-name { font-size: 12.5px; font-weight: 800; color: #e8f0ec; }
.cv-mod-name em { font-style: normal; font-weight: 500; color: #8fa8a0; margin-left: 4px; }
.cv-mod-text { font-size: 11px; color: #9fc0b4; line-height: 1.5; }

/* ---- 详情弹层（游戏面板） ---- */
.cv-detail-overlay {
  position: fixed; inset: 0; z-index: 1200;
  background: rgba(4, 8, 7, 0.72);
  display: flex; align-items: center; justify-content: center;
  backdrop-filter: blur(3px);
}
.cv-detail {
  position: relative;
  display: flex; gap: 22px; align-items: flex-start;
  background: linear-gradient(160deg, #1a2f29, #101d1a);
  border: 2px solid #4a6a64;
  border-radius: 14px;
  padding: 24px 28px;
  max-width: 560px;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.65), inset 0 1px 0 rgba(255, 255, 255, 0.08);
  animation: detailIn 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
}
@keyframes detailIn { from { opacity: 0; transform: scale(0.92); } to { opacity: 1; transform: none; } }
.cv-detail-card {
  animation: detailFloat 3s ease-in-out infinite;
  filter: drop-shadow(0 10px 16px rgba(0, 0, 0, 0.5));
}
@keyframes detailFloat {
  0%, 100% { transform: translateY(0) rotate(-1deg); }
  50% { transform: translateY(-6px) rotate(1deg); }
}
.cv-detail-info { display: flex; flex-direction: column; gap: 10px; min-width: 260px; }
.cv-detail-name {
  font-size: 20px; font-weight: 900; color: #f4c14f; letter-spacing: 1px;
  text-shadow: 0 2px 0 rgba(0, 0, 0, 0.5);
}
.cv-detail-name-en { font-size: 12px; color: #8fa8a0; font-weight: 500; margin-left: 8px; }
.cv-detail-tags { display: flex; gap: 6px; flex-wrap: wrap; }
.cv-tag {
  font-size: 10.5px; font-weight: 800;
  border: 2px solid rgba(255, 255, 255, 0.25);
  padding: 2px 9px; border-radius: 6px;
  color: #cfe0d8;
}
.cv-tag.cost { color: #ffd54f; border-color: rgba(255, 213, 79, 0.5); }
.cv-tag.mod { color: #80d8ff; border-color: rgba(128, 216, 255, 0.5); }
.cv-detail-text { margin: 0; font-size: 13px; color: #e8f0ec; line-height: 1.6; }
.cv-detail-text-en { margin: 0; font-size: 11px; color: #6f8a80; line-height: 1.5; }
.cv-detail-unlock {
  font-size: 11.5px; color: #a5d6a7;
  background: rgba(27, 62, 32, 0.4);
  border: 2px solid rgba(165, 214, 167, 0.3);
  padding: 6px 10px; border-radius: 6px;
}
/* 红色 squish 关闭钮 */
.cv-detail-close {
  position: absolute; top: 10px; right: 12px;
  width: 30px; height: 30px;
  background: linear-gradient(180deg, #e05548, #b03327);
  border: 2px solid #6e1d14;
  border-radius: 8px;
  color: #fff; font-size: 14px; font-weight: 900;
  box-shadow: 0 3px 0 #5c170f;
  cursor: pointer;
}
.cv-detail-close:hover { filter: brightness(1.15); }
.cv-detail-close:active { transform: scale(0.9); box-shadow: 0 1px 0 #5c170f; }
.cv-detail-card { cursor: zoom-in; }
.cv-detail-tip { margin-top: 8px; font-size: 10px; color: #54706a; text-align: center; }

/* ---- §14③ 3D 细看覆盖层 ---- */
.cv-inspect {
  position: fixed; inset: 0; z-index: 1400;
  display: flex; align-items: center; justify-content: center; gap: 32px;
  background: radial-gradient(ellipse at center, rgba(2, 6, 5, 0.55) 0%, rgba(2, 6, 5, 0.9) 78%);
  opacity: 0;
  transition: opacity 0.25s;
}
.cv-inspect.in { opacity: 1; }
.cv-inspect-mover {
  transition: transform 0.34s cubic-bezier(0.3, 1.35, 0.45, 1), opacity 0.3s;
  filter: drop-shadow(0 18px 30px rgba(0, 0, 0, 0.6));
}
.cv-inspect-info {
  display: flex; flex-direction: column; gap: 10px;
  max-width: 300px;
}
.cv-inspect-name {
  font-size: 24px; font-weight: 900; letter-spacing: 1px;
  color: #f4c14f;
  text-shadow: 0 2px 0 rgba(0, 0, 0, 0.6);
}
.cv-inspect-name-en { font-size: 12px; color: #8fa8a0; font-weight: 500; margin-left: 8px; letter-spacing: 0; }
.cv-inspect-text { font-size: 13px; color: #e8f0ec; line-height: 1.6; }
.cv-inspect-text-en { font-size: 11px; color: #6f8a80; line-height: 1.5; }
.cv-inspect-tip { font-size: 10.5px; color: #54706a; margin-top: 6px; }

/* ---- 收藏开包弹层（PackModal overlay 为 absolute，由本层提供 fixed 定位上下文） ---- */
.cv-pack-modal {
  position: fixed; inset: 0; z-index: 1300;
}
.cv-pack-modal :deep(.pm-overlay) {
  background: rgba(4, 9, 8, 0.5); /* 让 CRT 漩涡隐约透出 */
}

@media (max-width: 720px) {
  .cv-header { flex-direction: column; align-items: stretch; }
  .cv-detail { flex-direction: column; align-items: center; }
}
</style>
