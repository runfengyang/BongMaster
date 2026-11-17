<template>
  <div class="shop-panel">
    <!-- 头行：结算明细 + 离开 -->
    <div class="sp-head">
      <h2 class="sp-title">商店</h2>
      <div v-if="cashout" class="sp-cashout">
        <span v-if="cashout.reward">盲注奖励 +${{ cashout.reward }}</span>
        <span v-if="cashout.handsBonus">剩余出牌 +${{ cashout.handsBonus }}</span>
        <span v-if="cashout.discardsBonus">剩余弃牌 +${{ cashout.discardsBonus }}</span>
        <span v-if="cashout.interest">利息 +${{ cashout.interest }}</span>
        <span v-if="cashout.jokerEconomy">小丑经济 +${{ cashout.jokerEconomy }}</span>
      </div>
      <span class="sp-money">${{ fmt(run.money) }}</span>
      <button class="bt-btn primary" @click="$emit('leave')">下一回合 →</button>
    </div>

    <!-- 卡牌位（售罄保留空槽） -->
    <div class="sp-cards">
      <div v-for="i in cardSlots" :key="'slot' + i" class="sp-slot">
        <template v-if="shop.cards[i - 1]">
          <div class="sp-item">
            <PlayingCard
              v-if="shop.cards[i - 1].kind === 'playing'"
              :card="shop.cards[i - 1].card"
              kind="playing"
              :edition="shop.cards[i - 1].edition"
              :width="78"
            />
            <PlayingCard
              v-else
              :def="defOf(shop.cards[i - 1].id)"
              :kind="itemKind(shop.cards[i - 1])"
              :edition="shop.cards[i - 1].edition"
              :width="78"
            />
            <div class="sp-tip">
              <div class="t-name">{{ itemName(shop.cards[i - 1]) }}</div>
              <div class="t-text">{{ defOf(shop.cards[i - 1].id)?.text || '加入你的牌堆' }}</div>
            </div>
            <button
              class="bt-btn sm buy"
              :disabled="!canPay(shop.cards[i - 1].price ?? 0)"
              @click="$emit('buyItem', i - 1)"
            >${{ shop.cards[i - 1].price ?? 0 }}</button>
          </div>
        </template>
        <div v-else class="sp-empty"><span>已售出</span></div>
      </div>
    </div>

    <!-- 卡包 + 优惠券 + 重掷 -->
    <div class="sp-row">
      <div v-for="i in 2" :key="'pack' + i" class="sp-slot">
        <template v-if="shop.packs[i - 1]">
          <div class="sp-item">
            <div class="sp-pack" :style="packStyle(shop.packs[i - 1])">
              <span>{{ packMotif(shop.packs[i - 1]) }}</span>
            </div>
            <div class="sp-tip">
              <div class="t-name">{{ shop.packs[i - 1].name }}</div>
              <div class="t-text">{{ packDesc(shop.packs[i - 1]) }}</div>
            </div>
            <button
              class="bt-btn sm buy"
              :disabled="!canPay(shop.packs[i - 1].price ?? shop.packs[i - 1].cost)"
              @click="$emit('buyPack', i - 1)"
            >${{ shop.packs[i - 1].price ?? shop.packs[i - 1].cost }}</button>
          </div>
        </template>
        <div v-else class="sp-empty sm"><span>已售出</span></div>
      </div>

      <!-- 优惠券位 -->
      <div v-for="v in voucherSlots" :key="v.key" class="sp-slot">
        <template v-if="v.id">
          <div class="sp-item">
            <div class="sp-voucher">🎟️</div>
            <div class="sp-tip">
              <div class="t-name">{{ defOf(v.id)?.name }}</div>
              <div class="t-text">{{ defOf(v.id)?.text }}</div>
              <div class="t-text dim">本 Run 永久生效</div>
            </div>
            <button
              class="bt-btn sm buy"
              :disabled="!canPay(shop.voucherPrice ?? 10)"
              @click="$emit('buyVoucher', v.extra)"
            >${{ shop.voucherPrice ?? 10 }}</button>
          </div>
        </template>
        <div v-else class="sp-empty sm"><span>优惠券已购</span></div>
      </div>

      <button
        class="bt-btn reroll"
        :disabled="run.money < (shop.rerollCost ?? 5)"
        @click="$emit('reroll')"
      >🎲 重掷 ${{ shop.rerollCost ?? 5 }}</button>
    </div>

    <!-- 已持有优惠券 -->
    <div v-if="run.vouchers?.length" class="sp-owned">
      <span class="sp-owned-label">已持有优惠券</span>
      <span v-for="vid in run.vouchers" :key="vid" class="sp-vchip" :title="defOf(vid)?.text">
        {{ defOf(vid)?.art?.motif }} {{ defOf(vid)?.name }}
      </span>
    </div>
  </div>
</template>

<script setup>
// ShopPanel（§5.4）：卡牌位（售罄空槽）+ 卡包位 + 优惠券位 + 重掷 + 已持券展示
// 价格/栏位/折扣全部由引擎注入快照，UI 只读
import { computed } from 'vue'
import PlayingCard from './PlayingCard.vue'
import { BY_ID } from '../data/index.js'

const props = defineProps({
  run: { type: Object, required: true },       // 含 shop / money / vouchers / meta
  cashout: { type: Object, default: null },
})
defineEmits(['buyItem', 'buyPack', 'buyVoucher', 'reroll', 'leave'])

