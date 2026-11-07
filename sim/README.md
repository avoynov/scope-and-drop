# Scope And Drop sim (C#)

The game's simulation as a plain C# library, for the Unity version of the game. It is a Unity package (`com.scopeanddrop.sim`) that the Unity project will load from this folder, and it also builds outside Unity so the cloud can test it.

- **Target:** .NET Standard 2.1 and C# 9, the surface every current Unity player accepts. No Unity types: vectors are the sim's own double-precision structs.
- **Code:** `sim/Runtime/<Module>/`, namespaces `ScopeAndDrop.Sim.<Module>`.
- **Tests:** `dotnet/` holds the solution, a project that compiles these sources, and the NUnit tests (.NET 8). Every test runs under a German locale, so any culture-dependent text fails.
- **The TypeScript stays.** `src/`, `demo/` and `tests/` are kept as they are: frozen to bug fixes and used as the reference the C# is compared against. The migration never deletes or moves them.

```bash
dotnet test dotnet/ScopeAndDrop.sln          # build the sim as Unity will and run the tests
dotnet tool restore                          # once: installs CSharpier
dotnet csharpier format sim dotnet           # format (width 200, like the TypeScript's Prettier)
npx tsx dotnet/vectors/core.ts               # rewrite the test data from today's TypeScript
```

## Porting rules

C# uses its own native maths; the port does not copy the browser. Tiny last-digit differences mean some evenings unfold differently from the web version, so "the same" is judged by behaviour and rates, and any likelihood that drifts is tuned afterwards. What must not change is everything below.

| In the TypeScript | In the C# sim | Why |
|---|---|---|
| `Math.round(x)` | `Num.Round(x)` (halves up) | `Math.Round` rounds halves to even: 2.5 gives 2 |
| `Math.sign(x)` | `Num.Sign(x)` | `Math.Sign` throws on NaN |
| `Math.hypot(...)` | `Num.Hypot(...)` | not in .NET Standard 2.1 |
| other `Math.*` | `System.Math` | native maths, by decision |
| `String(x)`, `` `${x}` `` with a number | `Num.ToText(x)` | `$"{x}"` uses the PC's locale ("0,5") and .NET's format ("1E-07") |
| `Map` that is iterated | `OrderedMap<K, V>` | `Dictionary` order is not insertion order once keys are removed |
| `Set` that is iterated | `OrderedSet<T>` | same |
| `Map`/`Set` only looked up | `Dictionary` / `HashSet` | fine when order never matters |
| `arr.sort(cmp)` | `Sorting.StableSort(list, cmp)`, `Sorting.SortBy(list, key)` | `List.Sort` is unstable; ties must keep their order |
| `arr.sort()` on strings, `<` on strings | `Sorting.SortOrdinal`, `string.CompareOrdinal` | never culture-aware comparison |
| `Math.imul`, `>>> 0`, `\| 0` | `uint`/`int` arithmetic in `unchecked`, `Num.ToInt32`, `Num.ToUint32` | the RNG and hashes stay bit-exact |
| `new Rng(seed)`, `rng.fork(label)` | `new Rng(seed)`, `rng.Fork(label)` | same draws as the TypeScript for the same seed |
| `Math.random()` | never | use a forked `Rng` |
| `Date.now()`, `performance.now()` | never inside the sim | the sim never reads the clock |

A test (`PortRulesTests`) refuses the worst of these in sim sources.

**Shapes.**
- One TypeScript file becomes one C# file: `src/mansion/layout/rooms.ts` becomes `sim/Runtime/Mansion/Layout/Rooms.cs`. Exported functions become static methods on a class named after the file, in PascalCase. Types keep their names.
- String-literal unions become enums; their text names (for JSON and digests) are the original kebab-case strings.
- Plain-data interfaces become classes, so sharing and mutation work as in the TypeScript. Only small values are structs (`Vec2`, `Vec3`, `Rect`): copying one copies the numbers.
- `number` becomes `double`, or `int` where it is always an index or a count.
- `undefined`/`null` become nullable types.
- No static mutable state: the party runs on a worker thread.
- Per-step code allocates nothing where practical; loading code may.

**Checks, per module.** Each module's TypeScript tests are ported with it, with the same names, inputs and expected values. Checks on decimals get tolerances. Where exact agreement is expected (the RNG, integer and rectangle maths), the TypeScript writes test data under `dotnet/vectors/`, and the C# must match it bit for bit. The party adds sweeps: 200 evenings per house size, in both languages, compared on the rates that matter. Once a module lands, the C# writes its own golden results.

## Modules

| Module | TypeScript | C# | Status |
|---|---|---|---|
| Core: RNG, rounding, number text, ordered map and set, stable sort, rectangles | `src/mansion/core/rng.ts`, `geom.ts` | `Runtime/Core/` | done |
| Mansion generator and analysis | `src/mansion/` except `build/` | `Runtime/Mansion/` | next |
| Body and wounds | `src/body/` | `Runtime/Body/` | |
| Scope logic: ballistics, shot, wind, glass, optics, handling, rangefinder, radio | `src/scope/` | `Runtime/Scope/` | |
| Armoury | `src/armoury/` | `Runtime/Armoury/` | |
| Party | `src/party/` except `render/` | `Runtime/Party/` | |
| Spy | `src/party/spy/` | `Runtime/Party/Spy/` | |

The renderers (`src/mansion/build/`, `src/party/render/`) and the web labs are not ported: Unity rebuilds them.
