using System;
using System.Collections.Generic;
using ScopeAndDrop.Sim.Core;

namespace ScopeAndDrop.Sim.Mansion
{
    /// <summary>
    /// Room recipes: what goes where, per room type. Recipes only describe intent; the Placer enforces clearances, window rules and
    /// reachability. Port of src/mansion/interior/recipes.ts; random draws are taken in the TypeScript's order (arguments left to right).
    /// </summary>
    public static class Recipes
    {
        public static readonly double[] Tungsten = { 1.0, 0.6, 0.3 };
        public static readonly double[] Warm = { 1.0, 0.54, 0.24 };
        public static readonly double[] Candle = { 1.0, 0.48, 0.17 };
        public static readonly double[] Fire = { 1.0, 0.36, 0.09 };

        static Side Opposite(Side s) =>
            s switch
            {
                Side.N => Side.S,
                Side.S => Side.N,
                Side.E => Side.W,
                _ => Side.E,
            };

        static Prop? Mark(Prop? prop, PoiType poi)
        {
            if (prop != null)
                prop.Poi = poi;
            return prop;
        }

        /// <summary>The wall facing the windows: where a guest's front is seen from outside.</summary>
        static Side BackSide(Placer p)
        {
            List<Side> ws = p.WindowSides();
            return ws.Count > 0 ? Opposite(ws[0]) : p.SolidSides()[0];
        }

        static Side[] Perpendicular(Side s) => s == Side.N || s == Side.S ? new[] { Side.E, Side.W } : new[] { Side.N, Side.S };

        static List<Side> Cat(Side first, IEnumerable<Side> rest)
        {
            var output = new List<Side> { first };
            output.AddRange(rest);
            return output;
        }

        static List<Side> Cat(IEnumerable<Side> first, Side last)
        {
            var output = new List<Side>(first) { last };
            return output;
        }

        static double SideYaw(Side s) => Placer.SideYaw(s);

        static bool NorthSouth(Side s) => s == Side.N || s == Side.S;

        static double QuarterTurn(double yaw) => Num.Round(yaw / (Math.PI / 2)) * (Math.PI / 2);

        /* ------------------------------------------------------------------ */
        /* Shared groups                                                       */
        /* ------------------------------------------------------------------ */

        public static void Chandeliers(Placer p, double perArea = 42, double max = 4)
        {
            double longSide = Math.Max(p.Width, p.Depth);
            double shortSide = Math.Min(p.Width, p.Depth);
            double area = p.Width * p.Depth;
            double n = Math.Max(1, Math.Min(max, Math.Min(Num.Round(area / perArea), Num.Round(longSide / 5.5))));
            double clear = p.CeilY - p.FloorY;
            double h = Math.Min(2.4, Math.Max(0.9, clear * 0.3));
            double w = Math.Min(2.2, Math.Max(0.8, shortSide * 0.2));
            double intensity = Math.Min(900, Math.Max(260, (area / n) * 9)) * p.Room.Lit;
            for (int i = 0; i < n; i++)
            {
                double t = n == 1 ? 0.5 : (i + 0.5) / n;
                double x = p.LongAxis == Axis.X ? p.Inner.X0 + t * p.Width : p.Cx;
                double z = p.LongAxis == Axis.Z ? p.Inner.Z0 + t * p.Depth : p.Cz;
                p.Add(PropKind.Chandelier, x, z, 0, w, w, h, y: p.CeilY - h, blocks: false, mount: PropMount.Ceiling, variant: p.Room.Role == RoomRole.Party ? 0 : 1);
                if (p.Room.Lit > 0)
                    p.Light(LightKind.Chandelier, x, p.CeilY - h * 0.6, z, Tungsten, intensity, Math.Max(9, longSide * 0.9));
            }
        }

        public static void Sconces(Placer p, double spacing = 3.4)
        {
            if (p.Room.Lit <= 0)
                return;
            double y = p.FloorY + Math.Min(2.3, (p.CeilY - p.FloorY) * 0.5);
            int count = 0;
            foreach (Side side in Placer.Sides)
            {
                SideInfo info = p.SideOf(side);
                // Piers between windows on window walls; regular spacing elsewhere.
                List<(double a, double b)> runs = p.FreeRuns(side, 0, 0.6);
                foreach (var (a, b) in runs)
                {
                    double n = Math.Max(1, Math.Floor((b - a) / spacing));
                    for (int k = 0; k < n; k++)
                    {
                        if (count >= 10)
                            return;
                        double t = a + ((k + 0.5) * (b - a)) / n;
                        if (info.Windows == 0 && b - a < 1.0)
                            continue;
                        Prop? prop = p.OnWall(side, PropKind.Sconce, 0.32, 0.45, y, prefer: t, sweep: false);
                        if (prop != null)
                        {
                            Vec2 at = p.At(side, t, 0.25);
                            p.Light(LightKind.Sconce, at.X, y + 0.12, at.Z, Warm, 55 * p.Room.Lit, 6);
                            count++;
                        }
                    }
                }
            }
        }

        public static void Paintings(Placer p, double count, IReadOnlyList<Side>? sides = null, bool poi = false, bool big = false)
        {
            double clear = p.CeilY - p.FloorY;
            IReadOnlyList<Side> order = sides ?? p.SolidSides();
            int placed = 0;
            for (int pass = 0; pass < 2 && placed < count; pass++)
            {
                foreach (Side side in order)
                {
                    if (placed >= count)
                        break;
                    List<(double a, double b)> runs = p.FreeRuns(side, Math.Min(clear - 0.5, 2.6), 1.0);
                    foreach (var (a, b) in runs)
                    {
                        if (placed >= count)
                            break;
                        bool portrait = p.Rng.Chance(0.55);
                        double w =
                            big ? p.Rng.Range(1.4, 2.2)
                            : portrait ? p.Rng.Range(0.7, 1.1)
                            : p.Rng.Range(1.0, 1.7);
                        double h =
                            big ? w * p.Rng.Range(0.6, 0.8)
                            : portrait ? w * p.Rng.Range(1.2, 1.4)
                            : w * p.Rng.Range(0.65, 0.8);
                        if (b - a < w + 0.4)
                            continue;
                        double yc = p.FloorY + Math.Min(clear - h / 2 - 0.35, 1.25 + Math.Max(0.6, h / 2) + (pass != 0 ? 0.2 : 0));
                        double t = pass == 0 ? (a + b) / 2 : a + (b - a) * p.Rng.Range(0.25, 0.75);
                        Prop? prop = p.OnWall(side, PropKind.Painting, w, h, yc, prefer: t, variant: p.Rng.Int(0, 7));
                        if (prop != null)
                        {
                            if (poi)
                                prop.Poi = PoiType.Painting;
                            placed++;
                        }
                    }
                }
            }
        }

        static Side? Fireplace(Placer p, IReadOnlyList<Side> sides)
        {
            foreach (Side side in sides)
            {
                List<(double a, double b)> runs = p.FreeRuns(side, 2.4, 2.6);
                if (runs.Count == 0)
                    continue;
                var (a, b) = runs[0];
                double t = (a + b) / 2;
                Prop? fp = p.AgainstWall(side, PropKind.Fireplace, 2.0, 0.55, 1.4, prefer: t, sweep: false, variant: p.Rng.Int(0, 2));
                if (fp == null)
                    continue;
                fp.Poi = PoiType.Fireplace;
                double clear = p.CeilY - p.FloorY;
                double mh = Math.Min(1.6, clear - 2.0);
                if (mh > 0.6)
                    p.OnWall(side, p.Rng.Chance(0.6) ? PropKind.Mirror : PropKind.Painting, 1.3, mh, p.FloorY + 1.45 + mh / 2 + 0.1, prefer: t, sweep: false, variant: p.Rng.Int(0, 7));
                if (p.Room.Lit > 0)
                {
                    Vec2 at = p.At(side, t, 0.3);
                    p.Light(LightKind.Fire, at.X, p.FloorY + 0.35, at.Z, Fire, 45, 5.5);
                }
                return side;
            }
            return null;
        }

        /// <summary>Sofa + two armchairs + table around a focus.</summary>
        static bool Conversation(Placer p, double cx, double cz, Axis axis, bool withRug = true)
        {
            // Sofa on one side of the axis, armchairs opposite or flanking.
            Prop? sofa =
                axis == Axis.Z
                    ? p.Add(PropKind.Sofa, cx, cz + 1.3, Math.PI, 2.1, 0.9, 0.85, variant: p.Rng.Int(0, 2))
                    : p.Add(PropKind.Sofa, cx + 1.3, cz, -Math.PI / 2, 2.1, 0.9, 0.85, variant: p.Rng.Int(0, 2));
            if (sofa == null)
                return false;
            p.Add(PropKind.CoffeeTable, cx, cz, axis == Axis.Z ? 0 : Math.PI / 2, 1.2, 0.65, 0.45);
            if (axis == Axis.Z)
            {
                p.Add(PropKind.Armchair, cx - 1.45, cz - 0.1, Math.PI / 2, 0.85, 0.85, 0.95);
                p.Add(PropKind.Armchair, cx + 1.45, cz - 0.1, -Math.PI / 2, 0.85, 0.85, 0.95);
            }
            else
            {
                p.Add(PropKind.Armchair, cx - 0.1, cz - 1.45, 0, 0.85, 0.85, 0.95);
                p.Add(PropKind.Armchair, cx - 0.1, cz + 1.45, Math.PI, 0.85, 0.85, 0.95);
            }
            if (withRug)
                p.Add(PropKind.Rug, cx, cz, axis == Axis.Z ? 0 : Math.PI / 2, 3.6, 2.8, 0.012, blocks: false, variant: p.Rng.Int(0, 3));
            // Lamp on a side table at the sofa end.
            Prop? st = axis == Axis.Z ? p.Add(PropKind.SideTable, cx + 1.45, cz + 1.3, 0, 0.5, 0.5, 0.6) : p.Add(PropKind.SideTable, cx + 1.3, cz + 1.45, 0, 0.5, 0.5, 0.6);
            if (st != null && p.Room.Lit > 0)
            {
                p.Add(PropKind.Lamp, st.X, st.Z, 0, 0.4, 0.4, 0.7, y: p.FloorY + 0.6, blocks: false);
                p.Light(LightKind.Lamp, st.X, p.FloorY + 1.15, st.Z, Warm, 60 * p.Room.Lit, 5);
            }
            return true;
        }

