/**
 * CLI: generate a blueprint and print a summary (or write JSON).
 *   npx tsx scripts/gen.ts --seed foo [--style palladian] [--massing h] [--size grand] [--json out.json] [--plan]
 */
import { writeFileSync } from 'node:fs';
import { generateMansion, type MansionOptions } from '../src/mansion';

const args = process.argv.slice(2);
const get = (k: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const opts: MansionOptions = {
  seed: get('seed') ?? 'demo',
  style: get('style') as MansionOptions['style'],
  massing: get('massing') as MansionOptions['massing'],
  size: get('size') as MansionOptions['size'],
};
const bp = generateMansion(opts);
const errors = bp.validation.issues.filter((i) => i.severity === 'error');
const warns = bp.validation.issues.filter((i) => i.severity === 'warn');
console.log(`seed=${bp.seed} attempt=${bp.attempt} style=${bp.style.id} massing=${bp.massing} bays=${bp.bays}×${bp.bay}m levels=${bp.levels.length} ok=${bp.validation.ok} ${bp.stats.generationMs}ms`);
console.log(`rooms=${bp.stats.rooms} party=${bp.stats.partyRooms} walls=${bp.stats.walls} openings=${bp.stats.openings} props=${bp.stats.props} lights=${bp.stats.lights} pois=${bp.pois.length} trees=${bp.site.trees.length}`);
console.log(`perch d=${bp.site.perch.distance} az=${bp.site.perch.azimuthDeg} eye=${JSON.stringify(bp.site.perch.eye)} partyVisible=${bp.sightlines.partyVisible} terrace=${bp.sightlines.terrace}`);
console.log('metrics', JSON.stringify(bp.validation.metrics));
for (const e of errors) console.log('  ERROR', e.code, e.message);
for (const w of warns) console.log('  warn ', w.code, w.message);
if (args.includes('--plan')) {
  for (const r of bp.rooms) console.log(`  ${r.id.padEnd(7)} L${r.level} ${r.label.padEnd(26)} ${r.role.padEnd(11)} vis=${(bp.sightlines.rooms[r.id] ?? 0).toFixed(2)} lit=${r.lit} ${JSON.stringify(r.rect)}`);
}
const out = get('json');
if (out) {
  writeFileSync(out, JSON.stringify(bp, (_k, v) => (v instanceof Uint8Array || v instanceof Int16Array ? Array.from(v) : v)));
  console.log('wrote', out);
}
