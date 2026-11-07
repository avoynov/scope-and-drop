using System;
using System.Collections.Generic;
using ScopeAndDrop.Sim.Core;

namespace ScopeAndDrop.Sim.Mansion
{
    public enum RoomZone
    {
        Front,
        Back,
        Corridor,
        Wing,
        Conservatory,
    }

    /// <summary>A room before it is finished: reference identity matters (the programme moves types between drafts held in sets).</summary>
    public class RoomDraft
    {
        public string Id = "";
        public RoomType Type;
        public int Level;
        public string MassId = "";
        public Rect Rect;
        public RoomZone Zone;
        public bool DoubleHeight;
        public List<Rect> FloorHoles = new List<Rect>();
    }

    /// <summary>A draft with its clear interior: a copy of the draft (as the TypeScript's spread), sharing its FloorHoles list.</summary>
    public sealed class PlacedRoom : RoomDraft
    {
        public Rect Inner;

        public PlacedRoom() { }

        public PlacedRoom(RoomDraft d, Rect inner)
        {
            Id = d.Id;
            Type = d.Type;
            Level = d.Level;
            MassId = d.MassId;
            Rect = d.Rect;
            Zone = d.Zone;
            DoubleHeight = d.DoubleHeight;
            FloorHoles = d.FloorHoles;
            Inner = inner;
        }
    }

    public sealed class FloorPlan
    {
        public List<RoomDraft> Rooms = new List<RoomDraft>();

        /// <summary>Front/back partitions as bay index ranges (west to east).</summary>
        public List<(int a, int b)> FrontRanges = new List<(int, int)>();
        public List<(int a, int b)> BackRanges = new List<(int, int)>();
    }

    /// <summary>
    /// Floor plans (stage 2): split each pile of the bay grid into rooms and assign the programme. Port of src/mansion/layout/rooms.ts.
    /// Partitions are symmetric compositions of bays about the axis, so walls fall on bay lines and every room gets whole window bays.
    /// Upper floors reuse the ground-floor partition lines so walls stack.
    /// </summary>
    public static class Rooms
    {
        public static RoomRole Role(RoomType type)
        {
            switch (type)
            {
                case RoomType.EntranceHall:
                case RoomType.StairHall:
                case RoomType.Corridor:
                case RoomType.Landing:
                case RoomType.HallGallery:
                case RoomType.ServiceStair:
                    return RoomRole.Circulation;
                case RoomType.Gym:
                case RoomType.Study:
                case RoomType.Bedroom:
                case RoomType.SittingRoom:
                case RoomType.DressingRoom:
                case RoomType.Bathroom:
                    return RoomRole.Private;
                case RoomType.Kitchen:
                case RoomType.Cloakroom:
                case RoomType.Pantry:
                    return RoomRole.Service;
                default:
                    return RoomRole.Party;
            }
        }

        public static bool IsPassThrough(RoomType type)
        {
            RoomRole role = Role(type);
            // Caterers come and go through the kitchen all evening: it may be walked through.
            return role == RoomRole.Party || role == RoomRole.Circulation || type == RoomType.SittingRoom || type == RoomType.Kitchen;
        }

        /// <summary>
        /// Random composition of k bays into parts (listed from the axis outward).
        /// first/last pin the innermost/outermost part sizes when feasible.
        /// </summary>
        public static List<int> ComposeBays(Rng rng, int k, IReadOnlyList<(int item, double weight)> weights, int? first = null, int? last = null)
        {
            bool CanMake(int n)
            {
                // Reachability with unbounded parts from the sizes (tiny DP).
                var ok = new bool[n + 1];
                ok[0] = true;
                for (int i = 1; i <= n; i++)
                {
                    bool any = false;
                    for (int w = 0; w < weights.Count; w++)
                    {
                        int s = weights[w].item;
                        if (s <= i && ok[i - s])
                        {
                            any = true;
                            break;
                        }
                    }
                    ok[i] = any;
                }
                return ok[n];
            }
            for (int attempt = 0; attempt < 64; attempt++)
            {
                var parts = new List<int>();
                int rem = k;
                if (first.HasValue && first.Value <= rem)
                {
                    parts.Add(first.Value);
                    rem -= first.Value;
                }
                int tail = 0;
                if (last.HasValue && rem >= last.Value && CanMake(rem - last.Value))
                {
                    tail = last.Value;
                    rem -= last.Value;
                }
                int guard = 0;
                while (rem > 0 && guard++ < 64)
                {
                    var options = new List<(int item, double weight)>();
                    foreach (var entry in weights)
                    {
                        if (entry.item <= rem && CanMake(rem - entry.item))
                            options.Add(entry);
                    }
                    if (options.Count == 0)
                        break;
                    int s = rng.Weighted(options);
                    parts.Add(s);
                    rem -= s;
                }
                if (rem != 0)
                    continue;
                if (tail != 0)
                    parts.Add(tail);
                return parts;
            }
            // Fallback: single parts (always valid).
            var ones = new List<int>(k);
            for (int i = 0; i < k; i++)
                ones.Add(1);
            return ones;
        }

