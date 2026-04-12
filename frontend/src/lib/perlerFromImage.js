import {
  PixelationMode,
  calculatePixelGrid,
  renderMappedGridToDataUrl
} from './perlerPixelation.js'
import { buildPaletteColors, colorSystemMapping, getBrandKeyForHex, getNearestBrandKeyForHex } from './perlerPalette.js'

function loadImageFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('图片加载失败'))
    }
    img.src = url
  })
}

function loadImageUrl(url) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('图片加载失败'))
    img.src = url
  })
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function quantizeRgb(rgb, levels = 7) {
  const step = 255 / Math.max(1, levels - 1)
  return {
    r: Math.round(rgb.r / step) * step,
    g: Math.round(rgb.g / step) * step,
    b: Math.round(rgb.b / step) * step
  }
}

function rgbToHex({ r, g, b }) {
  const toHex = (value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase()
}

function buildAutoPaletteFromGrid(grid, maxColors = 24) {
  const counts = new Map()
  for (const row of grid) {
    for (const cell of row) {
      if (cell.isExternal) continue
      const quantized = quantizeRgb({ r: cell.r, g: cell.g, b: cell.b }, 7)
      const hex = rgbToHex(quantized)
      counts.set(hex, (counts.get(hex) || 0) + 1)
    }
  }

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxColors)
    .map(([hex], index) => {
      const numericHex = hex.replace('#', '')
      return {
        key: `C${String(index + 1).padStart(2, '0')}`,
        hex,
        rgb: {
          r: parseInt(numericHex.slice(0, 2), 16),
          g: parseInt(numericHex.slice(2, 4), 16),
          b: parseInt(numericHex.slice(4, 6), 16)
        }
      }
    })
}

function aggregateGenericStats(mapped, colorSystem = 'MARD') {
  const freq = new Map()
  for (const row of mapped) {
    for (const cell of row) {
      if (cell.isExternal) continue
      const hex = String(cell.color || '').toUpperCase()
      if (!hex) continue
      const prev = freq.get(hex) || { hex, count: 0, key: cell.key || '' }
      prev.count++
      freq.set(hex, prev)
    }
  }

  return Array.from(freq.values())
    .sort((a, b) => b.count - a.count)
    .map(({ hex, count, key }) => ({
      hex,
      beadCount: count,
      brandKey: getNearestBrandKeyForHex(hex, colorSystem) || key || '—'
    }))
}

/**
 * @param {File} file
 * @param {{ gridCols: number, mode: 'dominant'|'average', colorSystem: string, renderStyle?: 'original'|'cartoon' }} opts
 */
export async function processImageToPerler(file, opts) {
  const { gridCols, mode, colorSystem, renderStyle = 'original' } = opts
  const img = await loadImageFile(file)
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 不可用')
  ctx.drawImage(img, 0, 0)
  if (renderStyle === 'cartoon') {
    applyCartoonEffect(ctx, img.naturalWidth, img.naturalHeight)
  }

  const N = Math.max(4, Math.min(200, gridCols))
  const M = Math.max(1, Math.round((img.naturalHeight / img.naturalWidth) * N))

  const palette = buildPaletteColors(colorSystemMapping, colorSystem)
  if (!palette.length) throw new Error('色板为空')

  const pixelMode = mode === 'average' ? PixelationMode.Average : PixelationMode.Dominant
  const fallback = palette[0]

  const grid = calculatePixelGrid(
    ctx,
    img.naturalWidth,
    img.naturalHeight,
    N,
    M,
    palette,
    pixelMode,
    fallback
  )

  const maxDim = Math.max(N, M)
  const cellPx = getAnnotatedCellSize(maxDim)

  const imageDataUrl = renderMappedGridToDataUrl(grid, cellPx, { annotate: true })
  const beadPalette = aggregateBeadStats(grid, colorSystem)

  return {
    imageDataUrl,
    beadPalette,
    gridWidth: N,
    gridHeight: M,
    totalBeads: N * M
  }
}

/**
 * 将任意已生成图片再次转换为带坐标 / 色号 / HEX 的拼豆底稿样式。
 * 适用于文字心情图、股票配图等非品牌色板场景。
 */
