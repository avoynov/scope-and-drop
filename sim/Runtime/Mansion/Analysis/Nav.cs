// Navigation grids (per storey) with per-cell room index and perch visibility.
// The terrace is part of level 0 (room index -2).
using System;
using System.Collections.Generic;
using ScopeAndDrop.Sim.Core;

namespace ScopeAndDrop.Sim.Mansion
{
    public sealed class NavInput
    {
        public List<Room> Rooms = new List<Room>();
        public List<Wall> Walls = new List<Wall>();
        public List<LevelSpec> Levels = new List<LevelSpec>();
        public List<Mass> Masses = new List<Mass>();
        public List<Prop> Props = new List<Prop>();
        public List<Portico> Porticos = new List<Portico>();
        public Site Site = new Site();

        /// <summary>Extra blocked plan areas per room (stair footprints / holes).</summary>
        public OrderedMap<string, List<Rect>> Blocked = new OrderedMap<string, List<Rect>>();
        public double Cell;
    }

    public static class NavGrid
    {
        /// <summary>Looser than the furniture placer's 0.28 m so placer-connected rooms stay connected here.</summary>
        const double Agent = 0.12;

        /// <summary>Visibility is sampled on 2×2 cell blocks (rays are the expensive part).</summary>
        public const int VisBlock = 2;

        static readonly List<Rect> None = new List<Rect>();