        /// <summary>Mirror side compositions into bay index ranges, west to east.</summary>
        static List<(int a, int b)> SymmetricRanges(int bays, int center, List<int> side)
        {
            int k = (bays - center) / 2;
            var ranges = new List<(int, int)>();
            // West side: outermost first.
            int i = 0;
            for (int j = side.Count - 1; j >= 0; j--)
            {
                ranges.Add((i, i + side[j]));
                i += side[j];
            }
            ranges.Add((k, k + center));
            i = k + center;
            foreach (int s in side)
            {
                ranges.Add((i, i + s));
                i += s;
            }
            return ranges;
        }

        // Party rooms on the garden front are two or three bays wide: no one-bay rooms in a house like this.
        static readonly (int, double)[] FrontWeights = { (2, 0.55), (3, 0.45) };

        static readonly (int, double)[] BackWeights = { (1, 0.18), (2, 0.5), (3, 0.32) };

        // No single-bay wing rooms: a wing bay is too narrow for a party room.
        static readonly (int, double)[] WingWeights = { (2, 0.55), (3, 0.45) };

        /// <summary>With fewer party rooms than this on the ground floor, reception rooms are added upstairs.</summary>
        public const int MinGroundPartyRooms = 7;

        /// <summary>Narrowest side (m) a room may have and still be a room of the party.</summary>
        const double MinPartySpan = 5;

        static readonly FacadeSide[] Towards = { FacadeSide.Garden, FacadeSide.Entrance };

        static RoomDraft Draft(string id, RoomType type, int level, string massId, Rect rect, RoomZone zone) =>
            new RoomDraft
            {
                Id = id,
                Type = type,
                Level = level,
                MassId = massId,
                Rect = rect,
                Zone = zone,
                DoubleHeight = false,
            };

        static int FindIndex(List<RoomType> list, Predicate<RoomType> match) => list.FindIndex(match);

        static RoomType TakeAt(List<RoomType> list, int idx)
        {
            RoomType t = list[idx];
            list.RemoveAt(idx);
            return t;
        }

