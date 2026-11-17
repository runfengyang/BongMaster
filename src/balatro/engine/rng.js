// 可播种随机数（mulberry32）+ 加权抽取
// 状态可序列化：{ seed, counter } —— 每次调用推进 counter，保证读档后可复现

export function hashSeed(str) {
  let h = 2166136261 >>> 0
  const s = String(str)
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export class Rng {
  constructor(seed = 'balatro') {
    this.seed = typeof seed === 'string' ? hashSeed(seed) : (seed >>> 0)
    this.counter = 0
  }

  // mulberry32：种子 + 计数器派生，每次调用确定性推进
  next() {
    let t = (this.seed + Math.imul(this.counter++, 0x6d2b79f5)) >>> 0
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  int(min, max) { // [min, max] 闭区间
    return min + Math.floor(this.next() * (max - min + 1))
  }

  chance(numerator, denominator) { // n/d 概率
    return this.next() * denominator < numerator
  }

  pick(arr) {
    return arr[Math.floor(this.next() * arr.length)]
  }

  weightedPick(items, weightFn) { // items: array, weightFn: item → weight
    let total = 0
    for (const it of items) total += weightFn(it)
    let r = this.next() * total
    for (const it of items) {
      r -= weightFn(it)
      if (r <= 0) return it
    }
    return items[items.length - 1]
  }

  shuffle(arr) { // Fisher–Yates，原地并返回
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1))
      ;[arr[i], arr[j]] = [arr[j], arr[i]]
    }
    return arr
  }

  // 序列化
  getState() { return { seed: this.seed, counter: this.counter } }
  setState(s) { this.seed = s.seed >>> 0; this.counter = s.counter }
}
