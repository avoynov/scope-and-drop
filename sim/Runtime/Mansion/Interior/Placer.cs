using System;
using System.Collections.Generic;
using ScopeAndDrop.Sim.Core;

namespace ScopeAndDrop.Sim.Mansion
{
    /// <summary>A wall of a room, by the direction it faces from the room's centre: N is +z, S is -z, E is +x, W is -x.</summary>
    public enum Side
    {
        N,
        S,
        E,
        W,
    }

    public sealed class SideOpening
    {
        public double T0;
        public double T1;
        public double Y0;
        public double Y1;
        public OpeningKind Kind;
        public bool Exterior;
        public bool Passable;
    }

    public sealed class SideInfo
    {
        public Side Side;

        /// <summary>Coordinate of the inner wall face (z for N/S, x for E/W).</summary>
        public double Line;
        public double T0;
        public double T1;
        public List<SideOpening> Openings = new List<SideOpening>();
        public bool Exterior;
        public int Windows;
    }

    /// <summary>
    /// Constraint-checked furniture placement inside one room. Port of src/mansion/interior/placer.ts.
    /// Every blocking prop must (1) sit inside the clear interior, (2) avoid other props, door clearances and stairwells, (3) not stand in
    /// front of a window it would block, and (4) keep every door and mission stand-point reachable, verified by a flood fill after each
    /// placement (rejected props are dropped).
    /// </summary>
    public sealed class Placer
    {
        /// <summary>The four sides in the TypeScript's order (n, s, e, w).</summary>
        public static readonly Side[] Sides = { Side.N, Side.S, Side.E, Side.W };

        /// <summary>Yaw that makes a prop's front (+z local) face into the room from each wall.</summary>
        public static double SideYaw(Side s) =>
            s switch
            {
                Side.N => Math.PI,
                Side.S => 0,
                Side.E => -Math.PI / 2,
                _ => Math.PI / 2,
            };

        sealed class WallBand
        {
            public string? PropId;
            public Side Side;
            public double T0;
            public double T1;

            /// <summary>Top of floor-standing item against the wall, or [y0, y1] of a hung item.</summary>
            public double Y0;
            public double Y1;
        }

        public readonly struct Occupied
        {
            public readonly Rect R;
            public readonly Prop Prop;

            public Occupied(Rect r, Prop prop)
            {
                R = r;
                Prop = prop;
            }
        }

        public readonly Room Room;
        readonly SideInfo[] sides = new SideInfo[4];
        public readonly List<Occupied> Occ = new List<Occupied>();
        public readonly List<Rect> Keep = new List<Rect>();
        public readonly List<Rect> Blocked;
        public readonly List<Prop> Props = new List<Prop>();
        public readonly List<LightSpec> Lights = new List<LightSpec>();
        readonly List<WallBand> bands = new List<WallBand>();
        public readonly List<Vec2> MustReach = new List<Vec2>();
        readonly List<Vec2> doorPoints = new List<Vec2>();
        public readonly Rng Rng;
        readonly Func<string> propId;
        readonly Func<string> lightId;

        /// <summary>Set for the dome hall and its galleries: where the great chandelier hangs.</summary>
        public Vec3? Dome;

