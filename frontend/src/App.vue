<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import * as THREE from 'three'
import { VoxelEngine } from './lib/VoxelEngine.js'
import { TripoSRClient } from './lib/TripoSRClient.js'
import { ThreeMFExporter } from './lib/ThreeMFExporter.js'
import { processGeneratedImageToAnnotatedGrid, processImageToPerler } from './lib/perlerFromImage.js'
import {
  formatSignedNumber,
  getMoodImageById,
  pickMoodImageForProfit,
  pickStockMoodFromUpload
} from './lib/stockMood.js'

const mode = ref('mood')
const text = ref('')
const blockSize = ref(16)

// --- Speech Recognition (Teammate's Web Speech API) ---
const speechSupported = ref(false)
const speechListening = ref(false)
const speechError = ref('')
let speechRecognition = null

function initSpeechRecognition() {
  if (typeof window === 'undefined') return
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition
  if (!SR) return
  speechSupported.value = true
  const rec = new SR()
  rec.lang = 'zh-CN'
  rec.continuous = true
  rec.interimResults = true
  rec.maxAlternatives = 1
  rec.onresult = (event) => {
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const res = event.results[i]
      if (!res.isFinal) continue
      const chunk = (res[0]?.transcript || '').trim()
      if (!chunk) continue
      const cur = text.value
      const sep = cur && !/\s$/.test(cur) ? ' ' : ''
      const next = (cur + sep + chunk).slice(0, 2000)
      text.value = next
    }
  }
  rec.onerror = (e) => {
    speechError.value =
      e.error === 'not-allowed'
        ? '需要麦克风权限，请在浏览器设置中允许本站使用麦克风'
        : e.error === 'no-speech'
          ? '未检测到语音，请再说一次'
          : `语音识别: ${e.error || '出错'}`
    speechListening.value = false
  }
  rec.onend = () => {
    speechListening.value = false
  }
  speechRecognition = rec
}

function toggleSpeechInput() {
  speechError.value = ''
  if (!speechRecognition) return
  if (speechListening.value) {
    try {
      speechRecognition.stop()
    } catch {
      speechListening.value = false
    }
    return
  }
  try {
    speechRecognition.start()
    speechListening.value = true
  } catch (err) {
    speechListening.value = false
    speechError.value = err instanceof Error ? err.message : '无法启动语音识别'
  }
}
// ------------------------------

// ------------------------------
const loading = ref(false)
const loadingStep = ref('')
const errorMsg = ref('')
const imageDataUrl = ref('')
const beadPalette = ref([])
const gridWidth = ref(0)
const gridHeight = ref(0)
const totalBeads = ref(0)
const resultSource = ref('')

const perlerFile = ref(null)
const gridCols = ref(56)
const colorSystem = ref('MARD')
const pixelMode = ref('dominant')
const perlerRenderStyle = ref('original')

const yieldFile = ref(null)
const yieldSummary = ref(null)
const yieldOcrPreview = ref('')
const yieldDragActive = ref(false)
const yieldInputRef = ref(null)
const yieldPixelSize = ref(12)

// --- 3D Perler Logic ---
const vox3dFile = ref(null)
const voxPhotoFile = ref(null) // 新增：2D 照片
const voxResolution = ref(32)
const voxelGrid = ref(null) // 3D array
const sliceIndex = ref(0)
const voxEngine = new VoxelEngine()
const tripoClient = new TripoSRClient() // 默认连接 127.0.0.1:7860
const mfExporter = new ThreeMFExporter(0.1) // 1 颗豆 = 0.1mm
const preview3dCanvas = ref(null)
const isGenerating3D = ref(false)
const tripoProgress = ref('')
let scene, camera, renderer, animationId
const voxelGroup = new THREE.Group()

const currentSliceData = computed(() => {
  if (!voxelGrid.value || !voxelGrid.value[sliceIndex.value]) return []
  // voxelGrid is [z][y][x]
  return voxelGrid.value[sliceIndex.value]
})

const sliceBeadCount = computed(() => {
  let count = 0
  currentSliceData.value.forEach(row => {
    row.forEach(cell => { if (cell) count++ })
  })
  return count
})

const voxBeadStats = computed(() => {
  if (!voxelGrid.value) return []
  const stats = {}
  let total = 0
  voxelGrid.value.forEach(slice => {
    slice.forEach(row => {
      row.forEach(cell => {
        if (cell && cell.color) {
          stats[cell.color] = (stats[cell.color] || 0) + 1
          total++
        }
      })
    })
  })
  
  return Object.entries(stats)
    .map(([color, count]) => ({
      hex: color.toUpperCase(),
      beadCount: count,
      brandKey: 'MARD-TBD', // 3D 暂未接入深度色号映射，标记待定
      percent: total ? ((100 * count) / total).toFixed(1) : '0'
    }))
    .sort((a, b) => b.beadCount - a.beadCount)
})

const voxTotalBeads = computed(() => {
  return voxBeadStats.value.reduce((s, i) => s + i.beadCount, 0)
})

function init3DPreview() {
  if (!preview3dCanvas.value) return
  scene = new THREE.Scene()
  scene.background = new THREE.Color(0x1a1d24)
  camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000)
  renderer = new THREE.WebGLRenderer({ canvas: preview3dCanvas.value, antialias: true })
  renderer.setSize(400, 400)
  
  const ambientLight = new THREE.AmbientLight(0xffffff, 1.5)
  scene.add(ambientLight)
  const dirLight = new THREE.DirectionalLight(0xffffff, 1)
  dirLight.position.set(5, 5, 5)
  scene.add(dirLight)
  
  camera.position.z = 50
  scene.add(voxelGroup)

  const animate = () => {
    animationId = requestAnimationFrame(animate)
    voxelGroup.rotation.y += 0.01
    renderer.render(scene, camera)
  }
  animate()
}

