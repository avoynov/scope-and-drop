using System;
using System.Collections.Generic;
using ScopeAndDrop.Sim.Core;

namespace ScopeAndDrop.Sim.Mansion
{
    /// <summary>
    /// Wall derivation (stage 3). Port of src/mansion/layout/walls.ts.
    /// Walls are not authored; they fall out of the room rectangles. For every axis-aligned line we sweep the room edges lying on it and
    /// emit one wall segment per run with a constant (room-on-negative-side, room-on-positive-side) pair. A null side means outside, which
    /// makes the segment a facade wall.
    /// </summary>
    public static class Walls
    {
        public const double ExteriorT = Massing.ExteriorT;
        public const double InteriorT = Massing.InteriorT;
        public const double MassJointT = 0.5;
        public const double GlassT = 0.16;

        struct Edge
        {
            public Axis Axis;
            public double Line;
            public double T0;
            public double T1;
            public bool Pos;
            public RoomDraft Room;

            public Edge(Axis axis, double line, double t0, double t1, bool pos, RoomDraft room)
            {
                Axis = axis;
                Line = line;
                T0 = t0;
                T1 = t1;
                Pos = pos;
                Room = room;
            }
        }

        sealed class Seg
        {
            public double A;
            public double B;
            public RoomDraft? Neg;
            public RoomDraft? Pos;
        }

        /// <summary>Rooms occupying a level, including double-height rooms rising from below.</summary>
        public static List<RoomDraft> RoomsOnLevel(List<RoomDraft> rooms, int level) => rooms.FindAll(r => r.Level == level || (r.DoubleHeight && r.Level == level - 1));

        static int KindOrder(MassKind k) =>
            k switch
            {
                MassKind.Pavilion => 0,
                MassKind.Conservatory => 1,
                MassKind.Wing => 2,
                _ => 3,
            };

        public static Mass? MassAt(IReadOnlyList<Mass> masses, double x, double z, int minLevels = 1)
        {
            // Most specific first: pavilions/conservatories sit inside or against the main block.
            // The first mass of the most specific kind, in list order (a stable sort by kind, then the first).
            Mass? best = null;
            for (int i = 0; i < masses.Count; i++)
            {
                Mass m = masses[i];
                if (m.Levels < minLevels || !Geom.ContainsPoint(m.Rect, x, z, 1e-3))
                    continue;
                if (best == null || KindOrder(m.Kind) < KindOrder(best.Kind))
                    best = m;
            }
            return best;
        }

