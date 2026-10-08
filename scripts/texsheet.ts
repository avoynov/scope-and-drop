/** Contact sheet of all procedural textures (albedo row, then normal row). */
import { synthesize, type TextureKey } from '../src/mansion/build/textures';
import { writePng } from './png';

const keys: TextureKey[] = ['ashlar', 'rusticated', 'brick', 'stucco', 'slate', 'zinc', 'lead', 'herringbone', 'parquet', 'boards', 'marble', 'marble-floor', 'checker', 'flagstone', 'damask', 'silk', 'stripe', 'paneling', 'plaster', 'wood', 'fabric', 'books', 'grass', 'gravel', 'foliage', 'bark', 'soil', 'paintings', 'carpet', 'rug0', 'rug1', 'rug4'];
const S = 192;
const cols = 8;
const rows = Math.ceil(keys.length / cols);
const W = cols * S;
const H = rows * S;
const img = new Uint8Array(W * H * 3);
const t0 = performance.now();
keys.forEach((k, idx) => {
  const f = synthesize(k, S);
  const ox = (idx % cols) * S;
  const oy = (rows - 1 - Math.floor(idx / cols)) * S;
  for (let j = 0; j < S; j++)
    for (let i = 0; i < S; i++) {
      const s = (j * S + i) * 3;
      const d = ((oy + j) * W + ox + i) * 3;
      for (let c = 0; c < 3; c++) img[d + c] = Math.round(Math.min(1, Math.max(0, f.col[s + c]!)) * 255);
    }
});
console.log('synth ms', (performance.now() - t0).toFixed(0));
writePng(process.argv[2]!, W, H, img);