        public static FloorPlan Plan(Rng rng, MassingPlan m)
        {
            var rooms = new List<RoomDraft>();
            int n = m.Bays;
            int kF = (n - m.CenterFront) / 2;
            int kB = (n - m.CenterBack) / 2;

            // Wing junction rooms should not be split by the wing wall, so pin the
            // outermost front part to the wing width (2 bays) when wings face the garden.
            bool gardenWings = m.Wings.Exists(w => w.Toward == FacadeSide.Garden);
            List<int> frontSide = ComposeBays(rng.Fork("front"), kF, FrontWeights, null, gardenWings && kF >= 2 ? 2 : (int?)null);
            // Back pile, from the axis outward: a one-bay room beside the entrance hall (behind the dome
            // hall), then rooms of the back pile proper, ending in a one-bay service column.
            List<int> backSide = ComposeBays(rng.Fork("back"), kB, BackWeights, (m.CenterFront - m.CenterBack) / 2, 1);
            List<(int a, int b)> frontRanges = SymmetricRanges(n, m.CenterFront, frontSide);
            List<(int a, int b)> backRanges = SymmetricRanges(n, m.CenterBack, backSide);

            (double x0, double x1) Xr((int a, int b) r) => (Massing.BayLine(m, r.a), Massing.BayLine(m, r.b));
            int centerIndexF = frontSide.Count;
            int centerIndexB = backSide.Count;
            double pz = m.GardenPavilion?.Depth ?? 0;
            double pe = m.EntrancePavilion?.Depth ?? 0;
            var (hallX0, hallX1) = Xr(frontRanges[centerIndexF]);
            Rect hallRect = Rect.Of(hallX0, m.ZHallBack, hallX1, m.ZGarden + pz);
            // Back-pile rooms directly behind the dome hall: the entrance hall and the room either side of it.
            bool BehindHall(int i) => Math.Abs(i - centerIndexB) <= 1;

            /* ---------------- Ground floor (level 0): the party floor ---------------- */
            Rng typeRng = rng.Fork("types");
            List<RoomType> required = typeRng.Shuffle(new[] { RoomType.DrawingRoom, RoomType.DiningRoom, RoomType.Library });
            List<RoomType> optional = typeRng.Shuffle(
                new[] { RoomType.MusicRoom, RoomType.CardRoom, RoomType.MorningRoom, RoomType.BilliardRoom, RoomType.Gallery, RoomType.DrawingRoom, RoomType.MusicRoom }
            );
            RoomType TakeFront(int bays)
            {
                if (required.Count > 0)
                    return TakeAt(required, 0);
                int idx = FindIndex(optional, t => t != RoomType.Gallery || bays >= 3);
                if (idx >= 0)
                    return TakeAt(optional, idx);
                return typeRng.Pick(new[] { RoomType.DrawingRoom, RoomType.CardRoom, RoomType.MorningRoom });
            }

            // Pair types from the axis outward so mirrored rooms differ.
            var frontTypes = new RoomType[frontRanges.Count];
            frontTypes[centerIndexF] = RoomType.Ballroom;
            for (int j = 0; j < frontSide.Count; j++)
            {
                int west = centerIndexF - 1 - j;
                int east = centerIndexF + 1 + j;
                frontTypes[west] = TakeFront(frontSide[j]);
                frontTypes[east] = TakeFront(frontSide[j]);
            }
            for (int i = 0; i < frontRanges.Count; i++)
            {
                var (x0, x1) = Xr(frontRanges[i]);
                bool isCenter = i == centerIndexF;
                rooms.Add(Draft("0:F" + Num.ToText(i), frontTypes[i], 0, "main", isCenter ? hallRect : Rect.Of(x0, m.ZFrontInner, x1, m.ZGarden), RoomZone.Front));
            }

            var backTypes = new RoomType[backRanges.Count];
            backTypes[centerIndexB] = RoomType.EntranceHall;
            bool serviceWest = m.ServiceSide == FacadeSide.West;
            // Rooms the party can use first: a deep back pile has space for several.
            var backPool = new List<RoomType>(required);
            required.Clear();
            backPool.AddRange(typeRng.Shuffle(new[] { RoomType.BilliardRoom, RoomType.CardRoom, RoomType.MorningRoom, RoomType.MusicRoom, RoomType.Study, RoomType.Gallery }));
            RoomType PickBack(int bays)
            {
                int idx = FindIndex(backPool, t => t != RoomType.Gallery || bays >= 3);
                return idx >= 0 ? TakeAt(backPool, idx) : RoomType.CardRoom;
            }
            for (int j = 0; j < backSide.Count; j++)
            {
                int west = centerIndexB - 1 - j;
                int east = centerIndexB + 1 + j;
                bool outermost = j == backSide.Count - 1;
                if (j == 0 && backSide[0] < 2)
                {
                    // Either side of the entrance hall.
                    List<RoomType> pair = typeRng.Shuffle(new[] { RoomType.Study, RoomType.Cloakroom, RoomType.Cloakroom, RoomType.Pantry });
                    backTypes[west] = pair[0];
                    backTypes[east] = pair[1];
                }
                else if (outermost)
                {
                    backTypes[serviceWest ? west : east] = RoomType.ServiceStair;
                    backTypes[serviceWest ? east : west] = typeRng.Pick(new[] { RoomType.Cloakroom, RoomType.Pantry });
                }
                else
                {
                    backTypes[west] = PickBack(backSide[j]);
                    backTypes[east] = PickBack(backSide[j]);
                }
            }
            // The service stair is a full-depth column at one end of the back pile on
            // every storey, so stacked flights always have room; corridors stop at it.
            int serviceIndex = serviceWest ? 0 : backRanges.Count - 1;
            var (sx0, sx1) = Xr(backRanges[serviceIndex]);
            double corrX0 = serviceWest ? sx1 : -m.W / 2;
            double corrX1 = serviceWest ? m.W / 2 : sx0;
            for (int i = 0; i < backRanges.Count; i++)
            {
                var (x0, x1) = Xr(backRanges[i]);
                bool isCenter = i == centerIndexB;
                rooms.Add(
                    Draft(
                        "0:B" + Num.ToText(i),
                        backTypes[i],
                        0,
                        "main",
                        Rect.Of(
                            x0,
                            isCenter ? m.ZEntrance - pe : m.ZEntrance,
                            x1,
                            BehindHall(i) ? m.ZHallBack
                                : i == serviceIndex ? m.ZFrontInner
                                : m.ZBackInner
                        ),
                        RoomZone.Back
                    )
                );
            }

            // The spine corridor stops at the dome hall on either side of it.
            void CorridorHalves(int L, double z0, double z1)
            {
                foreach (var (tag, x0, x1) in new[] { ("w", corrX0, hallX0), ("e", hallX1, corrX1) })
                {
                    if (x1 - x0 < 1)
                        continue;
                    rooms.Add(Draft(Num.ToText(L) + ":C" + tag, RoomType.Corridor, L, "main", Rect.Of(x0, z0, x1, z1), RoomZone.Corridor));
                }
            }
            if (m.Dc > 0)
                CorridorHalves(0, m.ZBackInner, m.ZFrontInner);

            /* ---------------- Wings ---------------- */
            Rng wingRng = rng.Fork("wings");
            var wingComps = new Dictionary<FacadeSide, List<int>>();
            foreach (FacadeSide toward in Towards)
            {
                WingSpec? firstWing = m.Wings.Find(w => w.Toward == toward);
                if (firstWing == null)
                    continue;
                int nb = firstWing.Bays;
                List<int> comp = nb >= 3 && toward == FacadeSide.Garden && wingRng.Chance(0.35) ? new List<int> { nb } : ComposeBays(wingRng, nb, WingWeights);
                wingComps[toward] = comp;
            }
            foreach (WingSpec w in m.Wings)
            {
                List<int> comp = wingComps[w.Toward];
                List<RoomType> pool =
                    w.Toward == FacadeSide.Garden
                        ? wingRng.Shuffle(new[] { RoomType.MusicRoom, RoomType.CardRoom, RoomType.BilliardRoom, RoomType.MorningRoom, RoomType.DrawingRoom })
                        : wingRng.Shuffle(new[] { RoomType.BilliardRoom, RoomType.Study, RoomType.CardRoom, RoomType.Pantry, RoomType.Cloakroom, RoomType.MorningRoom });
                int start = 0;
                for (int j = 0; j < comp.Count; j++)
                {
                    int s = comp[j];
                    Rect r = WingPartRect(m, w, start, start + s);
                    start += s;
                    RoomType type =
                        comp.Count == 1 ? RoomType.Gallery
                        : s >= 3 && j == 0 && w.Toward == FacadeSide.Garden ? RoomType.Gallery
                        : pool[j % pool.Count];
                    rooms.Add(Draft("0:" + WingTag(w) + Num.ToText(j), type, 0, w.Id, r, RoomZone.Wing));
                }
            }

            if (m.Conservatory != null)
                rooms.Add(Draft("0:K", RoomType.Conservatory, 0, "conservatory", m.Conservatory.Rect, RoomZone.Conservatory));

            // A grand house has no narrow reception rooms: anything under five metres across is a study, not a salon.
            foreach (RoomDraft r in rooms)
            {
                if (Role(r.Type) != RoomRole.Party || r.Type == RoomType.Ballroom || r.Type == RoomType.Conservatory)
                    continue;
                if (Math.Min(r.Rect.X1 - r.Rect.X0, r.Rect.Z1 - r.Rect.Z0) < MinPartySpan)
                    r.Type = RoomType.Study;
            }

            /* ---------------- Upper floors ---------------- */
            Rng upRng = rng.Fork("upper");
            int groundParty = 0;
            foreach (RoomDraft r in rooms)
            {
                if (r.Level == 0 && Role(r.Type) == RoomRole.Party)
                    groundParty++;
            }
            bool partyUpstairs = groundParty < MinGroundPartyRooms || m.PartyUpstairs;
            List<RoomType> upstairsParty = upRng.Shuffle(new[] { RoomType.MorningRoom, RoomType.MusicRoom, RoomType.CardRoom, RoomType.DrawingRoom });
            List<RoomType> upstairsMore = upRng.Shuffle(new[] { RoomType.Gallery, RoomType.MorningRoom, RoomType.CardRoom, RoomType.MusicRoom, RoomType.DrawingRoom, RoomType.BilliardRoom });
            double uc0 = m.UpperCorridor[0];
            double uc1 = m.UpperCorridor[1];
            for (int L = 1; L < m.MainLevels; L++)
            {
                bool attic = L >= 2;
                string lv = Num.ToText(L);
                for (int i = 0; i < frontRanges.Count; i++)
                {
                    bool isCenter = i == centerIndexF;
                    var (x0, x1) = Xr(frontRanges[i]);
                    if (isCenter)
                    {
                        // Over the ball room: the hall stays open, ringed by a gallery on this floor.
                        rooms.Add(Draft(lv + ":G", RoomType.HallGallery, L, "main", hallRect, RoomZone.Front));
                        continue;
                    }
                    // When the hall has taken much of the ground floor, the party spills upstairs: the rooms either
                    // side of the first gallery become reception rooms, reached straight off the stair.
                    bool besideGallery = L == 1 && Math.Abs(i - centerIndexF) == 1;
                    // Where the windows show both storeys, the whole first-floor garden front is the party's.
                    bool wide = x1 - x0 >= MinPartySpan;
                    RoomType type =
                        besideGallery && partyUpstairs ? upstairsParty[i < centerIndexF ? 0 : 1]
                        : L == 1 && m.PartyUpstairs && wide ? upstairsMore[i % upstairsMore.Count]
                        : attic ? RoomType.Bedroom
                        : upRng.Pick(new[] { RoomType.Bedroom, RoomType.Bedroom, RoomType.SittingRoom });
                    rooms.Add(Draft(lv + ":F" + Num.ToText(i), type, L, "main", Rect.Of(x0, m.ZFrontInner, x1, m.ZGarden), RoomZone.Front));
                }
                CorridorHalves(L, uc0, uc1);
                for (int i = 0; i < backRanges.Count; i++)
                {
                    var r = backRanges[i];
                    var (x0, x1) = Xr(r);
                    bool isCenter = i == centerIndexB;
                    if (i == serviceIndex)
                    {
                        rooms.Add(Draft(lv + ":B" + Num.ToText(i), RoomType.ServiceStair, L, "main", Rect.Of(x0, m.ZEntrance, x1, m.ZFrontInner), RoomZone.Back));
                        continue;
                    }
                    RoomType type;
                    if (isCenter)
                        type = attic ? RoomType.Bedroom : upRng.Pick(new[] { RoomType.SittingRoom, RoomType.Bedroom });
                    else if (attic)
                        type = r.b - r.a >= 2 ? RoomType.Bedroom : upRng.Pick(new[] { RoomType.Bathroom, RoomType.DressingRoom });
                    else
                        type = r.b - r.a >= 2 ? upRng.Pick(new[] { RoomType.Bedroom, RoomType.Bedroom, RoomType.SittingRoom }) : upRng.Pick(new[] { RoomType.Bathroom, RoomType.DressingRoom });
                    rooms.Add(Draft(lv + ":B" + Num.ToText(i), type, L, "main", Rect.Of(x0, isCenter ? m.ZEntrance - pe : m.ZEntrance, x1, BehindHall(i) ? m.ZHallBack : uc0), RoomZone.Back));
                }

                foreach (WingSpec w in m.Wings)
                {
                    if (L >= w.Levels)
                        continue;
                    List<int> comp = wingComps[w.Toward];
                    // Corridor strip along the court-facing side keeps bedrooms off the route.
                    bool innerX1 = w.Side == FacadeSide.West;
                    const double cw = 2.8;
                    Rect corr = innerX1 ? Rect.Of(Geom.Snap(w.Rect.X1 - cw, 0.01), w.Rect.Z0, w.Rect.X1, w.Rect.Z1) : Rect.Of(w.Rect.X0, w.Rect.Z0, Geom.Snap(w.Rect.X0 + cw, 0.01), w.Rect.Z1);
                    rooms.Add(Draft(lv + ":" + WingTag(w) + "C", RoomType.Corridor, L, w.Id, corr, RoomZone.Wing));
                    int start = 0;
                    for (int j = 0; j < comp.Count; j++)
                    {
                        int s = comp[j];
                        Rect full = WingPartRect(m, w, start, start + s);
                        start += s;
                        Rect r = innerX1 ? Rect.Of(full.X0, full.Z0, corr.X0, full.Z1) : Rect.Of(corr.X1, full.Z0, full.X1, full.Z1);
                        RoomType type = s >= 2 ? RoomType.Bedroom : upRng.Pick(new[] { RoomType.DressingRoom, RoomType.Bathroom });
                        rooms.Add(Draft(lv + ":" + WingTag(w) + Num.ToText(j), type, L, w.Id, r, RoomZone.Wing));
                    }
                }
            }

            AssignProgramme(rng.Fork("programme"), rooms);
            return new FloorPlan
            {
                Rooms = rooms,
                FrontRanges = frontRanges,
                BackRanges = backRanges,
            };
        }