export async function processGeneratedImageToAnnotatedGrid(imageUrl, opts = {}) {
  const {
    gridCols = 24,
    maxColors = 24,
    mode = PixelationMode.Dominant,
    colorSystem = 'MARD'
  } = opts
  const img = await loadImageUrl(imageUrl)
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 不可用')
  ctx.drawImage(img, 0, 0)

  const N = clamp(Math.round(gridCols), 8, 96)
  const M = Math.max(1, Math.round((img.naturalHeight / img.naturalWidth) * N))
  const sampleCanvas = document.createElement('canvas')
  sampleCanvas.width = N
  sampleCanvas.height = M
  const sampleCtx = sampleCanvas.getContext('2d')
  if (!sampleCtx) throw new Error('Canvas 不可用')
  sampleCtx.imageSmoothingEnabled = true
  sampleCtx.imageSmoothingQuality = 'high'
  sampleCtx.drawImage(img, 0, 0, N, M)
  const sampleImage = sampleCtx.getImageData(0, 0, N, M).data
  const baseGrid = Array.from({ length: M }, (_, j) =>
    Array.from({ length: N }, (_, i) => {
      const index = (j * N + i) * 4
      return {
        r: sampleImage[index],
        g: sampleImage[index + 1],
        b: sampleImage[index + 2],
        isExternal: sampleImage[index + 3] < 128
      }
    })
  )

  const palette = buildAutoPaletteFromGrid(baseGrid, maxColors)
  const fallback = palette[0] || { key: 'C00', hex: '#F8FAFC', rgb: { r: 248, g: 250, b: 252 } }
  const mapped = calculatePixelGrid(ctx, img.naturalWidth, img.naturalHeight, N, M, palette, mode, fallback)
  const cellPx = getAnnotatedCellSize(Math.max(N, M))
  const imageDataUrl = renderMappedGridToDataUrl(mapped, cellPx, { annotate: true })
  const beadPalette = aggregateGenericStats(mapped, colorSystem)

  return {
    imageDataUrl,
    beadPalette,
    gridWidth: N,
    gridHeight: M,
    totalBeads: N * M
  }
}

function getAnnotatedCellSize(maxDim) {
  if (maxDim <= 24) return 56
  if (maxDim <= 36) return 48
  if (maxDim <= 48) return 40
  if (maxDim <= 64) return 34
  if (maxDim <= 80) return 30
  if (maxDim <= 96) return 28
  return 26
}

function applyCartoonEffect(ctx, width, height) {
  const base = ctx.getImageData(0, 0, width, height)
  const source = base.data
  const output = new Uint8ClampedArray(source.length)
  const levels = 5

  for (let i = 0; i < source.length; i += 4) {
    output[i] = posterizeChannel(source[i], levels, 1.06, 4)
    output[i + 1] = posterizeChannel(source[i + 1], levels, 1.03, 2)
    output[i + 2] = posterizeChannel(source[i + 2], levels, 0.98, 0)
    output[i + 3] = source[i + 3]
  }

  // 简单边缘描边：保留人像轮廓与五官对比，让拼豆结果更像卡通稿。
  for (let y = 0; y < height - 1; y++) {
    for (let x = 0; x < width - 1; x++) {
      const idx = (y * width + x) * 4
      const right = idx + 4
      const down = idx + width * 4
      const currentLuma = luma(source[idx], source[idx + 1], source[idx + 2])
      const rightLuma = luma(source[right], source[right + 1], source[right + 2])
      const downLuma = luma(source[down], source[down + 1], source[down + 2])
      const edgeStrength = Math.abs(currentLuma - rightLuma) + Math.abs(currentLuma - downLuma)

      if (edgeStrength > 72) {
        output[idx] = 32
        output[idx + 1] = 41
        output[idx + 2] = 54
      }
    }
  }

  const next = new ImageData(output, width, height)
  ctx.putImageData(next, 0, 0)
}

function posterizeChannel(value, levels, contrast, bias) {
  const adjusted = ((value - 128) * contrast + 128 + bias)
  const clamped = Math.max(0, Math.min(255, adjusted))
  const step = 255 / (levels - 1)
  return Math.round(clamped / step) * step
}

function luma(r, g, b) {
  return 0.299 * r + 0.587 * g + 0.114 * b
}

function aggregateBeadStats(mapped, colorSystem) {
  /** @type {Map<string, { hex: string, count: number }>} */
  const freq = new Map()
  for (let j = 0; j < mapped.length; j++) {
    for (let i = 0; i < mapped[j].length; i++) {
      const p = mapped[j][i]
      if (p.isExternal) continue
      const hex = p.color.toUpperCase()
      const prev = freq.get(hex) || { hex, count: 0 }
      prev.count++
      freq.set(hex, prev)
    }
  }

  const rows = []
  for (const { hex, count } of freq.values()) {
    const h = hex.startsWith('#') ? hex : `#${hex}`
    const r = parseInt(h.slice(1, 3), 16)
    const g = parseInt(h.slice(3, 5), 16)
    const b = parseInt(h.slice(5, 7), 16)
    const brandKey = getBrandKeyForHex(h, colorSystem)
    rows.push({
      hex: h,
      r,
      g,
      b,
      beadCount: count,
      brandKey
    })
  }
  rows.sort((a, b) => b.beadCount - a.beadCount)
  return rows
}
