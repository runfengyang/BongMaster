// 任务完成动效：confetti + 音效
let audioCtx = null

function getAudioCtx() {
  if (!audioCtx) {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)() } catch (_) {}
  }
  return audioCtx
}

export function playDoneSound() {
  const ctx = getAudioCtx()
  if (!ctx) return
  try {
    const now = ctx.currentTime
    // Ascending chime: C5 -> E5 -> G5
    const notes = [523.25, 659.25, 783.99]
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.1, now + i * 0.07)
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.07 + 0.28)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(now + i * 0.07)
      osc.stop(now + i * 0.07 + 0.3)
    })
  } catch (_) { /* audio not critical */ }
}

export function fireConfetti(originEl) {
  try {
    const rect = originEl ? originEl.getBoundingClientRect() : null
    const cx = rect ? rect.left + rect.width / 2 : window.innerWidth / 2
    const cy = rect ? rect.top + rect.height / 2 : window.innerHeight / 2

    const colors = ['#2EAADC','#0F7B6C','#E8B930','#EB5757','#9B51E0','#27AE60','#F2994A']
    const container = document.createElement('div')
    container.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:9999;'
    document.body.appendChild(container)

    for (let i = 0; i < 38; i += 1) {
      const particle = document.createElement('span')
      const angle = Math.random() * Math.PI * 2
      const velocity = 70 + Math.random() * 190
      const size = 4 + Math.random() * 7
      const color = colors[Math.floor(Math.random() * colors.length)]
      const rotation = Math.random() * 360
      const dx = Math.cos(angle) * velocity
      const dy = Math.sin(angle) * velocity - 60

      particle.style.cssText = `
        position:absolute;left:${cx}px;top:${cy}px;
        width:${size}px;height:${size * 0.6}px;
        background:${color};border-radius:2px;
        transform:rotate(${rotation}deg);
        opacity:0.9;
      `
      container.appendChild(particle)
      particle.animate([
        { transform: `translate(0, 0) rotate(${rotation}deg)`, opacity: 0.9 },
        { transform: `translate(${dx}px, ${dy + 150}px) rotate(${rotation + 360}deg)`, opacity: 0 }
      ], {
        duration: 800 + Math.random() * 500,
        delay: Math.random() * 90,
        easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
        fill: 'forwards'
      })
    }

    setTimeout(() => container.remove(), 1500)
  } catch (_) { /* non-critical */ }
}