        static int CornerStatues(Placer p, int max, bool poi = true, PropKind kind = PropKind.Statue)
        {
            Rect i = p.Inner;
            const double off = 0.95;
            List<(double x, double z)> corners = p.Rng.Shuffle(new[] { (i.X0 + off, i.Z0 + off), (i.X1 - off, i.Z0 + off), (i.X0 + off, i.Z1 - off), (i.X1 - off, i.Z1 - off) });
            int n = 0;
            foreach (var (x, z) in corners)
            {
                if (n >= max)
                    break;
                double yaw = Math.Atan2(p.Cx - x, p.Cz - z);
                double q = QuarterTurn(yaw);
                Prop? prop =
                    kind == PropKind.Plant
                        ? p.Add(PropKind.Plant, x, z, 0, 0.8, 0.8, 1.9, occludes: true, variant: p.Rng.Int(0, 2))
                        : p.Add(kind, x, z, q, 0.75, 0.75, kind == PropKind.Statue ? 2.25 : 1.75, occludes: true, variant: p.Rng.Int(0, 3));
                if (prop != null)
                {
                    if (poi && kind != PropKind.Plant)
                        prop.Poi = PoiType.Statue;
                    n++;
                }
            }
            return n;
        }

        static int ChairsAlong(Placer p, Side side, double spacing, int max)
        {
            int n = 0;
            foreach (var (a, b) in p.FreeRuns(side, 1.0, 0.8))
            {
                double count = Math.Floor((b - a) / spacing);
                for (int k = 0; k < count && n < max; k++)
                {
                    double t = a + (k + 0.5) * ((b - a) / count);
                    Vec2 at = p.At(side, t, 0.32);
                    if (p.Add(PropKind.Chair, at.X, at.Z, SideYaw(side), 0.5, 0.52, 0.95, variant: 1) != null)
                        n++;
                }
            }
            return n;
        }

        public static bool Bar(Placer p)
        {
            Side back = BackSide(p);
            List<Side> order = Cat(Cat(back, Perpendicular(back)), Opposite(back));
            // Full bar: back shelf against the wall, counter in front, guests on the room side.
            foreach (Side side in order)
            {
                foreach (var (a, b) in p.FreeRuns(side, 2.3, 3.4))
                {
                    foreach (double t in new[] { (a + b) / 2, a + 1.7, b - 1.7 })
                    {
                        Prop? shelf = p.AgainstWall(side, PropKind.BarShelf, 3.0, 0.42, 2.2, prefer: t, sweep: false, occludes: true);
                        if (shelf == null)
                            continue;
                        Vec2 at = p.At(side, t, 0.42 + 1.05 + 0.35);
                        Prop? counter = p.Add(PropKind.BarCounter, at.X, at.Z, SideYaw(side), 3.0, 0.7, 1.1, occludes: false);
                        if (counter == null)
                        {
                            p.Remove(shelf);
                            continue;
                        }
                        counter.Poi = PoiType.Bar;
                        BarLight(p, side, t);
                        return true;
                    }
                }
            }
            // Counter only (e.g. in front of low windows), bartender behind it.
            foreach (Side side in order)
            {
                foreach (var (a, b) in p.FreeRuns(side, 1.15, 2.8))
                {
                    double t = (a + b) / 2;
                    Vec2 at = p.At(side, t, 0.9 + 0.35);
                    Prop? counter = p.Add(PropKind.BarCounter, at.X, at.Z, SideYaw(side), 2.6, 0.7, 1.1, occludes: false);
                    if (counter == null)
                        continue;
                    counter.Poi = PoiType.Bar;
                    BarLight(p, side, t);
                    return true;
                }
            }
            return false;
        }

        static void BarLight(Placer p, Side side, double t)
        {
            if (p.Room.Lit <= 0)
                return;
            Vec2 l = p.At(side, t, 1.0);
            p.Light(LightKind.Lamp, l.X, p.FloorY + 2.3, l.Z, Warm, 80, 5);
        }

        static int Bookcases(Placer p, IReadOnlyList<Side> sides, int maxPoi)
        {
            double h = Math.Min(3.2, p.CeilY - p.FloorY - 0.45);
            int n = 0;
            int pois = 0;
            foreach (Side side in sides)
            {
                foreach (var (a, b) in p.FreeRuns(side, h, 1.0))
                {
                    double count = Math.Max(1, Math.Floor((b - a) / 1.25));
                    double w = (b - a) / count - 0.02;
                    for (int k = 0; k < count; k++)
                    {
                        double t = a + (k + 0.5) * ((b - a) / count);
                        Prop? bc = p.AgainstWall(side, PropKind.Bookcase, w, 0.45, h, prefer: t, sweep: false, occludes: true, variant: p.Rng.Int(0, 3));
                        if (bc != null)
                        {
                            n++;
                            if (pois < maxPoi && k == Math.Floor(count / 2))
                            {
                                bc.Poi = PoiType.Bookshelf;
                                pois++;
                            }
                        }
                    }
                }
            }
            return n;
        }

        /* ------------------------------------------------------------------ */
        /* Recipes                                                             */
        /* ------------------------------------------------------------------ */

        /// <summary>The great chandelier under the dome: one fitting, lighting the hall and every gallery round it.</summary>
        static void DomeChandelier(Placer p, bool fitting)
        {
            Vec3 d = p.Dome!.Value;
            if (fitting)
                p.Add(PropKind.Chandelier, d.X, d.Z, 0, 2.8, 2.8, 3.2, y: d.Y - 1.6, blocks: false, mount: PropMount.Ceiling, variant: 0);
            if (p.Room.Lit > 0)
                p.Light(LightKind.Chandelier, d.X, d.Y, d.Z, Tungsten, (fitting ? 760 : 520) * p.Room.Lit, 22);
        }

        static void Ballroom(Placer p, bool wantBar)
        {
            if (p.Dome != null)
                DomeChandelier(p, true);
            else
                Chandeliers(p, 40, 4);
            Side back = BackSide(p);
            // Band corner: piano and stands at one end of the back wall.
            Side[] ends = Perpendicular(back);
            Side first = p.Rng.Pick(ends);
            // Whichever end of the back wall has room; further from the wall, or along it, if the stair is in the way.
            Side end = first;
            Vec2 pianoAt = new Vec2(0, 0);
            double pianoYaw = 0;
            Prop? piano = null;
            var tryEnds = new List<Side> { first };
            foreach (Side q in ends)
            {
                if (q != first)
                    tryEnds.Add(q);
            }
            foreach (Side e in tryEnds)
            {
                SideInfo ei = p.SideOf(e);
                foreach (double inset in new[] { 2.4, 3.6, 5.0 })
                {
                    foreach (double off in new[] { 1.9, 3.2 })
                    {
                        double tEnd = e == Side.E || e == Side.N ? ei.Line - inset : ei.Line + inset;
                        Vec2 at = p.At(back, tEnd, off);
                        double yaw = SideYaw(back) + (e == Side.E || e == Side.N ? -0.35 : 0.35);
                        piano = p.Add(PropKind.GrandPiano, at.X, at.Z, QuarterTurn(yaw), 1.55, 2.1, 1.0, variant: 0);
                        if (piano != null)
                        {
                            end = e;
                            pianoAt = at;
                            pianoYaw = yaw;
                            goto placedPiano;
                        }
                    }
                }
            }
            placedPiano:
            double along = NorthSouth(back) ? pianoAt.X : pianoAt.Z;
            double toward = end == Side.E || end == Side.N ? -1 : 1;
            if (piano != null)
            {
                piano.Yaw = pianoYaw;
                piano.Poi = PoiType.Piano;
                for (int k = 0; k < 3; k++)
                {
                    double off = (k - 1) * 0.9;
                    Vec2 s = p.At(back, along + toward * 2.2 + off, 2.4);
                    p.Add(PropKind.MusicStand, s.X, s.Z, SideYaw(back), 0.45, 0.4, 1.2);
                    Vec2 c = p.At(back, along + toward * 2.2 + off, 1.7);
                    p.Add(PropKind.Chair, c.X, c.Z, SideYaw(back), 0.5, 0.52, 0.95, variant: 1);
                }
            }
            if (piano != null)
            {
                Vec2 h = p.At(back, along + toward * 4.6, 1.6);
                p.Add(PropKind.Harp, h.X, h.Z, SideYaw(back), 0.6, 0.9, 1.7);
            }
            if (wantBar)
                Bar(p);
            BallroomLife(p);
            CornerStatues(p, 4, true);
            foreach (Side s in Cat(Perpendicular(back), back))
                ChairsAlong(p, s, 1.0, 10);
            // Two cocktail tables near the windows for mingling groups.
            List<Side> wss = p.WindowSides();
            if (wss.Count > 0)
            {
                Side ws = wss[0];
                foreach (double frac in new[] { 0.25, 0.75 })
                {
                    SideInfo info = p.SideOf(ws);
                    double t = info.T0 + frac * (info.T1 - info.T0);
                    Vec2 at = p.At(ws, t, 2.2);
                    p.Add(PropKind.CocktailTable, at.X, at.Z, 0, 0.75, 0.75, 1.05, variant: 1);
                }
            }
            foreach (Side s in Perpendicular(back))
                p.OnWall(s, PropKind.Mirror, 1.4, Math.Min(2.6, p.CeilY - p.FloorY - 1.6), p.FloorY + 1.0 + Math.Min(2.6, p.CeilY - p.FloorY - 1.6) / 2);
            Paintings(p, 2, new[] { back }, poi: true, big: true);
            Sconces(p, 3.0);
        }

