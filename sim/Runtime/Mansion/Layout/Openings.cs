using System;
using System.Collections.Generic;
using ScopeAndDrop.Sim.Core;

namespace ScopeAndDrop.Sim.Mansion
{
    public sealed class OpeningContext
    {
        public Rng Rng;
        public MassingPlan M;
        public StyleDef Style;
        public List<LevelSpec> Levels;
        public List<Mass> Masses;
        public OrderedMap<string, PlacedRoom> Rooms;
        public List<Wall> Walls;

        /// <summary>Plan areas a door must not open onto, per room (stairs, stairwells).</summary>
        public OrderedMap<string, List<Rect>> Blocked;

        /// <summary>Opening id counter: "o0", "o1"... in creation order (the TypeScript keeps it in module state, reset per generation).</summary>
        public int Seq;

        public OpeningContext(
            Rng rng,
            MassingPlan m,
            StyleDef style,
            List<LevelSpec> levels,
            List<Mass> masses,
            OrderedMap<string, PlacedRoom> rooms,
            List<Wall> walls,
            OrderedMap<string, List<Rect>> blocked
        )
        {
            Rng = rng;
            M = m;
            Style = style;
            Levels = levels;
            Masses = masses;
            Rooms = rooms;
            Walls = walls;
            Blocked = blocked;
        }

        public string NextId(string prefix) => prefix + Num.ToText(Seq++);
    }

    public sealed class TerraceSpec
    {
        public string Id = "";
        public Rect Rect;
        public int Level;
        public string MassId = "";
    }

    public sealed class Retype
    {
        public string Id = "";
        public RoomType From;
        public RoomType To;
    }

    public sealed class DoorPlanResult
    {
        /// <summary>Rooms retyped to keep circulation sensible.</summary>
        public List<Retype> Retyped = new List<Retype>();
        public List<string> Unreachable = new List<string>();
        public List<string> PassViolations = new List<string>();

        /// <summary>Walls opened as column screens.</summary>
        public List<string> Screens = new List<string>();
    }

    /// <summary>
    /// Openings (stage 5): facade windows on the bay rhythm, then doors chosen as a graph problem so that every room is reachable and private
    /// rooms are never the only way through (cf. GFLAN's pass-through rule). Port of src/mansion/layout/openings.ts.
    /// </summary>
    public static class Openings
    {
        /// <summary>Plan position of a point u metres along the wall.</summary>
        public static Vec2 WallPoint(Wall w, double u) => w.Axis == Axis.X ? new Vec2(w.A.X + u, w.A.Z) : new Vec2(w.A.X, w.A.Z + u);

        static double UOf(Wall w, double x, double z) => w.Axis == Axis.X ? x - w.A.X : z - w.A.Z;

        static bool Fits(Wall w, double u0, double u1, double gap = 0.22, double margin = 0.3)
        {
            if (u0 < margin || u1 > Walls.WallLength(w) - margin)
                return false;
            foreach (Opening o in w.Openings)
            {
                if (!(u1 + gap <= o.U0 || u0 >= o.U1 + gap))
                    return false;
            }
            return true;
        }

        /* ------------------------------------------------------------------ */
        /* Windows                                                             */
        /* ------------------------------------------------------------------ */

        sealed class WindowSpec
        {
            public OpeningKind Kind;
            public double Width;
            public double Sill;
            public double Head;
            public int[] Panes = new int[2];
            public int Leaves;
            public bool Passable;

            /// <summary>Overrides the style's usual dressing (giant windows).</summary>
            public OpeningDressing? Dressing;
            public bool Bare;
        }

        static WindowSpec Window(OpeningKind kind, double width, double sill, double head, int cols, int rows, int leaves, bool passable) =>
            new WindowSpec
            {
                Kind = kind,
                Width = width,
                Sill = sill,
                Head = head,
                Panes = new[] { cols, rows },
                Leaves = leaves,
                Passable = passable,
            };

