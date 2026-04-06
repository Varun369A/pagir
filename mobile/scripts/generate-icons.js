/**
 * PAGIR 2 — App Icon Generator
 * Generates all required Android mipmap PNG icons programmatically.
 * Design: Dark #0A0F1E bg, PAGIR "P2" mark in gradient violet-teal, signal wave arc
 */

const { createCanvas } = require('canvas')
const fs = require('fs')
const path = require('path')

const SIZES = {
  'mipmap-mdpi':    48,
  'mipmap-hdpi':    72,
  'mipmap-xhdpi':   96,
  'mipmap-xxhdpi':  144,
  'mipmap-xxxhdpi': 192,
}

const RES_DIR = path.join(__dirname, '../android/app/src/main/res')

function drawIcon(canvas, size, round) {
  const ctx = canvas.getContext('2d')
  const cx = size / 2
  const cy = size / 2
  const r  = size / 2

  // ─── Background ───────────────────────────────────────────────────────────
  if (round) {
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.clip()
  } else {
    // Rounded rect background (20% corner radius)
    const rr = size * 0.20
    roundRect(ctx, 0, 0, size, size, rr)
    ctx.clip()
  }

  // Deep dark gradient background
  const bg = ctx.createLinearGradient(0, 0, size, size)
  bg.addColorStop(0,   '#050A14')
  bg.addColorStop(0.5, '#0A0F1E')
  bg.addColorStop(1,   '#0D1626')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, size, size)

  // Subtle radial glow from center
  const glow = ctx.createRadialGradient(cx, cy * 0.85, 0, cx, cy, size * 0.55)
  glow.addColorStop(0,   'rgba(120, 80, 255, 0.18)')
  glow.addColorStop(0.5, 'rgba(60, 160, 255, 0.08)')
  glow.addColorStop(1,   'rgba(0, 0, 0, 0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, size, size)

  // ─── Signal Wave Arcs (TARANG — wave symbol) ──────────────────────────────
  const waveAlpha = [0.15, 0.25, 0.40]
  const waveRadii = [size * 0.42, size * 0.32, size * 0.22]

  for (let i = 0; i < 3; i++) {
    const wr = waveRadii[i]
    ctx.beginPath()
    ctx.arc(cx, cy + size * 0.06, wr, Math.PI * 1.10, Math.PI * 1.90, false)
    ctx.strokeStyle = `rgba(110, 200, 255, ${waveAlpha[i]})`
    ctx.lineWidth = size * 0.022
    ctx.lineCap = 'round'
    ctx.stroke()
  }

  // ─── "P" lettermark ───────────────────────────────────────────────────────
  const fontSize = size * 0.44
  ctx.font = `900 ${fontSize}px Arial, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  // Text gradient: violet → electric blue
  const tg = ctx.createLinearGradient(cx - fontSize * 0.3, 0, cx + fontSize * 0.3, size)
  tg.addColorStop(0,   '#B060FF')
  tg.addColorStop(0.5, '#7B8FFF')
  tg.addColorStop(1,   '#20D0FF')
  ctx.fillStyle = tg

  // Subtle text shadow for depth
  ctx.shadowColor   = 'rgba(100, 80, 255, 0.6)'
  ctx.shadowBlur    = size * 0.08
  ctx.shadowOffsetX = 0
  ctx.shadowOffsetY = size * 0.02

  ctx.fillText('P', cx - size * 0.08, cy - size * 0.02)

  // ─── "2" superscript ─────────────────────────────────────────────────────
  ctx.shadowBlur = size * 0.04
  const subSize = fontSize * 0.42
  ctx.font = `700 ${subSize}px Arial, sans-serif`
  ctx.textBaseline = 'middle'
  const subGrad = ctx.createLinearGradient(0, 0, size, size)
  subGrad.addColorStop(0, '#40E0FF')
  subGrad.addColorStop(1, '#20B8FF')
  ctx.fillStyle = subGrad
  ctx.fillText('2', cx + fontSize * 0.32, cy - size * 0.14)

  // ─── Bottom dot (signal indicator) ───────────────────────────────────────
  ctx.shadowBlur    = size * 0.05
  ctx.shadowColor   = 'rgba(50, 220, 255, 0.9)'
  const dotR = size * 0.035
  ctx.beginPath()
  ctx.arc(cx, cy + size * 0.32, dotR, 0, Math.PI * 2)
  const dg = ctx.createRadialGradient(cx, cy + size * 0.32, 0, cx, cy + size * 0.32, dotR * 2)
  dg.addColorStop(0, '#60FFFF')
  dg.addColorStop(1, '#20D0FF')
  ctx.fillStyle = dg
  ctx.fill()

  ctx.shadowBlur    = 0
  ctx.shadowOffsetX = 0
  ctx.shadowOffsetY = 0
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

let generated = 0

for (const [folder, size] of Object.entries(SIZES)) {
  const dir = path.join(RES_DIR, folder)
  fs.mkdirSync(dir, { recursive: true })

  // ic_launcher.png (square with rounded corners)
  const canvas1 = createCanvas(size, size)
  drawIcon(canvas1, size, false)
  const buf1 = canvas1.toBuffer('image/png')
  fs.writeFileSync(path.join(dir, 'ic_launcher.png'), buf1)

  // ic_launcher_round.png (circular clip)
  const canvas2 = createCanvas(size, size)
  drawIcon(canvas2, size, true)
  const buf2 = canvas2.toBuffer('image/png')
  fs.writeFileSync(path.join(dir, 'ic_launcher_round.png'), buf2)

  console.log(`✓ ${folder}  ${size}x${size}`)
  generated += 2
}

console.log(`\n✓ Generated ${generated} icon files`)