        /// <summary>Largest clear rectangle of floor about a point, up to a size: shrunk until it misses the stair, the columns and the furniture.</summary>
        static Rect? ClearFloor(Placer p, double cx, double cz, double maxW, double maxD)
        {
            for (double k = 1; k > 0.35; k -= 0.08)
            {
                double w = maxW * k;
                double d = maxD * k;
                var r = new Rect(cx - w / 2, cz - d / 2, cx + w / 2, cz + d / 2);
                if (r.X0 < p.Inner.X0 + 0.8 || r.X1 > p.Inner.X1 - 0.8 || r.Z0 < p.Inner.Z0 + 0.8 || r.Z1 > p.Inner.Z1 - 0.8)
                    continue;
                if (p.IsFree(new Rect(r.X0 - 0.5, r.Z0 - 0.5, r.X1 + 0.5, r.Z1 + 0.5), true))
                    return r;
            }
            return null;
        }

        /// <summary>
        /// What makes a ballroom a place to spend a whole night: a dance floor kept clear in the middle, tables to stand at round its edge,
        /// a supper buffet, a harp beside the band, and sofas to retire to under the galleries. Run before the walls are dressed, so each
        /// claims its place.
        /// </summary>
        static void BallroomLife(Placer p)
        {
            Side back = BackSide(p);
            Side front = Opposite(back);
            double cx = p.Dome?.X ?? p.Cx;
            // Toward the windows from the middle: the stair comes down at the back.
            double cz0 = p.Dome?.Z ?? p.Cz;
            double towardFront = NorthSouth(front) ? Num.Sign(p.SideOf(front).Line - p.Cz) : 0;
            // The stair comes down across the back of the hall, so the floor lies between it and the windows:
            // the largest clear rectangle found on the axis.
            Rect? floor = null;
            static double AreaOf(Rect? r) => r.HasValue ? (r.Value.X1 - r.Value.X0) * (r.Value.Z1 - r.Value.Z0) : 0;
            for (double shift = 0; shift <= p.Depth / 2; shift += 0.5)
            {
                Rect? cand = ClearFloor(p, cx, cz0 + towardFront * shift, Math.Min(11, p.Width * 0.4), Math.Min(8, p.Depth * 0.46));
                if (AreaOf(cand) > AreaOf(floor) + 0.5)
                    floor = cand;
            }
            if (floor.HasValue)
            {
                Rect f = floor.Value;
                double w = f.X1 - f.X0;
                double d = f.Z1 - f.Z0;
                p.Add(PropKind.DanceFloor, (f.X0 + f.X1) / 2, (f.Z0 + f.Z1) / 2, 0, w, d, 0.02, blocks: false);
                // Nothing stands on the dance floor.
                p.Keep.Add(f);
                // Tables to stand at, round its edge.
                foreach (
                    var (x, z) in new[]
                    {
                        (f.X0 - 1.0, f.Z0 + d * 0.2),
                        (f.X1 + 1.0, f.Z0 + d * 0.2),
                        (f.X0 - 1.0, f.Z0 + d * 0.8),
                        (f.X1 + 1.0, f.Z0 + d * 0.8),
                        (f.X0 + w * 0.25, f.Z1 + 1.0),
                        (f.X0 + w * 0.75, f.Z1 + 1.0),
                    }
                )
                {
                    p.Add(PropKind.CocktailTable, x, z, 0, 0.75, 0.75, 1.05, variant: 1);
                }
            }
            // Supper: a long buffet against a side wall.
            foreach (Side side in Perpendicular(back))
            {
                SideInfo info = p.SideOf(side);
                // Toward the window end of the wall, clear of the stair.
                double t = towardFront >= 0 ? info.T0 + (info.T1 - info.T0) * 0.7 : info.T0 + (info.T1 - info.T0) * 0.3;
                Prop? buffet = p.AgainstWall(side, PropKind.Buffet, 3.8, 0.95, 0.78, prefer: t);
                if (buffet != null)
                {
                    if (p.Room.Lit > 0)
                        p.Light(LightKind.Lamp, buffet.X, p.FloorY + 2.2, buffet.Z, Warm, 70 * p.Room.Lit, 5);
                    break;
                }
            }
            // Sitting out: sofa groups down each side, under the galleries.
            Rect i = p.Inner;
            foreach (double fz in new[] { 0.3, 0.62, 0.86 })
            {
                foreach (double x in new[] { i.X0 + 2.6, i.X1 - 2.6 })
                {
                    if (Math.Abs(x - cx) < 4)
                        continue;
                    Conversation(p, x, i.Z0 + p.Depth * fz, Axis.Z);
                }
            }
            CornerStatues(p, 2, false, PropKind.Plant);
        }

        /// <summary>Dance room: a lit floor, a DJ at one end, a mirror ball, banquettes round the walls. Dark but for its colours.</summary>
        static void Disco(Placer p)
        {
            Side back = BackSide(p);
            double fw = Math.Min(8, p.Width - 3.6);
            double fd = Math.Min(8, p.Depth - 3.6);
            Rect? floor = null;
            if (fw >= 2.7 && fd >= 2.7)
                floor = ClearFloor(p, p.Cx, p.Cz, fw, fd);
            if (floor.HasValue)
            {
                Rect f = floor.Value;
                double fx = (f.X0 + f.X1) / 2;
                double fz = (f.Z0 + f.Z1) / 2;
                p.Add(PropKind.DiscoFloor, fx, fz, 0, f.X1 - f.X0, f.Z1 - f.Z0, 0.06, blocks: false);
                p.Keep.Add(f);
                p.Add(PropKind.MirrorBall, fx, fz, 0, 0.7, 0.7, 0.7, y: p.CeilY - 1.9, blocks: false, mount: PropMount.Ceiling);
                double lit = Math.Max(0.6, p.Room.Lit);
                double[][] cols = { new[] { 1.0, 0.25, 0.65 }, new[] { 0.2, 0.85, 1.0 }, new[] { 0.55, 0.35, 1.0 }, new[] { 1.0, 0.7, 0.25 } };
                var corners = new[] { (f.X0, f.Z0), (f.X1, f.Z0), (f.X1, f.Z1), (f.X0, f.Z1) };
                for (int k = 0; k < corners.Length; k++)
                    p.Light(LightKind.Lamp, corners[k].Item1, p.FloorY + 2.3, corners[k].Item2, cols[k], 60 * lit, 7);
                p.Light(LightKind.Lamp, fx, p.FloorY + 0.5, fz, new[] { 0.7, 0.5, 1.0 }, 50 * lit, 6);
            }
            // The DJ, flanked by speakers.
            foreach (Side side in WallsBackFirst(p))
            {
                SideInfo info = p.SideOf(side);
                double mid = (info.T0 + info.T1) / 2;
                // Against the wall, or standing clear of it where windows or doors take the wall.
                Prop? booth = p.AgainstWall(side, PropKind.DjBooth, 2.4, 0.95, 1.05);
                foreach (double dt in new[] { 0, -1.5, 1.5, -3, 3 })
                {
                    if (booth != null)
                        break;
                    Vec2 at = p.At(side, mid + dt, 1.3);
                    booth = p.Add(PropKind.DjBooth, at.X, at.Z, SideYaw(side), 2.4, 0.95, 1.05);
                }
                if (booth == null)
                    continue;
                double t = NorthSouth(side) ? booth.X : booth.Z;
                foreach (double dt in new[] { -2.0, 2.0 })
                    p.AgainstWall(side, PropKind.Speaker, 0.65, 0.55, 1.7, prefer: t + dt, sweep: false, occludes: true);
                break;
            }
            // Banquettes and standing tables round the walls.
            foreach (Side side in Cat(Perpendicular(back), Opposite(back)))
            {
                SideInfo info = p.SideOf(side);
                foreach (double f in new[] { 0.25, 0.75 })
                    p.AgainstWall(side, PropKind.Sofa, 2.1, 0.9, 0.85, prefer: info.T0 + (info.T1 - info.T0) * f, sweep: false, variant: 2);
            }
            Rect i = p.Inner;
            foreach (var (x, z) in new[] { (i.X0 + 1.6, i.Z0 + 1.6), (i.X1 - 1.6, i.Z0 + 1.6), (i.X0 + 1.6, i.Z1 - 1.6), (i.X1 - 1.6, i.Z1 - 1.6) })
                p.Add(PropKind.CocktailTable, x, z, 0, 0.75, 0.75, 1.05, variant: 1);
        }

