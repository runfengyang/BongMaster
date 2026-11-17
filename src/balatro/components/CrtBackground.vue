<template>
  <canvas ref="cv" class="crt-bg" :class="{ static: isStatic }"></canvas>
</template>

<script setup>
// CRT 漩涡背景（§3.1）：WebGL fragment shader 复刻原作旋转色块背景
// 两层旋转正弦色带（主色 #004d40 绿 + 辅色 #263238 蓝灰）+ 扫描线 + 暗角
// prefers-reduced-motion 或 animated=false → 静态渐变/冻结帧
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'

const props = defineProps({
  animated: { type: Boolean, default: true }, // 设置页「减少动效」开关
})

const cv = ref(null)
const reducedMotion = typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
const isStatic = computed(() => reducedMotion || !props.animated)
let gl, raf = 0, start = 0, started = false

const VERT = `attribute vec2 p; void main(){ gl_Position = vec4(p,0.,1.); }`
const FRAG = `
precision mediump float;
uniform vec2 res; uniform float t;
void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5*res) / min(res.x, res.y);
  float r = length(uv);
  float a = atan(uv.y, uv.x);
  // 极坐标扭曲 + 时间驱动的双层旋转色带
  float swirl1 = sin(a*3.0 + r*6.0 - t*0.35);
  float swirl2 = sin(a*5.0 - r*9.0 + t*0.22);
  vec3 green = vec3(0.0, 0.29, 0.22);   // #004a38（原作主色微偏墨绿）
  vec3 blue  = vec3(0.11, 0.16, 0.20);  // #1c2933（原作辅色偏深海军蓝）
  vec3 col = mix(green, blue, 0.5 + 0.5*swirl1);
  col = mix(col, green*1.35, 0.24*(0.5+0.5*swirl2));
  col *= 0.82 + 0.18*sin(r*10.0 - t*0.5);
  // CRT 扫描线
  float scan = 0.92 + 0.08*sin(gl_FragCoord.y*1.7);
  col *= scan;
  // 暗角
  col *= 1.0 - 0.45*smoothstep(0.55, 1.25, r);
  gl_FragColor = vec4(col, 1.0);
}`

function init() {
  if (isStatic.value || started) return
  started = true
  const canvas = cv.value
  gl = canvas.getContext('webgl', { antialias: false, alpha: false })
  if (!gl) { canvas.classList.add('static'); return }
  const mk = (type, src) => {
    const s = gl.createShader(type)
    gl.shaderSource(s, src); gl.compileShader(s)
    return s
  }
  const prog = gl.createProgram()
  gl.attachShader(prog, mk(gl.VERTEX_SHADER, VERT))
  gl.attachShader(prog, mk(gl.FRAGMENT_SHADER, FRAG))
  gl.linkProgram(prog)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { canvas.classList.add('static'); return }
  gl.useProgram(prog)
  const buf = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buf)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW)
  const loc = gl.getAttribLocation(prog, 'p')
  gl.enableVertexAttribArray(loc)
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
  const uRes = gl.getUniformLocation(prog, 'res')
  const uT = gl.getUniformLocation(prog, 't')
  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
    canvas.width = canvas.clientWidth * dpr
    canvas.height = canvas.clientHeight * dpr
    gl.viewport(0, 0, canvas.width, canvas.height)
  }
  resize()
  window.addEventListener('resize', resize)
  start = performance.now()
  const loop = (now) => {
    gl.uniform2f(uRes, canvas.width, canvas.height)
    gl.uniform1f(uT, (now - start) / 1000)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    raf = requestAnimationFrame(loop)
  }
  raf = requestAnimationFrame(loop)
  onBeforeUnmount(() => window.removeEventListener('resize', resize))
}

onMounted(init)
onBeforeUnmount(() => cancelAnimationFrame(raf))

// 设置开关：关闭动效 → 冻结当前帧；重新开启 → 重新初始化渲染循环
watch(isStatic, (s) => {
  if (s) {
    cancelAnimationFrame(raf)
    raf = 0
  } else {
    started = false
    init()
  }
})
</script>

<style scoped>
.crt-bg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
}
.crt-bg.static {
  background:
    radial-gradient(ellipse at 30% 40%, #00543f 0%, transparent 60%),
    radial-gradient(ellipse at 75% 65%, #013e33 0%, transparent 55%),
    linear-gradient(135deg, #004a38 0%, #1c2933 100%);
}
</style>
