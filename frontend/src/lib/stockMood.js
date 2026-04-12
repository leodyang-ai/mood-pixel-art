import { createWorker } from 'tesseract.js'
import { ocrYieldScreenshot, normalizeOcrText, parseDailyPercents } from './yieldHeatmap.js'
import { processGeneratedImageToAnnotatedGrid } from './perlerFromImage.js'
import loseHelloKittyUrl from '../assets/stock-mood/lose-hello-kitty.jpg'
import loseQuestionUrl from '../assets/stock-mood/lose-question.jpg'
import loseBuyDipUrl from '../assets/stock-mood/lose-buy-dip.jpg'
import losePeaceUrl from '../assets/stock-mood/lose-peace.jpg'
import earnMoneyBagUrl from '../assets/stock-mood/earn-money-bag.jpg'
import earnBeadBagUrl from '../assets/stock-mood/earn-bead-bag.jpg'
import earnMardBagUrl from '../assets/stock-mood/earn-mard-bag.jpg'

function svgToBase64DataUri(svg) {
  const encoded = btoa(unescape(encodeURIComponent(svg)))
  return `data:image/svg+xml;base64,${encoded}`
}

function clampPixelSize(pixelSize) {
  return Math.max(6, Math.min(28, Math.round(pixelSize || 12)))
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`图片加载失败：${url}`))
    img.src = url
  })
}

function quantizeChannel(value, levels = 6) {
  const boundedLevels = Math.max(2, levels)
  const step = 255 / (boundedLevels - 1)
  return Math.round(value / step) * step
}

function quantizeCanvas(ctx, width, height, levels = 6) {
  const image = ctx.getImageData(0, 0, width, height)
  const { data } = image
  for (let i = 0; i < data.length; i += 4) {
    data[i] = quantizeChannel(data[i], levels)
    data[i + 1] = quantizeChannel(data[i + 1], levels)
    data[i + 2] = quantizeChannel(data[i + 2], levels)
  }
  ctx.putImageData(image, 0, 0)
}

async function renderRasterAsPixelDataUrl(url, pixelSize, opts = {}) {
  const img = await loadImage(url)
  const blockSize = clampPixelSize(pixelSize)
  const sourceBlock = Math.max(4, Math.round(blockSize * 1.8))
  const gridWidth = Math.max(14, Math.round(img.naturalWidth / sourceBlock))
  const gridHeight = Math.max(18, Math.round((img.naturalHeight / img.naturalWidth) * gridWidth))
  const outputCell = Math.max(18, Math.min(96, blockSize * 3))
  const outputWidth = gridWidth * outputCell
  const outputHeight = gridHeight * outputCell

  const sampleCanvas = document.createElement('canvas')
  sampleCanvas.width = gridWidth
  sampleCanvas.height = gridHeight
  const sampleCtx = sampleCanvas.getContext('2d')
  if (!sampleCtx) throw new Error('Canvas 不可用')
  sampleCtx.imageSmoothingEnabled = true
  sampleCtx.imageSmoothingQuality = 'high'
  sampleCtx.drawImage(img, 0, 0, gridWidth, gridHeight)
  quantizeCanvas(sampleCtx, gridWidth, gridHeight, 6)

  const outCanvas = document.createElement('canvas')
  outCanvas.width = outputWidth
  outCanvas.height = outputHeight
  const outCtx = outCanvas.getContext('2d')
  if (!outCtx) throw new Error('Canvas 不可用')
  outCtx.imageSmoothingEnabled = false
  outCtx.fillStyle = opts.background || '#f8fafc'
  outCtx.fillRect(0, 0, outputWidth, outputHeight)
  outCtx.drawImage(sampleCanvas, 0, 0, outputWidth, outputHeight)

  return outCanvas.toDataURL('image/png')
}

