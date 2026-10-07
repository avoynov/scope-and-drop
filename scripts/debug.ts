import { generateOnce, resolveOptions } from '../src/mansion/generate';
import { navComponents } from '../src/mansion/analysis/nav';
const [seed, attempt] = [process.argv[2] ?? 'batch-0', Number(process.argv[3] ?? 0)];
const bp = generateOnce(resolveOptions({ seed }), attempt);
console.log(bp.style.id, bp.massing, 'ok', bp.validation.ok);
for (const i of bp.validation.issues) console.log(' ', i.severity, i.code, i.message);
const byType = new Map<string, number>();
for (const p of bp.pois) byType.set(p.type, (byType.get(p.type) ?? 0) + 1);
console.log('pois', JSON.stringify(Object.fromEntries(byType)));
const props = new Map<string, number>();
for (const p of bp.props) props.set(p.kind, (props.get(p.kind) ?? 0) + 1);
console.log('props', JSON.stringify(Object.fromEntries(props)));
for (const n of bp.nav.levels) {
  const comp = navComponents(n);
  const roomsIn = new Map<number, Set<string>>();
  for (let k = 0; k < comp.length; k++) {
    if (comp[k]! < 0) continue;
    const ri = n.room[k]!;
    const name = ri === -2 ? 'terrace' : ri === -1 ? 'out' : bp.rooms[ri]!.id;
    let s = roomsIn.get(comp[k]!);
    if (!s) roomsIn.set(comp[k]!, (s = new Set()));
    s.add(name);
  }
  console.log(`L${n.level} components:`);
  for (const [c, s] of roomsIn) console.log(`   #${c}: ${[...s].join(' ')}`);
}