        public static List<NavLevel> Build(NavInput input, SightlineTracer tracer)
        {
            var output = new List<NavLevel>();
            Terrace terrace = input.Site.Terrace;
            var roomIndex = new Dictionary<string, int>();
            foreach (Room r in input.Rooms)
                roomIndex[r.Id] = r.Index;
            foreach (LevelSpec lv in input.Levels)
            {
                List<Room> rooms = input.Rooms.FindAll(r => r.Level == lv.Index);
                if (rooms.Count == 0)
                    continue;
                double x0 = double.PositiveInfinity;
                double z0 = double.PositiveInfinity;
                double x1 = double.NegativeInfinity;
                double z1 = double.NegativeInfinity;
                void Grow(Rect r)
                {
                    x0 = Math.Min(x0, r.X0);
                    z0 = Math.Min(z0, r.Z0);
                    x1 = Math.Max(x1, r.X1);
                    z1 = Math.Max(z1, r.Z1);
                }
                foreach (Room r in rooms)
                    Grow(r.Rect);
                if (lv.Index == 0)
                    Grow(terrace.Rect);
                x0 -= 1;
                z0 -= 1;
                x1 += 1;
                z1 += 1;
                double cell = input.Cell;
                int cols = (int)Math.Ceiling((x1 - x0) / cell);
                int rows = (int)Math.Ceiling((z1 - z0) / cell);
                var walk = new byte[cols * rows];
                var room = new short[cols * rows];
                Array.Fill(room, (short)-1);
                var vis = new byte[cols * rows];

                var propRects = new Dictionary<string, List<Rect>>();
                foreach (Prop p in input.Props)
                {
                    if (!p.BlocksNav || p.Level != lv.Index)
                        continue;
                    int q = Num.ToInt32(Num.Round(p.Yaw / (Math.PI / 2))) & 1;
                    double hw = (q != 0 ? p.D : p.W) / 2 + Agent;
                    double hd = (q != 0 ? p.W : p.D) / 2 + Agent;
                    string key = p.RoomId ?? "terrace";
                    if (!propRects.TryGetValue(key, out List<Rect>? list))
                        propRects[key] = list = new List<Rect>();
                    list.Add(new Rect(p.X - hw, p.Z - hd, p.X + hw, p.Z + hd));
                }
                var terraceBlocks = new List<Rect>();
                if (lv.Index == 0)
                {
                    foreach (Balustrade b in terrace.Balustrades)
                        terraceBlocks.Add(new Rect(Math.Min(b.A.X, b.B.X) - 0.25, Math.Min(b.A.Z, b.B.Z) - 0.25, Math.Max(b.A.X, b.B.X) + 0.25, Math.Max(b.A.Z, b.B.Z) + 0.25));
                    foreach (Portico p in input.Porticos)
                    {
                        foreach (Vec2 c in p.Columns)
                            terraceBlocks.Add(new Rect(c.X - p.ColumnRadius - Agent, c.Z - p.ColumnRadius - Agent, c.X + p.ColumnRadius + Agent, c.Z + p.ColumnRadius + Agent));
                    }
                    if (propRects.TryGetValue("terrace", out List<Rect>? tp))
                        terraceBlocks.AddRange(tp);
                }
                List<Mass> masses = input.Masses;
                var visCache = new Dictionary<int, int>();
                double levelY = lv.FloorY;
                double ox = x0;
                double oz = z0;
                int VisAt(int c, int r, double floorY)
                {
                    int bc = c / VisBlock;
                    int br = r / VisBlock;
                    // As in the TypeScript, any floor other than the storey's shares one cache slot per block.
                    int key = (br * 4096 + bc) * 2 + (floorY == levelY ? 0 : 1);
                    if (!visCache.TryGetValue(key, out int v))
                    {
                        double x = ox + (bc + 0.5) * VisBlock * cell;
                        double z = oz + (br + 0.5) * VisBlock * cell;
                        v = (int)Num.Round(tracer.Person(x, z, floorY) * 255);
                        visCache[key] = v;
                    }
                    return v;
                }

                for (int r = 0; r < rows; r++)
                {
                    double z = z0 + (r + 0.5) * cell;
                    for (int c = 0; c < cols; c++)
                    {
                        double x = x0 + (c + 0.5) * cell;
                        int k = r * cols + c;
                        int idx = -1;
                        bool ok = false;
                        double floorY = lv.FloorY;
                        Room? rm = rooms.Find(q => x > q.Inner.X0 + Agent && x < q.Inner.X1 - Agent && z > q.Inner.Z0 + Agent && z < q.Inner.Z1 - Agent);
                        if (rm != null)
                        {
                            idx = rm.Index;
                            floorY = rm.FloorY;
                            ok =
                                !AnyContains(propRects.TryGetValue(rm.Id, out List<Rect>? pr) ? pr : None, x, z, 0)
                                && !AnyContains(input.Blocked.TryGetValue(rm.Id, out List<Rect> bl) ? bl : None, x, z, Agent);
                        }
                        else if (lv.Index == 0 && Geom.ContainsPoint(terrace.Rect, x, z) && !masses.Exists(m => Geom.ContainsPoint(m.Rect, x, z, 0.35)))
                        {
                            idx = -2;
                            floorY = terrace.Y;
                            ok = !AnyContains(terraceBlocks, x, z, 0);
                        }
                        room[k] = (short)idx;
                        walk[k] = ok ? (byte)1 : (byte)0;
                        if (ok)
                            vis[k] = (byte)VisAt(c, r, floorY);
                    }
                }

                // Carve doorways through walls.
                foreach (Wall w in input.Walls)
                {
                    if (w.Level != lv.Index)
                        continue;
                    foreach (Opening o in w.Openings)
                    {
                        if (!o.Passable || o.Y0 > lv.FloorY + 0.3)
                            continue;
                        double b = w.Axis == Axis.X ? w.A.X : w.A.Z;
                        double line = w.Axis == Axis.X ? w.A.Z : w.A.X;
                        double half = w.Thickness / 2 + Agent + cell;
                        int ownIdx =
                            !string.IsNullOrEmpty(w.Neg) ? (roomIndex.TryGetValue(w.Neg!, out int ni) ? ni : -1)
                            : !string.IsNullOrEmpty(w.Pos) ? (roomIndex.TryGetValue(w.Pos!, out int pi) ? pi : -1)
                            : -1;
                        for (double t = b + o.U0 + 0.25; t <= b + o.U1 - 0.25 + 1e-6; t += cell / 2)
                        {
                            for (double s = -half; s <= half + 1e-6; s += cell / 2)
                            {
                                double x = w.Axis == Axis.X ? t : line + s;
                                double z = w.Axis == Axis.X ? line + s : t;
                                double cf = Math.Floor((x - x0) / cell);
                                double rf = Math.Floor((z - z0) / cell);
                                if (!(cf >= 0 && rf >= 0 && cf < cols && rf < rows))
                                    continue;
                                int c = (int)cf;
                                int r = (int)rf;
                                int k = r * cols + c;
                                if (walk[k] != 0)
                                    continue;
                                // Only carve cells that are not inside furniture or a stairwell.
                                walk[k] = 1;
                                if (room[k] == -1)
                                {
                                    bool outside = w.Exterior && w.Side != FacadeSide.Entrance && lv.Index == 0 && Num.Sign(s) == (!string.IsNullOrEmpty(w.Neg) ? 1 : -1);
                                    room[k] = (short)(outside ? -2 : ownIdx);
                                }
                                double fy = room[k] == -2 ? terrace.Y : lv.FloorY;
                                vis[k] = (byte)VisAt(c, r, fy);
                            }
                        }
                    }
                }

                var n = new NavLevel
                {
                    Level = lv.Index,
                    Y = lv.FloorY,
                    OriginX = x0,
                    OriginZ = z0,
                    Cell = cell,
                    Cols = cols,
                    Rows = rows,
                    Walk = walk,
                    Room = room,
                    Vis = vis,
                };
                // Drop pockets that furniture seals off: only the storey's main component is walkable.
                int[] comp = Components(n);
                var sizes = new OrderedMap<int, int>();
                foreach (int q in comp)
                {
                    if (q >= 0)
                        sizes[q] = sizes.GetValueOrDefault(q, 0) + 1;
                }
                int main = int.MinValue;
                int best = -1;
                foreach (KeyValuePair<int, int> e in sizes)
                {
                    // Largest first, ties to the earlier component (a stable sort by size).
                    if (e.Value > best)
                    {
                        best = e.Value;
                        main = e.Key;
                    }
                }
                for (int k = 0; k < walk.Length; k++)
                {
                    if (walk[k] != 0 && comp[k] != main)
                    {
                        walk[k] = 0;
                        vis[k] = 0;
                    }
                }
                output.Add(n);
            }
            return output;
        }