function makePixelSvg({ title, subtitle, bg = '#f8fafc', palette, rows, footer = '', cell = 12 }) {
  const cols = rows[0].length
  const artHeight = rows.length * cell
  const footerHeight = footer ? Math.round(cell * 5.2) : Math.round(cell * 2.9)
  const width = cols * cell
  const height = artHeight + footerHeight

  const rects = rows
    .flatMap((row, y) =>
      row.split('').flatMap((key, x) => {
        const fill = palette[key]
        if (!fill) return []
        return `<rect x="${x * cell}" y="${y * cell}" width="${cell}" height="${cell}" fill="${fill}" />`
      })
    )
    .join('')

  const titleY = artHeight + Math.round(cell * 2)
  const subY = artHeight + Math.round(cell * 3.7)
  const footerY = artHeight + Math.round(cell * 4.9)
  const titleFont = Math.max(14, Math.round(cell * 1.15))
  const subtitleFont = Math.max(10, Math.round(cell * 0.82))
  const footerFont = Math.max(9, Math.round(cell * 0.72))

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" shape-rendering="crispEdges">
      <rect width="${width}" height="${height}" fill="${bg}" />
      ${rects}
      <text x="${width / 2}" y="${titleY}" text-anchor="middle" font-size="${titleFont}" font-family="'Noto Sans SC', sans-serif" font-weight="700" fill="#111827">${title}</text>
      <text x="${width / 2}" y="${subY}" text-anchor="middle" font-size="${subtitleFont}" font-family="'Noto Sans SC', sans-serif" fill="#475569">${subtitle}</text>
      ${footer ? `<text x="${width / 2}" y="${footerY}" text-anchor="middle" font-size="${footerFont}" font-family="'Noto Sans SC', sans-serif" fill="#64748b">${footer}</text>` : ''}
    </svg>
  `

  return svgToBase64DataUri(svg)
}

function makeMoodEntry(definition) {
  return definition
}

const stockMoodGallery = {
  earn: [
    makeMoodEntry({
      id: 'earn-money-bag-photo',
      title: '发财钱袋',
      type: 'raster',
      sourceUrl: earnMoneyBagUrl
    }),
    makeMoodEntry({
      id: 'earn-bead-bag-photo',
      title: '拼豆钱袋',
      type: 'raster',
      sourceUrl: earnBeadBagUrl
    }),
    makeMoodEntry({
      id: 'earn-mard-bag-photo',
      title: '豆画钱袋',
      type: 'raster',
      sourceUrl: earnMardBagUrl
    }),
    makeMoodEntry({
      id: 'gold-bag',
      title: '钱包鼓包',
      art: {
        title: '赚到了',
        subtitle: '今天像素钱包有点鼓',
        footer: '盈利图池可继续追加',
        bg: '#fffbea',
        palette: {
          '.': '',
          O: '#a97b2f',
          Y: '#f2d35d',
          H: '#ffe68a',
          D: '#443c43',
          B: '#6b3f1f'
        },
        rows: [
          '................',
          '.....OOOOOO.....',
          '....OYYYYYYO....',
          '...OOYHHHHYOO...',
          '..OOYHHHHHHYOO..',
          '..OYYHHDDHHYYO..',
          '..OYYHDDDDHYYO..',
          '.OOYHHDDDDHHYOO.',
          '.OYHHHDDDDHHHYO.',
          '.OYHHDDDDDDHHYO.',
          '.OYHHHDDDDHHHYO.',
          '.OOYHHHHHHHHYOO.',
          '..OOYHHHHHHYOO..',
          '...OOYYYYYYOO...',
          '....OOBBBBOO....',
          '.....OOOOOO.....'
        ]
      }
    }),
    makeMoodEntry({
      id: 'rocket-up',
      title: '火箭起飞',
      art: {
        title: '一路向上',
        subtitle: '今天像坐火箭',
        bg: '#eef6ff',
        palette: {
          '.': '',
          B: '#0f172a',
          R: '#ef4444',
          Y: '#facc15',
          O: '#f97316',
          W: '#ffffff',
          S: '#93c5fd'
        },
        rows: [
          '........W.......',
          '.......WWW......',
          '.......WWW......',
          '......WWWWW.....',
          '......WYRWW.....',
          '.....WWYRRWW....',
          '.....WYYRRRW....',
          '....WWYYYRRWW...',
          '....WYYYYRRRW...',
          '...WWYYYYYRRWW..',
          '...WBBBBBBBBBW..',
          '...WBBBBBBBBBW..',
          '....WBOOOBBWW...',
          '....WBOOOBBW....',
          '.....WOOOBW.....',
          '......WOOOW.....',
          '......WOOOW.....',
          '.....WSSSSW.....'
        ]
      }
    }),
    makeMoodEntry({
      id: 'happy-bull',
      title: '牛气冲天',
      art: {
        title: '牛起来了',
        subtitle: '今日账户有点豪横',
        bg: '#fff7e8',
        palette: {
          '.': '',
          K: '#2b1b12',
          B: '#6b4423',
          H: '#f6d5b4',
          Y: '#fde68a',
          W: '#ffffff'
        },
        rows: [
          '..WW........WW..',
          '.WYYW......WYYW.',
          '.WYYWKKKKKKWYYW.',
          '..WBBBBBBBBBBW..',
          '.KBBBBBBBBBBBBK.',
          'KBBHHHBBHHHBBBK',
          'KBBHHHBBHHHBBBK',
          'KBBBBBBBBBBBBBK',
          '.KBBBBBBBBBBBK.',
          '..KBBBBBBBBBK..',
          '...KBBBBBBBK...',
          '...KBBKKBBBK...',
          '...KBB..BBBK...',
          '..KBBK..KBBK...',
          '..KBB....BBK...',
          '.KBBK....KBBK..'
        ]
      }
    }),
    makeMoodEntry({
      id: 'trophy-laugh',
      title: '奖杯到手',
      art: {
        title: '拿奖杯了',
        subtitle: '账户终于笑出声',
        bg: '#fffbea',
        palette: {
          '.': '',
          G: '#b48a33',
          Y: '#f9df74',
          B: '#6b3f1f',
          D: '#3f3f46'
        },
        rows: [
          '......GGGG......',
          '....GGYYYYGG....',
          '...GYYYYYYYYG...',
          '..GGYYYYYYYYGG..',
          '..GYYYYYYYYYYG..',
          '..GGYYYYYYYYGG..',
          '...GGYYYYYYGG...',
          '.....GGYYGG.....',
          '......GBBG......',
          '......GBBG......',
          '.....GGYYGG.....',
          '....GGYYYYGG....',
          '...GGYYYYYYGG...',
          '...GGBBBBBBGG...',
          '..GGDDDDDDDDGG..',
          '..GGDDDDDDDDGG..'
        ]
      }
    }),
    makeMoodEntry({
      id: 'coin-rain',
      title: '金币雨',
      art: {
        title: '金币哗啦啦',
        subtitle: '今天像在下红包雨',
        bg: '#f8fafc',
        palette: {
          '.': '',
          Y: '#f6d84a',
          O: '#b48a33',
          D: '#3f3f46'
        },
        rows: [
          'Y...Y....Y...Y..',
          'OY.YO..YOY..YO..',
          '.YOY....Y....Y..',
          '..Y..Y....Y..Y..',
          '.YO..OY..YO..OY.',
          '..Y...Y...Y...Y.',
          'Y...Y....Y...Y..',
          'OY.YO..YOY..YO..',
          '.YOY....Y....Y..',
          '..Y..Y....Y..Y..',
          '.YO..OY..YO..OY.',
          '..Y...Y...Y...Y.',
          '......DDD.......',
          '.....DDDDD......',
          '....DDDDDDD.....',
          '.....DDDDD......'
        ]
      }
    }),
    makeMoodEntry({
      id: 'smile-cat',
      title: '招财猫猫',
      art: {
        title: '猫猫抬爪',
        subtitle: '好运直接拍你脸上',
        bg: '#fffaf0',
        palette: {
          '.': '',
          K: '#1f2937',
          W: '#ffffff',
          Y: '#facc15',
          P: '#f9a8d4',
          G: '#22c55e'
        },
        rows: [
          '..K........K....',
          '.KWK......KWK...',
          '.KWWKKKKKKWWK...',
          '.KWWWWWWWWWWK...',
          'KWWPWWWWWWPWWK..',
          'KWWWWKWWKWWWWK..',
          'KWWWWWWWWWWWWK..',
          '.KWWWWWWWWWWK...',
          '..KWWGYYGWWK....',
          '...KYGYYGYK.....',
          '....KYYYYK......',
          '....KYYYYK......',
          '....KWWWWK......',
          '...KWW..WWK.....',
          '...KWW..WWK.....',
          '..KWW....WWK....'
        ]
      }
    })
  ],
  lose: [
    makeMoodEntry({
      id: 'lose-hello-kitty-photo',
      title: '绿光普照',
      type: 'raster',
      sourceUrl: loseHelloKittyUrl
    }),
    makeMoodEntry({
      id: 'lose-question-photo',
      title: '看不懂盘面',
      type: 'raster',
      sourceUrl: loseQuestionUrl
    }),
    makeMoodEntry({
      id: 'lose-buy-dip-photo',
      title: '自信抄底',
      type: 'raster',
      sourceUrl: loseBuyDipUrl
    }),
    makeMoodEntry({
      id: 'lose-peace-photo',
      title: '只求平安',
      type: 'raster',
      sourceUrl: losePeaceUrl
    }),
    makeMoodEntry({
      id: 'green-monitor',
      title: '绿光普照',
      art: {
        title: '绿到发光',
        subtitle: '屏幕一亮，人先沉默',
        bg: '#f3f4f6',
        palette: {
          '.': '',
          K: '#1f2937',
          W: '#ffffff',
          G: '#22c55e',
          S: '#9ca3af',
          P: '#f9a8d4'
        },
        rows: [
          'KKKKK...........',
          'KWWWK....SSS....',
          'KWWWK...SWWWS...',
          'KKKKK..SWWWWWS..',
          '..K....SWWWWWS..',
          '......SWWGWWWS..',
          '.....SWWGGGWWS..',
          '....SWWGGGGWWS..',
          '...SWWGGGGGGWS..',
          '..SWWGGGGGGGWS..',
          '..SWWGGGGGGGWS..',
          '..SWWWGGGGWWS...',
          '...SWWWWWWWWS...',
          '....SSWWWWWSS...',
          '......SPPPS.....',
          '.......SSS......'
        ]
      }
    }),
    makeMoodEntry({
      id: 'question-trader',
      title: '看不懂盘面',
      art: {
        title: '亏懵了',
        subtitle: '问号比仓位还多',
        bg: '#d9a066',
        palette: {
          '.': '',
          B: '#20110a',
          F: '#e8a57a',
          G: '#a7b25d',
          H: '#3a1a0c'
        },
        rows: [
          '..........BB....',
          '........BB.BB...',
          '.....HHHHHH.....',
          '....HFFFFFFH....',
          '...HFFFGGFFFH...',
          '..HFFFGGGGFFFH..',
          '..HFFFGGGGFFFH..',
          '..HFFFFFFFGFFH..',
          '.HHFFFFFFFFFFHH.',
          '.HFFFFFFFFFFFFH.',
          '.HFFFHFFFFHFFFH.',
          '.HFFHHFFFFHHFFH.',
          '.HHH..FFFF..HHH.',
          '......FFFF......',
          '......BB........',
          '......BB........'
        ]
      }
    }),
    makeMoodEntry({
      id: 'dip-buy',
      title: '自信抄底',
      art: {
        title: '自信抄底',
        subtitle: '结果抄在半山腰',
        bg: '#d8d8d8',
        palette: {
          '.': '',
          K: '#111827',
          W: '#f8fafc',
          R: '#d95b2f',
          C: '#2fb1c4',
          Y: '#e6dd5f'
        },
        rows: [
          '.KKKKKKKKKKKKKK.',
          '.KWWWWWWWWWWWWK.',
          '.KWCCCRCCWWWWWK.',
          '.KWCWWCCWWWWWWK.',
          '.KWWWWRCCWWWWWK.',
          '.KWWWWWCRWWWWWK.',
          '.KWWWWWWRCWWWWK.',
          '.KWWWWWYYCCWWWK.',
          '.KWWYYYCWWRCWWK.',
          '.KWYYWWWWWWRCWK.',
          '.KWWWWWWWWWWWWK.',
          '.KKKKKKKKKKKKKK.',
          'WWWWWWWWWWWWWWWW',
          'WRRRRWWRRRRWWRRW',
          'WRWWRWWRWWRWWRRW',
          'WRRRRWWRRRRWWRRW'
        ]
      }
    }),
    makeMoodEntry({
      id: 'peace-beads',
      title: '只求平安',
      art: {
        title: '平安喜乐',
        subtitle: '先回本，再谈理想',
        bg: '#fff7cc',
        palette: {
          '.': '',
          Y: '#f7d84a',
          K: '#1f2937',
          R: '#d65a4a',
          B: '#f6e5bf'
        },
        rows: [
          'BBBBBBBBBBBBBBBB',
          'BRRRYYYYYYYYRRRB',
          'BRYYKKYYKKYYRYRB',
          'BRYYKKYYKKYYRYRB',
          'BRYYYYKKYYYYRYRB',
          'BRYYKKYYKKYYRYRB',
          'BRYYKKYYKKYYRYRB',
          'BRYYYYYYYYYYYYRB',
          'BRYYKKKKKKKKYYRB',
          'BRYYKKYYYYKKYYRB',
          'BRYYKKYYYYKKYYRB',
          'BRYYKKKKKKKKYYRB',
          'BRYYYYYYYYYYYYRB',
          'BRRRYYYYYYYYRRRB',
          'BBBBBBBBBBBBBBBB',
          '................'
        ]
      }
    })
  ]
}

async function renderMoodImage(entry, pixelSize = 12) {
  const clampedSize = clampPixelSize(pixelSize)
  const gridCols = Math.max(28, Math.min(84, Math.round(96 - clampedSize * 2)))
  if (entry.type === 'raster' && entry.sourceUrl) {
    return processGeneratedImageToAnnotatedGrid(entry.sourceUrl, {
      gridCols,
      maxColors: 32,
      colorSystem: 'MARD'
    })
  }
  const rawImageUrl = makePixelSvg({
    ...entry.art,
    cell: clampedSize
  })
  return processGeneratedImageToAnnotatedGrid(rawImageUrl, {
    gridCols,
    maxColors: 32,
    colorSystem: 'MARD'
  })
}

function pickRandom(items, excludeId = '') {
  if (!items.length) {
    throw new Error('内置配图池为空，请先补充 stockMood.js 中的图库配置。')
  }
  if (items.length === 1) return items[0]
  const pool = excludeId ? items.filter((item) => item.id !== excludeId) : items
  return pool[Math.floor(Math.random() * pool.length)]
}

function parseSignedNumber(raw) {
  if (!raw) return null
  let token = normalizeOcrText(raw)
    .replace(/\s+/g, '')
    .replace(/[元￥¥]/g, '')
    .replace(/[^\d+-.]/g, '')

  if (!token) return null

  let sign = ''
  if (token.startsWith('-')) sign = '-'
  if (token.startsWith('+')) sign = '+'
  token = token.replace(/^[+-]/, '')

  const lastDot = token.lastIndexOf('.')
  if (lastDot >= 0) {
    token = `${token.slice(0, lastDot).replace(/\./g, '')}.${token.slice(lastDot + 1).replace(/\./g, '')}`
  } else {
    token = token.replace(/\./g, '')
  }

  const value = Number(`${sign}${token}`)
  return Number.isFinite(value) ? value : null
}

function flattenOcrLines(lines) {
  return (Array.isArray(lines) ? lines : [])
    .map((line) => normalizeOcrText(line.text || '').trim())
    .filter(Boolean)
}

function pickMostLikelyAmount(candidates) {
  const valid = candidates
    .map(parseSignedNumber)
    .filter((value) => value != null && Math.abs(value) >= 100)
    .sort((a, b) => Math.abs(b) - Math.abs(a))
  return valid[0] ?? null
}

function pickMostLikelyRate(candidates) {
  const valid = candidates
    .map(parseSignedNumber)
    .filter((value) => value != null && Math.abs(value) <= 100)
    .sort((a, b) => Math.abs(b) - Math.abs(a))
  return valid[0] ?? null
}

function summarizeDailyRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return {
      count: 0,
      negativeCount: 0,
      positiveCount: 0,
      sumPct: 0,
      stronglyNegative: false,
      stronglyPositive: false
    }
  }

  const negativeCount = rows.filter((row) => row.pct < 0).length
  const positiveCount = rows.filter((row) => row.pct > 0).length
  const sumPct = rows.reduce((sum, row) => sum + row.pct, 0)
  const negativeRatio = negativeCount / rows.length
  const positiveRatio = positiveCount / rows.length

  return {
    count: rows.length,
    negativeCount,
    positiveCount,
    sumPct,
    stronglyNegative: sumPct <= -1.5 || (negativeRatio >= 0.6 && negativeCount - positiveCount >= 3),
    stronglyPositive: sumPct >= 1.5 || (positiveRatio >= 0.6 && positiveCount - negativeCount >= 3)
  }
}

function classifyPixelBias(r, g, b, a) {
  if (a < 180) return 0
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const saturation = max - min
  if (max < 110 || saturation < 28) return 0
  if (g - r > 22 && g - b > 12) return -1
  if (r - g > 20 && r - b > 10) return 1
  return 0
}

async function analyzeColorBias(file) {
  const bitmap = await createImageBitmap(file)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return { summaryBias: 0, calendarBias: 0, stronglyNegative: false, stronglyPositive: false }
  }

  ctx.drawImage(bitmap, 0, 0)

  const regions = {
    summary: {
      x: Math.round(bitmap.width * 0.36),
      y: Math.round(bitmap.height * 0.22),
      w: Math.round(bitmap.width * 0.6),
      h: Math.round(bitmap.height * 0.12)
    },
    calendar: {
      x: Math.round(bitmap.width * 0.04),
      y: Math.round(bitmap.height * 0.36),
      w: Math.round(bitmap.width * 0.92),
      h: Math.round(bitmap.height * 0.5)
    }
  }

  function scoreRegion({ x, y, w, h }) {
    const data = ctx.getImageData(x, y, w, h).data
    let green = 0
    let red = 0
    for (let i = 0; i < data.length; i += 4) {
      const bias = classifyPixelBias(data[i], data[i + 1], data[i + 2], data[i + 3])
      if (bias < 0) green++
      if (bias > 0) red++
    }
    return { green, red, score: green - red }
  }

  const summary = scoreRegion(regions.summary)
  const calendar = scoreRegion(regions.calendar)

  return {
    summaryBias: summary.score,
    calendarBias: calendar.score,
    stronglyNegative: summary.green > summary.red * 1.2 || calendar.green > calendar.red * 1.15,
    stronglyPositive: summary.red > summary.green * 1.2 || calendar.red > calendar.green * 1.15
  }
}

function extractFirstMatch(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match) return match[1]
  }
  return null
}

function findNearestLineValue(lines, keywordRe, valueRe) {
  const idx = lines.findIndex((line) => keywordRe.test(line))
  if (idx < 0) return null
  for (let cursor = idx; cursor <= Math.min(lines.length - 1, idx + 3); cursor++) {
    const match = lines[cursor].match(valueRe)
    if (match) return match[1]
  }
  return null
}

function extractHeaderWindow(lines) {
  const anchorIndex = lines.findIndex((line) => /时间|盈亏金额|盈亏率|盈亏分析|盈亏日历/.test(line))
  if (anchorIndex < 0) {
    return lines.slice(0, 10).join(' ')
  }
  const start = Math.max(0, anchorIndex - 1)
  const end = Math.min(lines.length, anchorIndex + 6)
  return lines.slice(start, end).join(' ')
}

function extractFromHeaderWindow(lines) {
  const windowText = extractHeaderWindow(lines)
  const amountCandidates = Array.from(windowText.matchAll(/([+\-−]?\s*\d[\d.\s]{2,18})/g)).map((m) => m[1])
  const rateCandidates = Array.from(windowText.matchAll(/([+\-−]?\s*\d+(?:\.\d+)?)\s*%/g)).map((m) => m[1])
  return {
    amount: pickMostLikelyAmount(amountCandidates),
    rate: pickMostLikelyRate(rateCandidates)
  }
}

async function ocrTopSummaryRegion(file, onProgress) {
  const bitmap = await createImageBitmap(file)
  const cropHeight = Math.max(220, Math.round(bitmap.height * 0.38))
  const scale = Math.max(3, 2200 / Math.max(bitmap.width, cropHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(cropHeight * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 不可用')

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.filter = 'contrast(1.18) saturate(1.08) brightness(1.03)'
  ctx.drawImage(bitmap, 0, 0, bitmap.width, cropHeight, 0, 0, canvas.width, canvas.height)
  ctx.filter = 'none'

  if (onProgress) onProgress('正在二次识别摘要区域...')
  const worker = await createWorker('chi_sim+eng', undefined, { 
    logger: (m) => {
        if (onProgress && m.status === 'recognizing text') {
          const pct = Math.round(m.progress * 100)
          onProgress(`识别摘要中 (${pct}%)`)
        }
    } 
  })
  let mergedText = ''
  try {
    // 优化：摘要区域格式通常较规整，单次 PSM 6 (块状文本) 或 3 即可。
    await worker.setParameters({
      tessedit_pageseg_mode: '6',
      user_defined_dpi: '300'
    })
    const {
      data: { text }
    } = await worker.recognize(canvas)
    mergedText = text || ''
  } finally {
    await worker.terminate()
  }

  return normalizeOcrText(mergedText)
}

function extractSummaryAmount(text, lines) {
  const amountPatterns = [
    /(?:月度|本月)?总盈亏(?:金额)?[：:\s]*([+\-]?\s*\d[\d.\s]{1,18})/,
    /盈亏金额[：:\s]*([+\-]?\s*\d[\d.\s]{1,18})/,
    /总收益[：:\s]*([+\-]?\s*\d[\d.\s]{1,18})/,
    /累计盈亏[：:\s]*([+\-]?\s*\d[\d.\s]{1,18})/
  ]

  const direct = extractFirstMatch(text, amountPatterns)
  if (direct) return parseSignedNumber(direct)

  const fromLine = findNearestLineValue(lines, /总盈亏|盈亏金额|累计盈亏|总收益/, /([+\-]?\s*\d[\d.\s]{1,18})/)
  if (fromLine) return parseSignedNumber(fromLine)

  const fromWindow = extractFromHeaderWindow(lines).amount
  if (fromWindow != null) return fromWindow

  const topBlock = (lines || []).slice(0, 12).join(' ')
  const fallback = Array.from(topBlock.matchAll(/([+\-−]?\s*\d[\d.\s]{2,18})/g)).map((m) => m[1])
  return pickMostLikelyAmount(fallback)
}

function extractSummaryRate(text, lines) {
  const ratePatterns = [
    /(?:总盈亏率|盈亏率|总收益率|累计收益率)[：:\s]*([+\-]?\s*\d+(?:\.\d+)?)\s*%/,
    /收益率[：:\s]*([+\-]?\s*\d+(?:\.\d+)?)\s*%/
  ]

  const direct = extractFirstMatch(text, ratePatterns)
  if (direct) return parseSignedNumber(direct)

  const fromLine = findNearestLineValue(
    lines,
    /总盈亏率|盈亏率|总收益率|累计收益率|收益率/,
    /([+\-]?\s*\d+(?:\.\d+)?)\s*%/
  )
  if (fromLine) return parseSignedNumber(fromLine)

  const fromWindow = extractFromHeaderWindow(lines).rate
  if (fromWindow != null) return fromWindow

  const topBlock = (lines || []).slice(0, 12).join(' ')
  const allRates = Array.from(topBlock.matchAll(/([+\-−]?\s*\d+(?:\.\d+)?)\s*%/g)).map((m) => m[1])
  return pickMostLikelyRate(allRates)
}

function inferStockOutcome({ amount, rate }) {
  if (amount == null && rate == null) {
    throw new Error('未能识别总盈亏金额或总盈亏率，请换一张更清晰、包含顶部汇总区域的截图。')
  }

  if ((amount ?? 0) < 0 || (rate ?? 0) < 0) {
    return { profit: false, verdict: '亏损' }
  }

  return { profit: true, verdict: '盈利' }
}

function reconcileOutcome(summary, dailyStats) {
  if (dailyStats.count < 5) {
    return {
      ...summary,
      source: summary.source
    }
  }

  if (summary.profit && dailyStats.stronglyNegative) {
    return {
      profit: false,
      verdict: '亏损',
      amount: summary.amount != null ? -Math.abs(summary.amount) : summary.amount,
      rate: summary.rate != null ? -Math.abs(summary.rate) : summary.rate,
      source: `${summary.source}；已按日历明细纠偏`
    }
  }

  if (!summary.profit && dailyStats.stronglyPositive) {
    return {
      profit: true,
      verdict: '盈利',
      amount: summary.amount != null ? Math.abs(summary.amount) : summary.amount,
      rate: summary.rate != null ? Math.abs(summary.rate) : summary.rate,
      source: `${summary.source}；已按日历明细纠偏`
    }
  }

  return {
    ...summary,
    source: `${summary.source}；日历明细一致`
  }
}

function reconcileWithColorBias(summary, colorBias) {
  if (summary.profit && colorBias.stronglyNegative) {
    return {
      profit: false,
      verdict: '亏损',
      amount: summary.amount != null ? -Math.abs(summary.amount) : summary.amount,
      rate: summary.rate != null ? -Math.abs(summary.rate) : summary.rate,
      source: `${summary.source}；已按颜色语义纠偏`
    }
  }

  if (!summary.profit && colorBias.stronglyPositive) {
    return {
      profit: true,
      verdict: '盈利',
      amount: summary.amount != null ? Math.abs(summary.amount) : summary.amount,
      rate: summary.rate != null ? Math.abs(summary.rate) : summary.rate,
      source: `${summary.source}；已按颜色语义纠偏`
    }
  }

  return summary
}

function formatSignedNumber(value, suffix = '') {
  if (value == null || Number.isNaN(value)) return '未识别'
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(2)}${suffix}`
}