onMounted(() => {
  if (mode.value === '3d') init3DPreview()
  initSpeechRecognition()
})

onUnmounted(() => {
  cancelAnimationFrame(animationId)
  if (speechRecognition && speechListening.value) {
    try {
      speechRecognition.abort()
    } catch {
      /* ignore */
    }
  }
})

watch(mode, (newMode) => {
  // 切换模式时清理结果状态，防止 UI 粘连
  errorMsg.value = ''
  imageDataUrl.value = ''
  beadPalette.value = []
  gridWidth.value = 0
  gridHeight.value = 0
  totalBeads.value = 0
  resultSource.value = ''
  yieldSummary.value = null
  yieldOcrPreview.value = ''
  
  if (newMode === '3d') {
    setTimeout(init3DPreview, 100)
  } else {
    cancelAnimationFrame(animationId)
    // 如果离开 3D 模式，也可以选择清理 3D 相关状态
    // voxelGrid.value = null
  }
  
  if (newMode !== 'mood' && speechListening.value && speechRecognition) {
    try {
      speechRecognition.stop()
    } catch {
      speechListening.value = false
    }
  }
})

// 监听分辨率变化，自动重新进行体素化
watch(voxResolution, () => {
  if (vox3dFile.value) {
    voxelizeModel()
  }
})

async function onVoxFileChange(e) {
  const f = e.target.files?.[0]
  if (f) {
    vox3dFile.value = f
    await voxelizeModel()
  }
}

async function voxelizeModel() {
  if (!vox3dFile.value) return
  loading.value = true
  try {
    const model = await voxEngine.loadModel(vox3dFile.value)
    const grid = await voxEngine.voxelize(model, voxResolution.value)
    voxelGrid.value = grid
    sliceIndex.value = 0
    
    // 更新 3D 预览中的体素展示
    voxelGroup.clear()
    const geometry = new THREE.BoxGeometry(0.9, 0.9, 0.9)
    const instancedMesh = new THREE.Group()
    
    const size = voxEngine.size
    const offset = {
      x: -size.x / 2,
      y: -size.y / 2,
      z: -size.z / 2
    }

    // 为了性能，只在此处简单演示，大数据量改为 InstancedMesh 会更好
    for (let z = 0; z < size.z; z++) {
      for (let y = 0; y < size.y; y++) {
        for (let x = 0; x < size.x; x++) {
          if (grid[z][y][x]) {
            const material = new THREE.MeshPhongMaterial({ color: grid[z][y][x].color })
            const cube = new THREE.Mesh(geometry, material)
            cube.position.set(x + offset.x, y + offset.y, z + offset.z)
            voxelGroup.add(cube)
          }
        }
      }
    }
    
    // 自动调整相机位置 (增加判空防止 UI 未初始化时报错)
    if (camera) {
      camera.position.z = Math.max(size.x, size.y, size.z) * 1.5
    }
    
  } catch (e) {
    errorMsg.value = '体素化失败: ' + e.message
  } finally {
    loading.value = false
  }
}

async function onVoxPhotoChange(e) {
  const f = e.target.files?.[0]
  if (f) voxPhotoFile.value = f
}

async function generate3DFromPhoto() {
  if (!voxPhotoFile.value) return
  isGenerating3D.value = true
  tripoProgress.value = '准备中...'
  errorMsg.value = ''
  try {
    const result = await tripoClient.predict3D(voxPhotoFile.value, (stage) => {
        tripoProgress.value = stage
    })
    // 根据返回的真实文件名创建 File 对象，确保 voxEngine 能识别出正确的后缀 (obj/glb)
    const syntheticFile = new File([result.blob], result.filename, { type: result.blob.type })
    vox3dFile.value = syntheticFile
    await voxelizeModel()
  } catch (e) {
    console.error(e)
    errorMsg.value = '2D 转 3D 失败: ' + e.message
  } finally {
    isGenerating3D.value = false
  }
}

async function download3MF() {
  if (!voxelGrid.value) return
  try {
    const blob = await mfExporter.export3MF(voxelGrid.value)
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `perler-bead-model-${Date.now()}.3mf`
    link.click()
  } catch (e) {
    errorMsg.value = '导出 3MF 失败: ' + e.message
  }
}
// --------------------

const colorSystemOptions = [
  { value: 'MARD', label: 'MARD' },
  { value: 'COCO', label: 'COCO' },
  { value: '漫漫', label: '漫漫' },
  { value: '盼盼', label: '盼盼' },
  { value: '咪小窝', label: '咪小窝' }
]

const apiBase = import.meta.env.VITE_API_BASE || ''

const showBrandColumn = computed(() => beadPalette.value.some((row) => row.brandKey && row.brandKey !== '—'))
const brandColumnLabel = computed(() => (resultSource.value === 'perler' ? `品牌色号（${colorSystem.value}）` : '品牌色号（MARD）'))

const canSubmit = computed(() => {
  if (loading.value) return false
  if (mode.value === 'mood') return text.value.trim().length > 0
  if (mode.value === 'perler') return perlerFile.value != null
  if (mode.value === '3d') return vox3dFile.value != null
  return yieldFile.value != null
})

function onPerlerFileChange(e) {
  const f = e.target.files?.[0]
  perlerFile.value = f || null
}

function onYieldFileChange(e) {
  const f = e.target.files?.[0]
  yieldFile.value = f || null
}

