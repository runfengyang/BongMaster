// Balatro 程序化音效（§3.4；§19 分层合成重做）
// 参考原作听感的纯 WebAudio 分层合成（原作采样音频有版权，不可复制，此处按听感重建）。
// 每个音效 = 多层结构叠加：噪声体（带通/高通/低通滤波 + 可选扫频）+ 音高体
// （振荡器 + 可选滑音）+ ADSR 包络（attack 线性 / decay+release 指数）。
//
// 音色参数总表（频率 Hz / 时长 s / peak 为相对增益，最终 × 全局 volume）：
//   flip    翻牌      L1 摩擦噪声 band 2600→900 Q1.4 .07s p.50 | L2 边缘脆响 hp 6000 .025s p.12
//   deal    发牌      flip 的轻声短版（.05s p.30 / hp 7000 .02s p.08），i×40ms 错位
//   chips   筹码      L1 三角 1450 .045s p.22 | L2 三角 2175(+.04) .05s p.20 | L3 打点噪声 hp 6500 .015s p.10
//   mult    倍率      上行琶音 saw 523/659/784/1047 步进 .05s（低通 3200）+ 顶层 hp 8000 闪烁 p.05
//   xmult   ×倍率     上行琶音 saw 784/988/1175/1568/1976 步进 .045s（低通 3600）+ hp 8500 闪烁
//   coin    金币      L1 正弦 990 .05s p.25 | L2 正弦 1980(+.05) .18s p.22 | L3 金属泛音 三角 2960 .22s p.06 | L4 击打 hp 9000 .02s p.05
//   coinCascade(n)    连续金币（一键卖出）：n 枚 coin 每 .07s 一枚，基频逐枚 ×1.06 上行
//   pack    开包      滤波噪声 1200Hz .3s p.6 + 600Hz .25s p.5（+.10）
//   crinkle 揉皱      5 簇高频噪声 2600→4600 递升（撕裂窗口内两发）
//   zip     拉锁      带通 900→4200 上扫 .28s p.55
//   thump   爆开低频  L1 正弦 130→42 .28s p.55 | L2 低通气浪 lp 260 .12s p.30
//   click   按钮      L1 正弦 520 .035s p.12 | L2 柔噪 lp 1800 .012s p.06
//   tick    悬停      正弦 1250 .018s p.045（极轻）
//   select  选中      正弦 660 .05s p.20
//   slam    撞击      正弦 220→55 .35s p.7 + 低噪 lp 300 .15s p.4
//   lose    失败      下行锯齿 440/392/330/262 步进 .18s
//   win     胜利      上行三角 523..1319 步进 .09s
//   glassBreak 玻璃碎 高通噪声 5000 Q3 .2s p.5
//   suspense 悬念     双正弦 440/445→880/895 上扬 .4s（t3/t4 翻牌前）
//   rareReveal 稀有   三角琶音 880..2217 步进 .06s + hp 8000 闪光
//   shimmer 解锁/稀有提示  L1 正弦滑音 1319→2637 .35s p.12 | L2 三角泛音簇 1760/2217/2637 步进 .07s p.10 | L3 高频扫频噪声 hp 9500 .3s p.06

let ctx = null
let _muted = false
let _volume = 0.5

export function setSoundSettings({ muted, volume } = {}) {
  if (muted !== undefined) _muted = muted
  if (volume !== undefined) _volume = volume
}

function ac() {
  if (typeof window === 'undefined') return null
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return null
    ctx = new AC()
  }
  if (ctx.state === 'suspended') ctx.resume()
  return ctx
}

// ADSR 包络：attack 线性至 peak，decay 指数衰减至 sustain 比例，hold 保持，release 指数归零
function adsr(gainNode, t0, dur, peak, { a = 0.005, s = 0, hold = 0, r = 0.03 } = {}) {
  const g = gainNode.gain
  const p = peak * _volume
  const sustainEnd = Math.max(t0 + a, t0 + dur - r)
  g.setValueAtTime(0, t0)
  g.linearRampToValueAtTime(p, t0 + a)
  if (s > 0) g.exponentialRampToValueAtTime(Math.max(p * s, 0.0001), t0 + a + hold)
  g.setValueAtTime(Math.max(s > 0 ? p * s : p, 0.0001), sustainEnd)
  g.exponentialRampToValueAtTime(0.0001, t0 + dur)
}