        public Placer(Room room, IReadOnlyList<Wall> walls, List<Rect> blocked, Rng rng, Func<string> propId, Func<string> lightId)
        {
            Room = room;
            Blocked = blocked;
            Rng = rng;
            this.propId = propId;
            this.lightId = lightId;
            Rect r = room.Rect;
            Rect i = room.Inner;
            sides[(int)Side.N] = Mk(Side.N, i.Z1, i.X0, i.X1);
            sides[(int)Side.S] = Mk(Side.S, i.Z0, i.X0, i.X1);
            sides[(int)Side.E] = Mk(Side.E, i.X1, i.Z0, i.Z1);
            sides[(int)Side.W] = Mk(Side.W, i.X0, i.Z0, i.Z1);
            foreach (Wall w in walls)
            {
                if (w.Neg != room.Id && w.Pos != room.Id)
                    continue;
                Side? side = null;
                if (w.Axis == Axis.X && Math.Abs(w.A.Z - r.Z1) < 1e-3 && w.Neg == room.Id)
                    side = Side.N;
                else if (w.Axis == Axis.X && Math.Abs(w.A.Z - r.Z0) < 1e-3 && w.Pos == room.Id)
                    side = Side.S;
                else if (w.Axis == Axis.Z && Math.Abs(w.A.X - r.X1) < 1e-3 && w.Neg == room.Id)
                    side = Side.E;
                else if (w.Axis == Axis.Z && Math.Abs(w.A.X - r.X0) < 1e-3 && w.Pos == room.Id)
                    side = Side.W;
                if (side == null)
                    continue;
                Side s = side.Value;
                SideInfo info = sides[(int)s];
                if (w.Exterior)
                    info.Exterior = true;
                double basePos = w.Axis == Axis.X ? w.A.X : w.A.Z;
                foreach (Opening o in w.Openings)
                {
                    info.Openings.Add(
                        new SideOpening
                        {
                            T0 = basePos + o.U0,
                            T1 = basePos + o.U1,
                            Y0 = o.Y0,
                            Y1 = o.Y1,
                            Kind = o.Kind,
                            Exterior = w.Exterior,
                            Passable = o.Passable,
                        }
                    );
                    if (w.Exterior && o.Glazed && o.Frosted != true)
                        info.Windows++;
                    if (o.Passable && o.Y0 < room.FloorY + 0.5)
                    {
                        // Door clearance zone and a reachability probe just inside the door.
                        double tc = basePos + (o.U0 + o.U1) / 2;
                        double depth = o.Kind == OpeningKind.FrenchWindow ? 0.9 : 1.15;
                        double half = (o.U1 - o.U0) / 2 + 0.15;
                        int inward = s == Side.N || s == Side.E ? -1 : 1;
                        if (s == Side.N || s == Side.S)
                        {
                            Keep.Add(Rect.Of(tc - half, info.Line, tc + half, info.Line + inward * depth));
                            doorPoints.Add(new Vec2(tc, info.Line + inward * 0.45));
                        }
                        else
                        {
                            Keep.Add(Rect.Of(info.Line, tc - half, info.Line + inward * depth, tc + half));
                            doorPoints.Add(new Vec2(info.Line + inward * 0.45, tc));
                        }
                    }
                }
            }
        }

        static SideInfo Mk(Side side, double line, double t0, double t1) =>
            new SideInfo
            {
                Side = side,
                Line = line,
                T0 = t0,
                T1 = t1,
            };

        public SideInfo SideOf(Side s) => sides[(int)s];

        /// <summary>
        /// Restrict the stretch of each wall that furniture may use (the rotunda's curved wall hides the back corners of the rectangle the
        /// room is planned on).
        /// </summary>
        public void LimitWalls(double[] backX, double[] sideZ)
        {
            static void Clamp(SideInfo info, double lo, double hi)
            {
                info.T0 = Math.Max(info.T0, lo);
                info.T1 = Math.Max(info.T0, Math.Min(info.T1, hi));
            }
            Clamp(SideOf(Side.S), backX[0], backX[1]);
            Clamp(SideOf(Side.E), sideZ[0], sideZ[1]);
            Clamp(SideOf(Side.W), sideZ[0], sideZ[1]);
        }

        public double FloorY => Room.FloorY;
        public double CeilY => Room.CeilingY;
        public Rect Inner => Room.Inner;
        public double Width => Inner.X1 - Inner.X0;
        public double Depth => Inner.Z1 - Inner.Z0;
        public double Cx => (Inner.X0 + Inner.X1) / 2;
        public double Cz => (Inner.Z0 + Inner.Z1) / 2;
        public Axis LongAxis => Width >= Depth ? Axis.X : Axis.Z;

        /// <summary>Sides with exterior glazing, most windows first.</summary>
        public List<Side> WindowSides()
        {
            var output = new List<Side>(4);
            foreach (Side s in Sides)
            {
                if (SideOf(s).Windows > 0)
                    output.Add(s);
            }
            Sorting.StableSort(output, (a, b) => SideOf(b).Windows - SideOf(a).Windows);
            return output;
        }