        static string WingTag(WingSpec w) => (w.Side == FacadeSide.West ? "W" : "E") + (w.Toward == FacadeSide.Garden ? "g" : "e");

        /* ------------------------------------------------------------------ */
        /* The programme: which room is what                                    */
        /* ------------------------------------------------------------------ */

        sealed class ProgrammeItem
        {
            public RoomType Type;

            /// <summary>Least clear span and floor area (m, m2) the room needs.</summary>
            public double Span;
            public double Area;

            /// <summary>Storeys it may be on, in order of preference.</summary>
            public int[] Levels = Array.Empty<int>();

            /// <summary>Added to a slot's score by its zone (indexed by RoomZone).</summary>
            public double[] Zones = new double[5];

            /// <summary>+1: takes the largest slot that fits; -1: the smallest.</summary>
            public int Size;

            /// <summary>Optional rooms only: the chance a house has one.</summary>
            public double Chance;

            public ProgrammeItem With(int[] levels, double? span = null, double? area = null)
            {
                var c = (ProgrammeItem)MemberwiseClone();
                c.Levels = levels;
                if (span.HasValue)
                    c.Span = span.Value;
                if (area.HasValue)
                    c.Area = area.Value;
                return c;
            }
        }

        static double[] Zones(double front = 0, double back = 0, double wing = 0)
        {
            var z = new double[5];
            z[(int)RoomZone.Front] = front;
            z[(int)RoomZone.Back] = back;
            z[(int)RoomZone.Wing] = wing;
            return z;
        }

