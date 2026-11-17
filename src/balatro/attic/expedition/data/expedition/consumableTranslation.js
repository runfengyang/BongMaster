// 塔罗 22 + 幻灵 18 全量翻译表（契约 §5.4，老虎机模型）
// 原则：改牌类恢复原作语义，直接作用于本局扑克牌组（牌组构建本体）；
// 当日类一次性法术按契约给定映射（节制 = 压力 -1；塔 = 重 roll Boss 今日意图；隐者 = 研料 +2）；
// 金钱 → 研料（局内货币）。effect.kind 由 engine/expedition/consumables.js 执行。

export const TAROT_TRANSLATION = {
  c_fool: {
    name: '愚者', translation: '复制本局上一张使用的消耗牌效果（原作语义）',
    effect: { kind: 'fool' },
  },
  c_magician: {
    name: '魔术师', translation: '牌组 2 张牌变万能（原作语义）',
    effect: { kind: 'deckMutate', count: 2, mutation: { enhancement: 'wild' } },
  },
  c_high_priestess: {
    name: '女祭司', translation: '随机 2 张星球牌入消耗栏（原作语义）',
    effect: { kind: 'create', pool: 'planet', count: 2 },
  },
  c_empress: {
    name: '皇后', translation: '牌组 2 张牌变倍率牌（+4 倍率，原作语义）',
    effect: { kind: 'deckMutate', count: 2, mutation: { enhancement: 'mult' } },
  },
  c_emperor: {
    name: '皇帝', translation: '随机 2 张塔罗牌入消耗栏（原作语义）',
    effect: { kind: 'create', pool: 'tarot', count: 2 },
  },
  c_hierophant: {
    name: '教皇', translation: '牌组 2 张牌变奖励牌（+30 筹码，原作语义）',
    effect: { kind: 'deckMutate', count: 2, mutation: { enhancement: 'bonus' } },
  },
  c_lovers: {
    name: '恋人', translation: '牌组 1 张牌变万能（原作语义）',
    effect: { kind: 'deckMutate', count: 1, mutation: { enhancement: 'wild' } },
  },
  c_chariot: {
    name: '战车', translation: '牌组 1 张牌变钢铁牌（未抽中时 ×1.5，原作语义）',
    effect: { kind: 'deckMutate', count: 1, mutation: { enhancement: 'steel' } },
  },
  c_justice: {
    name: '正义', translation: '牌组 1 张牌变玻璃牌（×2，1/4 碎裂，原作语义）',
    effect: { kind: 'deckMutate', count: 1, mutation: { enhancement: 'glass' } },
  },
  c_hermit: {
    name: '隐者', translation: '研料 +2（契约定值；原作金钱翻倍上限 $20）',
    effect: { kind: 'research', amount: 2 },
  },
  c_wheel: {
    name: '命运之轮', translation: '1/4 概率给阵容随机小丑加随机版本（原作语义；版本 = 数值/栏位加成）',
    effect: { kind: 'wheel' },
  },
  c_strength: {
    name: '力量', translation: '牌组 2 张牌 rank +1（原作语义）',
    effect: { kind: 'deckMutate', count: 2, mutation: { rankPlus: 1 } },
  },
  c_hanged_man: {
    name: '倒吊人', translation: '销毁牌组至多 2 张牌（原作语义）',
    effect: { kind: 'destroy', count: 2 },
  },
  c_death: {
    name: '死神', translation: '选 2 张牌，左牌变成右牌的复制（原作语义）',
    effect: { kind: 'death' },
  },
  c_temperance: {
    name: '节制', translation: '压力 -1（契约；原作按小丑售出价值得钱）',
    effect: { kind: 'pressure', amount: -1 },
  },
  c_devil: {
    name: '恶魔', translation: '牌组 1 张牌变黄金牌（计分时研料 +3，原作语义）',
    effect: { kind: 'deckMutate', count: 1, mutation: { enhancement: 'gold' } },
  },
  c_tower: {
    name: '塔', translation: '重 roll Boss 今日意图（契约；原作石头牌由魔术师系增强与卡包承载）',
    effect: { kind: 'rerollIntent' },
  },
  c_star: {
    name: '星星', translation: '牌组至多 3 张牌变为 ♦（原作语义）',
    effect: { kind: 'deckMutate', count: 3, mutation: { suit: 'diamonds' } },
  },
  c_moon: {
    name: '月亮', translation: '牌组至多 3 张牌变为 ♣（原作语义）',
    effect: { kind: 'deckMutate', count: 3, mutation: { suit: 'clubs' } },
  },
  c_sun: {
    name: '太阳', translation: '牌组至多 3 张牌变为 ♥（原作语义）',
    effect: { kind: 'deckMutate', count: 3, mutation: { suit: 'hearts' } },
  },
  c_judgement: {
    name: '审判', translation: '随机 1 张小丑入阵容（原作语义；需空栏位）',
    effect: { kind: 'createJoker' },
  },
  c_world: {
    name: '世界', translation: '牌组至多 3 张牌变为 ♠（原作语义）',
    effect: { kind: 'deckMutate', count: 3, mutation: { suit: 'spades' } },
  },
}

