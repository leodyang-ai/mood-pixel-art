import { createWorker } from 'tesseract.js'

/**
 * 将收益率映射为 RGB：正红、负绿；|pct| 相对当月最大绝对值越大越深。
 */
export function pctToRgb(pct, maxAbs) {
  const safe = Math.max(maxAbs, 1e-9)
  const t = Math.min(1, Math.abs(pct) / safe)
  const light = Math.round(210 * (1 - t))
  if (pct > 0) {
    return { r: 255, g: light, b: light }
  }
  if (pct < 0) {
    return { r: light, g: 255, b: light }
  }
  return { r: 160, g: 160, b: 160 }
}

function rgbToHex(r, g, b) {
  return (
    '#' +
    [r, g, b]
      .map((x) =>
        Math.max(0, Math.min(255, x))
          .toString(16)
          .padStart(2, '0')
      )
      .join('')
  )
}

/** 全角数字、符号归一化，便于正则匹配 */
export function normalizeOcrText(s) {
  return s
    .replace(/％/g, '%')
    .replace(/：/g, ':')
    .replace(/,/g, '.')
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xff10 + 0x30))
    .replace(/＋/g, '+')
    .replace(/－|−/g, '-')
}

/**
 * 从截图文字中推断「年、月」（用于交易日对齐与「今」→ 末日）。
 */
export function inferYearMonth(ocrText) {
  const t = normalizeOcrText(ocrText)
  const m1 = t.match(/(20\d{2})\s*年\s*(\d{1,2})\s*月/)
  if (m1) {
    return { year: parseInt(m1[1], 10), month: parseInt(m1[2], 10) }
  }
  const m2 = t.match(/(\d{1,2})\s*月\s*\d{4}\s*年/)
  if (m2) {
    const month = parseInt(m2[1], 10)
    const y = new Date().getFullYear()
    return { year: y, month }
  }
  const m3 = t.match(/(\d{4})[.\-/年](\d{1,2})/)
  if (m3) {
    return { year: parseInt(m3[1], 10), month: parseInt(m3[2], 10) }
  }
  const m4 = t.match(/(?:^|[^\d/])(\d{1,2})\s*月(?!\s*日)/)
  if (m4) {
    const month = parseInt(m4[1], 10)
    if (month >= 1 && month <= 12) {
      return { year: new Date().getFullYear(), month }
    }
  }
  return null
}

/** 当月最后一天（1–12） */
function lastDayOfMonth(year, month) {
  return new Date(year, month, 0).getDate()
}

/**
 * 粗略「仅剔除周六日」的交易日序号（与常见 App 日历一致；不含法定节假日）。
 */
export function weekendOffDayNumbers(year, month) {
  const last = lastDayOfMonth(year, month)
  const out = []
  for (let d = 1; d <= last; d++) {
    const w = new Date(year, month - 1, d).getDay()
    if (w !== 0 && w !== 6) out.push(d)
  }
  return out
}

function isSummaryOrIndexLine(lineText) {
  const t = lineText.replace(/\s/g, '')
  if (!t) return true
  if (/上证|深证|创业板|沪深|中证|道琼斯|纳斯达克|恒生/.test(t)) return true
  if (/跑赢大盘|跑赢|资产分析|同花顺|累计收益|月收益|年收益/.test(t) && !/日收益/.test(t)) return true
  if (/^\d{4}年\d{1,2}月$/.test(t)) return false
  return false
}

/**
 * 从「按阅读顺序」的文本里抽出百分数（带行过滤，减少页眉/脚注干扰）。
 */
function extractPercentsInLineOrder(lines) {
  const out = []
  const re = /([+\-]?\s*\d+(?:\.\d+)?)\s*%/g
  for (const line of lines) {
    const raw = line.text || ''
    if (isSummaryOrIndexLine(raw)) continue
    const t = normalizeOcrText(raw)
    let m
    re.lastIndex = 0
    while ((m = re.exec(t)) !== null) {
      let v = parseFloat(m[1].replace(/\s/g, ''))
      if (Number.isNaN(v)) continue
      if (v > 100 || v < -100) continue
      out.push(v)
    }
  }
  return out
}