        static WindowSpec WindowSpecFor(OpeningContext ctx, Wall w, PlacedRoom room, bool terraceFacing)
        {
            MassingPlan m = ctx.M;
            LevelSpec lv = ctx.Levels[w.Level];
            double b = m.Bay;
            RoomRole role = Rooms.Role(room.Type);
            if (ctx.Style.GiantWindows == true && terraceFacing && (role == RoomRole.Party || role == RoomRole.Circulation))
            {
                // One giant arched window per bay through every storey: glass from the floor to just under the
                // ceiling on each, the floor edge between them behind an iron panel, the top one arched.
                Mass? owner = ctx.Masses.Find(ms => ms.Id == w.MassId);
                int storeys = owner?.Levels ?? ctx.Levels.Count;
                bool topStorey = w.Level >= storeys - 1;
                double width = Math.Min(3.4, 0.74 * b);
                double sill = lv.FloorY + (w.Level == 0 ? 0 : 0.12);
                double head = topStorey ? lv.CeilingY - 0.5 : lv.CeilingY - 0.04;
                LevelSpec? next = w.Level + 1 < ctx.Levels.Count ? ctx.Levels[w.Level + 1] : null;
                WindowSpec spec = Window(w.Level == 0 ? OpeningKind.FrenchWindow : OpeningKind.Window, width, sill, head, 4, w.Level == 0 ? 5 : 3, w.Level == 0 ? 2 : 1, w.Level == 0);
                spec.Bare = true;
                spec.Dressing = topStorey
                    ? new OpeningDressing { Giant = true, Arch = Math.Min(width / 2, 1.5) }
                    : new OpeningDressing { Giant = true, Spandrel = next != null ? Geom.Snap(next.FloorY + 0.12 - head, 0.01) : 0 };
                return spec;
            }
            if (w.Level == 0 && terraceFacing && role != RoomRole.Service)
            {
                // Wide glazing on the stage front: about 70% of each bay is glass, so the sniper reads the room, not the piers.
                double width = Math.Min(3.1, Math.Max(2.4, 0.7 * b));
                return Window(OpeningKind.FrenchWindow, width, lv.FloorY, lv.FloorY + Math.Min(3.9, lv.Height - 1.1), 3, 5, 2, true);
            }
            if (w.Level == 0)
            {
                double width = Math.Min(1.7, Math.Max(1.3, 0.38 * b));
                double sill = lv.FloorY + 0.75;
                return Window(OpeningKind.Window, width, sill, sill + Math.Min(2.95, lv.Height - 1.85), 3, 4, 1, false);
            }
            if (w.Level >= 1 && role == RoomRole.Party && terraceFacing)
            {
                // Upstairs reception rooms get tall, wide sashes: guests there should be seen too.
                double width = Math.Min(2.6, Math.Max(1.9, 0.56 * b));
                double sill = lv.FloorY + 0.45;
                return Window(OpeningKind.Window, width, sill, sill + Math.Min(3.0, lv.Height - 1.15), 4, 4, 1, false);
            }
            if (w.Level == 1)
            {
                double width = Math.Min(1.6, Math.Max(1.25, 0.36 * b));
                double sill = lv.FloorY + 0.65;
                return Window(OpeningKind.Window, width, sill, sill + Math.Min(2.8, lv.Height - 1.3), 3, 4, 1, false);
            }
            {
                double width = Math.Min(1.3, Math.Max(1.0, 0.3 * b));
                double sill = lv.FloorY + 0.75;
                return Window(OpeningKind.Window, width, sill, sill + Math.Min(1.7, lv.Height - 1.35), 2, 3, 1, false);
            }
        }

        static OpeningDressing DressingFor(StyleDef style, int level, FacadeSide? side, int bayIndex)
        {
            bool main = side == FacadeSide.Garden || side == FacadeSide.Entrance;
            switch (style.Id)
            {
                case StyleId.Palladian:
                    if (level == 0 && main)
                        return new OpeningDressing { Surround = true, Pediment = bayIndex % 2 == 0 ? PedimentShape.Triangle : PedimentShape.Segment };
                    return new OpeningDressing { Surround = true };
                case StyleId.Georgian:
                    return new OpeningDressing { Surround = true, Keystone = true };
                case StyleId.Beauxarts:
                    if (level == 0)
                        return new OpeningDressing { Surround = true, Keystone = true };
                    if (level == 1 && main)
                        return new OpeningDressing
                        {
                            Surround = true,
                            Balconette = true,
                            Pediment = PedimentShape.Segment,
                        };
                    return new OpeningDressing { Surround = true };
                default:
                    // Round-headed windows throughout.
                    return new OpeningDressing { Surround = true, Arch = 0.55 };
            }
        }

        static Curtain CurtainFor(Rng rng, PlacedRoom room)
        {
            RoomRole role = Rooms.Role(room.Type);
            double r = rng.Next();
            if (role == RoomRole.Party || role == RoomRole.Circulation)
                return r < 0.08 ? Curtain.Sheer : Curtain.Open;
            if (r < 0.22)
                return Curtain.Drawn;
            if (r < 0.45)
                return Curtain.Sheer;
            return Curtain.Open;
        }

        static readonly double[] RoofProbes = { 0.25, 0.5, 0.75 };

        /// <summary>Is the ground just outside this wall covered by another (lower) mass?</summary>
        static bool FacesRoof(OpeningContext ctx, Wall w)
        {
            double len = Walls.WallLength(w);
            double outward = w.Neg != null ? 0.8 : -0.8;
            foreach (double t in RoofProbes)
            {
                Vec2 p = WallPoint(w, len * t);
                double x = w.Axis == Axis.Z ? p.X + outward : p.X;
                double z = w.Axis == Axis.X ? p.Z + outward : p.Z;
                foreach (Mass ms in ctx.Masses)
                {
                    if (Geom.ContainsPoint(ms.Rect, x, z, -0.05))
                        return true;
                }
            }
            return false;
        }