function triggerYieldPicker() {
  yieldInputRef.value?.click()
}

function onYieldDragOver() {
  yieldDragActive.value = true
}

function onYieldDragLeave() {
  yieldDragActive.value = false
}

function onYieldDrop(e) {
  yieldDragActive.value = false
  const f = e.dataTransfer?.files?.[0]
  if (f) {
    yieldFile.value = f
  }
}

function downloadCurrentImage() {
  if (!imageDataUrl.value) return
  const link = document.createElement('a')
  const suffix = resultSource.value === 'yield' ? 'stock-mood' : 'generated-image'
  link.href = imageDataUrl.value
  link.download = `${suffix}-${Date.now()}.png`
  link.click()
}

async function shuffleYieldMood() {
  if (!yieldSummary.value) return
  const next = await pickMoodImageForProfit(
    yieldSummary.value.profit,
    yieldSummary.value.memeId,
    yieldPixelSize.value
  )
  imageDataUrl.value = next.imageUrl
  beadPalette.value = next.beadPalette || []
  gridWidth.value = next.gridWidth || 0
  gridHeight.value = next.gridHeight || 0
  totalBeads.value = next.totalBeads || 0
  yieldSummary.value = {
    ...yieldSummary.value,
    memeId: next.id,
    memeTitle: next.title
  }
}

watch(yieldPixelSize, async (nextSize) => {
  if (resultSource.value !== 'yield' || !yieldSummary.value?.memeId) return
  const rendered = await getMoodImageById(yieldSummary.value.memeId, nextSize)
  if (rendered) {
    imageDataUrl.value = rendered.imageUrl
    beadPalette.value = rendered.beadPalette || []
    gridWidth.value = rendered.gridWidth || 0
    gridHeight.value = rendered.gridHeight || 0
    totalBeads.value = rendered.totalBeads || 0
  }
})

