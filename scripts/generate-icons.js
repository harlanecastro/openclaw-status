const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const assetsDir = path.join(__dirname, '..', 'assets');
if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });

function createSvg(variant) {
  const colors = {
    red:    { gradStart: '#FF6B4A', gradEnd: '#E74C3C', bgDeep: '#1a1a2e', cyan: '#00D4FF', antenna: '#FF6B4A' },
    gray:   { gradStart: '#888888', gradEnd: '#666666', bgDeep: '#444444', cyan: '#999999', antenna: '#aaaaaa' },
    orange: { gradStart: '#FF9500', gradEnd: '#FF7B00', bgDeep: '#1a1a2e', cyan: '#00D4FF', antenna: '#FF9500' }
  };
  const c = colors[variant] || colors.red;

  const gradStart = c.gradStart;
  const gradEnd   = c.gradEnd;
  const bgDeep    = c.bgDeep;
  const cyan      = c.cyan;
  const antenna   = c.antenna;

  return `<svg viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="lobster-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${gradStart}"/>
      <stop offset="100%" stop-color="${gradEnd}"/>
    </linearGradient>
  </defs>
  <!-- Body -->
  <path d="M60 10 C30 10 15 35 15 55 C15 75 30 95 45 100 L45 110 L55 110 L55 100 C55 100 60 102 65 100 L65 110 L75 110 L75 100 C90 95 105 75 105 55 C105 35 90 10 60 10Z" fill="url(#lobster-gradient)"/>
  <!-- Left Claw -->
  <path d="M20 45 C5 40 0 50 5 60 C10 70 20 65 25 55 C28 48 25 45 20 45Z" fill="url(#lobster-gradient)"/>
  <!-- Right Claw -->
  <path d="M100 45 C115 40 120 50 115 60 C110 70 100 65 95 55 C92 48 95 45 100 45Z" fill="url(#lobster-gradient)"/>
  <!-- Antenna -->
  <path d="M45 15 Q35 5 30 8" stroke="${antenna}" stroke-width="2" stroke-linecap="round"/>
  <path d="M75 15 Q85 5 90 8" stroke="${antenna}" stroke-width="2" stroke-linecap="round"/>
  <!-- Eyes -->
  <circle cx="45" cy="35" r="6" fill="${bgDeep}"/>
  <circle cx="75" cy="35" r="6" fill="${bgDeep}"/>
  <circle cx="46" cy="34" r="2" fill="${cyan}"/>
  <circle cx="76" cy="34" r="2" fill="${cyan}"/>
</svg>`;
}

async function generateIcons() {
  console.log('Generating icons...');

  const sizes = [16, 24, 32, 48, 64, 128, 256];

  // Generate red (running) PNG
  const redSvg = Buffer.from(createSvg('red'));
  await sharp(redSvg).resize(256, 256).png().toFile(path.join(assetsDir, 'icon-red.png'));
  console.log('  ✓ icon-red.png (256x256)');

  // Generate gray (stopped) PNG
  const graySvg = Buffer.from(createSvg('gray'));
  await sharp(graySvg).resize(256, 256).png().toFile(path.join(assetsDir, 'icon-gray.png'));
  console.log('  ✓ icon-gray.png (256x256)');

  // Generate orange (processing) PNG
  const orangeSvg = Buffer.from(createSvg('orange'));
  await sharp(orangeSvg).resize(256, 256).png().toFile(path.join(assetsDir, 'icon-orange.png'));
  console.log('  ✓ icon-orange.png (256x256)');

  // Generate tray icons at multiple sizes (16px for tray)
  for (const size of [16, 24, 32]) {
    await sharp(redSvg).resize(size, size).png().toFile(path.join(assetsDir, `tray-red-${size}.png`));
    console.log(`  ✓ tray-red-${size}.png`);
    await sharp(graySvg).resize(size, size).png().toFile(path.join(assetsDir, `tray-gray-${size}.png`));
    console.log(`  ✓ tray-gray-${size}.png`);
    await sharp(orangeSvg).resize(size, size).png().toFile(path.join(assetsDir, `tray-orange-${size}.png`));
    console.log(`  ✓ tray-orange-${size}.png`);
  }

  // Generate ICO (multi-size) for the installer
  // We'll create individual PNGs and combine them manually into ICO format
  const icoSizes = [16, 32, 48, 256];
  const icoBuffers = [];

  for (const size of icoSizes) {
    const buf = await sharp(redSvg).resize(size, size).png().toBuffer();
    icoBuffers.push({ size, buf });
  }

  const ico = createIco(icoBuffers);
  fs.writeFileSync(path.join(assetsDir, 'icon.ico'), ico);
  console.log('  ✓ icon.ico (multi-size)');

  console.log('Done!');
}

function createIco(images) {
  // ICO file format: header + directory entries + image data
  const numImages = images.length;
  const headerSize = 6;
  const dirEntrySize = 16;
  const dirSize = dirEntrySize * numImages;
  let dataOffset = headerSize + dirSize;

  // Header: reserved(2) + type(2) + count(2)
  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0);      // Reserved
  header.writeUInt16LE(1, 2);      // Type: 1 = ICO
  header.writeUInt16LE(numImages, 4); // Number of images

  const dirEntries = [];
  const imageDataBuffers = [];

  for (const { size, buf } of images) {
    const entry = Buffer.alloc(dirEntrySize);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);  // Width (0 = 256)
    entry.writeUInt8(size >= 256 ? 0 : size, 1);  // Height (0 = 256)
    entry.writeUInt8(0, 2);      // Color palette
    entry.writeUInt8(0, 3);      // Reserved
    entry.writeUInt16LE(1, 4);   // Color planes
    entry.writeUInt16LE(32, 6);  // Bits per pixel
    entry.writeUInt32LE(buf.length, 8);  // Image size
    entry.writeUInt32LE(dataOffset, 12); // Data offset

    dirEntries.push(entry);
    imageDataBuffers.push(buf);
    dataOffset += buf.length;
  }

  return Buffer.concat([header, ...dirEntries, ...imageDataBuffers]);
}

generateIcons().catch(err => {
  console.error('Error generating icons:', err);
  process.exit(1);
});
