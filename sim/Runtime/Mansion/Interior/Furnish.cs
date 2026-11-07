// Furnishing (stage 7): run room recipes, pick the bar room, derive mission
// points of interest (POIs) with reachable stand points.
using System;
using System.Collections.Generic;
using ScopeAndDrop.Sim.Core;

namespace ScopeAndDrop.Sim.Mansion
{
    /// <summary>Dome hall: its rooms, the chandelier position and the wall stretches furniture may use.</summary>
    public sealed class AtriumFurnish
    {
        public List<string> RoomIds = new List<string>();
        public Vec3 Dome;
        public double[] BackX = new double[2];
        public double[] SideZ = new double[2];
    }

    public sealed class FurnishInput
    {
        public Rng Rng = null!;
        public List<Room> Rooms = new List<Room>();
        public List<Wall> Walls = new List<Wall>();
        public OrderedMap<string, List<Rect>> Blocked = new OrderedMap<string, List<Rect>>();

        /// <summary>First-pass visibility per room id (architecture only).</summary>
        public OrderedMap<string, double> VisHint = new OrderedMap<string, double>();

        /// <summary>Person visibility at a plan point (x, z, floorY), from the architecture-only tracer.</summary>
        public Func<double, double, double, double> VisAt = null!;
        public OrderedMap<PoiType, PoiNeed> Required = new OrderedMap<PoiType, PoiNeed>();

        /// <summary>Threshold used for "visible" while placing (a margin above validation's).</summary>
        public double VisibleAt;

        /// <summary>Doors onto roof terraces (the terrace has no walls of its own for the placer to find them on).</summary>
        public OrderedMap<string, Vec2>? TerraceDoors;
        public AtriumFurnish? Atrium;
    }

    public sealed class FurnishOutput
    {
        public List<Prop> Props = new List<Prop>();
        public List<LightSpec> Lights = new List<LightSpec>();
        public List<Poi> Pois = new List<Poi>();
        public OrderedMap<string, Placer> Placers = new OrderedMap<string, Placer>();
    }

    public static class Furnish
    {
        static readonly HashSet<RoomType> BarRooms = new HashSet<RoomType>
        {
            RoomType.DrawingRoom,
            RoomType.BilliardRoom,
            RoomType.CardRoom,
            RoomType.MorningRoom,
            RoomType.MusicRoom,
            RoomType.GrandSalon,
            RoomType.Ballroom,
            RoomType.Gallery,
            RoomType.Library,
            RoomType.DiningRoom,
        };

        sealed class Cand
        {
            public Room R = null!;
            public double Score;
        }

