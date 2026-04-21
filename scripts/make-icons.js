/**
 * Generates a 256x256 ICO file (purple square) so electron-builder
 * has a valid icon without requiring extra packages or a Mac.
 * Replace public/icon.ico with real artwork before shipping.
 */
const zlib = require('zlib')
const fs   = require('fs')
const path = require('path')

const ICO_PATH = path.join(__dirname, '..', 'public', 'icon.ico')

if (fs.existsSync(ICO_PATH)) {
  console.log('public/icon.ico already exists, skipping.')
  return
}

// ── Minimal PNG encoder (pure Node.js, no deps) ───────────────────────────────
function crc32(buf) {
  let crc = 0xffffffff
  for (const byte of buf) {
    crc ^= byte
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii')
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])))
  return Buffer.concat([len, typeBytes, data, crcBuf])
}

function makePNG(size, r, g, b) {
  const sig  = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

  const ihdrData = Buffer.alloc(13)
  ihdrData.writeUInt32BE(size, 0)   // width
  ihdrData.writeUInt32BE(size, 4)   // height
  ihdrData[8]  = 8  // bit depth
  ihdrData[9]  = 2  // color type: RGB
  // compression, filter, interlace all 0

  // Raw scanlines: filter_byte(0) + RGB per pixel
  const row = Buffer.alloc(1 + size * 3)
  row[0] = 0 // filter: None
  for (let x = 0; x < size; x++) {
    row[1 + x * 3]     = r
    row[1 + x * 3 + 1] = g
    row[1 + x * 3 + 2] = b
  }
  const raw = Buffer.concat(Array(size).fill(row))

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdrData),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ── Wrap PNG in ICO (PNG-in-ICO, supported for 256×256) ──────────────────────
function makeICO(pngBuf) {
  // ICO header: reserved(2) + type(2=1) + count(2=1)
  const header = Buffer.from([0x00, 0x00, 0x01, 0x00, 0x01, 0x00])

  const dataOffset = 6 + 16 // header + one directory entry
  const dir = Buffer.alloc(16)
  dir[0] = 0          // width  0 = 256
  dir[1] = 0          // height 0 = 256
  dir[2] = 0          // color count
  dir[3] = 0          // reserved
  dir.writeUInt16LE(1,  4)              // planes
  dir.writeUInt16LE(32, 6)             // bit count
  dir.writeUInt32LE(pngBuf.length, 8) // size of image data
  dir.writeUInt32LE(dataOffset, 12)   // offset to image data

  return Buffer.concat([header, dir, pngBuf])
}

// Hearth purple: #7c3aed → rgb(124, 58, 237)
const png = makePNG(256, 124, 58, 237)
const ico = makeICO(png)

fs.writeFileSync(ICO_PATH, ico)
console.log(`Created public/icon.ico (256×256 purple — replace with real artwork before shipping)`)