        static ProgrammeItem Item(RoomType type, double span, double area, int[] levels, double[] zones, int size, double chance = 0) =>
            new ProgrammeItem
            {
                Type = type,
                Span = span,
                Area = area,
                Levels = levels,
                Zones = zones,
                Size = size,
                Chance = chance,
            };

        static readonly int[] L0 = { 0 };
        static readonly int[] L01 = { 0, 1 };

        /// <summary>Every house has these, placed in this order (the hungriest for space first).</summary>
        static IReadOnlyList<ProgrammeItem> RequiredItems() =>
            new[]
            {
                Item(RoomType.GreatRoom, 6, 60, L0, Zones(front: 1), 1),
                Item(RoomType.DiningRoom, 5.5, 48, L0, Zones(front: 0.5, back: 0.2), 1),
                Item(RoomType.Kitchen, 4.5, 30, L0, Zones(back: 1.5, wing: 0.5), -1),
                Item(RoomType.Library, 5, 38, L01, Zones(front: 0.3, back: 0.3), 1),
                Item(RoomType.Bar, 4.6, 28, L01, Zones(back: 1, wing: 0.6), -1),
                Item(RoomType.DrawingRoom, 5, 40, L01, Zones(front: 0.8), 1),
                Item(RoomType.Study, 3.2, 14, L01, Zones(back: 0.6), -1),
            };