        public static FurnishOutput Run(FurnishInput input)
        {
            Rng rng = input.Rng;
            List<Room> rooms = input.Rooms;
            int pn = 0;
            int ln = 0;
            string PropId() => "p" + Num.ToText(pn++);
            string LightId() => "l" + Num.ToText(ln++);

            // The bar goes where the sniper can watch it, with a little randomness.
            // The house's own bar room first; if it cannot take one, wherever the sniper can best watch it.
            var barCands = new List<Cand>();
            foreach (Room r in rooms)
            {
                if (!((r.Level == 0 && BarRooms.Contains(r.Type)) || r.Type == RoomType.Bar))
                    continue;
                double score = (r.Type == RoomType.Bar ? 10 : 0) + input.VisHint.GetValueOrDefault(r.Id, 0) + rng.Range(0, 0.15) + (r.Type == RoomType.Ballroom ? -0.1 : 0);
                barCands.Add(new Cand { R = r, Score = score });
            }
            Sorting.StableSort(barCands, (a, b) => Sorting.Cmp(b.Score - a.Score));
            string? barRoom = barCands.Count > 0 ? barCands[0].R.Id : null;

            var placers = new OrderedMap<string, Placer>();
            var props = new List<Prop>();
            var lights = new List<LightSpec>();
            foreach (Room room in rooms)
            {
                List<Wall> walls = input.Walls.FindAll(w => w.Neg == room.Id || w.Pos == room.Id);
                List<Rect> blocked = input.Blocked.TryGetValue(room.Id, out List<Rect> b) ? b : new List<Rect>();
                var p = new Placer(room, walls, blocked, rng.Fork(room.Id), PropId, LightId);
                if (input.TerraceDoors != null && input.TerraceDoors.TryGetValue(room.Id, out Vec2 door))
                {
                    // Keep the way out of the door clear, and everything on the terrace reachable from it.
                    var at = new Vec2(Math.Min(room.Inner.X1 - 0.4, Math.Max(room.Inner.X0 + 0.4, door.X)), Math.Min(room.Inner.Z1 - 0.4, Math.Max(room.Inner.Z0 + 0.4, door.Z)));
                    p.Keep.Add(new Rect(at.X - 1.3, at.Z - 1.3, at.X + 1.3, at.Z + 1.3));
                    p.MustReach.Add(at);
                }
                if (input.Atrium != null && input.Atrium.RoomIds.Contains(room.Id))
                {
                    p.Dome = input.Atrium.Dome;
                    p.LimitWalls(input.Atrium.BackX, input.Atrium.SideZ);
                }
                // The bar claims its wall before anything else in its room.
                if (room.Id == barRoom)
                    Recipes.Bar(p);
                Recipes.Run(room.Type, p, false);
                placers[room.Id] = p;
            }
            // Fallback: if the chosen room had no wall long enough for a bar, try the next best.
            bool HasBar()
            {
                foreach (Placer pl in placers.Values)
                {
                    foreach (Prop q in pl.Props)
                    {
                        if (q.Poi == PoiType.Bar)
                            return true;
                    }
                }
                return false;
            }
            for (int ci = 1; ci < barCands.Count; ci++)
            {
                if (HasBar())
                    break;
                Recipes.Bar(placers[barCands[ci].R.Id]);
            }

            // POIs with reachable stand points.
            var pois = new List<Poi>();
            int poiN = 0;
            bool AddPoi(Room room, Placer p, Prop prop)
            {
                Stand? stand = StandPoint(p, prop);
                if (stand == null)
                {
                    prop.Poi = null;
                    return false;
                }
                pois.Add(
                    new Poi
                    {
                        Id = "poi" + Num.ToText(poiN++),
                        Type = prop.Poi!.Value,
                        PropId = prop.Id,
                        RoomId = room.Id,
                        Level = room.Level,
                        X = prop.X,
                        Y = prop.Y,
                        Z = prop.Z,
                        Stand = stand,
                        Visibility = 0,
                    }
                );
                return true;
            }
            foreach (Room room in rooms)
            {
                Placer p = placers[room.Id];
                // AddPoi can clear a prop's POI but never adds or removes props, so the list is stable.
                foreach (Prop prop in p.Props)
                {
                    if (prop.Poi != null)
                        AddPoi(room, p, prop);
                }
            }

            // Repair: top up mission objects (and visible ones) that the recipes left short.
            var roomOf = new OrderedMap<string, Room>();
            foreach (Room r in rooms)
                roomOf[r.Id] = r;
            bool IsVisible(Poi q) => input.VisAt(q.Stand.X, q.Stand.Z, q.RoomId != null && roomOf.TryGetValue(q.RoomId, out Room rr) ? rr.FloorY : 0) >= input.VisibleAt;
            foreach (KeyValuePair<PoiType, PoiNeed> entry in input.Required)
            {
                PoiType type = entry.Key;
                PoiNeed need = entry.Value;
                if (!Fallbacks.TryGetValue(type, out FallbackSpec spec))
                    continue;
                for (int guard = 0; guard < 8; guard++)
                {
                    int all = 0;
                    int vis = 0;
                    foreach (Poi q in pois)
                    {
                        if (q.Type != type)
                            continue;
                        all++;
                        if (IsVisible(q))
                            vis++;
                    }
                    bool wantVisible = vis < need.Visible;
                    if (!wantVisible && all >= need.Min)
                        break;
                    var cands = new List<Cand>();
                    foreach (Room r in rooms)
                    {
                        if (r.Level != 0 || Array.IndexOf(spec.Rooms, r.Role) < 0)
                            continue;
                        double score = wantVisible ? input.VisHint.GetValueOrDefault(r.Id, 0) : rng.Next();
                        if (!wantVisible || score > 0.05)
                            cands.Add(new Cand { R = r, Score = score });
                    }
                    Sorting.StableSort(cands, (a, c) => Sorting.Cmp(c.Score - a.Score));
                    Prop? placed = null;
                    foreach (Cand c in cands)
                    {
                        Placer pl = placers[c.R.Id];
                        placed = PlaceFallback(pl, type, spec, wantVisible ? input.VisAt : null, input.VisibleAt);
                        if (placed != null && AddPoi(c.R, pl, placed))
                            break;
                        if (placed != null)
                            pl.Remove(placed);
                        placed = null;
                    }
                    if (placed == null)
                        break;
                }
            }
            foreach (Room room in rooms)
            {
                Placer p = placers[room.Id];
                props.AddRange(p.Props);
                lights.AddRange(p.Lights);
            }

            // Window spots: guests lingering at the stage French windows.
            foreach (Room room in rooms)
            {
                if (room.Level != 0 || room.Role != RoomRole.Party || !room.Stage)
                    continue;
                Placer p = placers[room.Id];
                List<Side> windowSides = p.WindowSides();
                if (windowSides.Count == 0)
                    continue;
                Side ws = windowSides[0];
                SideInfo info = p.SideOf(ws);
                SideOpening? win = info.Openings.Find(o => o.Exterior && o.Kind == OpeningKind.FrenchWindow);
                if (win == null)
                    continue;
                double t = (win.T0 + win.T1) / 2;
                Vec2 at = p.At(ws, t, 0.75);
                double yaw = ws switch
                {
                    Side.N => 0,
                    Side.S => Math.PI,
                    Side.E => Math.PI / 2,
                    _ => -Math.PI / 2,
                };
                p.MustReach.Add(at);
                if (!p.Connected())
                {
                    p.MustReach.RemoveAt(p.MustReach.Count - 1);
                    continue;
                }
                pois.Add(
                    new Poi
                    {
                        Id = "poi" + Num.ToText(poiN++),
                        Type = PoiType.Window,
                        RoomId = room.Id,
                        Level = 0,
                        X = at.X,
                        Y = room.FloorY,
                        Z = at.Z,
                        Stand = new Stand
                        {
                            X = Round(at.X),
                            Z = Round(at.Z),
                            Yaw = yaw,
                        },
                        Visibility = 0,
                    }
                );
            }
            return new FurnishOutput
            {
                Props = props,
                Lights = lights,
                Pois = pois,
                Placers = placers,
            };
        }

