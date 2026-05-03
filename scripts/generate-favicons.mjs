// Generates favicon PNG files from favicon.svg using sharp
import sharp from 'sharp'
import pngToIco from 'png-to-ico'
import { readFileSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const svgPath = join(__dirname, '..', 'src', 'public', 'favicon.svg')
const outDir = join(__dirname, '..', 'src', 'public')
const svgBuffer = readFileSync(svgPath)

const sizes = [16, 32, 48, 192, 512]

for (const size of sizes) {
  const out = join(outDir, `favicon-${size}.png`)
  await sharp(svgBuffer)
    .resize(size, size)
    .png()
    .toFile(out)
  console.log(`✓ favicon-${size}.png`)
}

// Also generate apple-touch-icon (180x180)
await sharp(svgBuffer)
  .resize(180, 180)
  .png()
  .toFile(join(outDir, 'apple-touch-icon.png'))
console.log('✓ apple-touch-icon.png')

// Generate favicon.ico (multi-size: 16, 32, 48)
const icoBuffer = await pngToIco([
  join(outDir, 'favicon-16.png'),
  join(outDir, 'favicon-32.png'),
  join(outDir, 'favicon-48.png'),
])
writeFileSync(join(outDir, 'favicon.ico'), icoBuffer)
console.log('✓ favicon.ico')

console.log('Done.')