        public static void PlaceWindows(OpeningContext ctx)
        {
            MassingPlan m = ctx.M;
            StyleDef style = ctx.Style;
            Rng rng = ctx.Rng;
            foreach (Wall w in ctx.Walls)
            {
                if (!w.Exterior)
                    continue;
                PlacedRoom room = ctx.Rooms[(w.Neg ?? w.Pos)!];
                double len = Walls.WallLength(w);
                LevelSpec lv = ctx.Levels[w.Level];

                if (w.Glazed == true)
                {
                    // Conservatory curtain wall: one continuous glazed band above a low stone sill.
                    w.Openings.Add(
                        new Opening
                        {
                            Id = ctx.NextId("o"),
                            Kind = OpeningKind.Window,
                            U0 = 0.25,
                            U1 = len - 0.25,
                            Y0 = lv.FloorY + 0.55,
                            Y1 = w.Y1 - 0.25,
                            Glazed = true,
                            Passable = false,
                            Panes = new[] { (int)Math.Max(2, Num.Round(len / 0.8)), 4 },
                            Leaves = 1,
                            Curtain = Curtain.Open,
                        }
                    );
                    continue;
                }
                if (FacesRoof(ctx, w))
                    continue;
                if (w.Level > 0 && room.Type == RoomType.ServiceStair && len < 3)
                    continue;

                WingSpec? wing = m.Wings.Find(wg => wg.Id == w.MassId);
                bool terraceFacing =
                    w.Side == FacadeSide.Garden
                    || (
                        wing != null && wing.Toward == FacadeSide.Garden && ((wing.Side == FacadeSide.West && w.Side == FacadeSide.East) || (wing.Side == FacadeSide.East && w.Side == FacadeSide.West))
                    );
                WindowSpec spec = WindowSpecFor(ctx, w, room, terraceFacing);
                var centres = new List<(double u, int bay)>();
                if (w.Axis == Axis.X)
                {
                    for (int i = 0; i < m.Bays; i++)
                    {
                        double x = -m.W / 2 + (i + 0.5) * m.Bay;
                        centres.Add((UOf(w, x, w.A.Z), i));
                    }
                }
                else if (wing != null)
                {
                    for (int j = 0; j < wing.Bays; j++)
                    {
                        double z = wing.Toward == FacadeSide.Garden ? m.ZGarden + (j + 0.5) * m.Bay : m.ZEntrance - (j + 0.5) * m.Bay;
                        centres.Add((UOf(w, w.A.X, z), j));
                    }
                }
                else
                {
                    if (len < 2.2)
                        continue; // pavilion returns
                    int count = (int)Math.Max(1, Math.Min(3, Math.Floor(len / 3.3)));
                    for (int k = 0; k < count; k++)
                        centres.Add((((k + 0.5) * len) / count, k));
                }
                double width = spec.Width;
                if (w.Axis == Axis.Z && wing == null && len < 3.2)
                    width = Math.Min(width, Math.Max(0.9, len - 1.2));
                foreach (var (cu, cbay) in centres)
                {
                    double u0 = cu - width / 2;
                    double u1 = cu + width / 2;
                    if (!Fits(w, u0, u1, 0.3, 0.45))
                        continue;
                    var o = new Opening
                    {
                        Id = ctx.NextId("o"),
                        Kind = spec.Kind,
                        U0 = u0,
                        U1 = u1,
                        Y0 = spec.Sill,
                        Y1 = spec.Head,
                        Glazed = true,
                        Passable = spec.Passable,
                        Frosted = room.Type == RoomType.Bathroom ? true : (bool?)null,
                        Panes = spec.Panes,
                        Leaves = spec.Leaves,
                        Dressing = spec.Dressing ?? DressingFor(style, w.Level, w.Side, cbay),
                    };
                    // A glasshouse front has no drapes (the draw is still taken, as the TypeScript does).
                    if (spec.Bare)
                    {
                        rng.Next();
                        o.Curtain = Curtain.Open;
                    }
                    else
                        o.Curtain = CurtainFor(rng, room);
                    w.Openings.Add(o);
                }
            }
        }

        /* ------------------------------------------------------------------ */
        /* Roof terraces                                                       */
        /* ------------------------------------------------------------------ */

        sealed class TerraceCandidate
        {
            public Wall W = null!;
            public double A;
            public double B;
            public PlacedRoom Room = null!;
        }