/**
 * 单日收益率用于上色的稳健上限：避免把「9.87% 月跑赢」误读成「87%」导致整月颜色发灰。
 */
function robustMaxAbs(pcts) {
  const abs = pcts.map((p) => Math.abs(p)).filter((x) => x <= 100 && x > 0)
  if (abs.length === 0) return 1e-9
  abs.sort((a, b) => a - b)
  const hi = abs[abs.length - 1]
  const second = abs.length > 1 ? abs[abs.length - 2] : hi
  if (hi > 45 && second < 18 && hi / Math.max(second, 1e-6) > 2.5) {
    return Math.max(second, 1e-6)
  }
  return hi
}

/**
 * 从 OCR 全文与行结构解析为「日 → 收益率」Map（含「今」→ -1 占位）。
 */
function parseDailyPercentsToMap(ocrText, lines) {
  const t = normalizeOcrText(ocrText)

  const byDay = new Map()

  // 主规则：日与收益率之间允许跨行（日历常见）
  const rePair = /(?:^|[^\d])(\d{1,2})[\s\S]{0,64}?([+\-]?\s*\d+(?:\.\d+)?)\s*%/gm
  let m
  while ((m = rePair.exec(t)) !== null) {
    const day = parseInt(m[1], 10)
    const pct = parseFloat(m[2].replace(/\s/g, ''))
    if (day < 1 || day > 31 || Number.isNaN(pct)) continue
    if (pct > 100 || pct < -100) continue
    byDay.set(day, pct)
  }

  const lineArr = Array.isArray(lines) ? lines : t.split(/\r?\n/).map((x) => ({ text: x }))

  for (let i = 0; i < lineArr.length - 1; i++) {
    const a = (lineArr[i].text || '').trim()
    const b = (lineArr[i + 1].text || '').trim()
    const dm = /^(\d{1,2})$/.exec(normalizeOcrText(a))
    const pm = /^([+\-]?\s*\d+(?:\.\d+)?)\s*%$/.exec(normalizeOcrText(b))
    if (dm && pm) {
      const day = parseInt(dm[1], 10)
      const pct = parseFloat(pm[1].replace(/\s/g, ''))
      if (day >= 1 && day <= 31 && !Number.isNaN(pct) && pct >= -100 && pct <= 100) {
        byDay.set(day, pct)
      }
    }
    const jin = /^今/.exec(normalizeOcrText(a))
    const pm2 = /^([+\-]?\s*\d+(?:\.\d+)?)\s*%$/.exec(normalizeOcrText(b))
    if (jin && pm2) {
      const pct = parseFloat(pm2[1].replace(/\s/g, ''))
      if (!Number.isNaN(pct) && pct >= -100 && pct <= 100) {
        byDay.set(-1, pct)
      }
    }
  }

  // 同行：02 +8.15% / 02 8.15%
  const reSame = /(\d{1,2})\s*([+\-]?\s*\d+(?:\.\d+)?)\s*%/g
  while ((m = reSame.exec(t)) !== null) {
    const day = parseInt(m[1], 10)
    const pct = parseFloat(m[2].replace(/\s/g, ''))
    if (day >= 1 && day <= 31 && !Number.isNaN(pct) && pct >= -100 && pct <= 100) {
      byDay.set(day, pct)
    }
  }

  const reRev = /([+\-]?\s*\d+(?:\.\d+)?)\s*%\D{0,16}?(\d{1,2})(?:\D|$)/gm
  while ((m = reRev.exec(t)) !== null) {
    const pct = parseFloat(m[1].replace(/\s/g, ''))
    const day = parseInt(m[2], 10)
    if (day >= 1 && day <= 31 && !Number.isNaN(pct) && pct >= -100 && pct <= 100) {
      if (!byDay.has(day)) byDay.set(day, pct)
    }
  }

  return { byDay, hadJin: byDay.has(-1) }
}

