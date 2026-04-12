/**
 * 算法改编自 Zippland/perler-beads（拼豆底稿生成器）
 * https://github.com/Zippland/perler-beads — AGPL-3.0
 */

export const PixelationMode = {
  Dominant: 'dominant',
  Average: 'average'
}

export function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
      }
    : null
}

export function colorDistance(rgb1, rgb2) {
  const dr = rgb1.r - rgb2.r
  const dg = rgb1.g - rgb2.g
  const db = rgb1.b - rgb2.b
  return Math.sqrt(dr * dr + dg * dg + db * db)
}

export function findClosestPaletteColor(targetRgb, palette) {
  if (!palette?.length) {
    return { key: '?', hex: '#000000', rgb: { r: 0, g: 0, b: 0 } }
  }
  let minD = Infinity
  let closest = palette[0]
  for (const c of palette) {
    const d = colorDistance(targetRgb, c.rgb)
    if (d < minD) {
      minD = d
      closest = c
      if (d === 0) break
    }
  }
  return closest
}

function calculateCellRepresentativeColor(imageData, startX, startY, width, height, mode) {
  const data = imageData.data
  const imgWidth = imageData.width
  let rSum = 0
  let gSum = 0
  let bSum = 0
  let pixelCount = 0
  const colorCountsInCell = {}
  let dominantColorRgb = null
  let maxCount = 0

  const endX = startX + width
  const endY = startY + height

  for (let y = startY; y < endY; y++) {
    for (let x = startX; x < endX; x++) {
      const index = (y * imgWidth + x) * 4
      if (data[index + 3] < 128) continue

      const r = data[index]
      const g = data[index + 1]
      const b = data[index + 2]

      pixelCount++

      if (mode === PixelationMode.Average) {
        rSum += r
        gSum += g
        bSum += b
      } else {
        const colorKey = `${r},${g},${b}`
        colorCountsInCell[colorKey] = (colorCountsInCell[colorKey] || 0) + 1
        if (colorCountsInCell[colorKey] > maxCount) {
          maxCount = colorCountsInCell[colorKey]
          dominantColorRgb = { r, g, b }
        }
      }
    }
  }

  if (pixelCount === 0) return null

  if (mode === PixelationMode.Average) {
    return {
      r: Math.round(rSum / pixelCount),
      g: Math.round(gSum / pixelCount),
      b: Math.round(bSum / pixelCount)
    }
  }
  return dominantColorRgb
}

/**
 * @param {CanvasRenderingContext2D} originalCtx
 * @returns {MappedPixel[][]} 行优先 [j][i]
 */
