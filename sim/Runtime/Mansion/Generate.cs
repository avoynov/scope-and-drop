// Mansion generator: seed in, validated blueprint out.
//
// Pipeline: style → massing grammar → room partitions → walls → stairs →
// windows/doors → site/perch → first-pass sightlines → furnishing/POIs →
// nav + final sightlines → validation. Invalid results are regenerated from a
// derived seed (seed#attempt), so output stays deterministic.
using System;
using System.Collections.Generic;
using ScopeAndDrop.Sim.Core;

namespace ScopeAndDrop.Sim.Mansion
{
    public static class MansionGenerator
    {
        public const string Schema = MansionBlueprint.SchemaId;
        const double ConservatoryHeight = 4.3;

        /// <summary>Clear floor left between a room's walls and the kerb of its roof lantern.</summary>
        const double LanternMargin = 0.5;

        public static ResolvedOptions ResolveOptions(MansionOptions o)
        {
            OrderedMap<PoiType, PoiNeed> required = Validation.DefaultRequiredPois();
            if (o.RequiredPois != null)
            {
                foreach (KeyValuePair<PoiType, PoiNeed> e in o.RequiredPois)
                    required[e.Key] = e.Value;
            }
            return new ResolvedOptions
            {
                Seed = o.Seed,
                Size = o.Size ?? MansionSize.Grand,
                Style = o.Style,
                Massing = o.Massing,
                PerchDistance = o.PerchDistance,
                PerchAzimuthDeg = o.PerchAzimuthDeg,
                PerchElevationDeg = o.PerchElevationDeg,
                RequiredPois = required,
                PartyVisibility = VisibilityBand(o),
                MaxAttempts = o.MaxAttempts ?? (o.MinVisible != null ? 32 : 16),
                NavCell = o.NavCell ?? 0.25,
                Hall = o.Hall ?? HallShape.Gallery,
            };
        }

        /// <summary>MinVisible raises the floor of the band; the ceiling moves up with it so the band never closes.</summary>
        static double[] VisibilityBand(MansionOptions o)
        {
            double lo = o.PartyVisibility != null ? o.PartyVisibility[0] : 0.3;
            double hi = o.PartyVisibility != null ? o.PartyVisibility[1] : 0.8;
            if (o.MinVisible == null)
                return new[] { lo, hi };
            double min = Math.Max(0, Math.Min(0.95, o.MinVisible.Value));
            return new[] { min, Math.Max(hi, Math.Min(1, min + 0.25)) };
        }

        /// <summary>
        /// Generates attempts until one validates, keeping the best. Reads no clock: Stats.GenerationMs stays 0
        /// for the caller to fill in if it times the call.
        /// </summary>
        public static MansionBlueprint Generate(MansionOptions options)
        {
            ResolvedOptions opts = ResolveOptions(options);
            MansionBlueprint? best = null;
            int bestErrors = int.MaxValue;
            for (int attempt = 0; attempt < opts.MaxAttempts; attempt++)
            {
                MansionBlueprint bp = GenerateOnce(opts, attempt);
                // Keep the house with the fewest faults; between equals, the one the sniper sees most of.
                int errors = bp.Validation.Issues.FindAll(i => i.Severity == Severity.Error).Count;
                if (best == null || errors < bestErrors || (errors == bestErrors && bp.Sightlines.PartyVisible > best.Sightlines.PartyVisible))
                {
                    best = bp;
                    bestErrors = errors;
                }
                if (bp.Validation.Ok)
                    break;
            }
            return best!;
        }

        static List<Mass> BuildMasses(MassingPlan m, StyleDef style, Rng rng)
        {
            LevelSpec top = m.Levels[m.Levels.Count - 1];
            double eave = Geom.Snap(top.FloorY + top.Height, 0.01);
            double pitch = Geom.Snap(rng.Range(style.RoofPitchDeg[0], style.RoofPitchDeg[1]), 0.5);
            var masses = new List<Mass>
            {
                new Mass
                {
                    Id = "main",
                    Kind = MassKind.Main,
                    Rect = Rect.Of(-m.W / 2, m.ZEntrance, m.W / 2, m.ZGarden),
                    Levels = m.MainLevels,
                    Roof = new RoofSpec
                    {
                        Kind = style.Roof,
                        EaveY = eave,
                        PitchDeg = pitch,
                        // A flat roof always sits behind a parapet.
                        Balustrade = style.BalustradeParapet || style.Roof == RoofKind.Flat,
                        Dormers = style.Roof == RoofKind.Mansard || (style.Id == StyleId.Georgian && rng.Chance(0.7)) || rng.Chance(0.25),
                    },
                },
            };
            if (m.GardenPavilion != null)
            {
                double half = m.GardenPavilion.Bays * m.Bay / 2;
                masses.Add(
                    new Mass
                    {
                        Id = "pavilion-garden",
                        Kind = MassKind.Pavilion,
                        Rect = Rect.Of(-half, m.ZGarden, half, Geom.Snap(m.ZGarden + m.GardenPavilion.Depth, 0.01)),
                        Levels = m.MainLevels,
                        Roof = new RoofSpec
                        {
                            Kind = RoofKind.Hipped,
                            EaveY = eave,
                            PitchDeg = Roofs.PavilionPitch,
                            Balustrade = false,
                            Pediment = FacadeSide.Garden,
                            Dormers = false,
                        },
                    }
                );
            }
            if (m.EntrancePavilion != null)
            {
                double half = m.EntrancePavilion.Bays * m.Bay / 2;
                masses.Add(
                    new Mass
                    {
                        Id = "pavilion-entrance",
                        Kind = MassKind.Pavilion,
                        Rect = Rect.Of(-half, Geom.Snap(m.ZEntrance - m.EntrancePavilion.Depth, 0.01), half, m.ZEntrance),
                        Levels = m.MainLevels,
                        Roof = new RoofSpec
                        {
                            Kind = RoofKind.Hipped,
                            EaveY = eave,
                            PitchDeg = Roofs.PavilionPitch,
                            Balustrade = false,
                            Pediment = FacadeSide.Entrance,
                            Dormers = false,
                        },
                    }
                );
            }
            RoofKind wingRoof =
                style.Roof == RoofKind.Mansard ? RoofKind.Mansard
                : style.BalustradeParapet && rng.Chance(0.5) && style.GlassRoofs != true ? RoofKind.Flat
                : RoofKind.Hipped;
            foreach (WingSpec w in m.Wings)
            {
                LevelSpec wl = m.Levels[w.Levels - 1];
                masses.Add(
                    new Mass
                    {
                        Id = w.Id,
                        Kind = MassKind.Wing,
                        Rect = w.Rect,
                        Levels = w.Levels,
                        Roof = new RoofSpec
                        {
                            Kind = wingRoof,
                            EaveY = Geom.Snap(wl.FloorY + wl.Height, 0.01),
                            PitchDeg = pitch,
                            Balustrade = (style.BalustradeParapet && style.GlassRoofs != true) || wingRoof == RoofKind.Flat,
                            Dormers = false,
                        },
                    }
                );
            }
            if (m.Conservatory != null)
            {
                masses.Add(
                    new Mass
                    {
                        Id = "conservatory",
                        Kind = MassKind.Conservatory,
                        Rect = m.Conservatory.Rect,
                        Levels = 1,
                        Roof = new RoofSpec
                        {
                            Kind = RoofKind.Glass,
                            EaveY = Geom.Snap(m.GroundFloorY + ConservatoryHeight, 0.01),
                            PitchDeg = 30,
                            Balustrade = false,
                            Dormers = false,
                        },
                    }
                );
            }
            return masses;
        }