        public static List<Wall> Derive(List<RoomDraft> rooms, List<LevelSpec> levels, IReadOnlyList<Mass> masses, double conservatoryHeight)
        {
            var walls = new List<Wall>();
            int maxLevel = int.MinValue;
            foreach (RoomDraft r in rooms)
                maxLevel = Math.Max(maxLevel, r.Level + (r.DoubleHeight ? 1 : 0));
            for (int L = 0; L <= maxLevel; L++)
            {
                List<RoomDraft> present = RoomsOnLevel(rooms, L);
                var groups = new OrderedMap<string, List<Edge>>();
                foreach (RoomDraft r in present)
                {
                    Rect rr = r.Rect;
                    AddEdge(groups, new Edge(Axis.X, rr.Z0, rr.X0, rr.X1, true, r));
                    AddEdge(groups, new Edge(Axis.X, rr.Z1, rr.X0, rr.X1, false, r));
                    AddEdge(groups, new Edge(Axis.Z, rr.X0, rr.Z0, rr.Z1, true, r));
                    AddEdge(groups, new Edge(Axis.Z, rr.X1, rr.Z0, rr.Z1, false, r));
                }
                var keys = new List<string>(groups.Keys);
                Sorting.SortOrdinal(keys);
                int n = 0;
                foreach (string key in keys)
                {
                    List<Edge> edges = groups[key];
                    Axis axis = edges[0].Axis;
                    double line = edges[0].Line;
                    var bps = new List<double>(edges.Count * 2);
                    foreach (Edge e in edges)
                    {
                        bps.Add(Num.Round(e.T0 * 1000) / 1000);
                        bps.Add(Num.Round(e.T1 * 1000) / 1000);
                    }
                    // A Set then a numeric sort: sorting first (stably) and dropping repeats keeps the same values in the same order.
                    Sorting.StableSort(bps, (p, q) => Sorting.Cmp(p - q));
                    var unique = new List<double>(bps.Count);
                    foreach (double v in bps)
                    {
                        if (unique.Count == 0 || unique[unique.Count - 1] != v)
                            unique.Add(v);
                    }
                    var segs = new List<Seg>();
                    for (int k = 0; k + 1 < unique.Count; k++)
                    {
                        double a = unique[k];
                        double b = unique[k + 1];
                        double mid = (a + b) / 2;
                        RoomDraft? neg = null;
                        RoomDraft? pos = null;
                        foreach (Edge e in edges)
                        {
                            if (!e.Pos && e.T0 <= mid && mid <= e.T1)
                            {
                                neg = e.Room;
                                break;
                            }
                        }
                        foreach (Edge e in edges)
                        {
                            if (e.Pos && e.T0 <= mid && mid <= e.T1)
                            {
                                pos = e.Room;
                                break;
                            }
                        }
                        if (neg == null && pos == null)
                            continue;
                        Seg? last = segs.Count > 0 ? segs[segs.Count - 1] : null;
                        if (last != null && Geom.Near(last.B, a) && last.Neg == neg && last.Pos == pos)
                            last.B = b;
                        else
                            segs.Add(
                                new Seg
                                {
                                    A = a,
                                    B = b,
                                    Neg = neg,
                                    Pos = pos,
                                }
                            );
                    }
                    foreach (Seg s in segs)
                    {
                        bool exterior = s.Neg == null || s.Pos == null;
                        RoomDraft inside = s.Neg ?? s.Pos!;
                        LevelSpec lv = levels[Math.Min(L, levels.Count - 1)];
                        FacadeSide? side = null;
                        if (exterior)
                        {
                            if (axis == Axis.X)
                                side = s.Pos != null ? FacadeSide.Entrance : FacadeSide.Garden;
                            else
                                side = s.Pos != null ? FacadeSide.West : FacadeSide.East;
                        }
                        bool conservatoryOnly = (s.Neg?.Zone ?? RoomZone.Conservatory) == RoomZone.Conservatory && (s.Pos?.Zone ?? RoomZone.Conservatory) == RoomZone.Conservatory;
                        bool glazed = exterior && inside.Zone == RoomZone.Conservatory;
                        bool crossMass = !exterior && s.Neg!.MassId != s.Pos!.MassId;
                        double thickness =
                            glazed ? GlassT
                            : exterior ? ExteriorT
                            : crossMass ? MassJointT
                            : InteriorT;
                        // Mass that owns the wall: sample just inside the building.
                        double mid = (s.A + s.B) / 2;
                        double inward = s.Neg != null ? -0.3 : 0.3;
                        double px = axis == Axis.X ? mid : line + inward;
                        double pz = axis == Axis.X ? line + inward : mid;
                        string owner = MassAt(masses, px, pz)?.Id ?? inside.MassId;
                        Vec2 wa = axis == Axis.X ? new Vec2(s.A, line) : new Vec2(line, s.A);
                        Vec2 wb = axis == Axis.X ? new Vec2(s.B, line) : new Vec2(line, s.B);
                        walls.Add(
                            new Wall
                            {
                                Id = "w" + Num.ToText(L) + "-" + Num.ToText(n++),
                                Level = L,
                                MassId = owner,
                                A = wa,
                                B = wb,
                                Axis = axis,
                                Thickness = thickness,
                                Y0 = lv.FloorY,
                                Y1 = conservatoryOnly ? lv.FloorY + conservatoryHeight : lv.FloorY + lv.Height,
                                Exterior = exterior,
                                Side = side,
                                Neg = s.Neg?.Id,
                                Pos = s.Pos?.Id,
                                Glazed = glazed ? true : (bool?)null,
                            }
                        );
                    }
                }
            }
            return walls;
        }

        static void AddEdge(OrderedMap<string, List<Edge>> groups, Edge e)
        {
            string key = e.Axis.Text() + ":" + Num.ToFixed(e.Line, 3);
            if (!groups.TryGetValue(key, out List<Edge> g))
            {
                g = new List<Edge>();
                groups.Set(key, g);
            }
            g.Add(e);
        }

        public static double WallLength(Wall w) => w.Axis == Axis.X ? w.B.X - w.A.X : w.B.Z - w.A.Z;

        /// <summary>Clear interior rectangle: room rect inset by half the thickest wall on each edge.</summary>
        public static Rect InnerRect(RoomDraft room, IReadOnlyList<Wall> walls)
        {
            Rect rr = room.Rect;
            int L = room.Level;
            double OnEdge(Axis axis, double line, double t0, double t1)
            {
                double t = 0;
                for (int i = 0; i < walls.Count; i++)
                {
                    Wall w = walls[i];
                    if (w.Axis != axis || (w.Level != L && !(room.DoubleHeight && w.Level == L + 1)))
                        continue;
                    double wl = axis == Axis.X ? w.A.Z : w.A.X;
                    if (!Geom.Near(wl, line, 1e-3))
                        continue;
                    double a = axis == Axis.X ? w.A.X : w.A.Z;
                    double b = axis == Axis.X ? w.B.X : w.B.Z;
                    if (b <= t0 + 1e-3 || a >= t1 - 1e-3)
                        continue;
                    if (w.Neg != room.Id && w.Pos != room.Id)
                        continue;
                    t = Math.Max(t, w.Thickness);
                }
                return t / 2;
            }
            return new Rect(
                rr.X0 + OnEdge(Axis.Z, rr.X0, rr.Z0, rr.Z1),
                rr.Z0 + OnEdge(Axis.X, rr.Z0, rr.X0, rr.X1),
                rr.X1 - OnEdge(Axis.Z, rr.X1, rr.Z0, rr.Z1),
                rr.Z1 - OnEdge(Axis.X, rr.Z1, rr.X0, rr.X1)
            );
        }
    }
}