        /// <summary>Rooms a house may have, each with its chance.</summary>
        static ProgrammeItem[] OptionalItems() =>
            new[]
            {
                Item(RoomType.Disco, 6.5, 68, L01, Zones(wing: 0.9, back: 0.6, front: 0.3), 1, 0.44),
                Item(RoomType.GrandSalon, 6, 55, L01, Zones(front: 1), 1, 0.6),
                Item(RoomType.Cinema, 5, 36, L01, Zones(back: 1.2, wing: 0.4), -1, 0.6),
                Item(RoomType.Gym, 4.5, 30, L01, Zones(back: 1, wing: 0.8), -1, 0.62),
                Item(RoomType.Spa, 6, 60, L0, Zones(wing: 1.2, front: 0.4, back: 0.2), 1, 0.5),
                Item(RoomType.Theatre, 6, 55, L01, Zones(wing: 0.8, back: 0.5, front: 0.3), 1, 0.3),
            };

        /// <summary>What fills the reception rooms left over, each once before any repeats.</summary>
        static readonly RoomType[] Fillers = { RoomType.MusicRoom, RoomType.BilliardRoom, RoomType.CardRoom, RoomType.MorningRoom, RoomType.Gallery };

        /// <summary>Once those are used up: rooms a great house may have more than one of.</summary>
        static readonly RoomType[] Repeatable = { RoomType.DrawingRoom, RoomType.MorningRoom, RoomType.CardRoom };