        /// <summary>After door planning: every house still has a study and its bathrooms.</summary>
        static void RestoreRequired(List<PlacedRoom> rooms, List<Wall> walls)
        {
            static double Area(PlacedRoom r) => (r.Inner.X1 - r.Inner.X0) * (r.Inner.Z1 - r.Inner.Z0);
            static double Span(PlacedRoom r) => Math.Min(r.Inner.X1 - r.Inner.X0, r.Inner.Z1 - r.Inner.Z0);
            int Count(RoomType t) => rooms.FindAll(r => r.Type == t).Count;
            PlacedRoom? Take(RoomType[] types, Func<int, bool> levels, double minSpan)
            {
                foreach (RoomType t in types)
                {
                    // Never the last of its kind, unless there are plenty (bedrooms).
                    List<PlacedRoom> pool = rooms.FindAll(r => r.Type == t && levels(r.Level) && Span(r) >= minSpan);
                    Sorting.StableSort(pool, (a, b) => Sorting.Cmp(Area(a) - Area(b)));
                    if (pool.Count > 0 && (Count(t) > 1 || t == RoomType.Bedroom || t == RoomType.SittingRoom || t == RoomType.DressingRoom))
                        return pool[0];
                }
                return null;
            }
            if (Count(RoomType.Study) == 0)
            {
                PlacedRoom? r = Take(new[] { RoomType.Cloakroom, RoomType.Pantry, RoomType.SittingRoom, RoomType.DressingRoom, RoomType.Bedroom }, l => l <= 1, 2.6);
                if (r != null)
                    r.Type = RoomType.Study;
            }
            while (Count(RoomType.Bathroom) < Rooms.MinBathrooms)
            {
                PlacedRoom? r = Take(new[] { RoomType.DressingRoom, RoomType.Bedroom, RoomType.SittingRoom }, l => l >= 1, 2.0);
                if (r == null)
                    break;
                r.Type = RoomType.Bathroom;
                // Obscured glass, as in every other bathroom.
                foreach (Wall w in walls)
                {
                    if (!(w.Exterior && (w.Neg == r.Id || w.Pos == r.Id)))
                        continue;
                    foreach (Opening o in w.Openings)
                    {
                        if (o.Glazed)
                            o.Frosted = true;
                    }
                }
            }
        }

        static readonly double[] ServiceLit = { 0, 0.4, 0.6 };
        static readonly (double, double)[] HighLit = { (0, 0.6), (0.4, 0.3), (0.8, 0.1) };
        static readonly (double, double)[] FirstLit = { (0, 0.35), (0.35, 0.25), (0.7, 0.25), (1, 0.15) };

        static double LitFor(Rng rng, RoomDraft r)
        {
            RoomRole role = Rooms.Role(r.Type);
            if (role == RoomRole.Party)
                return 1;
            // Someone has left the gym lights on.
            if (r.Type == RoomType.Gym)
            {
                rng.Next();
                return 0.7;
            }
            if (r.Type == RoomType.HallGallery)
                return 0.9;
            if (role == RoomRole.Circulation)
                return r.Level == 0 ? 0.9
                    : r.Type == RoomType.ServiceStair ? 0.35
                    : 0.6;
            // The kitchen is at work all evening.
            if (r.Type == RoomType.Kitchen)
            {
                rng.Pick(ServiceLit);
                return 1;
            }
            if (role == RoomRole.Service)
                return rng.Pick(ServiceLit);
            if (r.Level >= 2)
                return rng.Weighted(HighLit);
            if (r.Level == 0)
                return 0.8;
            return rng.Weighted(FirstLit);
        }