        /// <summary>
        /// A glazed door from the main block onto each flat wing roof. The wall above a lower wing is otherwise blank (no window looks onto a
        /// roof), so there is always room. Terraces that get no door are left out: a terrace nobody can reach is just a roof.
        /// </summary>
        public static OrderedMap<string, TerraceDoor> PlaceTerraceDoors(OpeningContext ctx, List<TerraceSpec> specs)
        {
            var output = new OrderedMap<string, TerraceDoor>();
            foreach (TerraceSpec t in specs)
            {
                if (t.Level < 0 || t.Level >= ctx.Levels.Count)
                    continue;
                LevelSpec lv = ctx.Levels[t.Level];
                var cands = new List<TerraceCandidate>();
                foreach (Wall w in ctx.Walls)
                {
                    if (!w.Exterior || w.Level != t.Level || w.Glazed == true)
                        continue;
                    double line = w.Axis == Axis.X ? w.A.Z : w.A.X;
                    bool onEdge = w.Axis == Axis.X ? Math.Abs(line - t.Rect.Z0) < 1e-3 || Math.Abs(line - t.Rect.Z1) < 1e-3 : Math.Abs(line - t.Rect.X0) < 1e-3 || Math.Abs(line - t.Rect.X1) < 1e-3;
                    if (!onEdge)
                        continue;
                    double a = Math.Max(w.Axis == Axis.X ? w.A.X : w.A.Z, w.Axis == Axis.X ? t.Rect.X0 : t.Rect.Z0);
                    double b = Math.Min(w.Axis == Axis.X ? w.B.X : w.B.Z, w.Axis == Axis.X ? t.Rect.X1 : t.Rect.Z1);
                    if (!ctx.Rooms.TryGetValue((w.Neg ?? w.Pos)!, out PlacedRoom? room) || room == null)
                        continue;
                    if (b - a < 2.6 || room.Type == RoomType.ServiceStair || room.Type == RoomType.HallGallery)
                        continue;
                    cands.Add(
                        new TerraceCandidate
                        {
                            W = w,
                            A = a,
                            B = b,
                            Room = room,
                        }
                    );
                }
                // Rooms guests may already cross first, bathrooms only if nothing else touches the terrace.
                static int Rank(PlacedRoom r) =>
                    Rooms.IsPassThrough(r.Type) ? 2
                    : r.Type == RoomType.Bathroom ? 0
                    : 1;
                Sorting.StableSort(cands, (p, q) => Sorting.Cmp(Num.Or(Rank(q.Room) - Rank(p.Room), q.B - q.A - (p.B - p.A))));
                foreach (TerraceCandidate c in cands)
                {
                    double basePos = c.W.Axis == Axis.X ? c.W.A.X : c.W.A.Z;
                    double u = (c.A + c.B) / 2 - basePos;
                    const double width = 1.6;
                    if (!Fits(c.W, u - width / 2, u + width / 2, 0.3, 0.45) || !FloorBothSides(ctx, c.W, u, width))
                        continue;
                    var o = new Opening
                    {
                        Id = ctx.NextId("o"),
                        Kind = OpeningKind.FrenchWindow,
                        U0 = u - width / 2,
                        U1 = u + width / 2,
                        Y0 = lv.FloorY,
                        Y1 = lv.FloorY + Math.Min(2.7, lv.Height - 1.0),
                        Glazed = true,
                        Passable = true,
                        Panes = new[] { 2, 4 },
                        Leaves = 2,
                        Dressing = new OpeningDressing { Surround = true },
                        Curtain = Curtain.Open,
                    };
                    c.W.Openings.Add(o);
                    // Guests cross this room to reach the terrace, so it cannot stay a bedroom.
                    if (!Rooms.IsPassThrough(c.Room.Type))
                    {
                        if (c.Room.Type == RoomType.Bathroom)
                        {
                            foreach (Wall w in ctx.Walls)
                            {
                                if (w.Neg == c.Room.Id || w.Pos == c.Room.Id)
                                {
                                    foreach (Opening q in w.Openings)
                                        q.Frosted = null;
                                }
                            }
                        }
                        c.Room.Type = RoomType.SittingRoom;
                    }
                    Vec2 p = WallPoint(c.W, u);
                    output.Set(
                        t.Id,
                        new TerraceDoor
                        {
                            X = p.X,
                            Z = p.Z,
                            From = c.Room.Id,
                            OpeningId = o.Id,
                        }
                    );
                    break;
                }
            }
            return output;
        }

        /* ------------------------------------------------------------------ */
        /* Doors                                                               */
        /* ------------------------------------------------------------------ */

        static string PairKey(string a, string b) => string.CompareOrdinal(a, b) < 0 ? a + "|" + b : b + "|" + a;

        /// <summary>The other id in a pair key, or null when the key does not hold id.</summary>
        static string? OtherIn(string key, string id)
        {
            int bar = key.IndexOf('|');
            string a = key.Substring(0, bar);
            string b = key.Substring(bar + 1);
            if (a == id)
                return b;
            if (b == id)
                return a;
            return null;
        }

        static bool PairHas(string key, string id) => OtherIn(key, id) != null;

        sealed class Adjacency
        {
            public string A = "";
            public string B = "";
            public Wall Wall = null!;
        }

        static List<Adjacency> InteriorAdjacency(OpeningContext ctx, int level)
        {
            var output = new List<Adjacency>();
            foreach (Wall w in ctx.Walls)
            {
                if (w.Level != level || w.Exterior)
                    continue;
                PlacedRoom ra = ctx.Rooms[w.Neg!];
                PlacedRoom rb = ctx.Rooms[w.Pos!];
                if (ra.Level != level || rb.Level != level)
                    continue; // skip double-height voids
                output.Add(
                    new Adjacency
                    {
                        A = ra.Id,
                        B = rb.Id,
                        Wall = w,
                    }
                );
            }
            return output;
        }

        static (double width, double height) DoorDims(OpeningContext ctx, PlacedRoom a, PlacedRoom b, OpeningKind kind, int level)
        {
            LevelSpec lv = ctx.Levels[level];
            double clear = lv.Height - ctx.M.Slab;
            switch (kind)
            {
                case OpeningKind.Arch:
                    return (2.6, Math.Min(3.8, clear - 0.7));
                case OpeningKind.DoubleDoor:
                    return (level == 0 ? 1.8 : 1.5, Math.Min(level == 0 ? 3.4 : 2.8, clear - 0.8));
                case OpeningKind.Entrance:
                    return (2.2, Math.Min(3.9, clear - 0.6));
                default:
                {
                    bool party = Rooms.Role(a.Type) == RoomRole.Party && Rooms.Role(b.Type) == RoomRole.Party;
                    return (party ? 1.4 : 1.0, Math.Min(level == 0 ? 2.9 : 2.5, clear - 0.8));
                }
            }
        }

        static readonly double[] Probes = { 0.45, 1.0 };