        static double Round(double v) => Num.Round(v * 1000) / 1000;

        /// <summary>Where an NPC stands to use a prop: in front of it, else beside it; must be reachable.</summary>
        static Stand? StandPoint(Placer p, Prop prop)
        {
            double fx = Math.Sin(prop.Yaw);
            double fz = Math.Cos(prop.Yaw);
            bool frontOnly = prop.Mount == PropMount.Wall || prop.Kind == PropKind.Fireplace || prop.Kind == PropKind.Bookcase || prop.Kind == PropKind.BarCounter || prop.Kind == PropKind.Clock;
            (double dx, double dz)[] dirs = frontOnly ? new[] { (fx, fz) } : new[] { (fx, fz), (-fx, -fz), (fz, -fx), (-fz, fx) };
            double reach =
                prop.Mount == PropMount.Wall ? 1.3
                : prop.Kind == PropKind.BarCounter ? -(prop.D / 2 + 0.45)
                : prop.D / 2 + 0.55;
            foreach (var (dx, dz) in dirs)
            {
                // Bar: stand on the guest side (in front of the counter).
                double s = prop.Kind == PropKind.BarCounter ? prop.D / 2 + 0.5 : reach;
                double x = prop.X + dx * s;
                double z = prop.Z + dz * s;
                if (!p.IsFree(new Rect(x - 0.2, z - 0.2, x + 0.2, z + 0.2), true))
                    continue;
                p.MustReach.Add(new Vec2(x, z));
                if (p.Connected())
                {
                    return new Stand
                    {
                        X = Round(x),
                        Z = Round(z),
                        Yaw = Round(Math.Atan2(prop.X - x, prop.Z - z)),
                    };
                }
                p.MustReach.RemoveAt(p.MustReach.Count - 1);
            }
            return null;
        }