        public static MansionBlueprint GenerateOnce(ResolvedOptions opts, int attempt)
        {
            var rng = new Rng(attempt == 0 ? opts.Seed : opts.Seed + "#" + Num.ToText(attempt));
            StyleDef style = Styles.Get(opts.Style ?? rng.Fork("style").Pick(Styles.Ids));
            MassingPlan m = Massing.Plan(rng.Fork("massing"), style, opts.Size, opts.Massing);
            List<LevelSpec> levels = m.Levels;
            List<Portico> porticos = Porticos.Plan(m, style);
            List<Mass> masses = BuildMasses(m, style, rng.Fork("roof"));

            FloorPlan plan = Rooms.Plan(rng.Fork("rooms"), m);
            List<Wall> walls = Walls.Derive(plan.Rooms, levels, masses, ConservatoryHeight);
            var placed = new OrderedMap<string, PlacedRoom>();
            foreach (RoomDraft d in plan.Rooms)
                placed[d.Id] = new PlacedRoom(d, Walls.InnerRect(d, walls));

            // Stairs.
            var stairs = new List<Stair>();
            var blocked = new OrderedMap<string, List<Rect>>();
            void Block(string id, Rect r)
            {
                if (!blocked.TryGetValue(id, out List<Rect> l))
                    blocked[id] = l = new List<Rect>();
                l.Add(r);
            }
            var missingStairs = new List<string>();
            PlacedRoom? At(RoomType type, int level)
            {
                foreach (PlacedRoom r in placed.Values)
                {
                    if (r.Type == type && r.Level == level)
                        return r;
                }
                return null;
            }
            // The dome hall: void, ring galleries and the split stair, all inside the ball room's rectangle.
            Atrium? atrium = null;
            AtriumGeometry? atriumGeo = null;
            if (levels.Count > 1)
            {
                PlacedRoom? hall = At(RoomType.Ballroom, 0);
                PlacedRoom? first = At(RoomType.HallGallery, 1);
                atriumGeo = hall != null && first != null ? AtriumLayout.Plan(hall.Inner, opts.Hall, levels[0].FloorY, levels[1].FloorY - levels[0].FloorY) : null;
                if (hall != null && first != null && atriumGeo != null)
                {
                    AtriumGeometry geo = atriumGeo;
                    foreach (Rect r in geo.Blocked0)
                        Block(hall.Id, r);
                    foreach (Rect r in geo.ColumnBlocks)
                        Block(hall.Id, r);
                    var galleries = new List<AtriumGallery>();
                    for (int L = 1; L < levels.Count; L++)
                    {
                        PlacedRoom? g = At(RoomType.HallGallery, L);
                        if (g == null)
                            continue;
                        List<Rect> holes = L == 1 ? geo.HolesFirst : geo.HolesPlain;
                        // Columns carry the gallery above, so the top gallery has none.
                        foreach (Rect r in holes)
                            Block(g.Id, r);
                        if (L < levels.Count - 1)
                        {
                            foreach (Rect r in geo.ColumnBlocks)
                                Block(g.Id, r);
                        }
                        g.FloorHoles.AddRange(holes);
                        galleries.Add(
                            new AtriumGallery
                            {
                                Level = L,
                                RoomId = g.Id,
                                Y = levels[L].FloorY,
                                Outline = L == 1 ? geo.OutlineWithLandings : geo.OutlinePlain,
                                Rails = L == 1 ? geo.RailsWithLandings : geo.RailsPlain,
                            }
                        );
                    }
                    double minX = double.PositiveInfinity;
                    double minZ = double.PositiveInfinity;
                    double maxX = double.NegativeInfinity;
                    double maxZ = double.NegativeInfinity;
                    foreach (StairArm a in geo.Arms)
                    {
                        foreach (Vec2 p in a.Path)
                        {
                            minX = Math.Min(minX, p.X);
                            minZ = Math.Min(minZ, p.Z);
                            maxX = Math.Max(maxX, p.X);
                            maxZ = Math.Max(maxZ, p.Z);
                        }
                    }
                    var landings = new List<StairLanding>();
                    foreach (Rect r in geo.Landings)
                        landings.Add(new StairLanding { Rect = r, Y = levels[1].FloorY });
                    stairs.Add(
                        new Stair
                        {
                            Id = "stair-grand",
                            Kind = StairKind.Grand,
                            FromLevel = 0,
                            ToLevel = 1,
                            BottomRoom = hall.Id,
                            TopRoom = first.Id,
                            Rect = Rect.Of(minX - geo.StairWidth / 2, minZ - geo.StairWidth / 2, maxX + geo.StairWidth / 2, maxZ + geo.StairWidth / 2),
                            Flights = new List<StairFlight>(),
                            Landings = landings,
                            Arms = geo.Arms,
                        }
                    );
                    // The hall's lantern: a glazed attic clear of every roof round it, then the drum and the dome.
                    LevelSpec top = levels[levels.Count - 1];
                    double eave = top.FloorY + top.Height;
                    double roofY = eave;
                    var ring = new Rect(hall.Inner.X0 - 0.7, hall.Inner.Z0 - 0.7, hall.Inner.X1 + 0.7, hall.Inner.Z1 + 0.7);
                    void Probe(double px, double pz)
                    {
                        double y = Roofs.RoofSurfaceY(masses, px, pz);
                        if (double.IsFinite(y))
                            roofY = Math.Max(roofY, y);
                    }
                    for (int i = 0; i <= 16; i++)
                    {
                        double x = ring.X0 + (ring.X1 - ring.X0) * i / 16;
                        double z = ring.Z0 + (ring.Z1 - ring.Z0) * i / 16;
                        Probe(x, ring.Z0);
                        Probe(x, ring.Z1);
                        Probe(ring.X0, z);
                        Probe(ring.X1, z);
                    }
                    double deckY = Geom.Snap(Math.Max(eave + 2.0, roofY + 0.7), 0.01);
                    double drum = Math.Min(2.6, Math.Max(1.8, 0.3 * geo.DomeRadius));
                    atrium = new Atrium
                    {
                        RoomId = hall.Id,
                        Shape = geo.Shape,
                        Inner = geo.Inner,
                        GalleryWidth = geo.GalleryWidth,
                        Void = geo.Void,
                        Footprint = geo.Footprint,
                        CurvedWalls = geo.CurvedWalls,
                        Galleries = galleries,
                        Columns = geo.Columns,
                        ColumnRadius = geo.ColumnRadius,
                        StairId = "stair-grand",
                        Dome = new Dome
                        {
                            X = geo.DomeX,
                            Z = geo.DomeZ,
                            Radius = geo.DomeRadius,
                            BaseY = top.CeilingY,
                            DeckY = deckY,
                            SpringY = Geom.Snap(deckY + drum, 0.01),
                            Height = Geom.Snap(geo.DomeRadius * 0.85, 0.01),
                        },
                    };
                }
                else
                    missingStairs.Add("grand");
                for (int L = 0; L + 1 < levels.Count; L++)
                {
                    PlacedRoom? lo = At(RoomType.ServiceStair, L);
                    PlacedRoom? hi = At(RoomType.ServiceStair, L + 1);
                    if (lo == null || hi == null)
                    {
                        missingStairs.Add("service-" + Num.ToText(L));
                        continue;
                    }
                    var res = Stairs.FitBetween(
                        "stair-service-" + Num.ToText(L),
                        StairKind.Service,
                        lo.Id,
                        lo.Inner,
                        hi.Id,
                        hi.Inner,
                        levels[L],
                        levels[L + 1],
                        new Vec2((lo.Rect.X0 + lo.Rect.X1) / 2, m.ZFrontInner)
                    );
                    if (res != null)
                    {
                        stairs.Add(res.Value.stair);
                        Block(lo.Id, res.Value.fit.Footprint);
                        Block(hi.Id, res.Value.fit.Hole);
                        hi.FloorHoles.Add(res.Value.fit.Hole);
                    }
                    else
                        missingStairs.Add("service-" + Num.ToText(L));
                }
            }

            // Openings.
            var octx = new OpeningContext(rng.Fork("openings"), m, style, levels, masses, placed, walls, blocked);
            Openings.PlaceWindows(octx);
            // Roof terraces: lower wings whose roof is already flat. (No roof is flattened for this.)
            var terraceSpecs = new List<TerraceSpec>();
            foreach (Mass ms in masses)
            {
                if (ms.Kind == MassKind.Wing && ms.Roof.Kind == RoofKind.Flat && ms.Levels < levels.Count)
                {
                    terraceSpecs.Add(
                        new TerraceSpec
                        {
                            Id = Num.ToText(ms.Levels) + ":T-" + ReplaceFirst(ms.Id, "wing-", ""),
                            Rect = ms.Rect,
                            Level = ms.Levels,
                            MassId = ms.Id,
                        }
                    );
                }
            }
            OrderedMap<string, TerraceDoor> terraceDoors = Openings.PlaceTerraceDoors(octx, terraceSpecs);
            DoorPlanResult doors = Openings.PlanDoors(octx);
            // Door planning may turn a room into a passage. If that cost the house its study or a bathroom,
            // a small private or service room that is no one's way through takes over the role.
            RestoreRequired(new List<PlacedRoom>(placed.Values), walls);
            var roofTerraces = new List<RoofTerrace>();
            foreach (TerraceSpec t in terraceSpecs)
            {
                if (!terraceDoors.TryGetValue(t.Id, out TerraceDoor door))
                    continue;
                // Added after door planning: a terrace hangs off one outside door, it is not part of the room graph.
                placed[t.Id] = new PlacedRoom
                {
                    Id = t.Id,
                    Type = RoomType.RoofTerrace,
                    Level = t.Level,
                    MassId = t.MassId,
                    Rect = t.Rect,
                    Zone = RoomZone.Wing,
                    DoubleHeight = false,
                    FloorHoles = new List<Rect>(),
                    Inner = Rect.Of(t.Rect.X0 + 0.4, t.Rect.Z0 + 0.4, t.Rect.X1 - 0.4, t.Rect.Z1 - 0.4),
                };
                roofTerraces.Add(
                    new RoofTerrace
                    {
                        RoomId = t.Id,
                        MassId = t.MassId,
                        Level = t.Level,
                        Rect = t.Rect,
                        Y = Geom.Snap(levels[t.Level].FloorY, 0.01),
                        Door = door,
                    }
                );
            }

            // Finalise rooms.
            Rng finishRng = rng.Fork("finish");
            var rooms = new List<Room>(placed.Count);
            int index = 0;
            foreach (PlacedRoom d in placed.Values)
            {
                bool stage = walls.Exists(w =>
                    (w.Neg == d.Id || w.Pos == d.Id) && w.Exterior && w.Level == d.Level && w.Openings.Exists(o => o.Kind == OpeningKind.FrenchWindow || (o.Glazed && w.Side == FacadeSide.Garden))
                );
                rooms.Add(
                    new Room
                    {
                        Id = d.Id,
                        Index = index++,
                        Type = d.Type,
                        Role = Rooms.Role(d.Type),
                        Label = Styles.RoomLabel(d.Type),
                        Level = d.Level,
                        MassId = d.MassId,
                        Rect = d.Rect,
                        Inner = d.Inner,
                        FloorY = levels[d.Level].FloorY,
                        CeilingY =
                            d.DoubleHeight ? levels[d.Level + 1].CeilingY
                            : d.Zone == RoomZone.Conservatory ? Geom.Snap(m.GroundFloorY + ConservatoryHeight - 0.1, 0.01)
                            : levels[d.Level].CeilingY,
                        FloorHoles = d.FloorHoles,
                        DoubleHeight = d.DoubleHeight,
                        PassThrough = Rooms.IsPassThrough(d.Type),
                        Stage = stage,
                        // Lit before finish: the TypeScript draws them from finishRng in this order.
                        Lit = LitFor(finishRng, d),
                        Finish = Styles.RoomFinish(d.Type, finishRng),
                    }
                );
            }
            // The galleries are the upper part of the hall: same walls, same floor.
            Room? hallRoom = atrium != null ? rooms.Find(r => r.Id == atrium.RoomId) : null;
            if (hallRoom != null)
            {
                foreach (Room r in rooms)
                {
                    if (r.Type == RoomType.HallGallery)
                        r.Finish = hallRoom.Finish.Clone();
                }
            }
            DisambiguateLabels(rooms);
            // Glass from above. The main block has a flat leaded roof with a glass lantern on a kerb over every
            // top-storey room; a wing is roofed entirely in glass. Two roofs, two shapes: glass never shares a slope with lead.
            if (style.GlassRoofs == true)
            {
                foreach (Mass ms in masses)
                {
                    if (ms.Kind != MassKind.Main && ms.Kind != MassKind.Wing)
                        continue;
                    var lanterns = new List<RoofLantern>();
                    List<Mass> others = masses.FindAll(o => o.Id != ms.Id);
                    foreach (Room r in rooms)
                    {
                        if (r.MassId != ms.Id || r.Level != ms.Levels - 1 || r.Type == RoomType.RoofTerrace || r.Type == RoomType.HallGallery)
                            continue;
                        if (ms.Kind == MassKind.Wing)
                        {
                            r.Skylit = true;
                            r.Skylight = r.Inner;
                            continue;
                        }
                        // As large as the room allows: the kerb stands just inside the walls.
                        Rect q = Rect.Of(r.Inner.X0 + LanternMargin, r.Inner.Z0 + LanternMargin, r.Inner.X1 - LanternMargin, r.Inner.Z1 - LanternMargin);
                        if (q.X1 - q.X0 < 1.2 || q.Z1 - q.Z0 < 1.2)
                            continue;
                        // A part of the house with a roof of its own (the pedimented entrance or garden front) keeps
                        // that roof whole: a room that runs under it gets no lantern.
                        if (Covered(others, q, ms))
                            continue;
                        r.Skylit = true;
                        r.Skylight = q;
                        lanterns.Add(new RoofLantern { RoomId = r.Id, Rect = q });
                    }
                    if (ms.Kind == MassKind.Wing)
                        ms.Roof.Glazed = new List<Rect> { Rect.Of(ms.Rect.X0 - 1, ms.Rect.Z0 - 1, ms.Rect.X1 + 1, ms.Rect.Z1 + 1) };
                    else if (lanterns.Count > 0)
                        ms.Roof.Lanterns = lanterns;
                }
            }
            foreach (Mass ms in masses)
            {
                var exposed = new List<FacadeSide>();
                foreach (Wall w in walls)
                {
                    if (w.Exterior && w.MassId == ms.Id && w.Side != null && !exposed.Contains(w.Side.Value))
                        exposed.Add(w.Side.Value);
                }
                ms.Exposed = exposed;
            }

            // Site + perch.
            var footRects = new List<Rect>(masses.Count + porticos.Count);
            foreach (Mass q in masses)
                footRects.Add(q.Rect);
            foreach (Portico p in porticos)
                footRects.Add(p.Rect);
            Rect footprint = BoundsOf(footRects);
            SiteOutput siteOut = SitePlanner.Plan(
                new SiteInput
                {
                    Rng = rng.Fork("site"),
                    M = m,
                    Style = style,
                    Porticos = porticos,
                    Footprint = footprint,
                    PerchDistance = opts.PerchDistance,
                    PerchAzimuthDeg = opts.PerchAzimuthDeg,
                    PerchElevationDeg = opts.PerchElevationDeg,
                }
            );
            Site site = siteOut.Site;

            // First-pass sightlines (architecture only) steer where the bar and mission props go.
            var tracer0 = new SightlineTracer(
                site.Perch.Eye,
                Occluders.Collect(
                    new OccluderInput
                    {
                        Walls = walls,
                        Rooms = rooms,
                        Levels = levels,
                        Masses = masses,
                        Porticos = porticos,
                        Props = new List<Prop>(),
                        Site = site,
                        Atrium = atrium,
                        Stairs = stairs,
                        WithProps = false,
                    }
                )
            );
            var visHint = new OrderedMap<string, double>();
            foreach (Room r in rooms)
            {
                if (r.Level > 1)
                    continue;
                double sum = 0;
                int n = 0;
                for (double x = r.Inner.X0 + 0.6; x < r.Inner.X1 - 0.3; x += 1.2)
                {
                    for (double z = r.Inner.Z0 + 0.6; z < r.Inner.Z1 - 0.3; z += 1.2)
                    {
                        sum += tracer0.Person(x, z, r.FloorY);
                        n++;
                    }
                }
                visHint[r.Id] = n != 0 ? sum / n : 0;
            }

            // Furnishing.
            var terraceDoorAt = new OrderedMap<string, Vec2>();
            foreach (RoofTerrace t in roofTerraces)
                terraceDoorAt[t.RoomId] = new Vec2(t.Door.X, t.Door.Z);
            AtriumFurnish? atriumFurnish = null;
            if (atrium != null && atriumGeo != null)
            {
                var ids = new List<string> { atrium.RoomId };
                foreach (AtriumGallery g in atrium.Galleries)
                    ids.Add(g.RoomId);
                atriumFurnish = new AtriumFurnish
                {
                    RoomIds = ids,
                    // Hung low enough to be seen through the upper windows, high enough to clear the dancers.
                    Dome = new Vec3(atrium.Dome.X, Geom.Snap(levels[1].FloorY + 2.2, 0.01), atrium.Dome.Z),
                    BackX = atriumGeo.WallSpanBackX,
                    SideZ = atriumGeo.WallSpanSideZ,
                };
            }
            FurnishOutput fur = Furnish.Run(
                new FurnishInput
                {
                    Rng = rng.Fork("furnish"),
                    Rooms = rooms,
                    Walls = walls,
                    Blocked = blocked,
                    VisHint = visHint,
                    VisAt = (x, z, y) => tracer0.Person(x, z, y),
                    Required = opts.RequiredPois,
                    VisibleAt = Validation.PoiVisible + 0.1,
                    TerraceDoors = terraceDoorAt,
                    Atrium = atriumFurnish,
                }
            );
            var props = new List<Prop>(fur.Props.Count + siteOut.Props.Count + roofTerraces.Count * 2);
            props.AddRange(fur.Props);
            props.AddRange(siteOut.Props);
            var lights = new List<LightSpec>();
            lights.AddRange(fur.Lights);
            lights.AddRange(siteOut.Lights);
            lights.AddRange(FacadeLights(walls, levels, rooms));
            // Lamps at the outer corners of each roof terrace (open air: exterior lights).
            for (int i = 0; i < roofTerraces.Count; i++)
            {
                RoofTerrace t = roofTerraces[i];
                static double Far(double v0, double v1, double at) => Math.Abs(at - v0) > Math.Abs(at - v1) ? v0 + 0.9 : v1 - 0.9;
                double z = Far(t.Rect.Z0, t.Rect.Z1, t.Door.Z);
                double x = Far(t.Rect.X0, t.Rect.X1, t.Door.X);
                (double, double)[] spots =
                    Math.Abs(t.Rect.Z1 - t.Rect.Z0) >= Math.Abs(t.Rect.X1 - t.Rect.X0) ? new[] { (t.Rect.X0 + 0.9, z), (t.Rect.X1 - 0.9, z) } : new[] { (x, t.Rect.Z0 + 0.9), (x, t.Rect.Z1 - 0.9) };
                for (int k = 0; k < spots.Length; k++)
                {
                    var (lx, lz) = spots[k];
                    string tag = Num.ToText(i) + "-" + Num.ToText(k);
                    props.Add(
                        new Prop
                        {
                            Id = "pt" + tag,
                            Kind = PropKind.Lamppost,
                            RoomId = t.RoomId,
                            Level = t.Level,
                            X = Geom.Snap(lx, 0.01),
                            Y = t.Y,
                            Z = Geom.Snap(lz, 0.01),
                            Yaw = 0,
                            W = 0.5,
                            D = 0.5,
                            H = 3.4,
                            Variant = 0,
                            Mount = PropMount.Floor,
                            BlocksNav = true,
                            Occludes = false,
                        }
                    );
                    lights.Add(
                        new LightSpec
                        {
                            Id = "lt" + tag,
                            Kind = LightKind.Lamppost,
                            Scope = "exterior",
                            X = Geom.Snap(lx, 0.01),
                            Y = Geom.Snap(t.Y + 3.25, 0.01),
                            Z = Geom.Snap(lz, 0.01),
                            Color = new[] { 1, 0.66, 0.36 },
                            Intensity = 120,
                            Range = 14,
                        }
                    );
                }
            }

            // Final sightlines + nav. One occluder set serves the final tracer and every bearing sampled below
            // (the TypeScript collects the same set twice).
            OccluderSet occluders = Occluders.Collect(
                new OccluderInput
                {
                    Walls = walls,
                    Rooms = rooms,
                    Levels = levels,
                    Masses = masses,
                    Porticos = porticos,
                    Props = props,
                    Site = site,
                    Atrium = atrium,
                    Stairs = stairs,
                    RoofTerraces = roofTerraces,
                    WithProps = true,
                }
            );
            var tracer = new SightlineTracer(site.Perch.Eye, occluders);
            List<NavLevel> navLevels = NavGrid.Build(
                new NavInput
                {
                    Rooms = rooms,
                    Walls = walls,
                    Levels = levels,
                    Masses = masses,
                    Props = props,
                    Porticos = porticos,
                    Site = site,
                    Blocked = blocked,
                    Cell = opts.NavCell,
                },
                tracer
            );
            List<NavLink> links = Openings.CollectLinks(octx);
            foreach (RoofTerrace t in roofTerraces)
            {
                foreach (NavLink l in links)
                {
                    if (l.Via != t.Door.OpeningId)
                        continue;
                    if (l.From != t.Door.From)
                        l.From = t.RoomId;
                    else
                        l.To = t.RoomId;
                }
            }
            foreach (Stair s in stairs)
            {
                if (s.Arms != null && atriumGeo != null)
                {
                    // One link pair per arm: at the foot on the dance floor, and on the landing at the gallery.
                    for (int i = 0; i < atriumGeo.Foot.Count; i++)
                    {
                        Vec2 f = atriumGeo.Foot[i];
                        Rect l = atriumGeo.Landings[i];
                        links.Add(
                            new NavLink
                            {
                                Kind = NavLinkKind.Stair,
                                From = s.BottomRoom,
                                To = s.TopRoom,
                                Via = s.Id,
                                X = f.X,
                                Z = f.Z,
                                Level = s.FromLevel,
                            }
                        );
                        links.Add(
                            new NavLink
                            {
                                Kind = NavLinkKind.Stair,
                                From = s.TopRoom,
                                To = s.BottomRoom,
                                Via = s.Id,
                                X = Geom.Snap((l.X0 + l.X1) / 2, 0.01),
                                Z = Geom.Snap((l.Z0 + l.Z1) / 2, 0.01),
                                Level = s.ToLevel,
                            }
                        );
                    }
                    continue;
                }
                StairFlight f0 = s.Flights[0];
                StairFlight f1 = s.Flights[s.Flights.Count - 1];
                Vec2 end = StepAlong(f1.X, f1.Z, f1.Dir, f1.Run + 0.3);
                links.Add(
                    new NavLink
                    {
                        Kind = NavLinkKind.Stair,
                        From = s.BottomRoom,
                        To = s.TopRoom,
                        Via = s.Id,
                        X = f0.X,
                        Z = f0.Z,
                        Level = s.FromLevel,
                    }
                );
                links.Add(
                    new NavLink
                    {
                        Kind = NavLinkKind.Stair,
                        From = s.TopRoom,
                        To = s.BottomRoom,
                        Via = s.Id,
                        X = end.X,
                        Z = end.Z,
                        Level = s.ToLevel,
                    }
                );
            }

            Sightlines sight = SummariseSightlines(navLevels, rooms, site.Perch.Eye);
            var pois = new List<Poi>(fur.Pois.Count);
            foreach (Poi p in fur.Pois)
                pois.Add(WithVisibility(p, tracer, rooms, site.Terrace.Y));
            // What the sniper would see from other bearings on the arc (coarse), for the briefing.
            double arcLo = site.Perch.ArcDeg[0];
            double arcHi = site.Perch.ArcDeg[1];
            for (int i = 0; i <= 8; i++)
            {
                double az = Geom.Snap(arcLo + (arcHi - arcLo) * i / 8, 0.1);
                Vec3 eye = Perches.PerchEyeAt(site.Terrain, m.ZGarden, m.GroundFloorY, az, site.Perch.ElevationDeg, site.Perch.Distance);
                site.Perch.Options.Add(new BearingOption { AzimuthDeg = az, PartyVisible = CoarsePartyVisible(new SightlineTracer(eye, occluders), rooms) });
            }
            double elLo = site.Perch.ElevationRangeDeg[0];
            double elHi = site.Perch.ElevationRangeDeg[1];
            for (int i = 0; i <= 6; i++)
            {
                double el = Geom.Snap(elLo + (elHi - elLo) * i / 6, 0.1);
                Vec3 eye = Perches.PerchEyeAt(site.Terrain, m.ZGarden, m.GroundFloorY, site.Perch.AzimuthDeg, el, site.Perch.Distance);
                site.Perch.ElevationOptions.Add(new ElevationOption { ElevationDeg = el, PartyVisible = CoarsePartyVisible(new SightlineTracer(eye, occluders), rooms) });
            }

            var bp = new MansionBlueprint
            {
                Seed = opts.Seed,
                Attempt = attempt,
                Options = opts,
                Style = style,
                Massing = m.Type,
                Bay = m.Bay,
                Bays = m.Bays,
                Levels = levels,
                GroundFloorY = m.GroundFloorY,
                Masses = masses,
                Rooms = rooms,
                Walls = walls,
                Stairs = stairs,
                Atrium = atrium,
                RoofTerraces = roofTerraces,
                Porticos = porticos,
                Props = props,
                Pois = pois,
                Lights = lights,
                Site = site,
                Nav = new Nav { Levels = navLevels, Links = links },
                Sightlines = sight,
            };
            ValidationReport validation = Validation.Validate(
                bp,
                new ValidateExtras
                {
                    Unreachable = doors.Unreachable,
                    PassViolations = doors.PassViolations,
                    MissingStairs = missingStairs,
                }
            );
            if (doors.Retyped.Count > 0)
                validation.Metrics["retypedRooms"] = doors.Retyped.Count;
            bp.Validation = validation;
            int openings = 0;
            foreach (Wall w in walls)
                openings += w.Openings.Count;
            bp.Stats = new BlueprintStats
            {
                Rooms = rooms.Count,
                PartyRooms = rooms.FindAll(r => r.Role == RoomRole.Party).Count,
                PartyArea = validation.Metrics.GetValueOrDefault("partyArea", 0),
                Walls = walls.Count,
                Openings = openings,
                Props = props.Count,
                Lights = lights.Count,
                Footprint = footprint,
                GenerationMs = 0,
            };
            return bp;
        }