        /// <summary>Both sides of an opening need floor, not a stairwell or the side of a flight.</summary>
        static bool FloorBothSides(OpeningContext ctx, Wall w, double u, double width)
        {
            Vec2 p = WallPoint(w, u);
            var ts = new List<double> { -width / 2 + 0.1, 0, width / 2 - 0.1 };
            if (width > 2)
            {
                ts.Add(-width / 4);
                ts.Add(width / 4);
            }
            for (int side = 0; side < 2; side++)
            {
                string? id = side == 0 ? w.Neg : w.Pos;
                if (string.IsNullOrEmpty(id))
                    continue;
                int dir = id == w.Pos ? 1 : -1;
                if (!ctx.Blocked.TryGetValue(id!, out List<Rect>? blocked) || blocked == null)
                    continue;
                foreach (double probe in Probes)
                {
                    double x = w.Axis == Axis.Z ? p.X + dir * probe : p.X;
                    double z = w.Axis == Axis.X ? p.Z + dir * probe : p.Z;
                    foreach (double t in ts)
                    {
                        double px = w.Axis == Axis.X ? x + t : x;
                        double pz = w.Axis == Axis.Z ? z + t : z;
                        foreach (Rect r in blocked)
                        {
                            if (Geom.ContainsPoint(r, px, pz))
                                return false;
                        }
                    }
                }
            }
            return true;
        }

        /// <summary>
        /// Column screen: open a wall between two party rooms bay by bay, leaving piers. The sniper looks in at an angle, so only wide
        /// openings let a view carry from the garden front through to the room behind. Returns the number of bays opened.
        /// </summary>
        static int CutScreen(OpeningContext ctx, Wall w)
        {
            double len = Walls.WallLength(w);
            LevelSpec lv = ctx.Levels[w.Level];
            double n = Math.Max(1, Num.Round(len / ctx.M.Bay));
            double span = len / n;
            double width = Math.Min(span - 0.8, 3.6);
            if (width < 1.6)
                return 0;
            double height = Math.Min(3.6, lv.Height - ctx.M.Slab - 0.7);
            int cut = 0;
            for (int i = 0; i < n; i++)
            {
                double u = (i + 0.5) * span;
                double u0 = u - width / 2;
                double u1 = u + width / 2;
                if (!Fits(w, u0, u1, 0.25, 0.35) || !FloorBothSides(ctx, w, u, width))
                    continue;
                w.Openings.Add(
                    new Opening
                    {
                        Id = ctx.NextId("o"),
                        Kind = OpeningKind.Arch,
                        U0 = u0,
                        U1 = u1,
                        Y0 = lv.FloorY,
                        Y1 = lv.FloorY + height,
                        Glazed = false,
                        Passable = true,
                        Leaves = 2,
                    }
                );
                cut++;
            }
            return cut;
        }

        /// <summary>Try to cut a door into w near preferU; returns the opening or null.</summary>
        static Opening? CutDoor(OpeningContext ctx, Wall w, double preferU, OpeningKind kind, double width, double height, bool glazed = false)
        {
            double len = Walls.WallLength(w);
            double margin = width / 2 + 0.4;
            if (len < width + 0.8)
                return null;
            double ClampU(double u) => Math.Min(len - margin, Math.Max(margin, u));
            var candidates = new List<double>(81) { ClampU(preferU) };
            for (int k = 1; k <= 40; k++)
            {
                candidates.Add(ClampU(preferU + k * 0.35));
                candidates.Add(ClampU(preferU - k * 0.35));
            }
            foreach (double u in candidates)
            {
                double u0 = u - width / 2;
                double u1 = u + width / 2;
                if (!Fits(w, u0, u1, 0.25, 0.35))
                    continue;
                if (!FloorBothSides(ctx, w, u, width))
                    continue;
                double y0 = ctx.Levels[w.Level].FloorY;
                var o = new Opening
                {
                    Id = ctx.NextId("o"),
                    Kind = kind,
                    U0 = u0,
                    U1 = u1,
                    Y0 = y0,
                    Y1 = y0 + height,
                    Glazed = glazed,
                    Passable = true,
                    Leaves = kind == OpeningKind.Door ? 1 : 2,
                };
                w.Openings.Add(o);
                return o;
            }
            return null;
        }

        static T? FindRoom<T>(IEnumerable<T> items, Predicate<T> match)
            where T : class
        {
            foreach (T item in items)
            {
                if (match(item))
                    return item;
            }
            return null;
        }