        /// <summary>Sides ordered by how much uninterrupted wall they offer.</summary>
        public List<Side> SolidSides()
        {
            double Score(Side s)
            {
                SideInfo info = SideOf(s);
                double len = info.T1 - info.T0;
                double cut = 0;
                foreach (SideOpening o in info.Openings)
                    cut += o.T1 - o.T0;
                return len - cut * 1.5 - info.Windows * 2;
            }
            var output = new List<Side>(Sides);
            Sorting.StableSort(output, (a, b) => Sorting.Cmp(Score(b) - Score(a)));
            return output;
        }

        public Rect Footprint(double x, double z, double yaw, double w, double d)
        {
            int q = Num.ToInt32(Num.Round(yaw / (Math.PI / 2))) & 1;
            double hw = (q != 0 ? d : w) / 2;
            double hd = (q != 0 ? w : d) / 2;
            return Rect.Of(x - hw, z - hd, x + hw, z + hd);
        }

        public bool IsFree(Rect r, bool ignoreKeep = false)
        {
            Rect i = Inner;
            if (r.X0 < i.X0 - 1e-3 || r.X1 > i.X1 + 1e-3 || r.Z0 < i.Z0 - 1e-3 || r.Z1 > i.Z1 + 1e-3)
                return false;
            foreach (Occupied o in Occ)
            {
                if (Geom.Overlaps(o.R, r, 1e-3))
                    return false;
            }
            foreach (Rect b in Blocked)
            {
                if (Geom.Overlaps(b, r, 1e-3))
                    return false;
            }
            if (!ignoreKeep)
            {
                foreach (Rect k in Keep)
                {
                    if (Geom.Overlaps(k, r, 1e-3))
                        return false;
                }
            }
            return true;
        }

        /// <summary>Flood fill on a 0.25 m grid: are all doors and stand points mutually reachable?</summary>
        public bool Connected()
        {
            var pts = new List<Vec2>(doorPoints.Count + MustReach.Count);
            pts.AddRange(doorPoints);
            pts.AddRange(MustReach);
            if (pts.Count <= 1)
                return true;
            const double cell = 0.25;
            Rect i = Inner;
            int cols = (int)Math.Max(1, Math.Ceiling((i.X1 - i.X0) / cell));
            int rows = (int)Math.Max(1, Math.Ceiling((i.Z1 - i.Z0) / cell));
            var grid = new byte[cols * rows];
            // Stricter than the nav grid's agent so placer-connected implies nav-connected.
            const double agent = 0.28;
            var obstacles = new List<Rect>(Occ.Count + Blocked.Count);
            foreach (Occupied o in Occ)
                obstacles.Add(o.R);
            obstacles.AddRange(Blocked);
            for (int r = 0; r < rows; r++)
            {
                double z = i.Z0 + (r + 0.5) * cell;
                for (int c = 0; c < cols; c++)
                {
                    double x = i.X0 + (c + 0.5) * cell;
                    bool blocked = x < i.X0 + agent || x > i.X1 - agent || z < i.Z0 + agent || z > i.Z1 - agent;
                    if (!blocked)
                    {
                        foreach (Rect o in obstacles)
                        {
                            if (x > o.X0 - agent && x < o.X1 + agent && z > o.Z0 - agent && z < o.Z1 + agent)
                            {
                                blocked = true;
                                break;
                            }
                        }
                    }
                    grid[r * cols + c] = blocked ? (byte)1 : (byte)0;
                }
            }
            int Idx(Vec2 p)
            {
                int c = (int)Math.Min(cols - 1, Math.Max(0, Math.Floor((p.X - i.X0) / cell)));
                int r = (int)Math.Min(rows - 1, Math.Max(0, Math.Floor((p.Z - i.Z0) / cell)));
                return r * cols + c;
            }
            int start = Idx(pts[0]);
            if (grid[start] != 0)
                return false;
            var seen = new byte[cols * rows];
            var stack = new Stack<int>();
            stack.Push(start);
            seen[start] = 1;
            while (stack.Count > 0)
            {
                int k = stack.Pop();
                int c = k % cols;
                int r = (k - c) / cols;
                int n0 = c > 0 ? k - 1 : -1;
                int n1 = c < cols - 1 ? k + 1 : -1;
                int n2 = r > 0 ? k - cols : -1;
                int n3 = r < rows - 1 ? k + cols : -1;
                Visit(n0);
                Visit(n1);
                Visit(n2);
                Visit(n3);
            }
            void Visit(int n)
            {
                if (n >= 0 && seen[n] == 0 && grid[n] == 0)
                {
                    seen[n] = 1;
                    stack.Push(n);
                }
            }
            foreach (Vec2 p in pts)
            {
                if (seen[Idx(p)] != 1)
                    return false;
            }
            return true;
        }