        static void DrawingRoom(Placer p, bool wantBar)
        {
            Chandeliers(p, 45, 2);
            Side back = BackSide(p);
            Side? fs = Fireplace(p, Cat(Perpendicular(back), back));
            // Conversation group in front of the fireplace, then a second one.
            if (fs.HasValue)
            {
                Side s = fs.Value;
                double t = (p.SideOf(s).T0 + p.SideOf(s).T1) / 2;
                Vec2 c = p.At(s, t, 2.3);
                Conversation(p, c.X, c.Z, NorthSouth(s) ? Axis.Z : Axis.X);
            }
            if (wantBar)
                Bar(p);
            if (Math.Max(p.Width, p.Depth) > 8.5)
            {
                Axis along = p.LongAxis;
                double cx = along == Axis.X ? p.Inner.X0 + p.Width * (fs == Side.W ? 0.72 : 0.28) : p.Cx;
                double cz = along == Axis.Z ? p.Inner.Z0 + p.Depth * (fs == Side.S ? 0.72 : 0.28) : p.Cz;
                Conversation(p, cx, cz, along == Axis.X ? Axis.Z : Axis.X);
            }
            Prop? cs = p.AgainstWall(back, p.Rng.Chance(0.5) ? PropKind.Console : PropKind.Sideboard, 1.6, 0.5, 0.9);
            if (cs != null && p.Room.Lit > 0)
            {
                p.Add(PropKind.Lamp, cs.X, cs.Z, 0, 0.4, 0.4, 0.7, y: p.FloorY + 0.9, blocks: false);
                p.Light(LightKind.Lamp, cs.X, p.FloorY + 1.45, cs.Z, Warm, 55 * p.Room.Lit, 5);
            }
            if (p.Rng.Chance(0.5))
                CardTable(p, p.Cx, p.Cz);
            CornerStatues(p, 2, false, PropKind.Plant);
            if (p.Rng.Chance(0.5))
                CornerStatues(p, 1, true, PropKind.Statue);
            Paintings(p, 4, poi: true);
            Sconces(p);
        }

        static bool CardTable(Placer p, double x, double z)
        {
            Prop? t = p.Add(PropKind.CardTable, x, z, 0, 0.9, 0.9, 0.74, variant: p.Rng.Int(0, 1));
            if (t == null)
                return false;
            p.Add(PropKind.Chair, x, z - 0.75, 0, 0.5, 0.52, 0.95);
            p.Add(PropKind.Chair, x, z + 0.75, Math.PI, 0.5, 0.52, 0.95);
            p.Add(PropKind.Chair, x - 0.75, z, Math.PI / 2, 0.5, 0.52, 0.95);
            p.Add(PropKind.Chair, x + 0.75, z, -Math.PI / 2, 0.5, 0.52, 0.95);
            return true;
        }

        static void Library(Placer p, bool wantBar)
        {
            Chandeliers(p, 50, 2);
            Side back = BackSide(p);
            Fireplace(p, Perpendicular(back));
            Bookcases(p, Cat(back, Perpendicular(back)), 2);
            // Long reading table on the long axis.
            Axis along = p.LongAxis;
            double tl = Math.Min(3.0, Math.Max(p.Width, p.Depth) - 4.5);
            if (tl >= 1.6)
            {
                double yaw = along == Axis.X ? Math.PI / 2 : 0;
                Prop? t = p.Add(PropKind.DiningTable, p.Cx, p.Cz, yaw, 1.1, tl, 0.78, variant: 2);
                if (t != null && p.Room.Lit > 0)
                {
                    p.Add(PropKind.Lamp, p.Cx, p.Cz, 0, 0.35, 0.35, 0.55, y: p.FloorY + 0.78, blocks: false, variant: 1);
                    p.Light(LightKind.Lamp, p.Cx, p.FloorY + 1.3, p.Cz, Warm, 55 * p.Room.Lit, 5);
                }
                if (t != null)
                {
                    foreach (int s in new[] { -1, 1 })
                    {
                        if (along == Axis.X)
                        {
                            p.Add(PropKind.Chair, p.Cx - tl / 4, p.Cz + s * 0.85, s > 0 ? Math.PI : 0, 0.5, 0.52, 0.95);
                            p.Add(PropKind.Chair, p.Cx + tl / 4, p.Cz + s * 0.85, s > 0 ? Math.PI : 0, 0.5, 0.52, 0.95);
                        }
                        else
                        {
                            p.Add(PropKind.Chair, p.Cx + s * 0.85, p.Cz - tl / 4, s > 0 ? -Math.PI / 2 : Math.PI / 2, 0.5, 0.52, 0.95);
                            p.Add(PropKind.Chair, p.Cx + s * 0.85, p.Cz + tl / 4, s > 0 ? -Math.PI / 2 : Math.PI / 2, 0.5, 0.52, 0.95);
                        }
                    }
                }
            }
            List<Side> wss = p.WindowSides();
            if (wss.Count > 0)
            {
                Side ws = wss[0];
                SideInfo info = p.SideOf(ws);
                Vec2 g = p.At(ws, info.T0 + (info.T1 - info.T0) * 0.15, 1.3);
                Mark(p.Add(PropKind.Globe, g.X, g.Z, 0, 0.7, 0.7, 1.05, variant: 0), PoiType.Globe);
                Vec2 a = p.At(ws, info.T0 + (info.T1 - info.T0) * 0.85, 1.4);
                p.Add(PropKind.Armchair, a.X, a.Z, SideYaw(ws) + Math.PI, 0.85, 0.85, 0.95, variant: 1);
            }
            if (wantBar)
                Bar(p);
            Sconces(p, 4);
        }

        static void DiningRoom(Placer p, bool wantBar)
        {
            Axis along = p.LongAxis;
            double longSide = Math.Max(p.Width, p.Depth);
            double tl = Math.Min(9, Math.Max(2.4, longSide - 3.4));
            double yaw = along == Axis.X ? Math.PI / 2 : 0;
            Prop? table = p.Add(PropKind.DiningTable, p.Cx, p.Cz, yaw, 1.25, tl, 0.76, variant: 0);
            if (table != null)
            {
                double n = Math.Max(2, Math.Floor((tl - 0.6) / 0.75));
                for (int k = 0; k < n; k++)
                {
                    double u = -tl / 2 + 0.55 + (k * (tl - 1.1)) / Math.Max(1, n - 1);
                    foreach (int s in new[] { -1, 1 })
                    {
                        if (along == Axis.X)
                            p.Add(PropKind.Chair, p.Cx + u, p.Cz + s * 0.95, s > 0 ? Math.PI : 0, 0.5, 0.52, 1.05, variant: 0);
                        else
                            p.Add(PropKind.Chair, p.Cx + s * 0.95, p.Cz + u, s > 0 ? -Math.PI / 2 : Math.PI / 2, 0.5, 0.52, 1.05, variant: 0);
                    }
                }
                foreach (int s in new[] { -1, 1 })
                {
                    if (along == Axis.X)
                        p.Add(PropKind.Chair, p.Cx + s * (tl / 2 + 0.45), p.Cz, s > 0 ? -Math.PI / 2 : Math.PI / 2, 0.55, 0.55, 1.15, variant: 0);
                    else
                        p.Add(PropKind.Chair, p.Cx, p.Cz + s * (tl / 2 + 0.45), s > 0 ? Math.PI : 0, 0.55, 0.55, 1.15, variant: 0);
                }
                // Candelabra down the table.
                int nc = tl > 5 ? 3 : 2;
                for (int k = 0; k < nc; k++)
                {
                    double u = -tl / 2 + ((k + 0.5) * tl) / nc;
                    double x = along == Axis.X ? p.Cx + u : p.Cx;
                    double z = along == Axis.Z ? p.Cz + u : p.Cz;
                    p.Add(PropKind.Lamp, x, z, 0, 0.35, 0.35, 0.6, y: p.FloorY + 0.76, blocks: false, variant: 2);
                    if (p.Room.Lit > 0)
                        p.Light(LightKind.Candles, x, p.FloorY + 1.3, z, Candle, 30 * p.Room.Lit, 4.5);
                }
            }
            Chandeliers(p, 30, 2);
            Side back = BackSide(p);
            Prop? sb = p.AgainstWall(back, PropKind.Sideboard, 2.2, 0.55, 0.95);
            if (sb != null && p.Room.Lit > 0)
                p.Light(LightKind.Candles, sb.X, p.FloorY + 1.3, sb.Z, Candle, 25 * p.Room.Lit, 4);
            Fireplace(p, Perpendicular(back));
            if (wantBar)
                Bar(p);
            Paintings(p, 4, poi: true);
            Sconces(p);
        }

        static void MusicRoom(Placer p, bool wantBar)
        {
            Chandeliers(p, 45, 2);
            List<Side> wss = p.WindowSides();
            Side ws = wss.Count > 0 ? wss[0] : p.SolidSides()[0];
            SideInfo info = p.SideOf(ws);
            double t = info.T0 + (info.T1 - info.T0) * p.Rng.Range(0.3, 0.7);
            Vec2 at = p.At(ws, t, 2.0);
            Prop? piano = p.Add(PropKind.GrandPiano, at.X, at.Z, SideYaw(ws) + Math.PI, 1.55, 2.1, 1.0);
            if (piano != null)
            {
                piano.Yaw = SideYaw(ws) + Math.PI + p.Rng.Range(-0.4, 0.4);
                piano.Poi = PoiType.Piano;
                Vec2 h = p.At(ws, t + (t > (info.T0 + info.T1) / 2 ? -1.9 : 1.9), 1.8);
                p.Add(PropKind.Harp, h.X, h.Z, SideYaw(ws) + Math.PI, 0.7, 1.0, 1.8, occludes: true);
            }
            // Two rows of chairs facing the piano.
            for (int row = 0; row < 2; row++)
            {
                for (int k = -2; k <= 2; k++)
                {
                    Vec2 c = p.At(ws, t + k * 0.75, 4.4 + row * 1.0);
                    p.Add(PropKind.Chair, c.X, c.Z, SideYaw(ws) + Math.PI, 0.5, 0.52, 0.95, variant: 1);
                }
            }
            Side back = Opposite(ws);
            p.AgainstWall(back, PropKind.Sofa, 2.1, 0.9, 0.85);
            if (wantBar)
                Bar(p);
            CornerStatues(p, 2, false, PropKind.Plant);
            Paintings(p, 3, poi: true);
            Sconces(p);
        }

