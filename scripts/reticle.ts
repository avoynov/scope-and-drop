/**
 * Headless stills of the scope lab (SwiftShader WebGL2).
 *   OUT=renders npx tsx scripts/reticle.ts "pso=reticle=pso&mag=8" "tree=reticle=tree&mag=12"
 * W and H set the viewport (default 1280×720); a name ending in .jpg saves a JPEG.
 */
import { chromium } from 'playwright';
import { createServer } from 'vite';
const shots = process.argv.slice(2); // name=query string
const out = process.env.OUT ?? "renders";
const server = await createServer({ configFile: 'vite.config.ts', logLevel: 'error', server: { port: 5198, host: '127.0.0.1' } });
await server.listen();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-proxy-server', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
for (const s of shots) {
  const i = s.indexOf('=');
  const name = s.slice(0, i);
  const q = s.slice(i + 1);
  const page = await browser.newPage({ viewport: { width: Number(process.env.W ?? 1280), height: Number(process.env.H ?? 720) } });
  page.on('console', (m) => (m.type() === 'error' || m.type()==='warning') && console.log(m.text().slice(0, 600)));
  page.on('pageerror', (e) => console.log('ERR', e.message));
  const t0 = Date.now();
  await page.goto(`http://127.0.0.1:5198/reticle/?shot=1&${q}`);
  await page.waitForFunction(() => (window as unknown as { __ready?: boolean }).__ready === true, null, { timeout: 300000, polling: 500 });
  const jpg = name.endsWith('.jpg');
  await page.screenshot({ path: `${out}/${jpg ? name : name + '.png'}`, type: jpg ? 'jpeg' : 'png', quality: jpg ? 86 : undefined });
  console.log(name, (Date.now() - t0) / 1000);
  await page.close();
}
await browser.close(); await server.close();
