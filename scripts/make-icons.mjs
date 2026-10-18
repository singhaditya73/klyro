#!/usr/bin/env node
/**
 * Generate Klyro's application icons from the OFFICIAL brand assets.
 *
 * Run: npm run icons   (or: node scripts/make-icons.mjs)
 *
 * Outputs:
 *   build/icon.png           1024px tile (electron-builder Linux: .desktop + rpm icon)
 *   build/icon-256.png       256px convenience copy
 *   build/icon.ico           16..256 px entries (Windows NSIS + generic)
 *   src/main/assets.ts       regenerated: inlined 32px tray/window data URL
 *
 * Single source of truth: src/renderer/src/assets/logo/klyro-mark.svg.
 * The artwork is the official mark centered on a graphite rounded tile —
 * matching the shipped graphite/charcoal UI. Placeholder K-glyph on a
 * blue-violet gradient is gone on purpose: it is not the brand.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { Resvg } from '@resvg/resvg-js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BUILD = path.join(ROOT, 'build')
const MARK = path.join(ROOT, 'src', 'renderer', 'src', 'assets', 'logo', 'klyro-mark.svg')

const TILE = '#191919' // graphite — matches --app-background in styles.css
const MARK_FILL = '#E0E1DE' // official warm off-white mark fill, untouched
const MARK_SCALE = 0.78 // inset so the mark reads cleanly at small sizes
const RADIUS = 0.22 * 64 // matches the old rounded-tile geometry

/** Tile + official mark, in a 64x64 viewBox. */
function artwork() {
  const inset = 64 * (1 - MARK_SCALE) / 2
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="${RADIUS}" fill="${TILE}"/>
  <g transform="translate(${inset} ${inset}) scale(${MARK_SCALE})">
    ${readFileSync(MARK, 'utf8')
      .replace(/<\?xml[^>]*\?>/g, '')
      .replace(/<svg[\s\S]*?>/, '')
      .replace(/<\/svg>/, '')
      .trim()}
  </g>
</svg>`
}

function renderPng(svg, size) {
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: size } })
  return resvg.render().asPng()
}

/** Minimal ICO writer: PNG-embedded entries (valid for Windows Vista+/Linux). */
function writeIcoFile(entries) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(entries.length, 4)
  const dirSize = 16 * entries.length
  let offset = header.length + dirSize
  const dirs = []
  const blobs = []
  for (const { size, png } of entries) {
    const e = Buffer.alloc(16)
    e.writeUInt8(size === 256 ? 0 : size, 0)
    e.writeUInt8(size === 256 ? 0 : size, 1)
    toBytesLE(e, 4, 1, 2)
    toBytesLE(e, 6, 32, 2)
    toBytesLE(e, 8, png.length, 4)
    toBytesLE(e, 12, offset, 4)
    dirs.push(e)
    blobs.push(png)
    offset += png.length
  }
  return Buffer.concat([header, ...dirs, ...blobs])
}

function toBytesLE(buf, offset, value, len) {
  for (let i = 0; i < len; i++) buf[offset + i] = (value >>> (8 * i)) & 0xff
}

const svg = artwork()
const sizes = [16, 32, 48, 64, 128, 256]
const pngs = new Map(sizes.map((s) => [s, renderPng(svg, s)]))

writeFileSync(path.join(BUILD, 'icon.png'), renderPng(svg, 1024))
writeFileSync(path.join(BUILD, 'icon-256.png'), pngs.get(256))
writeFileSync(
  path.join(BUILD, 'icon.ico'),
  writeIcoFile(sizes.map((s) => ({ size: s, png: pngs.get(s) })))
)

// Regenerate the inlined 32px tray/window icon so the tray matches the brand.
const icon32 = pngs.get(32).toString('base64')
const assetsTs = `/** Inline app/tray icon (32x32 PNG) so the tray renders without external files.
 * Regenerated from the official klyro-mark asset; do not hand-edit.
 * Run \`npm run icons\` after changing the SVG. */
export const KLYRO_ICON_DATA_URL =
  'data:image/png;base64,${icon32}'
`
writeFileSync(path.join(ROOT, 'src', 'main', 'assets.ts'), assetsTs)

console.log(`wrote build/icon.png (1024), build/icon-256.png, build/icon.ico (${sizes.join(',')}), src/main/assets.ts (32px)`)