/**
 * 从 OCR 全文解析「日 + 收益率」列表（不含「今」解析，供调试）。
 */
export function parseDailyPercents(ocrText, lines) {
  const { byDay } = parseDailyPercentsToMap(ocrText, lines)
  if (byDay.size === 0) return []
  return Array.from(byDay.entries())
    .filter(([day]) => day >= 1 && day <= 31)
    .sort((a, b) => a[0] - b[0])
    .map(([day, pct]) => ({ day, pct }))
}

/**
 * 将「今」映射到月末日；合并 Map。
 */
function applyJinAndYear(byDay, hadJin, year, month) {
  const last = lastDayOfMonth(year, month)
  if (hadJin && byDay.has(-1)) {
    const v = byDay.get(-1)
    byDay.delete(-1)
    byDay.set(last, v)
  }
  return last
}

/**
 * 有序百分比与「仅周末」交易日对齐（当按日解析过少时）。
 * 在全部百分比序列上滑动窗口，选与已有「日→收益率」最一致的一段。
 */
function alignOrderedPercentsToCalendar(byDay, orderedPcts, year, month) {
  const trading = weekendOffDayNumbers(year, month)
  if (trading.length === 0 || orderedPcts.length < 10) return

  if (byDay.size >= Math.min(trading.length, 18)) return

  const n = trading.length
  if (orderedPcts.length < n) return

  let bestSkip = 0
  let bestScore = -Infinity
  for (let skip = 0; skip <= orderedPcts.length - n; skip++) {
    let score = 0
    for (let i = 0; i < n; i++) {
      const d = trading[i]
      const p = orderedPcts[skip + i]
      if (byDay.has(d)) {
        const diff = Math.abs(byDay.get(d) - p)
        if (diff < 0.15) score += 4
        else if (diff < 0.8) score += 1
        else score -= 2
      } else {
        score += 0.05
      }
    }
    if (score > bestScore) {
      bestScore = score
      bestSkip = skip
    }
  }

  const slice = orderedPcts.slice(bestSkip, bestSkip + n)
  for (let i = 0; i < n; i++) {
    const d = trading[i]
    if (!byDay.has(d)) {
      byDay.set(d, slice[i])
    }
  }
}

function renderSquareGrid(items, cellPx) {
  const n = items.length
  const cols = Math.ceil(Math.sqrt(n))
  const rows = Math.ceil(n / cols)
  const cell = Math.max(cellPx, Math.floor(520 / Math.max(cols, rows, 1)))

  const canvas = document.createElement('canvas')
  canvas.width = cols * cell
  canvas.height = rows * cell
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 不可用')

  ctx.fillStyle = '#1a1d24'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  let idx = 0
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (idx >= n) break
      const it = items[idx++]
      ctx.fillStyle = it.hex
      ctx.fillRect(c * cell, r * cell, cell, cell)
      ctx.strokeStyle = 'rgba(0,0,0,0.35)'
      ctx.lineWidth = 1
      ctx.strokeRect(c * cell, r * cell, cell, cell)
    }
  }

  return {
    dataUrl: canvas.toDataURL('image/png'),
    cols,
    rows,
    cellPx: cell
  }
}

/**
 * 放大截图（保留彩色，避免灰度化削弱红/蓝底上的白字对比）。
 */