        static readonly double[] StatueYaws = { 0, Math.PI };

        static void Gallery(Placer p, bool wantBar)
        {
            Chandeliers(p, 36, 4);
            Axis along = p.LongAxis;
            double longSide = Math.Max(p.Width, p.Depth);
            Side[] sides = along == Axis.X ? new[] { Side.N, Side.S } : new[] { Side.E, Side.W };
            Paintings(p, Math.Max(4, Math.Floor(longSide / 2.2) * 2), sides, poi: true, big: p.Rng.Chance(0.4));
            // Statues down the spine, benches between them.
            double n = Math.Max(2, Math.Floor(longSide / 5));
            for (int k = 0; k < n; k++)
            {
                double u = (k + 0.5) / n;
                double x = along == Axis.X ? p.Inner.X0 + u * p.Width : p.Cx;
                double z = along == Axis.Z ? p.Inner.Z0 + u * p.Depth : p.Cz;
                if (k % 2 == 0)
                    Mark(p.Add(PropKind.Statue, x, z, p.Rng.Pick(StatueYaws), 0.8, 0.8, 2.3, occludes: true, variant: p.Rng.Int(0, 3)), PoiType.Statue);
                else
                    p.Add(PropKind.Bench, x, z, along == Axis.X ? 0 : Math.PI / 2, 1.6, 0.5, 0.45);
            }
            if (wantBar)
                Bar(p);
            Sconces(p, 4);
        }

        static void BilliardRoom(Placer p, bool wantBar)
        {
            double yaw = p.LongAxis == Axis.X ? Math.PI / 2 : 0;
            Prop? t = p.Add(PropKind.BilliardTable, p.Cx, p.Cz, yaw, 1.7, 3.0, 0.82);
            if (t != null)
            {
                p.Add(PropKind.Lamp, p.Cx, p.Cz, yaw, 0.6, 2.2, 0.5, y: p.FloorY + 1.55, blocks: false, mount: PropMount.Ceiling, variant: 3);
                if (p.Room.Lit > 0)
                    p.Light(LightKind.Lamp, p.Cx, p.FloorY + 1.55, p.Cz, Warm, 140 * p.Room.Lit, 4.5);
            }
            Side back = BackSide(p);
            if (wantBar)
                Bar(p);
            p.OnWall(Perpendicular(back)[0], PropKind.Cabinet, 1.2, 1.3, p.FloorY + 1.4, variant: 2);
            foreach (Side s in Perpendicular(back))
            {
                Prop? a = p.AgainstWall(s, PropKind.Armchair, 0.85, 0.85, 0.95, variant: 1);
                if (a != null)
                    p.AgainstWall(s, PropKind.SideTable, 0.5, 0.5, 0.6);
            }
            Fireplace(p, new[] { back });
            Paintings(p, 3, poi: true);
            Sconces(p);
        }

        static void CardRoom(Placer p, bool wantBar)
        {
            Chandeliers(p, 40, 2);
            double cols = Math.Max(1, Math.Min(3, Math.Floor(p.Width / 3.2)));
            double rows = Math.Max(1, Math.Min(2, Math.Floor(p.Depth / 3.2)));
            for (int i = 0; i < cols; i++)
            {
                for (int j = 0; j < rows; j++)
                    CardTable(p, p.Inner.X0 + ((i + 0.5) * p.Width) / cols, p.Inner.Z0 + ((j + 0.5) * p.Depth) / rows);
            }
            if (wantBar)
                Bar(p);
            Side back = BackSide(p);
            Fireplace(p, Perpendicular(back));
            p.AgainstWall(back, PropKind.Sideboard, 2.0, 0.55, 0.95);
            Paintings(p, 3, poi: true);
            Sconces(p);
        }

        static void MorningRoom(Placer p, bool wantBar)
        {
            Chandeliers(p, 45, 1);
            List<Side> wss = p.WindowSides();
            if (wss.Count > 0)
            {
                Side ws = wss[0];
                SideInfo info = p.SideOf(ws);
                Vec2 at = p.At(ws, (info.T0 + info.T1) / 2, 1.9);
                if (p.Add(PropKind.CocktailTable, at.X, at.Z, 0, 1.1, 1.1, 0.75, variant: 2) != null)
                {
                    // Doubles throughout: -dx and -dz of a zero must stay a negative zero, as in the TypeScript (atan2 reads its sign).
                    foreach (var (dx, dz) in new[] { (0.8, 0.0), (-0.8, 0.0), (0.0, 0.8), (0.0, -0.8) })
                        p.Add(PropKind.Chair, at.X + dx, at.Z + dz, Math.Atan2(-dx, -dz), 0.5, 0.52, 0.95, variant: 1);
                }
            }
            Side back = BackSide(p);
            Vec2 c = p.At(back, (p.SideOf(back).T0 + p.SideOf(back).T1) / 2, 2.4);
            Conversation(p, c.X, c.Z, NorthSouth(back) ? Axis.Z : Axis.X);
            if (wantBar)
                Bar(p);
            p.AgainstWall(Perpendicular(back)[0], PropKind.Desk, 1.4, 0.7, 0.77);
            CornerStatues(p, 2, false, PropKind.Plant);
            Paintings(p, 3, poi: true);
            Sconces(p);
        }

        static void Conservatory(Placer p)
        {
            // Palms along the glass, wicker groups inside, a statue at the heart.
            foreach (Side s in Placer.Sides)
            {
                SideInfo info = p.SideOf(s);
                if (!info.Exterior)
                    continue;
                double n = Math.Floor((info.T1 - info.T0) / 1.8);
                for (int k = 0; k < n; k++)
                {
                    Vec2 at = p.At(s, info.T0 + (k + 0.5) * ((info.T1 - info.T0) / n), 0.55);
                    p.Add(PropKind.Plant, at.X, at.Z, 0, 0.8, 0.8, p.Rng.Range(1.6, 2.6), occludes: true, variant: p.Rng.Int(0, 2));
                }
            }
            Mark(p.Add(PropKind.Statue, p.Cx, p.Cz, 0, 0.9, 0.9, 2.2, occludes: true, variant: p.Rng.Int(0, 3)), PoiType.Statue);
            foreach (int dz in new[] { -1, 1 })
            {
                double z = p.Cz + dz * Math.Min(2.6, p.Depth / 3);
                double x = p.Cx + (p.Width > 5 ? dz * 1.6 : 0);
                if (p.Add(PropKind.CocktailTable, x, z, 0, 0.7, 0.7, 0.72, variant: 3) != null)
                {
                    p.Add(PropKind.Armchair, x - 0.8, z, Math.PI / 2, 0.75, 0.75, 0.9, variant: 2);
                    p.Add(PropKind.Armchair, x + 0.8, z, -Math.PI / 2, 0.75, 0.75, 0.9, variant: 2);
                }
            }
            if (p.Room.Lit > 0)
                p.Light(LightKind.Lamp, p.Cx, p.CeilY - 0.6, p.Cz, Warm, 120 * p.Room.Lit, 9);
        }

        static readonly Side[] EastWest = { Side.E, Side.W };

        static void EntranceHall(Placer p)
        {
            Chandeliers(p, 50, 2);
            // Statues flanking the axis, a ledger on a console by the door, a long-case clock.
            foreach (int s in new[] { -1, 1 })
                Mark(p.Add(PropKind.Statue, p.Cx + s * Math.Min(2.2, p.Width / 2 - 1.0), p.Cz, 0, 0.8, 0.8, 2.3, occludes: true, variant: p.Rng.Int(0, 3)), PoiType.Statue);
            Prop? led = null;
            foreach (Side s in p.SolidSides())
            {
                if ((led = p.AgainstWall(s, PropKind.Console, 1.5, 0.5, 0.88)) != null)
                    break;
            }
            if (led != null)
                led.Poi = PoiType.Ledger;
            p.AgainstWall(p.Rng.Pick(EastWest), PropKind.Console, 1.5, 0.5, 0.88);
            Mark(p.AgainstWall(p.Rng.Pick(EastWest), PropKind.Clock, 0.55, 0.38, 2.15, occludes: true), PoiType.Clock);
            foreach (Side s in EastWest)
                p.AgainstWall(s, PropKind.Bench, 1.6, 0.5, 0.45);
            Paintings(p, 2, poi: true);
            Sconces(p);
        }

        static void StairHall(Placer p)
        {
            Chandeliers(p, 60, 1);
            Paintings(p, 3, poi: true, big: true);
            CornerStatues(p, 1, true, PropKind.Bust);
            Sconces(p);
        }

        static void Corridor(Placer p)
        {
            Axis along = p.LongAxis;
            Side[] sides = along == Axis.X ? new[] { Side.N, Side.S } : new[] { Side.E, Side.W };
            double longSide = Math.Max(p.Width, p.Depth);
            double lit = p.Room.Lit;
            double n = Math.Max(1, Math.Floor(longSide / 6));
            for (int k = 0; k < n; k++)
            {
                double u = (k + 0.5) / n;
                double x = along == Axis.X ? p.Inner.X0 + u * p.Width : p.Cx;
                double z = along == Axis.Z ? p.Inner.Z0 + u * p.Depth : p.Cz;
                p.Add(PropKind.Chandelier, x, z, 0, 0.6, 0.6, 0.7, y: p.CeilY - 0.7, blocks: false, mount: PropMount.Ceiling, variant: 2);
                if (lit > 0)
                    p.Light(LightKind.Chandelier, x, p.CeilY - 0.5, z, Tungsten, 120 * lit, 7);
            }
            if (Math.Min(p.Width, p.Depth) >= 2.3)
            {
                foreach (Side s in sides)
                    p.AgainstWall(s, p.Rng.Chance(0.5) ? PropKind.Console : PropKind.Bench, 1.3, 0.38, 0.85);
                if (longSide > 14)
                    Mark(p.AgainstWall(p.Rng.Pick(sides), PropKind.Clock, 0.55, 0.38, 2.15, occludes: true), PoiType.Clock);
            }
            Paintings(p, Math.Floor(longSide / 4), sides, poi: true);
            if (longSide > 6)
                p.Add(PropKind.Rug, p.Cx, p.Cz, along == Axis.X ? Math.PI / 2 : 0, Math.Min(p.Width, p.Depth) * 0.55, longSide - 1.2, 0.012, blocks: false, variant: 4);
        }