export function calculatePixelGrid(
  originalCtx,
  imgWidth,
  imgHeight,
  N,
  M,
  palette,
  mode,
  t1FallbackColor
) {
  const mappedData = Array.from({ length: M }, () =>
    Array.from({ length: N }, () => ({
      key: t1FallbackColor.key,
      color: t1FallbackColor.hex,
      isExternal: false
    }))
  )

  const cellWidthOriginal = imgWidth / N
  const cellHeightOriginal = imgHeight / M

  let fullImageData
  try {
    fullImageData = originalCtx.getImageData(0, 0, imgWidth, imgHeight)
  } catch {
    return mappedData
  }

  for (let j = 0; j < M; j++) {
    for (let i = 0; i < N; i++) {
      const startXOriginal = Math.floor(i * cellWidthOriginal)
      const startYOriginal = Math.floor(j * cellHeightOriginal)
      const endXOriginal = Math.min(imgWidth, Math.ceil((i + 1) * cellWidthOriginal))
      const endYOriginal = Math.min(imgHeight, Math.ceil((j + 1) * cellHeightOriginal))
      const currentCellWidth = Math.max(1, endXOriginal - startXOriginal)
      const currentCellHeight = Math.max(1, endYOriginal - startYOriginal)

      const representativeRgb = calculateCellRepresentativeColor(
        fullImageData,
        startXOriginal,
        startYOriginal,
        currentCellWidth,
        currentCellHeight,
        mode
      )

      if (representativeRgb) {
        const closestBead = findClosestPaletteColor(representativeRgb, palette)
        mappedData[j][i] = { key: closestBead.key, color: closestBead.hex, isExternal: false }
      } else {
        mappedData[j][i] = { key: '—', color: '#FFFFFF', isExternal: true }
      }
    }
  }
  return mappedData
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function pickInkColor(hex) {
  const rgb = hexToRgb(hex)
  if (!rgb) return '#111827'
  const luminance = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255
  return luminance > 0.62 ? '#111827' : '#f8fafc'
}

function drawAxisLabels(ctx, N, M, cellPx, leftPad, topPad) {
  const axisFontSize = clamp(Math.round(cellPx * 0.34), 10, 18)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#475569'
  ctx.font = `600 ${axisFontSize}px "Noto Sans SC", sans-serif`

  for (let i = 0; i < N; i++) {
    const x = leftPad + i * cellPx + cellPx / 2
    ctx.fillText(String(i + 1), x, topPad / 2)
  }

  for (let j = 0; j < M; j++) {
    const y = topPad + j * cellPx + cellPx / 2
    ctx.fillText(String(j + 1), leftPad / 2, y)
  }

  ctx.fillStyle = '#0f172a'
  ctx.font = `700 ${clamp(Math.round(cellPx * 0.42), 12, 22)}px "Noto Sans SC", sans-serif`
  ctx.fillText('X', leftPad + (N * cellPx) / 2, Math.max(axisFontSize, topPad * 0.18))
  ctx.save()
  ctx.translate(Math.max(axisFontSize, leftPad * 0.18), topPad + (M * cellPx) / 2)
  ctx.rotate(-Math.PI / 2)
  ctx.fillText('Y', 0, 0)
  ctx.restore()
}

function drawCellLabel(ctx, cell, x, y, cellPx) {
  if (cell.isExternal) return

  const showTwoLines = cellPx >= 36
  const showHex = cellPx >= 26
  const key = cell.key && cell.key !== '?' && cell.key !== '—' ? String(cell.key) : ''
  const hex = String(cell.color || '').toUpperCase()
  const textColor = pickInkColor(hex)
  const strokeColor = textColor === '#111827' ? 'rgba(255,255,255,0.78)' : 'rgba(15,23,42,0.62)'

  const primary = key || hex
  const secondary = showTwoLines && key ? hex : ''
  if (!primary) return

  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  ctx.lineWidth = Math.max(1, Math.round(cellPx * 0.06))
  ctx.strokeStyle = strokeColor
  ctx.fillStyle = textColor

  if (secondary) {
    const topFont = clamp(Math.round(cellPx * 0.24), 10, 16)
    const bottomFont = clamp(Math.round(cellPx * 0.18), 8, 12)
    ctx.font = `700 ${topFont}px "Noto Sans SC", sans-serif`
    ctx.strokeText(primary, x + cellPx / 2, y + cellPx * 0.39)
    ctx.fillText(primary, x + cellPx / 2, y + cellPx * 0.39)
    ctx.font = `600 ${bottomFont}px ui-monospace, monospace`
    ctx.strokeText(secondary, x + cellPx / 2, y + cellPx * 0.69)
    ctx.fillText(secondary, x + cellPx / 2, y + cellPx * 0.69)
    return
  }

  const singleFont = clamp(Math.round(cellPx * (showHex ? 0.2 : 0.18)), 8, 14)
  ctx.font = `${key ? 700 : 600} ${singleFont}px ${key ? '"Noto Sans SC", sans-serif' : 'ui-monospace, monospace'}`
  ctx.strokeText(primary, x + cellPx / 2, y + cellPx / 2)
  ctx.fillText(primary, x + cellPx / 2, y + cellPx / 2)
}

/** 拼豆预览图 Data URL */
export function renderMappedGridToDataUrl(mapped, cellPx, opts = {}) {
  const M = mapped.length
  const N = mapped[0].length
  const annotate = opts.annotate === true
  const leftPad = annotate ? Math.max(36, Math.round(cellPx * 1.9)) : 0
  const topPad = annotate ? Math.max(34, Math.round(cellPx * 1.5)) : 0
  const outerPad = annotate ? Math.max(10, Math.round(cellPx * 0.35)) : 0
  const canvas = document.createElement('canvas')
  canvas.width = leftPad + N * cellPx + outerPad
  canvas.height = topPad + M * cellPx + outerPad
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''

  ctx.fillStyle = '#f8fafc'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  if (annotate) {
    ctx.fillStyle = '#e2e8f0'
    ctx.fillRect(leftPad, 0, N * cellPx, topPad)
    ctx.fillRect(0, topPad, leftPad, M * cellPx)
    ctx.fillStyle = '#cbd5e1'
    ctx.fillRect(0, 0, leftPad, topPad)
    drawAxisLabels(ctx, N, M, cellPx, leftPad, topPad)
  }

  for (let j = 0; j < M; j++) {
    for (let i = 0; i < N; i++) {
      const x = leftPad + i * cellPx
      const y = topPad + j * cellPx
      ctx.fillStyle = mapped[j][i].color
      ctx.fillRect(x, y, cellPx, cellPx)
      ctx.strokeStyle = 'rgba(15, 23, 42, 0.16)'
      ctx.lineWidth = 1
      ctx.strokeRect(x, y, cellPx, cellPx)
      if (annotate) {
        drawCellLabel(ctx, mapped[j][i], x, y, cellPx)
      }
    }
  }
  return canvas.toDataURL('image/png')
}
