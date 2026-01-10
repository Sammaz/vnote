import pngToIco from 'png-to-ico';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const iconsDir = path.join(__dirname, '..', 'src-tauri', 'icons');

async function generateIco() {
  // Use the 256x256 icon for ICO
  const pngPath = path.join(iconsDir, '128x128@2x.png');
  const icoPath = path.join(iconsDir, 'icon.ico');

  const buf = await pngToIco(pngPath);
  fs.writeFileSync(icoPath, buf);
  console.log('Generated: icon.ico');
}

generateIco().catch(console.error);