        /// <summary>Ring gallery round the dome hall: kept clear to walk, lit by the chandelier and wall lights.</summary>
        static void HallGallery(Placer p)
        {
            if (p.Dome != null)
                DomeChandelier(p, false);
            Sconces(p, 3.2);
            Paintings(p, 3, poi: true);
        }

        /// <summary>Roof terrace: open air, a few tables and planters; the lanterns are exterior lights.</summary>
        static void RoofTerrace(Placer p)
        {
            double longSide = Math.Max(p.Width, p.Depth);
            double n = Math.Max(1, Num.Round(longSide / 6));
            for (int k = 0; k < n; k++)
            {
                double t = (k + 0.5) / n;
                double x = p.LongAxis == Axis.X ? p.Inner.X0 + t * p.Width : p.Cx;
                double z = p.LongAxis == Axis.Z ? p.Inner.Z0 + t * p.Depth : p.Cz;
                p.Add(PropKind.CocktailTable, x, z, 0, 0.75, 0.75, 1.05, variant: 1);
            }
            Rect i = p.Inner;
            foreach (var (x, z) in new[] { (i.X0 + 0.5, i.Z0 + 0.5), (i.X1 - 0.5, i.Z0 + 0.5), (i.X0 + 0.5, i.Z1 - 0.5), (i.X1 - 0.5, i.Z1 - 0.5) })
                p.Add(PropKind.Plant, x, z, 0, 0.6, 0.6, 1.4, occludes: true);
        }

        static void Landing(Placer p)
        {
            Chandeliers(p, 60, 1);
            p.AgainstWall(p.SolidSides()[0], PropKind.Console, 1.4, 0.45, 0.85);
            Paintings(p, 2, poi: true);
            Sconces(p);
        }

        static void Study(Placer p)
        {
            List<Side> wss = p.WindowSides();
            if (wss.Count > 0)
            {
                Side ws = wss[0];
                SideInfo info = p.SideOf(ws);
                Vec2 at = p.At(ws, (info.T0 + info.T1) / 2, 1.6);
                if (p.Add(PropKind.Desk, at.X, at.Z, SideYaw(ws), 1.6, 0.8, 0.77) != null)
                {
                    double dx =
                        ws == Side.E ? -0.7
                        : ws == Side.W ? 0.7
                        : 0;
                    double dz =
                        ws == Side.N ? -0.7
                        : ws == Side.S ? 0.7
                        : 0;
                    p.Add(PropKind.Chair, at.X + dx, at.Z + dz, SideYaw(ws) + Math.PI, 0.6, 0.6, 1.1, variant: 2);
                    if (p.Room.Lit > 0)
                    {
                        p.Add(PropKind.Lamp, at.X, at.Z, 0, 0.35, 0.35, 0.55, y: p.FloorY + 0.77, blocks: false, variant: 1);
                        p.Light(LightKind.Lamp, at.X, p.FloorY + 1.3, at.Z, Warm, 60 * p.Room.Lit, 5);
                    }
                }
            }
            Side back = BackSide(p);
            Bookcases(p, new[] { back }, 1);
            Rect i = p.Inner;
            if (Mark(p.Add(PropKind.Safe, i.X0 + 0.5, i.Z0 + 0.45, 0, 0.7, 0.6, 1.0), PoiType.Safe) == null)
                Mark(p.Add(PropKind.Safe, i.X1 - 0.5, i.Z0 + 0.45, 0, 0.7, 0.6, 1.0), PoiType.Safe);
            Fireplace(p, Perpendicular(back));
            p.AgainstWall(Perpendicular(back)[1], PropKind.Armchair, 0.85, 0.85, 0.95, variant: 1);
            // Every study has its globe.
            Globe(p);
            Paintings(p, 2);
            if (p.Room.Lit > 0)
                Chandeliers(p, 60, 1);
        }

        static void Service(Placer p)
        {
            List<Side> solid = p.SolidSides();
            for (int k = 0; k < 2 && k < solid.Count; k++)
                p.AgainstWall(solid[k], PropKind.Cabinet, 1.4, 0.5, 1.9, occludes: true);
            if (p.Room.Lit > 0)
                p.Light(LightKind.Lamp, p.Cx, p.CeilY - 0.3, p.Cz, Tungsten, 60 * p.Room.Lit, 5);
        }

        static void Bedroom(Placer p)
        {
            List<Side> wss = p.WindowSides();
            List<Side> sides = wss.Count > 0 ? Cat(Opposite(wss[0]), Perpendicular(wss[0])) : p.SolidSides();
            foreach (Side s in sides)
            {
                Prop? bed = p.AgainstWall(s, PropKind.Bed, 1.8, 2.2, 2.3, variant: p.Rng.Int(0, 1));
                if (bed != null)
                {
                    double t = NorthSouth(s) ? bed.X : bed.Z;
                    foreach (double d in new[] { -1.35, 1.35 })
                    {
                        Prop? st = p.AgainstWall(s, PropKind.SideTable, 0.5, 0.45, 0.62, prefer: t + d, sweep: false);
                        if (st != null && p.Room.Lit > 0)
                        {
                            p.Add(PropKind.Lamp, st.X, st.Z, 0, 0.32, 0.32, 0.5, y: p.FloorY + 0.62, blocks: false);
                            p.Light(LightKind.Lamp, st.X, p.FloorY + 1.05, st.Z, Warm, 45 * p.Room.Lit, 4.5);
                        }
                    }
                    break;
                }
            }
            foreach (Side s in p.SolidSides())
            {
                if (p.AgainstWall(s, PropKind.Wardrobe, 1.6, 0.6, 2.3, occludes: true) != null)
                    break;
            }
            p.AgainstWall(p.SolidSides()[1], PropKind.Console, 1.2, 0.5, 0.8);
            p.Add(PropKind.Armchair, p.Inner.X0 + 1.0, p.Inner.Z1 - 1.0, Math.PI * 0.75, 0.85, 0.85, 0.95);
            p.Add(PropKind.Rug, p.Cx, p.Cz, 0, Math.Min(3.2, p.Width - 1.2), Math.Min(2.4, p.Depth - 1.2), 0.012, blocks: false, variant: p.Rng.Int(0, 3));
            Paintings(p, 2);
            if (p.Room.Lit > 0.5)
                Chandeliers(p, 60, 1);
        }

        static void SittingRoom(Placer p)
        {
            Side back = BackSide(p);
            Vec2 c = p.At(back, (p.SideOf(back).T0 + p.SideOf(back).T1) / 2, 2.3);
            Conversation(p, c.X, c.Z, NorthSouth(back) ? Axis.Z : Axis.X);
            p.AgainstWall(Perpendicular(back)[0], PropKind.Bookcase, 1.2, 0.45, Math.Min(2.4, p.CeilY - p.FloorY - 0.4), occludes: true);
            p.AgainstWall(Perpendicular(back)[1], PropKind.Desk, 1.4, 0.7, 0.77);
            Paintings(p, 2);
            if (p.Room.Lit > 0)
                Chandeliers(p, 60, 1);
        }

        static void DressingRoom(Placer p)
        {
            List<Side> solid = p.SolidSides();
            for (int k = 0; k < 2 && k < solid.Count; k++)
                p.AgainstWall(solid[k], PropKind.Wardrobe, 1.6, 0.6, 2.3, occludes: true);
            List<Side> again = p.SolidSides();
            p.OnWall(again.Count > 2 ? again[2] : Side.N, PropKind.Mirror, 0.9, 1.6, p.FloorY + 1.3);
            if (p.Room.Lit > 0)
                p.Light(LightKind.Lamp, p.Cx, p.CeilY - 0.3, p.Cz, Warm, 40 * p.Room.Lit, 4);
        }

        static void Bathroom(Placer p)
        {
            List<Side> solid = p.SolidSides();
            foreach (Side side in solid)
            {
                if (p.AgainstWall(side, PropKind.Bathtub, 1.8, 0.85, 0.62) != null)
                    break;
            }
            p.AgainstWall(solid.Count > 1 ? solid[1] : solid[0], PropKind.Cabinet, 1.2, 0.55, 0.9, variant: 1);
            p.OnWall(solid.Count > 2 ? solid[2] : solid[0], PropKind.Mirror, 0.8, 1.1, p.FloorY + 1.5);
            if (p.Room.Lit > 0)
                p.Light(LightKind.Lamp, p.Cx, p.CeilY - 0.3, p.Cz, Tungsten, 35 * p.Room.Lit, 4);
        }

        /// <summary>Furthest from the windows first: where the things that want a blank wall go.</summary>
        static List<Side> WallsBackFirst(Placer p)
        {
            Side back = BackSide(p);
            return Cat(Cat(back, Perpendicular(back)), Opposite(back));
        }

        static readonly double[] GlobeWallFractions = { 0.15, 0.85, 0.5, 0.3, 0.7 };
        static readonly double[] GlobeFloorFractions = { 0.5, 0.3, 0.7, 0.2, 0.8 };