        /// <summary>What fills the rooms too narrow for the party, in order.</summary>
        static readonly RoomType[] Small = { RoomType.Cloakroom, RoomType.Pantry, RoomType.Bathroom, RoomType.Study };

        static bool IsFixed(RoomType t) =>
            t == RoomType.Ballroom
            || t == RoomType.EntranceHall
            || t == RoomType.ServiceStair
            || t == RoomType.Corridor
            || t == RoomType.HallGallery
            || t == RoomType.Conservatory
            || t == RoomType.Landing
            || t == RoomType.RoofTerrace
            || t == RoomType.StairHall;

        /// <summary>Bathrooms every house has at least, and the number it aims for.</summary>
        public const int MinBathrooms = 2;
        const int WantBathrooms = 3;

        /// <summary>
        /// Decide what each room is. The plan above fixes the shell (hall, entrance, stairs, corridors) and the size of every other room;
        /// this hands those rooms out: first the rooms every house must have, then the optional ones by chance, then one each of the
        /// remaining reception rooms. No type repeats while another is still unused, so a house gets a cinema before it gets a second
        /// music room.
        /// </summary>
        static void AssignProgramme(Rng rng, List<RoomDraft> rooms)
        {
            static double Span(RoomDraft r) => Math.Min(r.Rect.X1 - r.Rect.X0, r.Rect.Z1 - r.Rect.Z0) - 0.4;
            static double Area(RoomDraft r) => (r.Rect.X1 - r.Rect.X0 - 0.4) * (r.Rect.Z1 - r.Rect.Z0 - 0.4);
            var slots = rooms.FindAll(r => !IsFixed(r.Type) && r.Level <= 1);
            var free = new OrderedSet<RoomDraft>(slots.FindAll(r => r.Level == 0));
            // Upstairs, a bedroom or sitting room can give way to a room the house must have; bathrooms and dressing rooms stay.
            var spare = new OrderedSet<RoomDraft>(slots.FindAll(r => r.Level == 1 && r.Type != RoomType.Bathroom && r.Type != RoomType.DressingRoom));
            var jitter = new Dictionary<RoomDraft, double>();
            foreach (RoomDraft r in slots)
                jitter[r] = rng.Range(0, 0.4);

            bool Place(ProgrammeItem it, double relax = 1)
            {
                foreach (int level in it.Levels)
                {
                    var pool = new List<RoomDraft>();
                    foreach (RoomDraft r in level == 0 ? free : spare)
                    {
                        if (r.Level == level && Span(r) >= it.Span * relax && Area(r) >= it.Area * relax)
                            pool.Add(r);
                    }
                    if (pool.Count == 0)
                        continue;
                    double Score(RoomDraft r) => it.Zones[(int)r.Zone] + (it.Size * Area(r)) / 120 + jitter[r];
                    Sorting.StableSort(pool, (a, b) => Sorting.Cmp(Score(b) - Score(a)));
                    RoomDraft best = pool[0];
                    best.Type = it.Type;
                    free.Remove(best);
                    spare.Remove(best);
                    return true;
                }
                return false;
            }
            foreach (ProgrammeItem it in RequiredItems())
            {
                // A tight house makes do with a smaller room, on either storey, rather than go without.
                if (!Place(it) && !Place(it, 0.7) && !Place(it.With(L01), 0.5))
                    Place(it.With(L01, 3, 10));
            }
            foreach (ProgrammeItem it in rng.Shuffle(OptionalItems()))
            {
                if (rng.Chance(it.Chance))
                    Place(it);
            }

            // The rest of the ground floor.
            List<RoomType> fillers = rng.Shuffle(Fillers);
            int f = 0;
            int s = 0;
            var rest = new List<RoomDraft>(free);
            Sorting.StableSort(rest, (a, b) => Sorting.Cmp(Area(b) - Area(a)));
            foreach (RoomDraft r in rest)
            {
                if (Span(r) >= MinPartySpan - 0.4)
                {
                    // A picture gallery wants a long room.
                    bool isLong = Math.Max(r.Rect.X1 - r.Rect.X0, r.Rect.Z1 - r.Rect.Z0) >= 10;
                    int k = fillers.FindIndex(t => t != RoomType.Gallery || isLong);
                    // Each once; after that only the kinds of room a great house has several of. Never a second music or billiard room.
                    r.Type = k >= 0 ? TakeAt(fillers, k) : Repeatable[f++ % Repeatable.Length];
                }
                else
                    r.Type = Small[s++ % Small.Length];
            }

            // Upstairs reception rooms were handed out before the ground floor was settled: one that repeats a
            // music or billiard room downstairs becomes a drawing room.
            foreach (RoomDraft r in rooms)
            {
                if (r.Level < 1 || (r.Type != RoomType.MusicRoom && r.Type != RoomType.BilliardRoom && r.Type != RoomType.Gallery))
                    continue;
                if (rooms.Exists(q => q != r && q.Type == r.Type))
                    r.Type = RoomType.DrawingRoom;
            }

            // Bathrooms: dressing rooms, then the smallest bedrooms, become bathrooms until there are enough.
            int Count() => rooms.FindAll(r => r.Type == RoomType.Bathroom).Count;
            void Give(RoomType[] types, int target)
            {
                var pool = rooms.FindAll(r => r.Level >= 1 && Array.IndexOf(types, r.Type) >= 0);
                Sorting.StableSort(pool, (a, b) => Sorting.Cmp(Area(a) - Area(b)));
                int next = 0;
                while (Count() < target && next < pool.Count)
                    pool[next++].Type = RoomType.Bathroom;
            }
            Give(new[] { RoomType.DressingRoom }, WantBathrooms);
            Give(new[] { RoomType.Bedroom, RoomType.SittingRoom }, MinBathrooms);
        }

        /// <summary>Rect of wing bays [s, e) counted from the junction with the main block.</summary>
        public static Rect WingPartRect(MassingPlan m, WingSpec w, int s, int e)
        {
            if (w.Toward == FacadeSide.Garden)
                return Rect.Of(w.Rect.X0, Geom.Snap(m.ZGarden + s * m.Bay, 0.01), w.Rect.X1, Geom.Snap(m.ZGarden + e * m.Bay, 0.01));
            return Rect.Of(w.Rect.X0, Geom.Snap(m.ZEntrance - e * m.Bay, 0.01), w.Rect.X1, Geom.Snap(m.ZEntrance - s * m.Bay, 0.01));
        }
    }
}