async function imageFileToEnhancedCanvas(file) {
  const bmp = await createImageBitmap(file)
  const scale = Math.max(2400 / Math.max(bmp.width, bmp.height), 2.4)
  const w = Math.round(bmp.width * scale)
  const h = Math.round(bmp.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 不可用')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bmp, 0, 0, w, h)
  return canvas
}

async function runOcrPasses(canvas, onProgress) {
  if (onProgress) onProgress('正在加载模型资源...')
  const worker = await createWorker('chi_sim+eng', undefined, {
    logger: (m) => {
      if (onProgress && m.status === 'recognizing text') {
        const pct = Math.round(m.progress * 100)
        onProgress(`识别文字中 (${pct}%)`)
      }
    }
  })

  // 优化：仅使用 PSM 3 (全量自动分页) 扫描一次。对于大多数标准的盈亏截图，这已经足够。
  // PSM 11 或 6 的二次扫描虽然能提高非标布局的召回，但在前端执行过于沉重。
  await worker.setParameters({
    tessedit_pageseg_mode: '3',
    user_defined_dpi: '300'
  })

  if (onProgress) onProgress('启动文字识别...')
  const {
    data: { text, lines }
  } = await worker.recognize(canvas)

  await worker.terminate()

  const lineMap = new Map()
  const cleanLines = (lines || [])
  for (const ln of cleanLines) {
    const yb = Math.round((ln.bbox?.y0 ?? 0) / 14)
    const key = `${yb}:${(ln.text || '').trim().slice(0, 48)}`
    if (!lineMap.has(key)) lineMap.set(key, ln)
  }
  
  const mergedLines = Array.from(lineMap.values()).sort((a, b) => {
    const dy = (a.bbox?.y0 ?? 0) - (b.bbox?.y0 ?? 0)
    if (Math.abs(dy) > 8) return dy
    return (a.bbox?.x0 ?? 0) - (b.bbox?.x0 ?? 0)
  })

  return { text: text || '', lines: mergedLines }
}

/** 仅 OCR（放大 + 单 PSM），供股票配图等复用 */
export async function ocrYieldScreenshot(file, onProgress) {
  if (onProgress) onProgress('正在解析图像...')
  const canvas = await imageFileToEnhancedCanvas(file)
  return runOcrPasses(canvas, onProgress)
}

/**
 * @param {File} file
 * @param {{ cellPx?: number }} [opts]
 */
export async function buildYieldHeatmap(file, opts = {}) {
  const canvas = await imageFileToEnhancedCanvas(file)
  const { text, lines } = await runOcrPasses(canvas)
  return buildYieldHeatmapFromOcr(text, lines, opts)
}

export async function buildYieldHeatmapFromOcr(text, lines, opts = {}) {
  const cellPx = opts.cellPx ?? 0

  const ym = inferYearMonth(text) || {
    year: new Date().getFullYear(),
    month: new Date().getMonth() + 1
  }
  const { byDay, hadJin } = parseDailyPercentsToMap(text, lines)
  const lastDay = applyJinAndYear(byDay, hadJin, ym.year, ym.month)

  const ordered = extractPercentsInLineOrder(lines.length ? lines : text.split('\n').map((t) => ({ text: t })))
  alignOrderedPercentsToCalendar(byDay, ordered, ym.year, ym.month)

  if (byDay.size === 0) {
    throw new Error(
      '未能识别到「日期 + 收益率%」。请使用清晰截图，或包含类似 02 +8.15% / 03 -4.87% 的文字排版。'
    )
  }

  const days = Array.from(byDay.entries())
    .filter(([day]) => day >= 1 && day <= lastDay)
    .sort((a, b) => a[0] - b[0])
    .map(([day, pct]) => ({ day, pct }))

  const maxAbs = robustMaxAbs(days.map((d) => d.pct))

  const colored = days.map((d) => {
    const { r, g, b } = pctToRgb(d.pct, maxAbs)
    const hex = rgbToHex(r, g, b)
    return { ...d, r, g, b, hex }
  })

  const grid = renderSquareGrid(colored, cellPx || 0)

  return {
    dataUrl: grid.dataUrl,
    cols: grid.cols,
    rows: grid.rows,
    cellPx: grid.cellPx,
    maxAbs,
    items: colored,
    ocrPreview: text.slice(0, 2500)
  }
}