        /// <summary>Globe by a window, or failing that anywhere along the walls.</summary>
        static bool Globe(Placer p)
        {
            var order = new List<Side>(p.WindowSides());
            order.AddRange(p.SolidSides());
            foreach (Side side in order)
            {
                SideInfo info = p.SideOf(side);
                foreach (double f in GlobeWallFractions)
                {
                    Vec2 at = p.At(side, info.T0 + (info.T1 - info.T0) * f, 1.1);
                    if (Mark(p.Add(PropKind.Globe, at.X, at.Z, 0, 0.7, 0.7, 1.05, variant: 0), PoiType.Globe) != null)
                        return true;
                }
            }
            // Anywhere it fits, from the middle of the room outward.
            foreach (double fx in GlobeFloorFractions)
            {
                foreach (double fz in GlobeFloorFractions)
                {
                    if (Mark(p.Add(PropKind.Globe, p.Inner.X0 + p.Width * fx, p.Inner.Z0 + p.Depth * fz, 0, 0.6, 0.6, 1.05, variant: 0), PoiType.Globe) != null)
                        return true;
                }
            }
            return false;
        }

        /// <summary>The living room of the house: two or three sofa groups round a fireplace, far larger than a drawing room's.</summary>
        static void GreatRoom(Placer p)
        {
            Chandeliers(p, 40, 3);
            Side back = BackSide(p);
            Fireplace(p, Cat(back, Perpendicular(back)));
            Axis along = p.LongAxis;
            Axis cross = along == Axis.X ? Axis.Z : Axis.X;
            foreach (double f in p.LongAxis == Axis.X ? new[] { 0.5, 0.2, 0.8 } : new[] { 0.5, 0.22, 0.78 })
            {
                double cx = along == Axis.X ? p.Inner.X0 + p.Width * f : p.Cx;
                double cz = along == Axis.Z ? p.Inner.Z0 + p.Depth * f : p.Cz;
                Conversation(p, cx, cz, cross);
            }
            foreach (Side side in Perpendicular(back))
            {
                Prop? cs = p.AgainstWall(side, PropKind.Console, 1.8, 0.5, 0.9);
                if (cs != null && p.Room.Lit > 0)
                {
                    p.Add(PropKind.Lamp, cs.X, cs.Z, 0, 0.4, 0.4, 0.7, y: p.FloorY + 0.9, blocks: false);
                    p.Light(LightKind.Lamp, cs.X, p.FloorY + 1.45, cs.Z, Warm, 55 * p.Room.Lit, 5);
                }
            }
            p.AgainstWall(back, PropKind.Bookcase, 1.6, 0.45, Math.Min(2.6, p.CeilY - p.FloorY - 0.45), occludes: true);
            CornerStatues(p, 2, false, PropKind.Plant);
            CornerStatues(p, 1, true, PropKind.Statue);
            Paintings(p, 5, poi: true, big: true);
            Sconces(p);
        }

        /// <summary>Show kitchen: a range under its hood on the back wall, a long marble island, dressers of china.</summary>
        static void Kitchen(Placer p)
        {
            double lit = Math.Max(0.6, p.Room.Lit);
            Side? rangeSide = null;
            foreach (Side side in WallsBackFirst(p))
            {
                if (p.AgainstWall(side, PropKind.Range, 2.2, 0.75, 2.4, occludes: true) != null)
                {
                    rangeSide = side;
                    break;
                }
            }
            Axis along = p.LongAxis;
            double il = Math.Min(4.2, (along == Axis.X ? p.Width : p.Depth) - 3.2);
            if (il >= 1.8)
            {
                Prop? isl = p.Add(PropKind.KitchenIsland, p.Cx, p.Cz, along == Axis.X ? 0 : Math.PI / 2, il, 1.1, 0.92);
                if (isl != null)
                {
                    foreach (double k in new[] { -0.3, 0.3 })
                        p.Light(LightKind.Lamp, p.Cx + (along == Axis.X ? il * k : 0), p.FloorY + 2.3, p.Cz + (along == Axis.Z ? il * k : 0), Tungsten, 70 * lit, 5);
                }
            }
            int n = 0;
            foreach (Side side in WallsBackFirst(p))
            {
                if (side == rangeSide)
                {
                    SideInfo info = p.SideOf(side);
                    foreach (double f in new[] { 0.15, 0.85 })
                        p.AgainstWall(side, PropKind.Sideboard, 1.6, 0.6, 0.92, prefer: info.T0 + (info.T1 - info.T0) * f, sweep: false);
                    continue;
                }
                if (n++ < 2)
                    p.AgainstWall(side, PropKind.Cabinet, 1.6, 0.5, 2.1, occludes: true);
            }
            p.Light(LightKind.Lamp, p.Cx, p.CeilY - 0.3, p.Cz, Tungsten, 80 * lit, 6);
        }

        /// <summary>Bar and wine cellar: the bar itself, walls of bottles, standing tables.</summary>
        static void BarRoom(Placer p)
        {
            if (!p.Props.Exists(q => q.Poi == PoiType.Bar) && !Bar(p))
            {
                // No wall will take it: an island bar in the middle of the room.
                Prop? c = p.Add(PropKind.BarCounter, p.Cx, p.Cz, p.LongAxis == Axis.X ? 0 : Math.PI / 2, 2.6, 0.7, 1.1, occludes: false);
                if (c != null)
                {
                    c.Poi = PoiType.Bar;
                    if (p.Room.Lit > 0)
                        p.Light(LightKind.Lamp, p.Cx, p.FloorY + 2.3, p.Cz, Warm, 80, 5);
                }
            }
            double h = Math.Min(2.6, p.CeilY - p.FloorY - 0.5);
            int racks = 0;
            foreach (Side side in WallsBackFirst(p))
            {
                foreach (var (a, b) in p.FreeRuns(side, h, 1.3))
                {
                    double count = Math.Min(4 - racks, Math.Max(1, Math.Floor((b - a) / 1.45)));
                    for (int k = 0; k < count; k++)
                    {
                        double t = a + (k + 0.5) * ((b - a) / count);
                        if (p.AgainstWall(side, PropKind.WineRack, 1.3, 0.4, h, prefer: t, sweep: false, occludes: true) != null)
                            racks++;
                    }
                    if (racks >= 4)
                        break;
                }
                if (racks >= 4)
                    break;
            }
            foreach (var (fx, fz) in new[] { (0.35, 0.5), (0.65, 0.5), (0.5, 0.3) })
                p.Add(PropKind.CocktailTable, p.Inner.X0 + p.Width * fx, p.Inner.Z0 + p.Depth * fz, 0, 0.75, 0.75, 1.05, variant: 1);
            Paintings(p, 2);
            Sconces(p, 3.2);
            if (p.Room.Lit > 0)
                p.Light(LightKind.Lamp, p.Cx, p.CeilY - 0.4, p.Cz, Candle, 60 * p.Room.Lit, 6);
        }

        /// <summary>Home cinema: a screen on a blank wall, rows of armchairs facing it, low light.</summary>
        static void Cinema(Placer p)
        {
            Side? screenSide = null;
            double sh = Math.Min(2.4, p.CeilY - p.FloorY - 1.4);
            foreach (Side side in WallsBackFirst(p))
            {
                double len = p.SideOf(side).T1 - p.SideOf(side).T0;
                // The widest screen the wall takes between its doors.
                foreach (double sw in new[] { Math.Min(5.2, len - 1.2), 3.6, 2.6 })
                {
                    if (sw < 2.4 || sw > len - 0.6)
                        continue;
                    if (p.OnWall(side, PropKind.CinemaScreen, sw, sh, p.FloorY + 0.9 + sh / 2) != null)
                    {
                        screenSide = side;
                        break;
                    }
                }
                if (screenSide != null)
                    break;
            }
            if (screenSide.HasValue)
            {
                Side ss = screenSide.Value;
                SideInfo info = p.SideOf(ss);
                double mid = (info.T0 + info.T1) / 2;
                double depth = NorthSouth(ss) ? p.Depth : p.Width;
                double cols = Math.Max(2, Math.Min(6, Math.Floor((info.T1 - info.T0 - 2.2) / 1.05)));
                for (int row = 0; row < 4; row++)
                {
                    double off = 3.2 + row * 1.5;
                    if (off > depth - 1.4)
                        break;
                    for (int c = 0; c < cols; c++)
                    {
                        Vec2 at = p.At(ss, mid + (c - (cols - 1) / 2) * 1.05, off);
                        p.Add(PropKind.Armchair, at.X, at.Z, SideYaw(ss) + Math.PI, 0.85, 0.85, 0.95, variant: 1);
                    }
                }
                // The glow of the picture.
                Vec2 g = p.At(ss, mid, 1.2);
                p.Light(LightKind.Lamp, g.X, p.FloorY + 2.0, g.Z, new[] { 0.75, 0.85, 1.0 }, 55 * Math.Max(0.5, p.Room.Lit), 7);
            }
            p.AgainstWall(Opposite(screenSide ?? BackSide(p)), PropKind.Sideboard, 1.6, 0.5, 0.9);
            Sconces(p, 4.5);
        }