        public static DoorPlanResult PlanDoors(OpeningContext ctx)
        {
            MassingPlan m = ctx.M;
            var result = new DoorPlanResult();
            var doorPairs = new OrderedSet<string>();
            int maxLevel = int.MinValue;
            foreach (PlacedRoom r in ctx.Rooms.Values)
                maxLevel = Math.Max(maxLevel, r.Level);

            bool AddDoor(Adjacency adj, OpeningKind kind, double? preferU = null, bool glazed = false)
            {
                string key = PairKey(adj.A, adj.B);
                if (doorPairs.Contains(key))
                    return true;
                PlacedRoom ra = ctx.Rooms[adj.A];
                PlacedRoom rb = ctx.Rooms[adj.B];
                var (width, height) = DoorDims(ctx, ra, rb, kind, adj.Wall.Level);
                double u = preferU ?? Walls.WallLength(adj.Wall) / 2;
                Opening? o = CutDoor(ctx, adj.Wall, u, kind, width, height, glazed);
                if (o == null)
                    return false;
                doorPairs.Add(key);
                return true;
            }

            for (int L = 0; L <= maxLevel; L++)
            {
                List<Adjacency> adjs = InteriorAdjacency(ctx, L);
                var byPair = new OrderedMap<string, List<Adjacency>>();
                foreach (Adjacency a in adjs)
                {
                    string k = PairKey(a.A, a.B);
                    if (!byPair.TryGetValue(k, out List<Adjacency>? list) || list == null)
                    {
                        list = new List<Adjacency>();
                        byPair.Set(k, list);
                    }
                    list.Add(a);
                }
                static List<Adjacency> Longest(List<Adjacency> list)
                {
                    var copy = new List<Adjacency>(list);
                    Sorting.StableSort(copy, (p, q) => Sorting.Cmp(Walls.WallLength(q.Wall) - Walls.WallLength(p.Wall)));
                    return copy;
                }
                bool TryPair(string a, string b, OpeningKind kind, Func<Wall, double>? at = null, bool glazed = false)
                {
                    if (!byPair.TryGetValue(PairKey(a, b), out List<Adjacency>? list) || list == null)
                        return false;
                    foreach (Adjacency adj in Longest(list))
                    {
                        if (AddDoor(adj, kind, at != null ? at(adj.Wall) : (double?)null, glazed))
                            return true;
                    }
                    return false;
                }
                // Every pair key that holds id, in insertion order, mapped to the other room's id.
                List<string> PairedWith(string id)
                {
                    var output = new List<string>();
                    foreach (string k in byPair.Keys)
                    {
                        string? other = OtherIn(k, id);
                        if (other != null)
                            output.Add(other);
                    }
                    return output;
                }
                var roomsL = new List<PlacedRoom>();
                foreach (PlacedRoom r in ctx.Rooms.Values)
                {
                    if (r.Level == L)
                        roomsL.Add(r);
                }
                RoomType TypeOf(string id) => ctx.Rooms[id].Type;

                if (L == 0)
                {
                    // 1. The grand axis: entrance hall -> (corridor) -> ballroom.
                    static double AxisAt(Wall w) => UOf(w, 0, 0);
                    PlacedRoom? hall = roomsL.Find(r => r.Type == RoomType.EntranceHall);
                    PlacedRoom? ball = roomsL.Find(r => r.Type == RoomType.Ballroom);
                    if (hall != null && ball != null)
                        TryPair(hall.Id, ball.Id, OpeningKind.DoubleDoor, AxisAt);
                    // 3. Enfilade along the garden front, near the windows.
                    List<PlacedRoom> front = roomsL.FindAll(r => r.Zone == RoomZone.Front);
                    Sorting.StableSort(front, (p, q) => Sorting.Cmp(p.Rect.X0 - q.Rect.X0));
                    double zEnf = m.ZGarden - 0.3 - 1.25 - 0.9;
                    for (int i = 0; i + 1 < front.Count; i++)
                        TryPair(front[i].Id, front[i + 1].Id, OpeningKind.DoubleDoor, w => UOf(w, w.A.X, zEnf));
                    // 3b. Column screens: party rooms that sit one behind the other open into each other, so the
                    // garden-front view carries through. Capped by rule: only party-to-party walls parallel to the
                    // garden front. Halls, corridors, service and private rooms keep solid walls and stay blind.
                    foreach (Adjacency adj in adjs)
                    {
                        if (adj.Wall.Axis != Axis.X)
                            continue;
                        PlacedRoom ra = ctx.Rooms[adj.A];
                        PlacedRoom rb = ctx.Rooms[adj.B];
                        if (Rooms.Role(ra.Type) != RoomRole.Party || Rooms.Role(rb.Type) != RoomRole.Party)
                            continue;
                        if (ra.Zone == RoomZone.Conservatory || rb.Zone == RoomZone.Conservatory)
                            continue;
                        if (CutScreen(ctx, adj.Wall) > 0)
                        {
                            doorPairs.Add(PairKey(adj.A, adj.B));
                            result.Screens.Add(adj.Wall.Id);
                        }
                    }
                    // 4. Conservatory.
                    foreach (PlacedRoom r in roomsL.FindAll(q => q.Type == RoomType.Conservatory))
                    {
                        foreach (var kv in byPair)
                        {
                            if (!PairHas(kv.Key, r.Id))
                                continue;
                            foreach (Adjacency adj in Longest(kv.Value))
                            {
                                if (AddDoor(adj, OpeningKind.DoubleDoor, null, true))
                                    break;
                            }
                        }
                    }
                }

                // 5. Wings: chain rooms along the wing, and join the wing to the main block.
                foreach (WingSpec wing in m.Wings)
                {
                    double FromMain(PlacedRoom r) => wing.Toward == FacadeSide.Garden ? r.Rect.Z0 - m.ZGarden : m.ZEntrance - r.Rect.Z1;
                    List<PlacedRoom> wr = roomsL.FindAll(r => r.MassId == wing.Id && r.Type != RoomType.Corridor);
                    Sorting.StableSort(wr, (p, q) => Sorting.Cmp(FromMain(p) - FromMain(q)));
                    if (L == 0)
                    {
                        for (int i = 0; i + 1 < wr.Count; i++)
                            TryPair(wr[i].Id, wr[i + 1].Id, OpeningKind.DoubleDoor);
                        PlacedRoom? first = wr.Count > 0 ? wr[0] : null;
                        if (first != null)
                        {
                            List<string> neighbours = PairedWith(first.Id).FindAll(id => ctx.Rooms[id].MassId != wing.Id);
                            Sorting.StableSort(neighbours, (p, q) => (Rooms.IsPassThrough(TypeOf(q)) ? 1 : 0) - (Rooms.IsPassThrough(TypeOf(p)) ? 1 : 0));
                            foreach (string nb in neighbours)
                            {
                                if (TryPair(first.Id, nb, OpeningKind.DoubleDoor))
                                    break;
                            }
                        }
                    }
                }

                // 5b. Ring gallery of the dome hall: a door into every room beside it. (The corridor behind it
                // is joined in step 6.) Doors go near the garden end, where the gallery runs straight.
                PlacedRoom? gallery = roomsL.Find(r => r.Type == RoomType.HallGallery);
                if (gallery != null)
                {
                    foreach (string otherId in PairedWith(gallery.Id))
                    {
                        PlacedRoom other = ctx.Rooms[otherId];
                        if (other.Type == RoomType.Corridor)
                            continue;
                        TryPair(gallery.Id, other.Id, OpeningKind.Door, w => w.Axis == Axis.Z ? UOf(w, w.A.X, m.ZGarden - 2.4) : Walls.WallLength(w) / 2);
                    }
                }

                // 6. Every room opening onto a corridor or landing gets a door to it.
                foreach (PlacedRoom r in roomsL)
                {
                    if (r.Type != RoomType.Corridor && r.Type != RoomType.Landing)
                        continue;
                    foreach (string otherId in PairedWith(r.Id))
                    {
                        PlacedRoom other = ctx.Rooms[otherId];
                        OpeningKind kind = (Rooms.Role(other.Type) == RoomRole.Party && L == 0) || other.Type == RoomType.HallGallery ? OpeningKind.DoubleDoor : OpeningKind.Door;
                        TryPair(
                            r.Id,
                            other.Id,
                            kind,
                            w =>
                            {
                                // Aim for the middle of the other room's span along the wall.
                                double c = w.Axis == Axis.X ? (other.Rect.X0 + other.Rect.X1) / 2 : (other.Rect.Z0 + other.Rect.Z1) / 2;
                                return w.Axis == Axis.X ? c - w.A.X : c - w.A.Z;
                            }
                        );
                    }
                }

                // 7. Connectivity: grow from the root, adding doors to unreached neighbours.
                PlacedRoom? root =
                    L == 0
                        ? roomsL.Find(r => r.Type == RoomType.EntranceHall)
                        : (L == 1 ? gallery : null)
                            ?? roomsL.Find(r => r.Type == RoomType.Landing)
                            ?? roomsL.Find(r => r.Type == RoomType.ServiceStair)
                            ?? roomsL.Find(r => r.Type == RoomType.Corridor);
                if (root == null)
                    continue;
                List<string> NeighboursWithDoor(string id)
                {
                    var output = new List<string>();
                    foreach (string k in doorPairs)
                    {
                        string? other = OtherIn(k, id);
                        if (other != null && ctx.Rooms[other].Level == L)
                            output.Add(other);
                    }
                    return output;
                }
                static int Priority(RoomType t)
                {
                    RoomRole role = Rooms.Role(t);
                    return role == RoomRole.Circulation ? 3
                        : role == RoomRole.Party ? 2
                        : t == RoomType.SittingRoom ? 1
                        : 0;
                }
                OrderedSet<string> Reach(bool passOnly)
                {
                    var seen = new OrderedSet<string>();
                    seen.Add(root.Id);
                    var queue = new Queue<string>();
                    queue.Enqueue(root.Id);
                    while (queue.Count > 0)
                    {
                        string id = queue.Dequeue();
                        if (passOnly && id != root.Id && !Rooms.IsPassThrough(TypeOf(id)))
                            continue;
                        foreach (string nb in NeighboursWithDoor(id))
                        {
                            if (!seen.Contains(nb))
                            {
                                seen.Add(nb);
                                queue.Enqueue(nb);
                            }
                        }
                    }
                    return seen;
                }
                for (int iter = 0; iter < 40; iter++)
                {
                    OrderedSet<string> seen = Reach(false);
                    List<PlacedRoom> missing = roomsL.FindAll(r => !seen.Contains(r.Id));
                    if (missing.Count == 0)
                        break;
                    bool progressed = false;
                    foreach (PlacedRoom r in missing)
                    {
                        List<string> cands = PairedWith(r.Id).FindAll(x => seen.Contains(x));
                        Sorting.StableSort(cands, (p, q) => Priority(TypeOf(q)) - Priority(TypeOf(p)));
                        foreach (string c in cands)
                        {
                            if (TryPair(r.Id, c, OpeningKind.Door))
                            {
                                progressed = true;
                                break;
                            }
                        }
                    }
                    if (!progressed)
                        break;
                }
                OrderedSet<string> seenAll = Reach(false);
                foreach (PlacedRoom r in roomsL)
                {
                    if (!seenAll.Contains(r.Id))
                        result.Unreachable.Add(r.Id);
                }

                // 8. Pass-through repair: no private room may be the only way in.
                for (int iter = 0; iter < 20; iter++)
                {
                    OrderedSet<string> ok = Reach(true);
                    List<PlacedRoom> bad = roomsL.FindAll(r => seenAll.Contains(r.Id) && !ok.Contains(r.Id));
                    if (bad.Count == 0)
                        break;
                    bool progressed = false;
                    foreach (PlacedRoom v in bad)
                    {
                        // Prefer a new door to a properly reachable pass-through neighbour.
                        List<string> cands = PairedWith(v.Id).FindAll(x => ok.Contains(x) && Rooms.IsPassThrough(TypeOf(x)));
                        bool joined = false;
                        foreach (string c in cands)
                        {
                            if (TryPair(v.Id, c, OpeningKind.Door))
                            {
                                joined = true;
                                break;
                            }
                        }
                        if (joined)
                        {
                            progressed = true;
                            continue;
                        }
                        // Otherwise promote the blocking room to circulation.
                        string? blocker = NeighboursWithDoor(v.Id).Find(x => ok.Contains(x) && !Rooms.IsPassThrough(TypeOf(x)));
                        if (blocker != null)
                        {
                            PlacedRoom br = ctx.Rooms[blocker];
                            // A wide room becomes a morning room the party walks through; a narrow one is just a passage.
                            bool narrow = Math.Min(br.Rect.X1 - br.Rect.X0, br.Rect.Z1 - br.Rect.Z0) < 5;
                            RoomType to = L == 0 ? (narrow ? RoomType.Corridor : RoomType.MorningRoom) : RoomType.Landing;
                            result.Retyped.Add(
                                new Retype
                                {
                                    Id = br.Id,
                                    From = br.Type,
                                    To = to,
                                }
                            );
                            br.Type = to;
                            progressed = true;
                        }
                    }
                    if (!progressed)
                    {
                        foreach (PlacedRoom b in bad)
                            result.PassViolations.Add(b.Id);
                        break;
                    }
                }
            }

            // Exterior doors.
            PlacedRoom? entranceHall = FindRoom(ctx.Rooms.Values, r => r.Type == RoomType.EntranceHall);
            if (entranceHall != null)
            {
                Wall? w = ctx.Walls.Find(q => q.Exterior && q.Side == FacadeSide.Entrance && q.Level == 0 && (q.Neg == entranceHall.Id || q.Pos == entranceHall.Id));
                if (w != null)
                {
                    LevelSpec lv = ctx.Levels[0];
                    double u = UOf(w, 0, w.A.Z);
                    // Replace a window on the axis if one is there.
                    w.Openings = w.Openings.FindAll(o => o.U1 < u - 1.3 || o.U0 > u + 1.3);
                    double h = Math.Min(3.9, lv.Height - ctx.M.Slab - 0.6);
                    w.Openings.Add(
                        new Opening
                        {
                            Id = ctx.NextId("o"),
                            Kind = OpeningKind.Entrance,
                            U0 = u - 1.1,
                            U1 = u + 1.1,
                            Y0 = lv.FloorY,
                            Y1 = lv.FloorY + h,
                            Glazed = false,
                            Passable = true,
                            Leaves = 2,
                        }
                    );
                }
            }
            PlacedRoom? cons = FindRoom(ctx.Rooms.Values, r => r.Type == RoomType.Conservatory);
            if (cons != null)
            {
                Wall? w = ctx.Walls.Find(q => q.Exterior && q.Side == FacadeSide.Garden && (q.Neg == cons.Id || q.Pos == cons.Id));
                Opening? g = w != null && w.Openings.Count > 0 ? w.Openings[0] : null;
                if (w != null && g != null)
                {
                    // Split the glazed band around a central garden door.
                    double mid = Walls.WallLength(w) / 2;
                    LevelSpec lv = ctx.Levels[0];
                    Opening left = g.Clone();
                    left.Id = ctx.NextId("o");
                    left.U1 = mid - 1.0;
                    Opening right = g.Clone();
                    right.Id = ctx.NextId("o");
                    right.U0 = mid + 1.0;
                    var door = new Opening
                    {
                        Id = ctx.NextId("o"),
                        Kind = OpeningKind.DoubleDoor,
                        U0 = mid - 0.85,
                        U1 = mid + 0.85,
                        Y0 = lv.FloorY,
                        Y1 = lv.FloorY + 2.8,
                        Glazed = true,
                        Passable = true,
                        Leaves = 2,
                    };
                    w.Openings = new List<Opening> { left, right, door };
                }
            }

            return result;
        }

        /// <summary>Navigation links for every passable opening.</summary>
        public static List<NavLink> CollectLinks(OpeningContext ctx)
        {
            var links = new List<NavLink>();
            foreach (Wall w in ctx.Walls)
            {
                foreach (Opening o in w.Openings)
                {
                    if (!o.Passable)
                        continue;
                    Vec2 p = WallPoint(w, (o.U0 + o.U1) / 2);
                    string outside = w.Side == FacadeSide.Entrance ? "outside" : "terrace";
                    links.Add(
                        new NavLink
                        {
                            Kind = o.Kind == OpeningKind.FrenchWindow ? NavLinkKind.FrenchWindow : NavLinkKind.Door,
                            From = w.Neg ?? outside,
                            To = w.Pos ?? outside,
                            Via = o.Id,
                            X = p.X,
                            Z = p.Z,
                            Level = w.Level,
                        }
                    );
                }
            }
            return links;
        }
    }
}
