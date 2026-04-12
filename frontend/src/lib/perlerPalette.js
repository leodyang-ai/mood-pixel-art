import colorSystemMapping from '../../../backend/resouce/perler-beads-master/src/app/colorSystemMapping.json'
import { findClosestPaletteColor, hexToRgb } from './perlerPixelation.js'

/** @typedef {'MARD'|'COCO'|'漫漫'|'盼盼'|'咪小窝'} ColorSystem */

/**
 * @param {Record<string, Record<string, string>>} mapping
 * @param {string} colorSystem
 */
export function buildPaletteColors(mapping, colorSystem) {
  const out = []
  for (const [hex, row] of Object.entries(mapping)) {
    const key = row[colorSystem]
    if (key == null || key === '' || key === '-') continue
    const rgb = hexToRgb(hex)
    if (!rgb) continue
    out.push({
      key,
      hex: hex.toUpperCase(),
      rgb,
      row
    })
  }
  return out
}

export function getBrandKeyForHex(hex, colorSystem) {
  const h = hex.toUpperCase()
  const row = colorSystemMapping[h]
  if (!row) return '?'
  return row[colorSystem] ?? '?'
}

export function getNearestBrandKeyForHex(hex, colorSystem = 'MARD') {
  const h = hex.toUpperCase()
  const direct = getBrandKeyForHex(h, colorSystem)
  if (direct && direct !== '?') return direct
  const rgb = hexToRgb(h)
  if (!rgb) return '?'
  const palette = buildPaletteColors(colorSystemMapping, colorSystem)
  if (!palette.length) return '?'
  return findClosestPaletteColor(rgb, palette)?.key ?? '?'
}

export { colorSystemMapping }
