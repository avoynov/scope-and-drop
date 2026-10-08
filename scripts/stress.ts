/** Stress: every style × massing × size combination, N seeds each. */
import { generateMansion } from '../src/mansion';
import type { MansionSize, MassingType, StyleId } from '../src/mansion';

const N = Number(process.argv[2] ?? 6);
const styles: StyleId[] = ['palladian', 'georgian', 'beauxarts'];
const massings: MassingType[] = ['block', 'u-garden', 'u-entrance', 'h'];
const sizes: MansionSize[] = ['compact', 'grand', 'palatial'];
let total = 0;
let ok = 0;
let attempts = 0;
let ms = 0;
const fails: string[] = [];
const codes = new Map<string, number>();
for (const style of styles)
  for (const massing of massings)
    for (const size of sizes)
      for (let i = 0; i < N; i++) {
        const bp = generateMansion({ seed: `s-${style}-${massing}-${size}-${i}`, style, massing, size });
        total++;
        attempts += bp.attempt + 1;
        ms += bp.stats.generationMs;
        if (bp.validation.ok) ok++;
        else fails.push(`${bp.seed}: ${bp.validation.issues.filter((x) => x.severity === 'error').map((x) => x.message).join('; ')}`);
        for (const x of bp.validation.issues) codes.set(`${x.severity}:${x.code}`, (codes.get(`${x.severity}:${x.code}`) ?? 0) + 1);
      }
console.log(`total=${total} ok=${ok} meanAttempts=${(attempts / total).toFixed(2)} meanMs=${(ms / total).toFixed(0)}`);
for (const [k, v] of [...codes.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${k} ${v}`);
for (const f of fails.slice(0, 10)) console.log('  FAIL', f);
