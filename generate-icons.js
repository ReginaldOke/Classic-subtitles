// Generate simple PNG icons for the Chrome extension
// Run: node generate-icons.js
// Requires no dependencies - creates minimal valid PNG files

function createPNG(size) {
  // Create an uncompressed PNG with a gold "ES" icon
  // For simplicity, we create a solid gold square with basic pixel art

  const width = size;
  const height = size;

  // PNG signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 2; // color type: RGB
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace

  const ihdr = createChunk('IHDR', ihdrData);

  // Create image data
  const rawData = Buffer.alloc(height * (1 + width * 3)); // filter byte + RGB per pixel

  const gold = [255, 215, 0];
  const darkBg = [26, 26, 46];
  const black = [0, 0, 0];

  // Fill with dark background and gold rounded-ish square
  const margin = Math.max(1, Math.floor(size * 0.1));
  const cornerR = Math.max(1, Math.floor(size * 0.15));

  for (let y = 0; y < height; y++) {
    const rowOffset = y * (1 + width * 3);
    rawData[rowOffset] = 0; // No filter

    for (let x = 0; x < width; x++) {
      const px = rowOffset + 1 + x * 3;

      // Check if inside rounded rect
      const inRect = isInsideRoundedRect(x, y, margin, margin, width - margin * 2, height - margin * 2, cornerR);

      let color = darkBg;
      if (inRect) {
        color = gold;

        // Draw "ES" letters for sizes >= 32
        if (size >= 32 && isInLetters(x, y, size)) {
          color = darkBg;
        }
      }

      rawData[px] = color[0];
      rawData[px + 1] = color[1];
      rawData[px + 2] = color[2];
    }
  }

  // Compress with zlib (deflate)
  const zlib = require('zlib');
  const compressed = zlib.deflateSync(rawData);

  const idat = createChunk('IDAT', compressed);

  // IEND chunk
  const iend = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdr, idat, iend]);
}

function isInsideRoundedRect(px, py, x, y, w, h, r) {
  if (px < x || px >= x + w || py < y || py >= y + h) return false;

  // Check corners
  const corners = [
    [x + r, y + r],
    [x + w - r, y + r],
    [x + r, y + h - r],
    [x + w - r, y + h - r],
  ];

  for (const [cx, cy] of corners) {
    if (
      (px < x + r || px >= x + w - r) &&
      (py < y + r || py >= y + h - r)
    ) {
      const dx = px - cx;
      const dy = py - cy;
      if (dx * dx + dy * dy > r * r) return false;
    }
  }

  return true;
}

function isInLetters(px, py, size) {
  // Normalize coordinates to 0-1 range
  const nx = px / size;
  const ny = py / size;

  // "E" letter (left side)
  const eLeft = 0.2, eRight = 0.47;
  const eTop = 0.28, eBottom = 0.72;
  const strokeW = size >= 48 ? 0.08 : 0.1;
  const midY = (eTop + eBottom) / 2;

  // E: vertical bar
  if (nx >= eLeft && nx <= eLeft + strokeW && ny >= eTop && ny <= eBottom) return true;
  // E: top bar
  if (nx >= eLeft && nx <= eRight && ny >= eTop && ny <= eTop + strokeW) return true;
  // E: middle bar
  if (nx >= eLeft && nx <= eRight - 0.03 && ny >= midY - strokeW / 2 && ny <= midY + strokeW / 2) return true;
  // E: bottom bar
  if (nx >= eLeft && nx <= eRight && ny >= eBottom - strokeW && ny <= eBottom) return true;

  // "S" letter (right side) - simplified blocky S
  const sLeft = 0.53, sRight = 0.8;
  const sTop = 0.28, sBottom = 0.72;

  // S: top bar
  if (nx >= sLeft && nx <= sRight && ny >= sTop && ny <= sTop + strokeW) return true;
  // S: left upper bar
  if (nx >= sLeft && nx <= sLeft + strokeW && ny >= sTop && ny <= midY + strokeW / 2) return true;
  // S: middle bar
  if (nx >= sLeft && nx <= sRight && ny >= midY - strokeW / 2 && ny <= midY + strokeW / 2) return true;
  // S: right lower bar
  if (nx >= sRight - strokeW && nx <= sRight && ny >= midY - strokeW / 2 && ny <= sBottom) return true;
  // S: bottom bar
  if (nx >= sLeft && nx <= sRight && ny >= sBottom - strokeW && ny <= sBottom) return true;

  return false;
}

function createChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);

  const typeBuffer = Buffer.from(type, 'ascii');
  const crcInput = Buffer.concat([typeBuffer, data]);

  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcInput));

  return Buffer.concat([length, typeBuffer, data, crc]);
}

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// Generate icons
const fs = require('fs');
const path = require('path');

const sizes = [16, 48, 128];
const outDir = path.join(__dirname, 'icons');

for (const size of sizes) {
  const png = createPNG(size);
  const filePath = path.join(outDir, `icon${size}.png`);
  fs.writeFileSync(filePath, png);
  console.log(`Generated ${filePath} (${png.length} bytes)`);
}

console.log('Done!');