        static bool AnyContains(List<Rect> rects, double x, double z, double tol)
        {
            foreach (Rect b in rects)
            {
                if (Geom.ContainsPoint(b, x, z, tol))
                    return true;
            }
            return false;
        }

        /// <summary>Connected components flood fill over walkable cells of one level (4-neighbour).</summary>
        public static int[] Components(NavLevel n)
        {
            var comp = new int[n.Cols * n.Rows];
            Array.Fill(comp, -1);
            int id = 0;
            var stack = new Stack<int>();
            for (int k = 0; k < comp.Length; k++)
            {
                if (n.Walk[k] == 0 || comp[k] >= 0)
                    continue;
                stack.Push(k);
                comp[k] = id;
                while (stack.Count > 0)
                {
                    int q = stack.Pop();
                    int c = q % n.Cols;
                    int r = (q - c) / n.Cols;
                    Visit(c > 0 ? q - 1 : -1);
                    Visit(c < n.Cols - 1 ? q + 1 : -1);
                    Visit(r > 0 ? q - n.Cols : -1);
                    Visit(r < n.Rows - 1 ? q + n.Cols : -1);
                }
                id++;
            }
            return comp;

            void Visit(int nb)
            {
                if (nb >= 0 && n.Walk[nb] != 0 && comp[nb] < 0)
                {
                    comp[nb] = id;
                    stack.Push(nb);
                }
            }
        }

        public static int CellAt(NavLevel n, double x, double z)
        {
            double c = Math.Floor((x - n.OriginX) / n.Cell);
            double r = Math.Floor((z - n.OriginZ) / n.Cell);
            if (!(c >= 0 && r >= 0 && c < n.Cols && r < n.Rows))
                return -1;
            return (int)r * n.Cols + (int)c;
        }
    }
}