        static bool Covered(List<Mass> others, Rect q, Mass ms)
        {
            ReadOnlySpan<double> steps = stackalloc double[] { 0, 0.25, 0.5, 0.75, 1 };
            foreach (double u in steps)
            {
                foreach (double v in steps)
                {
                    if (double.IsFinite(Roofs.RoofSurfaceY(others, q.X0 + (q.X1 - q.X0) * u, q.Z0 + (q.Z1 - q.Z0) * v, ms)))
                        return true;
                }
            }
            return false;
        }

        static Poi WithVisibility(Poi p, SightlineTracer tracer, List<Room> rooms, double terraceY)
        {
            Room? room = p.RoomId != null ? rooms.Find(r => r.Id == p.RoomId) : null;
            Poi q = p.Clone();
            q.Visibility = Num.Round(tracer.Person(p.Stand.X, p.Stand.Z, room != null ? room.FloorY : terraceY) * 1000) / 1000;
            return q;
        }

        /// <summary>Per-room, terrace and indoor-party visibility from the nav grids.</summary>
        static Sightlines SummariseSightlines(List<NavLevel> navLevels, List<Room> rooms, Vec3 eye)
        {
            var roomVis = new OrderedMap<string, double>();
            double partySum = 0;
            int partyN = 0;
            double terrSum = 0;
            int terrN = 0;
            int publicN = 0;
            int hiddenN = 0;
            var byIndex = new Dictionary<int, Room>();
            foreach (Room r in rooms)
                byIndex[r.Index] = r;
            var sums = new Dictionary<int, (double sum, int n)>();
            foreach (NavLevel n in navLevels)
            {
                for (int k = 0; k < n.Walk.Length; k++)
                {
                    if (n.Walk[k] == 0)
                        continue;
                    double v = n.Vis[k] / 255.0;
                    int ri = n.Room[k];
                    if (ri == -2)
                    {
                        // The terrace is in plain view by design; it is reported on its own so it cannot mask an opaque house.
                        terrSum += v;
                        terrN++;
                    }
                    else if (ri >= 0)
                    {
                        var s = sums.TryGetValue(ri, out var cur) ? cur : (0.0, 0);
                        sums[ri] = (s.Item1 + v, s.Item2 + 1);
                        Room r = byIndex[ri];
                        bool party = r.Role == RoomRole.Party && r.Type != RoomType.RoofTerrace;
                        if (party)
                        {
                            partySum += v;
                            partyN++;
                        }
                        if (party || (r.Level == 0 && r.Role == RoomRole.Circulation))
                        {
                            publicN++;
                            if (v < 0.1)
                                hiddenN++;
                        }
                    }
                }
            }
            foreach (Room r in rooms)
                roomVis[r.Id] = sums.TryGetValue(r.Index, out var s) ? Num.Round(s.sum / s.n * 1000) / 1000 : 0;
            return new Sightlines
            {
                Eye = eye,
                Rooms = roomVis,
                Terrace = terrN != 0 ? Num.Round(terrSum / terrN * 1000) / 1000 : 0,
                PartyVisible = partyN != 0 ? Num.Round(partySum / partyN * 1000) / 1000 : 0,
                HiddenShare = publicN != 0 ? Num.Round((double)hiddenN / publicN * 1000) / 1000 : 0,
            };
        }

