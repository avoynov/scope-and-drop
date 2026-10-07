/**
 * Headless renders of the demo (SwiftShader WebGL2).
 *   npx tsx scripts/render.ts --seed gala-night --views scope,wide,iso --out renders
 */
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const args = process.argv.slice(2);
const get = (k: string, d: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1]! : d;
};
const seeds = get('seed', 'gala-night').split(',');
const views = get('views', 'wide').split(',');
const out = get('out', 'renders');
const w = get('w', '1280');
const h = get('h', '720');
const extra = get('params', '');
mkdirSync(out, { recursive: true });

const server = await createServer({ configFile: 'vite.config.ts', logLevel: 'error', server: { port: 5199, host: '127.0.0.1' } });
await server.listen();
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
});
try {
  for (const seed of seeds) {
    for (const view of views) {
      const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
      const logs: string[] = [];
      page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && logs.push(`[${m.type()}] ${m.text()}`));
      page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
      const t0 = Date.now();
      await page.goto(`http://127.0.0.1:5199/?shot=1&seed=${encodeURIComponent(seed)}&view=${view}&w=${w}&h=${h}${extra ? '&' + extra : ''}`);
      try {
        await page.waitForFunction(() => (window as unknown as { __ready?: boolean }).__ready === true, null, { timeout: 600_000, polling: 500 });
      } catch (e) {
        console.log('timeout', seed, view, logs.join('\n'));
        throw e;
      }
      const file = `${out}/${seed}-${view}${extra ? '-' + extra.replace(/[^a-z0-9]+/gi, '_') : ''}.png`;
      await page.screenshot({ path: file });
      const stats = await page.evaluate(() => (window as unknown as { __stats: () => unknown }).__stats());
      console.log(`${file}  ${((Date.now() - t0) / 1000).toFixed(1)}s  ${JSON.stringify(stats)}`);
      for (const l of logs.slice(0, 12)) console.log('   ', l.slice(0, 400));
      await page.close();
    }
  }
} finally {
  await browser.close();
  await server.close();
}