        enum Mode
        {
            Wall,
            Free,
            Hang,
        }

        sealed class FallbackSpec
        {
            public PropKind Kind;

            /// <summary>Placement modes to try, in order.</summary>
            public Mode[] Modes = Array.Empty<Mode>();
            public double W;
            public double D;
            public double H;
            public double? Gap;
            public bool? Occludes;
            public RoomRole[] Rooms = Array.Empty<RoomRole>();
        }

        static readonly Dictionary<PoiType, FallbackSpec> Fallbacks = new Dictionary<PoiType, FallbackSpec>
        {
            [PoiType.Statue] = new FallbackSpec
            {
                Kind = PropKind.Statue,
                Modes = new[] { Mode.Free },
                W = 0.8,
                D = 0.8,
                H = 2.25,
                Occludes = true,
                Rooms = new[] { RoomRole.Party, RoomRole.Circulation },
            },
            // An island bar facing the windows is the fallback when no wall spot is watchable.
            [PoiType.Bar] = new FallbackSpec
            {
                Kind = PropKind.BarCounter,
                Modes = new[] { Mode.Wall, Mode.Free },
                W = 2.6,
                D = 0.7,
                H = 1.1,
                Gap = 0.9,
                Rooms = new[] { RoomRole.Party },
            },
            [PoiType.Painting] = new FallbackSpec
            {
                Kind = PropKind.Painting,
                Modes = new[] { Mode.Hang },
                W = 1.2,
                D = 0.08,
                H = 1.0,
                Rooms = new[] { RoomRole.Party, RoomRole.Circulation, RoomRole.Private },
            },
            [PoiType.Piano] = new FallbackSpec
            {
                Kind = PropKind.GrandPiano,
                Modes = new[] { Mode.Free },
                W = 1.55,
                D = 2.1,
                H = 1.0,
                Rooms = new[] { RoomRole.Party },
            },
            [PoiType.Ledger] = new FallbackSpec
            {
                Kind = PropKind.Console,
                Modes = new[] { Mode.Wall },
                W = 1.4,
                D = 0.5,
                H = 0.88,
                Rooms = new[] { RoomRole.Circulation, RoomRole.Party },
            },
            [PoiType.Fireplace] = new FallbackSpec
            {
                Kind = PropKind.Fireplace,
                Modes = new[] { Mode.Wall },
                W = 2.0,
                D = 0.55,
                H = 1.4,
                Rooms = new[] { RoomRole.Party },
            },
            [PoiType.Bookshelf] = new FallbackSpec
            {
                Kind = PropKind.Bookcase,
                Modes = new[] { Mode.Wall },
                W = 1.2,
                D = 0.45,
                H = 2.4,
                Occludes = true,
                Rooms = new[] { RoomRole.Party, RoomRole.Private },
            },
            [PoiType.Clock] = new FallbackSpec
            {
                Kind = PropKind.Clock,
                Modes = new[] { Mode.Wall },
                W = 0.55,
                D = 0.38,
                H = 2.15,
                Occludes = true,
                Rooms = new[] { RoomRole.Circulation, RoomRole.Party },
            },
            [PoiType.Globe] = new FallbackSpec
            {
                Kind = PropKind.Globe,
                Modes = new[] { Mode.Free },
                W = 0.7,
                D = 0.7,
                H = 1.05,
                Rooms = new[] { RoomRole.Party, RoomRole.Private },
            },
            [PoiType.Safe] = new FallbackSpec
            {
                Kind = PropKind.Safe,
                Modes = new[] { Mode.Wall },
                W = 0.7,
                D = 0.6,
                H = 1.0,
                Rooms = new[] { RoomRole.Private },
            },
        };