        /// <summary>Indoor party visibility on a 1 m grid: cheap enough to sample several bearings.</summary>
        static double CoarsePartyVisible(SightlineTracer tracer, List<Room> rooms)
        {
            double sum = 0;
            int n = 0;
            foreach (Room r in rooms)
            {
                if (r.Role != RoomRole.Party || r.Type == RoomType.RoofTerrace)
                    continue;
                for (double x = r.Inner.X0 + 0.5; x < r.Inner.X1; x += 1)
                {
                    for (double z = r.Inner.Z0 + 0.5; z < r.Inner.Z1; z += 1)
                    {
                        sum += tracer.Person(x, z, r.FloorY);
                        n++;
                    }
                }
            }
            return n != 0 ? Num.Round(sum / n * 1000) / 1000 : 0;
        }

        /// <summary>
        /// Move the sniper to another bearing on the perch arc and, optionally, another elevation.
        /// The house, furniture and mission objects are untouched; only what depends on the eye is
        /// recomputed (visibility grids, per-room and party visibility, mission-object visibility).
        /// Pure: returns a new blueprint that shares every part it does not change.
        /// </summary>
        public static MansionBlueprint MovePerch(MansionBlueprint bp, double azimuthDeg, double? elevationDeg = null)
        {
            double lo = bp.Site.Perch.ArcDeg[0];
            double hi = bp.Site.Perch.ArcDeg[1];
            double elLo = bp.Site.Perch.ElevationRangeDeg[0];
            double elHi = bp.Site.Perch.ElevationRangeDeg[1];
            double az = Geom.Snap(Math.Max(lo, Math.Min(hi, azimuthDeg)), 0.1);
            double el = Geom.Snap(Math.Max(elLo, Math.Min(elHi, elevationDeg ?? bp.Site.Perch.ElevationDeg)), 0.1);
            double zGarden = bp.Site.Perch.Target.Z;
            Vec3 eye = Perches.PerchEyeAt(bp.Site.Terrain, zGarden, bp.GroundFloorY, az, el, bp.Site.Perch.Distance);
            Site site = bp.Site.Clone();
            Perch perch = bp.Site.Perch.Clone();
            perch.Eye = eye;
            perch.AzimuthDeg = az;
            perch.ElevationDeg = el;
            site.Perch = perch;
            var tracer = new SightlineTracer(
                eye,
                Occluders.Collect(
                    new OccluderInput
                    {
                        Walls = bp.Walls,
                        Rooms = bp.Rooms,
                        Levels = bp.Levels,
                        Masses = bp.Masses,
                        Porticos = bp.Porticos,
                        Props = bp.Props,
                        Site = site,
                        Atrium = bp.Atrium,
                        Stairs = bp.Stairs,
                        RoofTerraces = bp.RoofTerraces,
                        WithProps = true,
                    }
                )
            );
            var levels = new List<NavLevel>(bp.Nav.Levels.Count);
            foreach (NavLevel n in bp.Nav.Levels)
            {
                var vis = new byte[n.Vis.Length];
                var cache = new Dictionary<int, int>();
                for (int k = 0; k < n.Walk.Length; k++)
                {
                    if (n.Walk[k] == 0)
                        continue;
                    int c = k % n.Cols;
                    int r = (k - c) / n.Cols;
                    int ri = n.Room[k];
                    double floorY =
                        ri == -2 ? site.Terrace.Y
                        : ri >= 0 ? bp.Rooms[ri].FloorY
                        : n.Y;
                    int bc = c / NavGrid.VisBlock;
                    int br = r / NavGrid.VisBlock;
                    int key = (br * 4096 + bc) * 2 + (floorY == n.Y ? 0 : 1);
                    if (!cache.TryGetValue(key, out int v))
                    {
                        v = (int)Num.Round(tracer.Person(n.OriginX + (bc + 0.5) * NavGrid.VisBlock * n.Cell, n.OriginZ + (br + 0.5) * NavGrid.VisBlock * n.Cell, floorY) * 255);
                        cache[key] = v;
                    }
                    vis[k] = (byte)v;
                }
                NavLevel copy = n.Clone();
                copy.Vis = vis;
                levels.Add(copy);
            }
            var pois = new List<Poi>(bp.Pois.Count);
            foreach (Poi p in bp.Pois)
                pois.Add(WithVisibility(p, tracer, bp.Rooms, site.Terrace.Y));
            MansionBlueprint moved = bp.ShallowCopy();
            moved.Site = site;
            moved.Pois = pois;
            moved.Nav = new Nav { Levels = levels, Links = bp.Nav.Links };
            moved.Sightlines = SummariseSightlines(levels, bp.Rooms, eye);
            return moved;
        }