async function generate() {
  errorMsg.value = ''
  imageDataUrl.value = ''
  beadPalette.value = []
  gridWidth.value = 0
  gridHeight.value = 0
  totalBeads.value = 0
  resultSource.value = ''
  yieldSummary.value = null
  yieldOcrPreview.value = ''
  loading.value = true

  try {
    if (mode.value === 'mood') {
      loadingStep.value = '正在唤醒 AI...'
      const res = await fetch(`${apiBase}/api/mood-pixel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: text.value,
          blockSize: blockSize.value
        })
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        errorMsg.value = data.error || `请求失败 (${res.status})`
        return
      }
      if (data.base64Image && data.mimeType) {
        loadingStep.value = '渲染像素网格...'
        const rawImageUrl = `data:${data.mimeType};base64,${data.base64Image}`
        const annotated = await processGeneratedImageToAnnotatedGrid(rawImageUrl, {
          gridCols: Math.max(12, Math.min(48, Math.round(64 - blockSize.value))),
          maxColors: 28,
          colorSystem: 'MARD'
        })
        imageDataUrl.value = annotated.imageDataUrl
        beadPalette.value = annotated.beadPalette
        gridWidth.value = annotated.gridWidth
        gridHeight.value = annotated.gridHeight
        totalBeads.value = annotated.totalBeads
        resultSource.value = 'mood'
      } else {
        errorMsg.value = '返回数据格式异常'
      }
    } else if (mode.value === 'perler') {
      if (!perlerFile.value) {
        errorMsg.value = '请选择一张图片'
        return
      }
      let fileToProcess = perlerFile.value
      if (perlerRenderStyle.value === 'cartoon') {
        loadingStep.value = 'Xais 卡通化处理中...'
        const fd = new FormData()
        fd.append('file', perlerFile.value)
        const res = await fetch(`${apiBase}/api/perler-cartoonize`, {
          method: 'POST',
          body: fd
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          errorMsg.value = data.error || `卡通化失败 (${res.status})`
          return
        }
        if (!data.base64Image || !data.mimeType) {
          errorMsg.value = '卡通化返回数据异常'
          return
        }
        const raw = atob(data.base64Image)
        const arr = new Uint8Array(raw.length)
        for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i)
        fileToProcess = new File([arr], 'cartoon.png', { type: data.mimeType })
      }
      loadingStep.value = '生成拼豆底稿...'
      const out = await processImageToPerler(fileToProcess, {
        gridCols: gridCols.value,
        mode: pixelMode.value,
        colorSystem: colorSystem.value,
        renderStyle: 'original'
      })
      imageDataUrl.value = out.imageDataUrl
      beadPalette.value = out.beadPalette
      gridWidth.value = out.gridWidth
      gridHeight.value = out.gridHeight
      totalBeads.value = out.totalBeads
      resultSource.value = 'perler'
    } else if (mode.value === 'yield') {
      if (!yieldFile.value) {
        errorMsg.value = '请选择收益率截图'
        return
      }
      loadingStep.value = '初始化 OCR 引擎...'
      const out = await pickStockMoodFromUpload(yieldFile.value, {
        pixelSize: yieldPixelSize.value,
        onProgress: (step) => { loadingStep.value = step }
      })
      imageDataUrl.value = out.imageUrl
      beadPalette.value = out.beadPalette || []
      gridWidth.value = out.gridWidth || 0
      gridHeight.value = out.gridHeight || 0
      totalBeads.value = out.totalBeads || 0
      yieldSummary.value = {
        profit: out.profit,
        verdict: out.verdict,
        amount: out.amount,
        rate: out.rate,
        source: out.source,
        folder: out.folder,
        memeId: out.memeId,
        memeTitle: out.memeTitle
      }
      yieldOcrPreview.value = out.ocrPreview || ''
      resultSource.value = 'yield'
    }
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : '处理失败'
  } finally {
    loading.value = false
    loadingStep.value = ''
  }
}

const btnLabel = computed(() => {
  if (loading.value) return loadingStep.value || '处理中…'
  if (mode.value === 'mood') return '生成像素心情图'
  if (mode.value === 'perler') return '生成拼豆底稿'
  if (mode.value === '3d') return '重新体素化'
  return '上传盈亏图即可'
})
</script>

<template>
  <div class="page">
    <header class="header">
      <h1>心情拼豆 / 图片拼豆 / 股票配图</h1>
      <p class="subtitle">
        文字生成 AI 图、上传图拼豆底稿，或上传股票「日收益」截图：根据 OCR 判断本月总体盈/亏，从本机素材库随机返回一张对应配图。
      </p>
    </header>

    <div class="mode-tabs" role="tablist">
      <button type="button" :class="['tab', { active: mode === 'mood' }]" @click="mode = 'mood'">
        文字心情
      </button>
      <button type="button" :class="['tab', { active: mode === 'perler' }]" @click="mode = 'perler'">
        上传拼豆
      </button>
      <button type="button" :class="['tab', { active: mode === 'yield' }]" @click="mode = 'yield'">
        股票配图
      </button>
      <button type="button" :class="['tab', { active: mode === '3d' }]" @click="mode = '3d'">
        3D 拼豆
      </button>
    </div>

    <main class="card">
      <template v-if="mode === 'mood'">
        <label class="field mood-text-field">
          <div class="field-label-row">
            <span>此刻的心情或想说的话</span>
            <button
              v-if="speechSupported"
              type="button"
              class="voice-btn"
              :class="{ listening: speechListening }"
              :disabled="loading"
              :title="speechListening ? '点击停止听写' : '点击开始语音输入（中文）'"
              @click="toggleSpeechInput"
            >
              {{ speechListening ? '停止听写' : '语音输入' }}
            </button>
          </div>
          <p v-if="!speechSupported" class="hint speech-hint">当前浏览器不支持语音输入，请使用 Chrome 或 Edge。</p>
          <p v-else-if="speechError" class="hint speech-error">{{ speechError }}</p>
          <textarea
            v-model="text"
            rows="4"
            maxlength="2000"
            placeholder="例如：加班结束后的轻松，又像有点空的周一傍晚……"
          />
        </label>

        <label class="field inline">
          <span>像素块大小</span>
          <input v-model.number="blockSize" type="range" min="4" max="48" step="2" />
          <span class="hint">{{ blockSize }}（越大越「马赛克」）</span>
        </label>
      </template>

      <template v-else-if="mode === 'perler'">
        <div class="section-head">
          <h2 class="section-title">照片拼豆</h2>
          <p class="section-copy">在原有拼豆生成逻辑上，支持原图直出与人像卡通化两种模式，结果图会自动带上色号和坐标轴。</p>
        </div>

        <div class="field">
          <span>功能模式</span>
          <div class="radio-group">
            <label class="radio-card">
              <input v-model="perlerRenderStyle" type="radio" value="original" />
              <span class="radio-card-main">原图直出</span>
              <span class="radio-card-sub">默认模式，保留原图色彩与明暗关系。</span>
            </label>
            <label class="radio-card">
              <input v-model="perlerRenderStyle" type="radio" value="cartoon" />
              <span class="radio-card-main">人像卡通化</span>
              <span class="radio-card-sub">后端调用 Xais 图生图（OpenAI 兼容接口），将人像转为卡通风格后再生成拼豆底稿。</span>
            </label>
          </div>
        </div>

        <label class="field">
          <span>{{
            perlerRenderStyle === 'cartoon'
              ? '选择图片（卡通化会经后端调用 Xais，限 JPEG/PNG）'
              : '选择图片（本地处理，不上传服务器）'
          }}</span>
          <input type="file" accept="image/*" class="file-input" @change="onPerlerFileChange" />
          <span v-if="perlerFile" class="hint file-name">{{ perlerFile.name }}</span>
        </label>

        <label class="field inline">
          <span>横向格数 N</span>
          <input v-model.number="gridCols" type="range" min="16" max="120" step="4" />
          <span class="hint">{{ gridCols }}（纵向格数按原图比例自动算）</span>
        </label>

        <label class="field">
          <span>像素化模式（与 perler-beads 一致）</span>
          <select v-model="pixelMode" class="select">
            <option value="dominant">主导色（卡通、少灰边）</option>
            <option value="average">平均色（更写实）</option>
          </select>
        </label>

        <label class="field">
          <span>品牌色号体系</span>
          <select v-model="colorSystem" class="select">
            <option v-for="o in colorSystemOptions" :key="o.value" :value="o.value">
              {{ o.label }}
            </option>
          </select>
        </label>
      </template>

      <template v-else-if="mode === 'yield'">
        <div class="section-head">
          <h2 class="section-title">上传盈亏图即可</h2>
        </div>

        <div
          :class="['dropzone', { active: yieldDragActive }]"
          @dragover.prevent="onYieldDragOver"
          @dragleave.prevent="onYieldDragLeave"
          @drop.prevent="onYieldDrop"
        >
          <input
            ref="yieldInputRef"
            type="file"
            accept="image/*"
            class="file-input sr-only"
            @change="onYieldFileChange"
          />
          <p class="dropzone-title">拖拽截图到这里，或点击按钮上传</p>
          <button type="button" class="ghost-btn" @click="triggerYieldPicker">选择盈亏截图</button>
          <span v-if="yieldFile" class="hint file-name">当前文件：{{ yieldFile.name }}</span>
        </div>
        <label class="field inline compact-inline">
          <span>像素块大小</span>
          <input v-model.number="yieldPixelSize" type="range" min="6" max="28" step="2" />
          <span class="hint">{{ yieldPixelSize }} px（越大越粗、越像素化）</span>
        </label>
      </template>

      <template v-else-if="mode === '3d'">
        <div class="section-head">
          <h2 class="section-title">3D 体素拼豆</h2>
          <p class="section-copy">将 .obj 或 .glb 3D模型转化为 1:1 的实心体素模型，支持逐层切片查看图纸。</p>
        </div>

        <label class="field">
          <span>选择 3D 模型 (.obj / .glb)</span>
          <input type="file" accept=".obj,.glb,.gltf" class="file-input" @change="onVoxFileChange" />
          <span v-if="vox3dFile" class="hint file-name">{{ vox3dFile.name }}</span>
        </label>

        <label class="field inline">
          <span>体素分辨率</span>
          <input v-model.number="voxResolution" type="range" min="16" max="256" step="16" />
          <span class="hint">{{ voxResolution }}（分辨率越高细节越多，但也越消耗电脑性能。建议 32-64）</span>
        </label>

        <div class="field vox-photo-section">
            <div class="section-head mini">
                <h3 class="section-title">2D 照片直接生成 3D (TripoSR)</h3>
                <p class="section-copy">通过 SSH 隧道连接远程 GPU 集群实时生成（1 颗豆 = 0.1mm）</p>
            </div>
            <div class="photo-upload-row">
                <input type="file" accept="image/*" class="file-input" @change="onVoxPhotoChange" />
                <button type="button" class="btn primary-btn-glow" :disabled="!voxPhotoFile || isGenerating3D" @click="generate3DFromPhoto">
                    {{ isGenerating3D ? '🚀 任务处理中...' : '生成 3D 拼豆模型' }}
                </button>
            </div>
            <div v-if="isGenerating3D" class="vox-progress-bar">
                <div class="spinner"></div>
                <span>{{ tripoProgress }}</span>
            </div>
        </div>

        <div v-if="voxelGrid" class="vox-container">
            <div class="vox-preview">
                <canvas ref="preview3dCanvas" class="vox-canvas"></canvas>
                <div class="vox-preview-footer">
                    <p class="vox-hint">3D 实时体素预览</p>
                    <button type="button" class="ghost-btn export-btn" @click="download3MF">
                        💾 导出 .3MF 模型
                    </button>
                </div>
            </div>
            
            <div class="vox-slicer">
                <div class="slicer-header">
                    <h3>分层图纸预览</h3>
                    <div class="slicer-controls">
                        <span>当前层：{{ sliceIndex + 1 }} / {{ voxelGrid.length }}</span>
                        <input type="range" v-model.number="sliceIndex" min="0" :max="voxelGrid.length - 1" />
                    </div>
                </div>
                
                <div class="slice-grid-container">
                    <div v-if="currentSliceData.length" class="slice-grid">
                        <div v-for="(row, y) in currentSliceData" :key="'r'+y" class="slice-row">
                            <div v-for="(cell, x) in row" :key="'c'+x" 
                                 :class="['slice-cell', { active: cell }]"
                                 :style="cell ? { backgroundColor: cell.color } : {}">
                            </div>
                        </div>
                    </div>
                </div>
                <p class="vox-hint">本层所需豆数：{{ sliceBeadCount }} 颗 | 这一层拼好后，按顺序向上叠加。</p>
            </div>
        </div>

        <section v-if="voxBeadStats.length" class="palette">
            <h2 class="palette-title">3D 拼豆颜色用量（全模型总计：{{ voxTotalBeads }} 颗）</h2>
            <div class="palette-table-wrap">
                <table class="palette-table">
                    <thead>
                        <tr>
                            <th>颜色</th>
                            <th>HEX</th>
                            <th>品牌色号 (MARD)</th>
                            <th>颗数</th>
                            <th>占比</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="row in voxBeadStats" :key="row.hex">
                            <td class="swatch-cell">
                                <span class="swatch" :style="{ backgroundColor: row.hex }" />
                            </td>
                            <td class="mono">{{ row.hex }}</td>
                            <td class="mono">{{ row.brandKey }}</td>
                            <td class="num">{{ row.beadCount }}</td>
                            <td class="num muted">{{ row.percent }}%</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </section>
      </template>

      <button v-if="mode !== '3d'" type="button" class="btn" :disabled="!canSubmit" @click="generate">
        {{ btnLabel }}
      </button>

      <p v-if="errorMsg" class="error">{{ errorMsg }}</p>

      <figure v-if="imageDataUrl" :class="['result', { 'yield-result': resultSource === 'yield' }]">
        <img :src="imageDataUrl" alt="生成结果" />
        <figcaption>
          <template v-if="resultSource === 'mood'">
            逻辑网格 {{ gridWidth }}×{{ gridHeight }}，共 {{ totalBeads }} 格，已叠加颜色编码与 X/Y 坐标
          </template>
          <template v-else-if="resultSource === 'perler'">
            逻辑网格 {{ gridWidth }}×{{ gridHeight }}，共 {{ totalBeads }} 格；{{ perlerRenderStyle === 'cartoon' ? '人像卡通化' : '原图直出' }}，
            已叠加 {{ colorSystem }} 色号、HEX 与 X/Y 坐标
          </template>
          <template v-else>
            逻辑网格 {{ gridWidth }}×{{ gridHeight }}，共 {{ totalBeads }} 格；判定：{{ yieldSummary?.verdict }}（依据：{{ yieldSummary?.source }}）· 当前配图：{{ yieldSummary?.memeTitle }} · 像素块 {{ yieldPixelSize }} px
          </template>
        </figcaption>
      </figure>

      <div v-if="imageDataUrl" class="result-actions">
        <button type="button" class="ghost-btn" @click="downloadCurrentImage">
          {{ resultSource === 'yield' ? '下载配图' : '下载底稿' }}
        </button>
        <button
          v-if="resultSource === 'yield' && yieldSummary"
          type="button"
          class="ghost-btn"
          @click="shuffleYieldMood"
        >
          换一张搞笑图
        </button>
      </div>

      <section v-if="resultSource === 'yield' && yieldSummary" class="palette">
        <div class="summary-grid">
          <div class="summary-card">
            <span class="summary-label">本月总盈亏</span>
            <strong :class="['summary-value', yieldSummary.profit ? 'profit' : 'loss']">
              {{ formatSignedNumber(yieldSummary.amount, ' 元') }}
            </strong>
          </div>
          <div class="summary-card">
            <span class="summary-label">总盈亏率</span>
            <strong :class="['summary-value', yieldSummary.profit ? 'profit' : 'loss']">
              {{ formatSignedNumber(yieldSummary.rate, '%') }}
            </strong>
          </div>
          <div class="summary-card">
            <span class="summary-label">判定结果</span>
            <strong :class="['summary-value', yieldSummary.profit ? 'profit' : 'loss']">
              {{ yieldSummary.verdict }}
            </strong>
          </div>
          <div class="summary-card">
            <span class="summary-label">配图主题</span>
            <strong class="summary-value neutral">{{ yieldSummary.memeTitle }}</strong>
          </div>
        </div>
        <p class="palette-hint">
          页面会优先识别顶部总盈亏金额，其次识别总盈亏率；若 OCR 不准，请换更清晰的截图，尽量保留汇总区域。
        </p>
        <details v-if="yieldOcrPreview" class="ocr-details">
          <summary>OCR 原文片段（排错用）</summary>
          <pre class="ocr-pre">{{ yieldOcrPreview }}</pre>
        </details>
      </section>

      <section v-if="beadPalette.length" class="palette">
        <h2 class="palette-title">拼豆颜色用量（按颗数从多到少）</h2>
        <p class="palette-hint">
          <template v-if="resultSource === 'mood'">
            文字心情图已自动转成带颜色编码与坐标轴的拼豆底稿。后端<strong>中位切分</strong>至多 128 色。参考
            <a href="https://github.com/666ghj/MiroFish" target="_blank" rel="noopener noreferrer">MiroFish</a> 思路。
          </template>
          <template v-else-if="resultSource === 'yield'">
            股票配图已自动转成带颜色编码 / HEX 与完整 X/Y 坐标轴的参考拼豆图，便于照着排豆。
          </template>
          <template v-else>
            算法与色板数据来自
            <a href="https://github.com/Zippland/perler-beads" target="_blank" rel="noopener noreferrer">perler-beads</a>
            （AGPL-3.0）；导出图中每个色块会自动叠加品牌色号 / HEX 与完整坐标轴。
          </template>
        </p>
        <div class="palette-table-wrap">
          <table class="palette-table">
            <thead>
              <tr>
                <th>颜色</th>
                <th>HEX</th>
                <th v-if="showBrandColumn">{{ brandColumnLabel }}</th>
                <th>颗数</th>
                <th>占比</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, idx) in beadPalette" :key="idx + row.hex">
                <td class="swatch-cell">
                  <span class="swatch" :style="{ backgroundColor: row.hex }" />
                </td>
                <td class="mono">{{ row.hex }}</td>
                <td v-if="showBrandColumn" class="mono">{{ row.brandKey ?? '—' }}</td>
                <td class="num">{{ row.beadCount }}</td>
                <td class="num muted">
                  {{ totalBeads ? ((100 * row.beadCount) / totalBeads).toFixed(1) : '0' }}%
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </main>

    <footer class="footer">
      <small>
        「文字心情」与「上传拼豆 · 人像卡通化」需 MiniMax 与 Java 后端；「上传拼豆 · 原图直出」「股票配图」在浏览器本地处理（配图模式首次 OCR 需下载语言包）。
      </small>
    </footer>
  </div>
</template>

<style>
:root {
  --bg: #0f1115;
  --card: #1a1d24;
  --text: #e8eaef;
  --muted: #8b919c;
  --accent: #6ee7b7;
  --accent-dim: #34d399;
  --error: #f87171;
  --border: #2a2f3a;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-height: 100vh;
  font-family: 'Noto Sans SC', system-ui, sans-serif;
  background: radial-gradient(ellipse 120% 80% at 50% -20%, #1e293b 0%, var(--bg) 55%);
  color: var(--text);
}

#app {
  min-height: 100vh;
}

.page {
  max-width: 720px;
  margin: 0 auto;
  padding: 2.5rem 1.25rem 3rem;
}

.header h1 {
  margin: 0 0 0.5rem;
  font-size: 1.65rem;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.subtitle {
  margin: 0;
  color: var(--muted);
  font-size: 0.95rem;
  line-height: 1.5;
}

.mode-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 1.5rem;
}

.tab {
  flex: 1;
  min-width: 6rem;
  padding: 0.6rem 0.75rem;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #12151c;
  color: var(--muted);
  font: inherit;
  font-size: 0.9rem;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.tab.active {
  background: rgba(52, 211, 153, 0.15);
  border-color: var(--accent-dim);
  color: var(--text);
}

.card {
  margin-top: 1rem;
  padding: 1.75rem;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
}

.section-head {
  margin-bottom: 1.25rem;
}

.section-title {
  margin: 0;
  font-size: 1.1rem;
  font-weight: 600;
}

.section-copy {
  margin: 0.35rem 0 0;
  color: var(--muted);
  font-size: 0.85rem;
  line-height: 1.55;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-bottom: 1.25rem;
}

.field > span:first-child {
  font-size: 0.875rem;
  color: var(--muted);
}

textarea {
  width: 100%;
  padding: 0.75rem 1rem;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #12151c;
  color: var(--text);
  font: inherit;
  resize: vertical;
  min-height: 100px;
}

textarea:focus {
  outline: none;
  border-color: var(--accent-dim);
  box-shadow: 0 0 0 2px rgba(52, 211, 153, 0.2);
}

.file-input {
  padding: 0.5rem 0;
  font: inherit;
  color: var(--muted);
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.file-name {
  color: var(--accent-dim);
}

.yield-tip {
  margin: 0 0 1rem;
  line-height: 1.5;
}

.select {
  padding: 0.65rem 0.75rem;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: #12151c;
  color: var(--text);
  font: inherit;
}

.field.inline {
  flex-direction: row;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem;
}

.compact-inline {
  margin-top: 0.25rem;
}

.field.inline input[type='range'] {
  flex: 1;
  min-width: 120px;
  accent-color: var(--accent-dim);
}

.hint {
  font-size: 0.8rem;
  color: var(--muted);
  width: 100%;
  margin-left: 0;
}

.radio-group {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
}

.radio-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  padding: 0.9rem 1rem 0.9rem 2.8rem;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: #12151c;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s, transform 0.15s;
}

.radio-card:hover {
  border-color: rgba(52, 211, 153, 0.45);
}

.radio-card input {
  position: absolute;
  top: 1rem;
  left: 1rem;
  width: 1rem;
  height: 1rem;
  margin: 0;
  accent-color: var(--accent-dim);
}

.radio-card:has(input:checked) {
  border-color: var(--accent-dim);
  background: rgba(52, 211, 153, 0.1);
  transform: translateY(-1px);
}

.radio-card-main {
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--text);
}

.radio-card-sub {
  color: var(--muted);
  font-size: 0.8rem;
  line-height: 1.45;
}

.dropzone {
  margin-bottom: 1rem;
  padding: 1.2rem;
  border: 1px dashed rgba(110, 231, 183, 0.35);
  border-radius: 12px;
  background:
    linear-gradient(135deg, rgba(52, 211, 153, 0.07), rgba(15, 23, 42, 0.02)),
    #12151c;
  text-align: center;
  transition: border-color 0.15s, background 0.15s, transform 0.15s;
}

.dropzone.active {
  border-color: var(--accent-dim);
  background:
    linear-gradient(135deg, rgba(52, 211, 153, 0.18), rgba(15, 23, 42, 0.04)),
    #12151c;
  transform: translateY(-1px);
}

.dropzone-title {
  margin: 0;
  font-size: 0.98rem;
  font-weight: 600;
}

.dropzone-copy {
  margin: 0.45rem 0 0.9rem;
  color: var(--muted);
  font-size: 0.84rem;
  line-height: 1.5;
}

.ghost-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 8rem;
  padding: 0.72rem 1rem;
  border: 1px solid rgba(110, 231, 183, 0.35);
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.35);
  color: var(--text);
  font: inherit;
  font-size: 0.9rem;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}

.ghost-btn:hover {
  border-color: var(--accent-dim);
  background: rgba(52, 211, 153, 0.1);
}

.btn {
  width: 100%;
  padding: 0.85rem 1.25rem;
  border: none;
  border-radius: 8px;
  background: linear-gradient(135deg, #34d399, #10b981);
  color: #0f172a;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s, transform 0.1s;
}

.btn:hover:not(:disabled) {
  opacity: 0.95;
  transform: translateY(-1px);
}

.btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.error {
  margin-top: 1rem;
  padding: 0.75rem;
  border-radius: 8px;
  background: rgba(248, 113, 113, 0.12);
  color: var(--error);
  font-size: 0.9rem;
}

.result {
  margin: 1.5rem 0 0;
  padding: 0;
}

.result img {
  display: block;
  width: 100%;
  max-width: 512px;
  margin: 0 auto;
  border-radius: 8px;
  border: 1px solid var(--border);
  image-rendering: pixelated;
  image-rendering: crisp-edges;
}

.yield-result img {
  max-width: 720px;
}

.result figcaption {
  margin-top: 0.75rem;
  text-align: center;
  font-size: 0.8rem;
  color: var(--muted);
}

.palette {
  margin-top: 1.75rem;
  padding-top: 1.25rem;
  border-top: 1px solid var(--border);
}

.result-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-bottom: 1rem;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
  margin-bottom: 1rem;
}

.summary-card {
  padding: 0.9rem 1rem;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: #12151c;
}

.summary-label {
  display: block;
  margin-bottom: 0.35rem;
  color: var(--muted);
  font-size: 0.78rem;
}

.summary-value {
  display: block;
  font-size: 1rem;
  line-height: 1.35;
}

.summary-value.profit {
  color: #fbbf24;
}

.summary-value.loss {
  color: #4ade80;
}

.summary-value.neutral {
  color: var(--text);
}

.palette-title {
  margin: 0 0 0.5rem;
  font-size: 1.05rem;
  font-weight: 600;
}

.palette-hint {
  margin: 0 0 1rem;
  font-size: 0.8rem;
  color: var(--muted);
  line-height: 1.5;
}

.palette-hint a {
  color: var(--accent-dim);
}

.palette-table-wrap {
  overflow-x: auto;
  border-radius: 8px;
  border: 1px solid var(--border);
}

.palette-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.875rem;
}

.palette-table th,
.palette-table td {
  padding: 0.5rem 0.75rem;
  text-align: left;
  border-bottom: 1px solid var(--border);
}

.palette-table th {
  background: #12151c;
  color: var(--muted);
  font-weight: 600;
}

.palette-table tbody tr:last-child td {
  border-bottom: none;
}

.swatch-cell {
  width: 3rem;
}

.swatch {
  display: inline-block;
  width: 2rem;
  height: 2rem;
  border-radius: 4px;
  border: 1px solid var(--border);
  vertical-align: middle;
}

.mono {
  font-family: ui-monospace, monospace;
}

.num {
  font-variant-numeric: tabular-nums;
}

.muted {
  color: var(--muted);
}

.ocr-details {
  margin-top: 1rem;
  font-size: 0.8rem;
  color: var(--muted);
}

.ocr-pre {
  margin: 0.5rem 0 0;
  padding: 0.75rem;
  max-height: 12rem;
  overflow: auto;
  background: #12151c;
  border-radius: 8px;
  border: 1px solid var(--border);
  font-size: 0.7rem;
  white-space: pre-wrap;
  word-break: break-all;
}

.field-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.btn-voice {
  background: transparent;
  border: 1px solid var(--accent);
  color: var(--accent);
  border-radius: 4px;
  padding: 0.2rem 0.5rem;
  font-size: 0.8rem;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-voice:hover:not(:disabled) {
  background: rgba(110, 231, 183, 0.1);
}

.btn-voice.recording {
  border-color: var(--error);
  color: var(--error);
  animation: pulse 1.5s infinite;
}

.btn-voice:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  border-color: var(--muted);
  color: var(--muted);
}

@keyframes pulse {
  0% { box-shadow: 0 0 0 0 rgba(248, 113, 113, 0.4); }
  70% { box-shadow: 0 0 0 4px rgba(248, 113, 113, 0); }
  100% { box-shadow: 0 0 0 0 rgba(248, 113, 113, 0); }
}

.footer {
  margin-top: 2rem;
  text-align: center;
}

.footer small {
  color: var(--muted);
  font-size: 0.75rem;
}

@media (max-width: 640px) {
  .card {
    padding: 1.15rem;
  }

  .radio-group {
    grid-template-columns: 1fr;
  }

  .radio-card {
    padding-left: 2.6rem;
  }

  .summary-grid {
    grid-template-columns: 1fr;
  }

  .result-actions {
    flex-direction: column;
  }

  .ghost-btn {
    width: 100%;
  }
}

/* 3D Voxel Slicer Styles */
.vox-progress-bar {
  margin-top: 1rem;
  padding: 1rem;
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid var(--border);
  border-radius: 8px;
  display: flex;
  align-items: center;
  gap: 12px;
  color: var(--accent);
  font-weight: 500;
  animation: fadeIn 0.3s ease;
}

.spinner {
  width: 20px;
  height: 20px;
  border: 2px solid rgba(110, 231, 183, 0.1);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(-5px); }
  to { opacity: 1; transform: translateY(0); }
}

.vox-container {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  margin-top: 1rem;
}

.vox-preview {
  display: flex;
  flex-direction: column;
  align-items: center;
  background: #12151c;
  padding: 1rem;
  border-radius: 12px;
  border: 1px solid var(--border);
  position: relative;
}

.vox-preview-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  padding-top: 0.5rem;
}

.export-btn {
  font-size: 0.8rem;
  padding: 0.4rem 0.8rem;
  min-width: auto;
}

.vox-photo-section {
    padding: 1rem;
    background: rgba(110, 231, 183, 0.05);
    border: 1px solid rgba(110, 231, 183, 0.2);
    border-radius: 12px;
}

.photo-upload-row {
    display: flex;
    gap: 1rem;
    align-items: center;
    margin-top: 0.5rem;
}

.primary-btn-glow {
    background: linear-gradient(135deg, #3b82f6, #8b5cf6) !important;
    color: white !important;
    box-shadow: 0 0 15px rgba(139, 92, 246, 0.4);
    width: auto;
}

.vox-canvas {
  width: 100% !important;
  max-width: 400px;
  height: auto !important;
  aspect-ratio: 1;
  border-radius: 8px;
}

.vox-hint {
  margin-top: 0.75rem;
  font-size: 0.8rem;
  color: var(--muted);
  text-align: center;
}

.vox-slicer {
  background: #12151c;
  padding: 1.25rem;
  border-radius: 12px;
  border: 1px solid var(--border);
}

.slicer-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 1rem;
  margin-bottom: 1rem;
}

.slicer-header h3 {
  margin: 0;
  font-size: 1rem;
  color: var(--accent);
}

.slicer-controls {
  display: flex;
  align-items: center;
  gap: 1rem;
  font-size: 0.85rem;
}

.slice-grid-container {
  background: #000;
  padding: 10px;
  border-radius: 4px;
  overflow: auto;
  max-height: 400px;
  display: flex;
  justify-content: center;
}

.slice-grid {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.slice-row {
  display: flex;
  gap: 1px;
}

.slice-cell {
  width: 10px;
  height: 10px;
  background: #1a1d24;
  border-radius: 2px;
}

.slice-cell.active {
  border: 1px solid rgba(255,255,255,0.1);
}
</style>