        /// <summary>Unit step into the room from each side's wall.</summary>
        static (double x, double z) Inward(Side s) =>
            s switch
            {
                Side.N => (0.0, -1.0),
                Side.S => (0.0, 1.0),
                Side.E => (-1.0, 0.0),
                _ => (1.0, 0.0),
            };

        /// <summary>Place one mission prop in room p, at a spot whose stand point is visible when visAt is given.</summary>
        static Prop? PlaceFallback(Placer p, PoiType type, FallbackSpec spec, Func<double, double, double, double>? visAt, double need)
        {
            foreach (Mode mode in spec.Modes)
            {
                Prop? prop = mode == Mode.Free ? PlaceFree(p, type, spec, visAt, need) : PlaceOnWall(p, type, spec, mode, visAt, need);
                if (prop != null)
                    return prop;
            }
            return null;
        }

        static Prop? PlaceFree(Placer p, PoiType type, FallbackSpec spec, Func<double, double, double, double>? visAt, double need)
        {
            // Face the windows so whoever uses it stands between it and the sniper.
            List<Side> windowSides = p.WindowSides();
            Side face = windowSides.Count > 0 ? windowSides[0] : Side.N;
            var (ix, iz) = Inward(face);
            double dirX = -ix;
            double dirZ = -iz;
            double yaw = Num.Round(Math.Atan2(dirX, dirZ) / (Math.PI / 2)) * (Math.PI / 2);
            var cands = new List<(double x, double z, double v)>();
            Rect i = p.Inner;
            double m = Math.Max(spec.W, spec.D) / 2 + 0.6;
            for (double x = i.X0 + m; x <= i.X1 - m; x += 0.5)
            {
                for (double z = i.Z0 + m; z <= i.Z1 - m; z += 0.5)
                {
                    double sx = x + dirX * (spec.D / 2 + 0.55);
                    double sz = z + dirZ * (spec.D / 2 + 0.55);
                    double v = visAt != null ? visAt(sx, sz, p.FloorY) : 1;
                    if (v >= (visAt != null ? need : 0))
                        cands.Add((x, z, v + p.Rng.Next() * 0.05));
                }
            }
            Sorting.StableSort(cands, (a, b) => Sorting.Cmp(b.v - a.v));
            int n = Math.Min(40, cands.Count);
            for (int k = 0; k < n; k++)
            {
                var c = cands[k];
                Prop? prop = p.Add(spec.Kind, c.x, c.z, yaw, spec.W, spec.D, spec.H, occludes: spec.Occludes, variant: p.Rng.Int(0, 3));
                if (prop != null)
                {
                    prop.Poi = type;
                    return prop;
                }
            }
            return null;
        }

        static Prop? PlaceOnWall(Placer p, PoiType type, FallbackSpec spec, Mode mode, Func<double, double, double, double>? visAt, double need)
        {
            List<Side> windowSides = p.WindowSides();
            Side? windowSide = windowSides.Count > 0 ? windowSides[0] : (Side?)null;
            bool Ok(double x, double z) => visAt == null || visAt(x, z, p.FloorY) >= need;
            foreach (Side side in Placer.Sides)
            {
                if (side == windowSide)
                    continue;
                SideInfo info = p.SideOf(side);
                for (double t = info.T0 + spec.W / 2 + 0.2; t <= info.T1 - spec.W / 2 - 0.2; t += 0.5)
                {
                    double reach = mode == Mode.Hang ? 1.3 : (spec.Gap ?? 0.04) + spec.D + 0.55;
                    Vec2 st = p.At(side, t, reach);
                    if (!Ok(st.X, st.Z))
                        continue;
                    Prop? prop =
                        mode == Mode.Hang
                            ? p.OnWall(side, spec.Kind, spec.W, spec.H, p.FloorY + 1.75, prefer: t, sweep: false, variant: p.Rng.Int(0, 7))
                            : p.AgainstWall(side, spec.Kind, spec.W, spec.D, spec.H, prefer: t, sweep: false, gap: spec.Gap, occludes: spec.Occludes);
                    if (prop != null)
                    {
                        prop.Poi = type;
                        return prop;
                    }
                }
            }
            return null;
        }
    }
}