        static Vec2 StepAlong(double x, double z, Dir4 dir, double d) =>
            dir switch
            {
                Dir4.PosX => new Vec2(x + d, z),
                Dir4.NegX => new Vec2(x - d, z),
                Dir4.PosZ => new Vec2(x, z + d),
                _ => new Vec2(x, z - d),
            };

        static Rect BoundsOf(List<Rect> rs)
        {
            double x0 = double.PositiveInfinity;
            double z0 = double.PositiveInfinity;
            double x1 = double.NegativeInfinity;
            double z1 = double.NegativeInfinity;
            foreach (Rect r in rs)
            {
                x0 = Math.Min(x0, r.X0);
                z0 = Math.Min(z0, r.Z0);
                x1 = Math.Max(x1, r.X1);
                z1 = Math.Max(z1, r.Z1);
            }
            return new Rect(x0, z0, x1, z1);
        }

        /// <summary>"West Drawing Room" / "East Drawing Room" when a type repeats on a floor.</summary>
        static void DisambiguateLabels(List<Room> rooms)
        {
            var groups = new OrderedMap<string, List<Room>>();
            foreach (Room r in rooms)
            {
                string k = Num.ToText(r.Level) + ":" + r.Type.Text();
                if (!groups.TryGetValue(k, out List<Room> g))
                    groups[k] = g = new List<Room>();
                g.Add(r);
            }
            foreach (List<Room> g in groups.Values)
            {
                if (g.Count < 2)
                    continue;
                foreach (Room r in g)
                {
                    double cx = (r.Rect.X0 + r.Rect.X1) / 2;
                    double cz = (r.Rect.Z0 + r.Rect.Z1) / 2;
                    string ew =
                        cx < -1 ? "West"
                        : cx > 1 ? "East"
                        : "";
                    string ns = g.Exists(q => q != r && Math.Abs((q.Rect.X0 + q.Rect.X1) / 2 - cx) < 1) ? (cz > 0 ? "Garden" : "North") : "";
                    var parts = new List<string>(3);
                    foreach (string s in new[] { ns, ew, Styles.RoomLabel(r.Type) })
                    {
                        if (s.Length > 0)
                            parts.Add(s);
                    }
                    r.Label = string.Join(" ", parts);
                }
                // Still clashing (e.g. two west bedrooms): number them.
                var seen = new Dictionary<string, int>();
                foreach (Room r in g)
                {
                    int n = (seen.TryGetValue(r.Label, out int c) ? c : 0) + 1;
                    seen[r.Label] = n;
                    if (n > 1)
                        r.Label = r.Label + " " + Num.ToText(n);
                }
            }
        }