        public Prop? Add(
            PropKind kind,
            double x,
            double z,
            double yaw,
            double w,
            double d,
            double h,
            double? y = null,
            bool? blocks = null,
            bool? occludes = null,
            PropMount mount = PropMount.Floor,
            int? variant = null,
            string? color = null,
            bool ignoreKeep = false,
            bool force = false
        )
        {
            bool blocksNav = blocks ?? true;
            Rect fp = Footprint(x, z, yaw, w, d);
            if (blocksNav && !force && !IsFree(fp, ignoreKeep))
                return null;
            var prop = new Prop
            {
                Id = propId(),
                Kind = kind,
                RoomId = Room.Id,
                Level = Room.Level,
                X = R(x),
                Y = R(y ?? FloorY),
                Z = R(z),
                Yaw = R(yaw),
                W = R(w),
                D = R(d),
                H = R(h),
                Variant = variant ?? 0,
                Color = color,
                Mount = mount,
                BlocksNav = blocksNav,
                Occludes = occludes ?? false,
            };
            if (blocksNav)
            {
                Occ.Add(new Occupied(fp, prop));
                if (!force && !Connected())
                {
                    Occ.RemoveAt(Occ.Count - 1);
                    return null;
                }
            }
            Props.Add(prop);
            return prop;
        }

        public void Remove(Prop prop)
        {
            int i = Props.IndexOf(prop);
            if (i >= 0)
                Props.RemoveAt(i);
            int j = Occ.FindIndex(o => o.Prop == prop);
            if (j >= 0)
                Occ.RemoveAt(j);
            for (int k = bands.Count - 1; k >= 0; k--)
            {
                if (bands[k].PropId == prop.Id)
                    bands.RemoveAt(k);
            }
        }

        /// <summary>Is span [t0, t1] on a side clear of openings that an item from yBottom to yTop would clash with?</summary>
        public bool SpanClear(Side side, double t0, double t1, double yTop, double? yBottom = null)
        {
            double yb = yBottom ?? FloorY;
            SideInfo info = SideOf(side);
            if (t0 < info.T0 - 1e-3 || t1 > info.T1 + 1e-3)
                return false;
            foreach (SideOpening o in info.Openings)
            {
                if (t1 > o.T0 - 0.12 && t0 < o.T1 + 0.12 && yTop > o.Y0 - 0.05 && yb < o.Y1 + 0.05)
                    return false;
            }
            foreach (WallBand b in bands)
            {
                if (b.Side == side && t1 > b.T0 && t0 < b.T1 && yTop > b.Y0 && yb < b.Y1)
                    return false;
            }
            return true;
        }

        /// <summary>Free stretches of a side for items of height h (sorted by length, longest first).</summary>
        public List<(double a, double b)> FreeRuns(Side side, double h, double minLen)
        {
            SideInfo info = SideOf(side);
            var cuts = new List<(double a, double b)>();
            foreach (SideOpening o in info.Openings)
            {
                if (h + FloorY > o.Y0 - 0.05)
                    cuts.Add((o.T0 - 0.15, o.T1 + 0.15));
            }
            foreach (WallBand b in bands)
            {
                if (b.Side == side && FloorY + h > b.Y0 && FloorY < b.Y1)
                    cuts.Add((b.T0, b.T1));
            }
            Sorting.StableSort(cuts, (p, q) => Sorting.Cmp(p.a - q.a));
            var runs = new List<(double a, double b)>();
            double cur = info.T0 + 0.05;
            foreach (var (a, b) in cuts)
            {
                if (a > cur)
                    runs.Add((cur, Math.Min(a, info.T1 - 0.05)));
                cur = Math.Max(cur, b);
            }
            if (info.T1 - 0.05 > cur)
                runs.Add((cur, info.T1 - 0.05));
            List<(double a, double b)> kept = runs.FindAll(r => r.b - r.a >= minLen);
            Sorting.StableSort(kept, (p, q) => Sorting.Cmp(q.b - q.a - (p.b - p.a)));
            return kept;
        }