        /// <summary>Spa and pool: the pool down the middle of the room, loungers along both sides, palms in the corners.</summary>
        static void Spa(Placer p)
        {
            Axis along = p.LongAxis;
            double len = along == Axis.X ? p.Width : p.Depth;
            double cross = along == Axis.X ? p.Depth : p.Width;
            double yaw = along == Axis.X ? 0 : Math.PI / 2;
            Prop? pool = null;
            // As large as leaves a walk all round; smaller if doors need the room.
            foreach (double k in new[] { 1, 0.8, 0.6 })
            {
                double L0 = (len - 3.6) * k;
                double Wd = Math.Min(5, cross - 4.4) * (k == 1 ? 1 : 0.85);
                if (L0 < 3 || Wd < 2)
                    break;
                pool = p.Add(PropKind.Pool, p.Cx, p.Cz, yaw, L0, Wd, 0.12);
                if (pool != null)
                    break;
            }
            if (pool != null)
            {
                double L = pool.W;
                double off = pool.D / 2 + 1.0;
                if (p.Room.Lit > 0)
                {
                    // Underwater lights.
                    foreach (double k in new[] { -0.3, 0.3 })
                        p.Light(LightKind.Lamp, p.Cx + (along == Axis.X ? L * k : 0), p.FloorY + 0.4, p.Cz + (along == Axis.Z ? L * k : 0), new[] { 0.45, 0.85, 1.0 }, 70 * p.Room.Lit, 6);
                }
                double n = Math.Max(1, Math.Floor(L / 2.6));
                foreach (int s in new[] { -1, 1 })
                {
                    for (int k = 0; k < n; k++)
                    {
                        double t = ((k + 0.5) / n - 0.5) * L;
                        double x = p.Cx + (along == Axis.X ? t : s * off);
                        double z = p.Cz + (along == Axis.Z ? t : s * off);
                        p.Add(PropKind.Bench, x, z, yaw, 1.9, 0.7, 0.42);
                    }
                }
            }
            Rect i = p.Inner;
            foreach (double inset in new[] { 0.6, 1.0 })
            {
                foreach (var (x, z) in new[] { (i.X0 + inset, i.Z0 + inset), (i.X1 - inset, i.Z0 + inset), (i.X0 + inset, i.Z1 - inset), (i.X1 - inset, i.Z1 - inset) })
                {
                    if (!p.Props.Exists(q => q.Kind == PropKind.Plant && Num.Hypot(q.X - x, q.Z - z) < 1.2))
                        p.Add(PropKind.Plant, x, z, 0, 0.6, 0.6, 1.6, occludes: true);
                }
            }
            CornerStatues(p, 1, true, PropKind.Statue);
            Sconces(p, 3.6);
            if (p.Room.Lit > 0)
                p.Light(LightKind.Lamp, p.Cx, p.CeilY - 0.4, p.Cz, Warm, 70 * p.Room.Lit, 7);
        }

        /// <summary>Gym: machines facing the windows, weights along a wall, a mirror wall.</summary>
        static void Gym(Placer p)
        {
            List<Side> wss = p.WindowSides();
            Side ws = wss.Count > 0 ? wss[0] : Opposite(BackSide(p));
            SideInfo info = p.SideOf(ws);
            double n = Math.Max(1, Math.Min(4, Math.Floor((info.T1 - info.T0 - 1) / 1.5)));
            for (int k = 0; k < n; k++)
            {
                Vec2 at = p.At(ws, info.T0 + ((k + 0.5) * (info.T1 - info.T0)) / n, 1.9);
                p.Add(PropKind.Treadmill, at.X, at.Z, SideYaw(ws) + Math.PI, 0.85, 1.9, 1.4);
            }
            Side back = BackSide(p);
            foreach (Side side in Cat(back, Perpendicular(back)))
            {
                if (p.AgainstWall(side, PropKind.Weights, 2.2, 0.6, 1.1) != null)
                    break;
            }
            foreach (Side side in Perpendicular(back))
                p.OnWall(side, PropKind.Mirror, 1.8, 1.9, p.FloorY + 1.25);
            p.Add(PropKind.Bench, p.Cx, p.Cz, p.LongAxis == Axis.X ? 0 : Math.PI / 2, 1.4, 0.45, 0.45);
            if (p.Room.Lit > 0)
                p.Light(LightKind.Lamp, p.Cx, p.CeilY - 0.3, p.Cz, Tungsten, 60 * p.Room.Lit, 6);
        }

        static readonly double[] StageFractions = { 1, 0.75, 0.55, 0.4 };
        static readonly int[] StageAligns = { 0, -1, 1 };

        /// <summary>Private theatre: a stage at one end, rows of chairs facing it, an aisle down the middle.</summary>
        static void Theatre(Placer p)
        {
            Chandeliers(p, 55, 2);
            Axis along = p.LongAxis;
            double len = along == Axis.X ? p.Width : p.Depth;
            // Stage at an end of the long axis, the blanker end first; narrower, or to one side, if doors are in the way.
            List<Side> solid = p.SolidSides();
            var ends = new List<Side>(along == Axis.X ? new[] { Side.W, Side.E } : new[] { Side.N, Side.S });
            Sorting.StableSort(ends, (a, b) => solid.IndexOf(a) - solid.IndexOf(b));
            double sd = Math.Min(3.6, Math.Max(2.2, len * 0.26));
            Prop? stage = null;
            Side end = ends[0];
            double mid = 0;
            double sw = 0;
            // Last resort: any wall, and over a door's clear zone so long as every door can still be reached.
            for (int pass = 0; pass < 2; pass++)
            {
                foreach (Side e in pass == 0 ? ends : solid)
                {
                    SideInfo info = p.SideOf(e);
                    double full = Math.Min(9, info.T1 - info.T0 - 0.6);
                    foreach (double frac in StageFractions)
                    {
                        double w = full * frac;
                        if (w < 2.4)
                            break;
                        foreach (int align in StageAligns)
                        {
                            double t = (info.T0 + info.T1) / 2 + (align * (info.T1 - info.T0 - 0.6 - w)) / 2;
                            Vec2 at = p.At(e, t, sd / 2 + 0.05);
                            stage = p.Add(PropKind.Stage, at.X, at.Z, SideYaw(e), w, sd, 0.7, occludes: false, ignoreKeep: pass == 1);
                            if (stage != null)
                            {
                                end = e;
                                mid = t;
                                sw = w;
                                goto placedStage;
                            }
                            if (frac == 1)
                                break;
                        }
                    }
                }
            }
            placedStage:
            if (stage != null)
            {
                SideInfo info = p.SideOf(end);
                double centre = (info.T0 + info.T1) / 2;
                double cols = Math.Max(2, Math.Min(8, Math.Floor((info.T1 - info.T0 - 2.4) / 0.75)));
                double run = NorthSouth(end) ? p.Depth : p.Width;
                for (int row = 0; row < 6; row++)
                {
                    double off = sd + 1.8 + row * 1.05;
                    if (off > run - 1.6)
                        break;
                    for (int c = 0; c < cols; c++)
                    {
                        // Aisle down the middle.
                        double k = c - (cols - 1) / 2;
                        Vec2 a = p.At(end, centre + k * 0.75 + Num.Sign(Num.Or(k, 1)) * 0.5, off);
                        p.Add(PropKind.Chair, a.X, a.Z, SideYaw(end) + Math.PI, 0.5, 0.52, 0.95, variant: 1);
                    }
                }
                // Footlights.
                foreach (double k in new[] { -0.3, 0.3 })
                {
                    Vec2 f = p.At(end, mid + sw * k, sd + 0.3);
                    p.Light(LightKind.Lamp, f.X, p.FloorY + 1.0, f.Z, Warm, 80 * Math.Max(0.5, p.Room.Lit), 6);
                }
            }
            Paintings(p, 2);
            Sconces(p, 3.6);
        }

        /// <summary>Furnish a room by its type.</summary>
        public static void Run(RoomType type, Placer p, bool wantBar)
        {
            switch (type)
            {
                case RoomType.Ballroom:
                    Ballroom(p, wantBar);
                    break;
                case RoomType.GrandSalon:
                case RoomType.DrawingRoom:
                    DrawingRoom(p, wantBar);
                    break;
                case RoomType.MusicRoom:
                    MusicRoom(p, wantBar);
                    break;
                case RoomType.Library:
                    Library(p, wantBar);
                    break;
                case RoomType.DiningRoom:
                    DiningRoom(p, wantBar);
                    break;
                case RoomType.Gallery:
                    Gallery(p, wantBar);
                    break;
                case RoomType.BilliardRoom:
                    BilliardRoom(p, wantBar);
                    break;
                case RoomType.CardRoom:
                    CardRoom(p, wantBar);
                    break;
                case RoomType.MorningRoom:
                    MorningRoom(p, wantBar);
                    break;
                case RoomType.Conservatory:
                    Conservatory(p);
                    break;
                case RoomType.EntranceHall:
                    EntranceHall(p);
                    break;
                case RoomType.StairHall:
                    StairHall(p);
                    break;
                case RoomType.Corridor:
                    Corridor(p);
                    break;
                case RoomType.Landing:
                    Landing(p);
                    break;
                case RoomType.HallGallery:
                    HallGallery(p);
                    break;
                case RoomType.RoofTerrace:
                    RoofTerrace(p);
                    break;
                case RoomType.ServiceStair:
                    break;
                case RoomType.Study:
                    Study(p);
                    break;
                case RoomType.Cloakroom:
                case RoomType.Pantry:
                    Service(p);
                    break;
                case RoomType.GreatRoom:
                    GreatRoom(p);
                    break;
                case RoomType.Kitchen:
                    Kitchen(p);
                    break;
                case RoomType.Bar:
                    BarRoom(p);
                    break;
                case RoomType.Cinema:
                    Cinema(p);
                    break;
                case RoomType.Spa:
                    Spa(p);
                    break;
                case RoomType.Gym:
                    Gym(p);
                    break;
                case RoomType.Theatre:
                    Theatre(p);
                    break;
                case RoomType.Disco:
                    Disco(p);
                    break;
                case RoomType.Bedroom:
                    Bedroom(p);
                    break;
                case RoomType.SittingRoom:
                    SittingRoom(p);
                    break;
                case RoomType.DressingRoom:
                    DressingRoom(p);
                    break;
                case RoomType.Bathroom:
                    Bathroom(p);
                    break;
            }
        }
    }
}
