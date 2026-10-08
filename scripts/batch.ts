/** Batch diagnostics: failure codes per attempt, attempts needed, timing. */
import { generateOnce, resolveOptions } from '../src/mansion/generate';

const N = Number(process.argv[2] ?? 40);
const codes = new Map<string, number>();
const attemptsNeeded: number[] = [];
let totalMs = 0;
let firstTryOk = 0;
let failedAll = 0;
const examples = new Map<string, string>();
for (let s = 0; s < N; s++) {
  const opts = resolveOptions({ seed: `batch-${s}` });
  let ok = false;
  for (let a = 0; a < opts.maxAttempts; a++) {
    const t0 = performance.now();
    const bp = generateOnce(opts, a);
    totalMs += performance.now() - t0;
    for (const i of bp.validation.issues) {
      if (i.severity !== 'error') continue;
      codes.set(i.code, (codes.get(i.code) ?? 0) + 1);
      if (!examples.has(i.code)) examples.set(i.code, `${bp.seed}#${a} ${bp.style.id}/${bp.massing}: ${i.message}`);
    }
    if (bp.validation.ok) {
      ok = true;
      attemptsNeeded.push(a + 1);
      if (a === 0) firstTryOk++;
      break;
    }
  }
  if (!ok) failedAll++;
}
const runs = attemptsNeeded.reduce((a, b) => a + b, 0);
console.log(`seeds=${N} firstTryOk=${firstTryOk} failedAll=${failedAll} meanAttempts=${(runs / Math.max(1, attemptsNeeded.length)).toFixed(2)} msPerAttempt=${(totalMs / Math.max(1, runs)).toFixed(1)}`);
for (const [k, v] of [...codes.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(18)} ${v}   e.g. ${examples.get(k)}`);