        /// <summary>Lanterns flanking the entrance and garden doors, and warm spill from lit windows.</summary>
        static List<LightSpec> FacadeLights(List<Wall> walls, List<LevelSpec> levels, List<Room> rooms)
        {
            var output = new List<LightSpec>();
            int n = 0;
            double y = levels[0].FloorY + 2.7;
            var byId = new Dictionary<string, Room>();
            foreach (Room r in rooms)
                byId[r.Id] = r;
            foreach (Wall w in walls)
            {
                if (!w.Exterior || w.Level != 0)
                    continue;
                string? owner = w.Neg ?? w.Pos;
                if (owner == null || !byId.TryGetValue(owner, out Room? room))
                    continue;
                double sgn = !string.IsNullOrEmpty(w.Neg) ? 1 : -1;
                double nx = w.Axis == Axis.Z ? sgn : 0;
                double nz = w.Axis == Axis.X ? sgn : 0;
                double face = (w.Axis == Axis.X ? w.A.Z : w.A.X) + sgn * (w.Thickness / 2);
                double b = w.Axis == Axis.X ? w.A.X : w.A.Z;
                // Spill: a downward-outward spot just outside each lit window paints the paving, not the wall.
                if (room.Lit >= 0.5)
                {
                    foreach (Opening o in w.Openings)
                    {
                        if (!o.Glazed || o.Frosted == true || o.Curtain == Curtain.Drawn)
                            continue;
                        double t = b + (o.U0 + o.U1) / 2;
                        double out1 = face + sgn * 0.35;
                        double k = o.Kind == OpeningKind.FrenchWindow ? 1.0 : 0.6;
                        output.Add(
                            new LightSpec
                            {
                                Id = "lw" + Num.ToText(n++),
                                Kind = LightKind.Spill,
                                Scope = "exterior",
                                X = w.Axis == Axis.X ? t : out1,
                                Y = o.Y0 + Math.Min(2.4, (o.Y1 - o.Y0) * 0.7),
                                Z = w.Axis == Axis.X ? out1 : t,
                                Color = new[] { 1, 0.56, 0.26 },
                                Intensity = 70 * room.Lit * k * (o.Curtain == Curtain.Sheer ? 0.5 : 1),
                                Range = 9,
                                Dir = new[] { nx * 0.62, -0.78, nz * 0.62 },
                                Cone = 0.35,
                            }
                        );
                    }
                }
                if ((w.Side != FacadeSide.Garden && w.Side != FacadeSide.Entrance) || (room.Type != RoomType.Ballroom && room.Type != RoomType.EntranceHall))
                    continue;
                double off = w.Side == FacadeSide.Garden ? 0.45 : -0.45;
                foreach (Opening o in w.Openings)
                {
                    if (!(o.Passable && Math.Abs(w.A.X + (o.U0 + o.U1) / 2) < 2.5))
                        continue;
                    foreach (double u in new[] { o.U0 - 0.55, o.U1 + 0.55 })
                    {
                        output.Add(
                            new LightSpec
                            {
                                Id = "lf" + Num.ToText(n++),
                                Kind = LightKind.Lantern,
                                Scope = "exterior",
                                X = w.A.X + u,
                                Y = y,
                                Z = w.A.Z + off * 1.4,
                                Color = new[] { 1, 0.6, 0.3 },
                                Intensity = 35,
                                Range = 9,
                                Dir = new[] { 0, -0.8, Num.Sign(off) * 0.6 },
                                Cone = 0.15,
                            }
                        );
                    }
                }
            }
            return output;
        }

        /// <summary>The TypeScript's string replace with a string pattern: the first match only.</summary>
        static string ReplaceFirst(string s, string find, string with)
        {
            int i = s.IndexOf(find, StringComparison.Ordinal);
            return i < 0 ? s : s.Substring(0, i) + with + s.Substring(i + find.Length);
        }
    }
}