const shop = computed(() => props.run.shop || {})
const cardSlots = computed(() => Math.max(props.run.meta?.shopSlots ?? 2, shop.value.cards?.length ?? 0))

const voucherSlots = computed(() => {
  const out = [{ key: 'v0', id: shop.value.voucher, extra: false }]
  if (shop.value.extraVoucher !== undefined && shop.value.extraVoucher !== null) {
    out.push({ key: 'v1', id: shop.value.extraVoucher, extra: true })
  }
  return out
})

function defOf(id) { return BY_ID[id] || null }
function itemKind(item) {
  if (item.kind === 'joker') return 'joker'
  return BY_ID[item.id]?.type || 'tarot'
}
function itemName(item) {
  if (item.kind === 'playing') return '扑克牌'
  return BY_ID[item.id]?.name || item.id
}
function canPay(price) {
  if (shop.value.coupon) return true
  return (props.run.money ?? 0) >= price
}
function fmt(n) { return Math.round(n ?? 0).toLocaleString('en-US') }

const PACK_MOTIFS = { arcana: '🔮', celestial: '🪐', standard: '🂠', spectral: '👻', buffoon: '🃏' }
const PACK_DESCS = {
  tarot: '内含塔罗牌', planet: '内含星球牌', playing: '内含扑克牌（可带增强/蜡封/版本）',
  spectral: '内含幻灵牌', joker: '内含小丑牌',
}
function packMotif(p) { return PACK_MOTIFS[p.packType] || '📦' }
function packDesc(p) {
  return `${PACK_DESCS[p.contents] || ''}，${p.count} 张选 ${p.choose} 张`
}
function packStyle(p) {
  return { background: `linear-gradient(160deg, ${p.art?.bg || '#4a3a6a'}, #14101c 150%)` }
}
</script>

<style scoped>
.shop-panel {
  display: flex; flex-direction: column; align-items: center; gap: 18px;
  width: 100%;
}
.sp-head { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; justify-content: center; }
.sp-title { font-size: 22px; font-weight: 900; letter-spacing: 2px; color: #ffd54f; margin: 0; text-shadow: 0 2px 0 rgba(0,0,0,0.5); }
.sp-cashout {
  display: flex; gap: 10px; flex-wrap: wrap;
  font-size: 12px; font-weight: 700; color: #ffd54f;
  background: rgba(0,0,0,0.4); padding: 6px 12px; border-radius: 8px;
}
.sp-money {
  font-size: 18px; font-weight: 900; color: #ffd54f;
  background: rgba(0,0,0,0.5); border: 1px solid rgba(255,213,79,0.35);
  padding: 4px 14px; border-radius: 8px;
}

.sp-cards { display: flex; gap: 18px; flex-wrap: wrap; justify-content: center; }
.sp-row { display: flex; gap: 18px; flex-wrap: wrap; justify-content: center; align-items: flex-end; }

.sp-slot { position: relative; }
.sp-item {
  position: relative;
  display: flex; flex-direction: column; align-items: center; gap: 6px;
}
.sp-empty {
  width: 82px; height: 110px;
  border: 2px dashed rgba(255,255,255,0.14); border-radius: 10px;
  display: flex; align-items: center; justify-content: center;
  color: rgba(255,255,255,0.25); font-size: 11px;
}
.sp-empty.sm { width: 82px; height: 86px; }

.sp-pack {
  width: 78px; height: 104px; border-radius: 10px;
  border: 2px solid #8a6d9e;
  display: flex; align-items: center; justify-content: center;
  font-size: 36px;
  box-shadow: 0 4px 0 rgba(0,0,0,0.4);
  transition: transform 0.14s;
}
.sp-item:hover .sp-pack { transform: translateY(-3px); }
.sp-voucher {
  width: 78px; height: 104px; border-radius: 10px;
  border: 2px solid #c9a86a;
  background: linear-gradient(160deg, #5c4a2e, #302410);
  display: flex; align-items: center; justify-content: center;
  font-size: 36px;
  box-shadow: 0 4px 0 rgba(0,0,0,0.4);
}

/* 悬停详情 */
.sp-tip {
  position: absolute; bottom: calc(100% + 8px); left: 50%; transform: translateX(-50%) translateY(4px);
  width: 190px;
  background: rgba(13, 20, 24, 0.96);
  border: 1px solid rgba(255,255,255,0.18);
  border-radius: 9px; padding: 8px 10px;
  opacity: 0; pointer-events: none;
  transition: opacity 0.14s, transform 0.14s;
  z-index: 20;
}
.sp-item:hover .sp-tip { opacity: 1; transform: translateX(-50%) translateY(0); }
.t-name { font-size: 12px; font-weight: 900; color: #ffd54f; margin-bottom: 3px; }
.t-text { font-size: 11px; color: #cfd8dc; line-height: 1.5; }
.t-text.dim { color: #90a4ae; margin-top: 3px; }

.bt-btn.reroll { margin-bottom: 2px; }

.sp-owned {
  display: flex; gap: 8px; flex-wrap: wrap; align-items: center; justify-content: center;
  max-width: 720px;
}
.sp-owned-label { font-size: 11px; color: #78909c; }
.sp-vchip {
  font-size: 11px; font-weight: 700; color: #ffe0b2;
  background: rgba(92, 74, 46, 0.5);
  border: 1px solid rgba(201, 168, 106, 0.45);
  padding: 3px 9px; border-radius: 20px;
  cursor: help;
}
</style>