        /// <summary>Plan point at distance off from a side's wall face, at position t along it.</summary>
        public Vec2 At(Side side, double t, double off)
        {
            SideInfo info = SideOf(side);
            return side switch
            {
                Side.N => new Vec2(t, info.Line - off),
                Side.S => new Vec2(t, info.Line + off),
                Side.E => new Vec2(info.Line - off, t),
                _ => new Vec2(info.Line + off, t),
            };
        }

        /// <summary>Place a floor item with its back to a wall. Tries prefer first, then sweeps.</summary>
        public Prop? AgainstWall(
            Side side,
            PropKind kind,
            double w,
            double d,
            double h,
            double? prefer = null,
            double? gap = null,
            bool? occludes = null,
            int? variant = null,
            string? color = null,
            bool? blocks = null,
            bool sweep = true
        )
        {
            SideInfo info = SideOf(side);
            double g = gap ?? 0.04;
            double mid = (info.T0 + info.T1) / 2;
            double pref = prefer ?? mid;
            var cands = new List<double>(sweep ? 79 : 1) { pref };
            if (sweep)
            {
                for (int k = 1; k < 40; k++)
                {
                    cands.Add(pref + k * 0.3);
                    cands.Add(pref - k * 0.3);
                }
            }
            foreach (double t in cands)
            {
                if (t - w / 2 < info.T0 + 0.02 || t + w / 2 > info.T1 - 0.02)
                    continue;
                if (!SpanClear(side, t - w / 2, t + w / 2, FloorY + h))
                    continue;
                Vec2 p = At(side, t, g + d / 2);
                Prop? prop = Add(kind, p.X, p.Z, SideYaw(side), w, d, h, occludes: occludes, variant: variant, color: color, blocks: blocks);
                if (prop != null)
                {
                    bands.Add(
                        new WallBand
                        {
                            PropId = prop.Id,
                            Side = side,
                            T0 = t - w / 2,
                            T1 = t + w / 2,
                            Y0 = FloorY,
                            Y1 = FloorY + h,
                        }
                    );
                    return prop;
                }
            }
            return null;
        }

        /// <summary>Hang an item on a wall (painting, mirror, sconce).</summary>
        public Prop? OnWall(Side side, PropKind kind, double w, double h, double yc, double? prefer = null, bool sweep = true, int? variant = null, string? color = null)
        {
            SideInfo info = SideOf(side);
            double mid = (info.T0 + info.T1) / 2;
            double pref = prefer ?? mid;
            var cands = new List<double>(sweep ? 59 : 1) { pref };
            if (sweep)
            {
                for (int k = 1; k < 30; k++)
                {
                    cands.Add(pref + k * 0.35);
                    cands.Add(pref - k * 0.35);
                }
            }
            foreach (double t in cands)
            {
                double t0 = t - w / 2;
                double t1 = t + w / 2;
                if (t0 < info.T0 + 0.15 || t1 > info.T1 - 0.15)
                    continue;
                if (!SpanClear(side, t0, t1, yc + h / 2, yc - h / 2))
                    continue;
                Vec2 p = At(side, t, 0.04);
                Prop? prop = Add(kind, p.X, p.Z, SideYaw(side), w, 0.08, h, y: yc - h / 2, blocks: false, mount: PropMount.Wall, variant: variant, color: color);
                if (prop != null)
                {
                    bands.Add(
                        new WallBand
                        {
                            PropId = prop.Id,
                            Side = side,
                            T0 = t0 - 0.2,
                            T1 = t1 + 0.2,
                            Y0 = yc - h / 2 - 0.15,
                            Y1 = yc + h / 2 + 0.15,
                        }
                    );
                    return prop;
                }
            }
            return null;
        }

        public void Light(LightKind kind, double x, double y, double z, double[] color, double intensity, double range)
        {
            Lights.Add(
                new LightSpec
                {
                    Id = lightId(),
                    Kind = kind,
                    Scope = Room.Id,
                    X = R(x),
                    Y = R(y),
                    Z = R(z),
                    Color = (double[])color.Clone(),
                    Intensity = R(intensity),
                    Range = R(range),
                }
            );
        }

        public T Pick<T>(IReadOnlyList<T> items) => Rng.Pick(items);

        static double R(double v) => Num.Round(v * 1000) / 1000;
    }
}