// 音高体层：振荡器 + 可选滑音（f0→f1）+ 可选滤波（ftype f0f→f1f）
function oscLayer(t0, { type = 'sine', f0, f1 = null, dur, peak = 0.3, env = {}, detune = 0, ftype = null, f0f = null, f1f = null, Q = 1 }) {
  const a = ac()
  if (!a) return
  const o = a.createOscillator()
  o.type = type
  o.frequency.setValueAtTime(f0, t0)
  if (f1) o.frequency.exponentialRampToValueAtTime(f1, t0 + dur)
  if (detune) o.detune.setValueAtTime(detune, t0)
  const g = a.createGain()
  adsr(g, t0, dur, peak, env)
  let head = o
  if (ftype) {
    const f = a.createBiquadFilter()
    f.type = ftype
    f.frequency.setValueAtTime(f0f || 2000, t0)
    if (f1f) f.frequency.exponentialRampToValueAtTime(f1f, t0 + dur)
    f.Q.value = Q
    o.connect(f)
    head = f
  }
  head.connect(g).connect(a.destination)
  o.start(t0)
  o.stop(t0 + dur + 0.05)
}

// 噪声体层：白噪声 buffer + 滤波（band/high/low pass，可选扫频）
function noiseLayer(t0, { dur, peak = 0.3, ftype = 'bandpass', f0 = 2000, f1 = null, Q = 1, env = {} }) {
  const a = ac()
  if (!a) return
  const len = Math.max(1, Math.ceil(a.sampleRate * dur))
  const buf = a.createBuffer(1, len, a.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
  const src = a.createBufferSource()
  src.buffer = buf
  const f = a.createBiquadFilter()
  f.type = ftype
  f.frequency.setValueAtTime(f0, t0)
  if (f1) f.frequency.exponentialRampToValueAtTime(f1, t0 + dur)
  f.Q.value = Q
  const g = a.createGain()
  adsr(g, t0, dur, peak, { a: 0.003, ...env })
  src.connect(f).connect(g).connect(a.destination)
  src.start(t0)
  src.stop(t0 + dur + 0.05)
}

// 多层调度：layers = [{ noise?: 层参数, osc?: 层参数, delay?: s }]
function perform(layers) {
  const a = ac()
  if (!a || _muted) return
  const t = a.currentTime
  for (const l of layers) {
    const t0 = t + (l.delay || 0)
    if (l.noise) noiseLayer(t0, l.noise)
    if (l.osc) oscLayer(t0, l.osc)
  }
}

export const sound = {
  // 翻牌：短促纸牌摩擦（带通噪声快速下滑）+ 边缘脆响
  flip() {
    perform([
      { noise: { dur: 0.07, peak: 0.5, f0: 2600, f1: 900, Q: 1.4 } },
      { noise: { dur: 0.025, peak: 0.12, ftype: 'highpass', f0: 6000 } },
    ])
  },
  // 发牌：flip 轻声短版，i 错位
  deal(i = 0) {
    perform([
      { delay: i * 0.04, noise: { dur: 0.05, peak: 0.3, f0: 3000, f1: 1100, Q: 1.4 } },
      { delay: i * 0.04, noise: { dur: 0.02, peak: 0.08, ftype: 'highpass', f0: 7000 } },
    ])
  },
  // 筹码：清脆高频 click（短三角双音 + 噪声打点）
  chips() {
    perform([
      { osc: { type: 'triangle', f0: 1450, dur: 0.045, peak: 0.22 } },
      { delay: 0.04, osc: { type: 'triangle', f0: 2175, dur: 0.05, peak: 0.2 } },
      { noise: { dur: 0.015, peak: 0.1, ftype: 'highpass', f0: 6500 } },
    ])
  },
  // 倍率：上行滑音琶音（低通柔化锯齿）+ 高频闪烁
  mult() {
    perform([
      ...[523, 659, 784, 1047].map((f, i) => ({
        delay: i * 0.05,
        osc: { type: 'sawtooth', f0: f, dur: 0.12, peak: 0.14, ftype: 'lowpass', f0f: 3200 },
      })),
      { noise: { dur: 0.05, peak: 0.05, ftype: 'highpass', f0: 8000 } },
    ])
  },
  xmult() {
    perform([
      ...[784, 988, 1175, 1568, 1976].map((f, i) => ({
        delay: i * 0.045,
        osc: { type: 'sawtooth', f0: f, dur: 0.14, peak: 0.15, ftype: 'lowpass', f0f: 3600 },
      })),
      { noise: { dur: 0.06, peak: 0.06, ftype: 'highpass', f0: 8500 } },
    ])
  },
  // 金币：明亮双音 + 金属泛音尾 + 击打点
  coin() {
    perform([
      { osc: { type: 'sine', f0: 990, dur: 0.05, peak: 0.25 } },
      { delay: 0.05, osc: { type: 'sine', f0: 1980, dur: 0.18, peak: 0.22 } },
      { delay: 0.05, osc: { type: 'triangle', f0: 2960, dur: 0.22, peak: 0.06 } },
      { noise: { dur: 0.02, peak: 0.05, ftype: 'highpass', f0: 9000 } },
    ])
  },
  // 连续金币（一键卖出重复）：n 枚逐枚上行
  coinCascade(n = 3) {
    for (let i = 0; i < n; i++) {
      perform([
        { delay: i * 0.07, osc: { type: 'sine', f0: 990 * Math.pow(1.06, i), dur: 0.05, peak: 0.22 } },
        { delay: i * 0.07 + 0.05, osc: { type: 'sine', f0: 1980 * Math.pow(1.06, i), dur: 0.16, peak: 0.18 } },
        { delay: i * 0.07 + 0.05, osc: { type: 'triangle', f0: 2960 * Math.pow(1.06, i), dur: 0.18, peak: 0.05 } },
      ])
    }
  },
  // 开包（兜底/Run 模式购买）：双带通噪声
  pack() {
    perform([
      { noise: { dur: 0.3, peak: 0.6, f0: 1200, Q: 0.8 } },
      { delay: 0.1, noise: { dur: 0.25, peak: 0.5, f0: 600, Q: 0.8 } },
    ])
  },
  // §13 塑料包装揉皱：一簇高频短噪声
  crinkle() {
    perform([0, 0.05, 0.11, 0.18, 0.26].map((d, i) => ({
      delay: d,
      noise: { dur: 0.04 + (i % 2) * 0.02, peak: 0.4, f0: 2600 + i * 500, Q: 1.5 },
    })))
  },
  // §13 撕条划过：带通频率上扫的拉锁声
  zip() {
    perform([
      { noise: { dur: 0.28, peak: 0.55, f0: 900, f1: 4200, Q: 1.2 } },
    ])
  },
  // §19 爆开低频 thump（配合 zip 撕裂瞬间）
  thump() {
    perform([
      { osc: { type: 'sine', f0: 130, f1: 42, dur: 0.28, peak: 0.55 } },
      { noise: { dur: 0.12, peak: 0.3, ftype: 'lowpass', f0: 260 } },
    ])
  },
  // §13 悬停滴答（极轻）
  tick() {
    perform([{ osc: { type: 'sine', f0: 1250, dur: 0.018, peak: 0.045 } }])
  },
  slam() {
    perform([
      { osc: { type: 'sine', f0: 220, f1: 55, dur: 0.35, peak: 0.7 } },
      { noise: { dur: 0.15, peak: 0.4, ftype: 'lowpass', f0: 300 } },
    ])
  },
  lose() {
    perform([440, 392, 330, 262].map((f, i) => ({
      delay: i * 0.18,
      osc: { type: 'sawtooth', f0: f, dur: 0.3, peak: 0.22, ftype: 'lowpass', f0f: 2400 },
    })))
  },
  win() {
    perform([523, 659, 784, 1047, 1319].map((f, i) => ({
      delay: i * 0.09,
      osc: { type: 'triangle', f0: f, dur: 0.25, peak: 0.25 },
    })))
  },
  select() {
    perform([{ osc: { type: 'sine', f0: 660, dur: 0.05, peak: 0.2 } }])
  },
  // 按钮：柔和短 click（正弦体 + 低通柔噪）
  click() {
    perform([
      { osc: { type: 'sine', f0: 520, dur: 0.035, peak: 0.12 } },
      { noise: { dur: 0.012, peak: 0.06, ftype: 'lowpass', f0: 1800 } },
    ])
  },
  glassBreak() {
    perform([{ noise: { dur: 0.2, peak: 0.5, ftype: 'highpass', f0: 5000, Q: 3 } }])
  },
  // 稀有卡揭晓前的 0.4s 悬念上扬（双正弦微失谐）
  suspense() {
    perform([
      { osc: { type: 'sine', f0: 440, f1: 880, dur: 0.4, peak: 0.3 } },
      { osc: { type: 'sine', f0: 445, f1: 895, dur: 0.4, peak: 0.15 } },
    ])
  },
  // 稀有/传奇揭晓：上扬闪光琶音 + 高频闪烁
  rareReveal() {
    perform([
      ...[880, 1109, 1319, 1760, 2217].map((f, i) => ({
        delay: i * 0.06,
        osc: { type: 'triangle', f0: f, dur: 0.3, peak: 0.24 },
      })),
      { noise: { dur: 0.25, peak: 0.13, ftype: 'highpass', f0: 8000, Q: 2 } },
    ])
  },
  // §19 上扬 shimmer（梯度解锁提示 / 稀有事件点缀）
  shimmer() {
    perform([
      { osc: { type: 'sine', f0: 1319, f1: 2637, dur: 0.35, peak: 0.12 } },
      ...[1760, 2217, 2637].map((f, i) => ({
        delay: i * 0.07,
        osc: { type: 'triangle', f0: f, dur: 0.22, peak: 0.1 },
      })),
      { noise: { dur: 0.3, peak: 0.06, ftype: 'highpass', f0: 9500, f1: 14000 } },
    ])
  },
}
