import sharp from 'sharp'
import { readdirSync } from 'node:fs'
import { join, basename } from 'node:path'

const dir = new URL('.', import.meta.url).pathname
const svgs = readdirSync(dir).filter((f) => f.endsWith('.svg'))

// one legibility sheet per concept: 512, 96, 48, 24 px side by side
const SIZES = [512, 96, 48, 24]
const PAD = 24

for (const svg of svgs) {
  const base = basename(svg, '.svg')
  const rendered = await Promise.all(
    SIZES.map((s) => sharp(join(dir, svg), { density: 300 }).resize(s, s).png().toBuffer())
  )
  const width = SIZES.reduce((a, b) => a + b, 0) + PAD * (SIZES.length + 1)
  const height = 512 + PAD * 2
  await sharp({
    create: { width, height, channels: 4, background: '#3c4456' },
  })
    .composite(rendered.map((input, i) => ({
      input,
      left: PAD + SIZES.slice(0, i).reduce((a, b) => a + b, 0) + PAD * i,
      top: PAD,
    })))
    .png()
    .toFile(join(dir, `${base}-sheet.png`))
  console.log(`done: ${base}`)
}