export const SPECTRAL_TRANSLATION = {
  s_familiar: {
    name: '使魔', translation: '销毁牌组 1 张牌，加入 3 张随机增强人头牌（原作语义）',
    effect: { kind: 'destroyAdd', destroy: 1, add: { count: 3, ranks: [11, 12, 13], enhanced: true } },
  },
  s_grim: {
    name: '严峻', translation: '销毁牌组 1 张牌，加入 2 张随机增强 A（原作语义）',
    effect: { kind: 'destroyAdd', destroy: 1, add: { count: 2, ranks: [14], enhanced: true } },
  },
  s_incantation: {
    name: '咒语', translation: '销毁牌组 1 张牌，加入 4 张随机增强数字牌（原作语义）',
    effect: { kind: 'destroyAdd', destroy: 1, add: { count: 4, ranks: [2, 3, 4, 5, 6, 7, 8, 9, 10], enhanced: true } },
  },
  s_talisman: {
    name: '护身符', translation: '牌组 1 张牌加金蜡封（原作语义）',
    effect: { kind: 'deckMutate', count: 1, mutation: { seal: 'gold' } },
  },
  s_aura: {
    name: '光环', translation: '牌组 1 张牌加随机版本（原作语义）',
    effect: { kind: 'deckMutate', count: 1, mutation: { edition: 'random' } },
  },
  s_wraith: {
    name: '幽灵', translation: '随机稀有小丑入阵容，研料归零（原作语义：金钱归零）',
    effect: { kind: 'wraith' },
  },
  s_sigil: {
    name: '符印', translation: '今日全部抽取视为同一随机花色（原作「全手牌同花色」的当日映射）',
    effect: { kind: 'dayFx', fx: { type: 'allSameSuit' } },
  },
  s_ouija: {
    name: '占卜', translation: '今日全部抽取视为同一点数（原作「全手牌同点 -1 手牌上限」的当日映射）',
    effect: { kind: 'dayFx', fx: { type: 'allSameRank' } },
  },
  s_ectoplasm: {
    name: '灵质', translation: '阵容随机 1 张小丑变负片（+1 栏），每次拉杆抽取 -1（原作 -1 手牌上限）',
    effect: { kind: 'ectoplasm' },
  },
  s_immolate: {
    name: '火祭', translation: '销毁阵容 1 张小丑 → 当日全部拉杆伤害 ×2（契约「诅咒」语义）',
    effect: { kind: 'immolate' },
  },
  s_ankh: {
    name: '生命十字章', translation: '复制阵容 1 张小丑（局内副本，契约「降神」）',
    effect: { kind: 'ankh' },
  },
  s_deja_vu: {
    name: '既视感', translation: '牌组 1 张牌加红蜡封（计分重触发，原作语义）',
    effect: { kind: 'deckMutate', count: 1, mutation: { seal: 'red' } },
  },
  s_hex: {
    name: '妖法', translation: '阵容随机 1 张小丑变多彩，销毁其余（原作语义，慎用）',
    effect: { kind: 'hex' },
  },
  s_trance: {
    name: '入迷', translation: '牌组 1 张牌加蓝蜡封（未抽中时日终产星球，原作语义）',
    effect: { kind: 'deckMutate', count: 1, mutation: { seal: 'blue' } },
  },
  s_medium: {
    name: '灵媒', translation: '牌组 1 张牌加紫蜡封（被销毁时产塔罗，原作语义映射）',
    effect: { kind: 'deckMutate', count: 1, mutation: { seal: 'purple' } },
  },
  s_cryptid: {
    name: '神秘生物', translation: '选牌组 1 张牌，加入 2 份复制（原作语义）',
    effect: { kind: 'cryptid' },
  },
  s_soul: {
    name: '灵魂', translation: '随机传奇小丑入阵容（原作语义；需空栏位）',
    effect: { kind: 'soul' },
  },
  s_black_hole: {
    name: '黑洞', translation: '全部牌型等级 +1（原作语义）',
    effect: { kind: 'blackHole' },
  },
}

export const CONSUMABLE_TRANSLATION = { ...TAROT_TRANSLATION, ...SPECTRAL_TRANSLATION }