export async function pickMoodImageForProfit(profit, excludeId = '', pixelSize = 12) {
  const key = profit ? 'earn' : 'lose'
  const picked = pickRandom(stockMoodGallery[key], excludeId)
  const annotated = await renderMoodImage(picked, pixelSize)
  return {
    ...picked,
    imageUrl: annotated.imageDataUrl,
    beadPalette: annotated.beadPalette,
    gridWidth: annotated.gridWidth,
    gridHeight: annotated.gridHeight,
    totalBeads: annotated.totalBeads
  }
}

export async function getMoodImageById(id, pixelSize = 12) {
  for (const items of Object.values(stockMoodGallery)) {
    const found = items.find((item) => item.id === id)
    if (found) {
      const annotated = await renderMoodImage(found, pixelSize)
      return {
        ...found,
        imageUrl: annotated.imageDataUrl,
        beadPalette: annotated.beadPalette,
        gridWidth: annotated.gridWidth,
        gridHeight: annotated.gridHeight,
        totalBeads: annotated.totalBeads
      }
    }
  }
  return null
}

export async function pickStockMoodFromUpload(file, opts = {}) {
  const pixelSize = clampPixelSize(opts.pixelSize || 12)
  const onProgress = opts.onProgress
  
  const { text, lines } = await ocrYieldScreenshot(file, onProgress)
  const normalizedText = normalizeOcrText(text)
  const normalizedLines = flattenOcrLines(lines)
  
  let amount = extractSummaryAmount(normalizedText, normalizedLines)
  let rate = extractSummaryRate(normalizedText, normalizedLines)

  // 对“盈亏分析”页做二次兜底：专门裁出顶部摘要区域重新 OCR，避免整页识别时把汇总栏漏掉。
  if (amount == null && rate == null) {
    const topRegionText = await ocrTopSummaryRegion(file, onProgress)
    const topRegionLines = topRegionText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
    amount = extractSummaryAmount(topRegionText, topRegionLines)
    rate = extractSummaryRate(topRegionText, topRegionLines)
  }

  if (onProgress) onProgress('正在分析盈亏数据...')
  const dailyRows = parseDailyPercents(normalizedText, lines)
  const dailyStats = summarizeDailyRows(dailyRows)
  const colorBias = await analyzeColorBias(file)
  const resolved = reconcileWithColorBias(
    reconcileOutcome(
      {
        ...inferStockOutcome({ amount, rate }),
        amount,
        rate,
        source: amount != null && rate != null ? '总盈亏金额 + 总盈亏率' : amount != null ? '总盈亏金额' : '总盈亏率'
      },
      dailyStats
    ),
    colorBias
  )
  
  if (onProgress) onProgress('匹配心情配图...')
  const picked = await pickMoodImageForProfit(resolved.profit, '', pixelSize)

  return {
    imageUrl: picked.imageUrl,
    memeId: picked.id,
    memeTitle: picked.title,
    beadPalette: picked.beadPalette,
    gridWidth: picked.gridWidth,
    gridHeight: picked.gridHeight,
    totalBeads: picked.totalBeads,
    profit: resolved.profit,
    verdict: resolved.verdict,
    amount: resolved.amount,
    rate: resolved.rate,
    source: resolved.source,
    folder: resolved.profit ? 'earn' : 'lose',
    dailyStats,
    colorBias,
    ocrPreview: normalizedText.slice(0, 2500)
  }
}


export { stockMoodGallery, formatSignedNumber }
