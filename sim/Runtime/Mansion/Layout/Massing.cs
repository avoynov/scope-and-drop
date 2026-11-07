using System;
using System.Collections.Generic;
using ScopeAndDrop.Sim.Core;

namespace ScopeAndDrop.Sim.Mansion
{
    public sealed class WingSpec
    {
        public string Id = "";

        /// <summary>West or East.</summary>
        public FacadeSide Side;

        /// <summary>Which front the wing projects from: Garden or Entrance.</summary>
        public FacadeSide Toward;
        public Rect Rect;

        /// <summary>Length in bays along z.</summary>
        public int Bays;
        public int Levels;
    }

    public sealed class PavilionSpec
    {
        public int Bays;
        public double Depth;
    }

    public sealed class PorticoSpec
    {
        public double Depth;
        public bool Giant;
    }

    public sealed class ConservatorySpec
    {
        /// <summary>West or East.</summary>
        public FacadeSide Side;
        public Rect Rect;
    }

    public sealed class MassingPlan
    {
        public MassingType Type;
        public double Bay;

        /// <summary>Bays across the main block (odd).</summary>
        public int Bays;

        /// <summary>Main block width / depth (wall centrelines).</summary>
        public double W;
        public double D;

        /// <summary>Pile depths: front (garden) pile, corridor (0 = none), back (entrance) pile.</summary>
        public double Df;
        public double Dc;
        public double Db;
        public double ZGarden;
        public double ZEntrance;

        /// <summary>Wall between front pile and corridor/back pile.</summary>
        public double ZFrontInner;

        /// <summary>Wall between corridor and back pile (== ZFrontInner when no corridor).</summary>
        public double ZBackInner;

        /// <summary>Back wall of the dome hall, which runs from here to the garden front.</summary>
        public double ZHallBack;

        /// <summary>Upper-floor corridor band [z0, z1].</summary>
        public double[] UpperCorridor = new double[2];
        public List<LevelSpec> Levels = new List<LevelSpec>();
        public int MainLevels;
        public double GroundFloorY;
        public double Slab;

        /// <summary>The whole first-floor garden front is given to the party (houses whose windows show both storeys).</summary>
        public bool PartyUpstairs;

        /// <summary>Bays of the central front (garden) room and central back room (entrance hall).</summary>
        public int CenterFront;
        public int CenterBack;

        /// <summary>Projecting central pavilion on the garden front.</summary>
        public PavilionSpec? GardenPavilion;
        public PavilionSpec? EntrancePavilion;
        public PorticoSpec? GardenPortico;

        /// <summary>Entrance portico (Giant is always false).</summary>
        public PorticoSpec? EntrancePortico;
        public List<WingSpec> Wings = new List<WingSpec>();
        public ConservatorySpec? Conservatory;

        /// <summary>Side of the back pile carrying the service stair (West or East). The grand stair is inside the dome hall.</summary>
        public FacadeSide ServiceSide;
    }

    /// <summary>
    /// Massing grammar (stage 1). Port of src/mansion/layout/massing.ts.
    /// Follows the first steps of Stiny and Mitchell's Palladian grammar: a bay grid mirrored about the garden axis (x = 0), then the parti
    /// (main block, wings, pavilions, portico, conservatory). Everything downstream snaps to this grid, which is what keeps windows, walls
    /// and rooms in classical alignment.
    /// </summary>
    public static class Massing
    {
        // Wall thicknesses (kept here so the massing can size rooms; Walls re-exports them).
        public const double ExteriorT = 0.6;
        public const double InteriorT = 0.25;

        static readonly FacadeSide[] WestEast = { FacadeSide.West, FacadeSide.East };

        // A great house: the smallest is eleven bays, wide enough for a five-bay hall and the rooms such a
        // house is expected to have (kitchen, great room, bar, study...) either side of it.
        static readonly int[] BaysCompact = { 11, 13 };
        static readonly int[] BaysGrand = { 15, 17, 17 };
        static readonly int[] BaysPalatial = { 19, 21 };

        static int[] SizeBays(MansionSize size) =>
            size switch
            {
                MansionSize.Compact => BaysCompact,
                MansionSize.Grand => BaysGrand,
                _ => BaysPalatial,
            };

        public static MassingPlan Plan(Rng rng, StyleDef style, MansionSize size, MassingType? forced = null)
        {
            double bay = Geom.Snap(rng.Range(style.BayWidth[0], style.BayWidth[1]), 0.1);
            int bays = rng.Pick(SizeBays(size));
            double W = Geom.Snap(bays * bay, 0.01);

            MassingType type;
            if (forced.HasValue)
                type = forced.Value;
            else
            {
                var entries = new List<(MassingType item, double weight)>(style.MassingWeights.Count);
                foreach (var kv in style.MassingWeights)
                    entries.Add((kv.Key, kv.Value));
                type = rng.Weighted(entries);
            }
            // Wings need enough facade between them to read as a court.

            int mainLevels = rng.Int(style.Floors[0], style.Floors[1]);
            const double slab = 0.4;
            double groundFloorY = Geom.Snap(rng.Range(style.Plinth[0], style.Plinth[1]));
            var levels = new List<LevelSpec>();
            double y = groundFloorY;
            for (int i = 0; i < mainLevels; i++)
            {
                double[] lohi = style.LevelHeights[Math.Min(i, 2)];
                double height = Geom.Snap(rng.Range(lohi[0], lohi[1]));
                levels.Add(
                    new LevelSpec
                    {
                        Index = i,
                        FloorY = Geom.Snap(y),
                        Height = height,
                        CeilingY = Geom.Snap(y + height - slab),
                    }
                );
                y += height;
            }

            // Piles: deep, well-proportioned rooms. A corridor-less double pile needs a deeper back
            // pile so an upper corridor can be carved from it.
            double corridorWidth = Geom.Snap(rng.Range(3.0, 3.6), 0.1);
            double dc = rng.Chance(0.45) ? corridorWidth : 0;
            double df = Geom.Snap(rng.Range(9.8, 11.8), 0.1);
            double db = Geom.Snap(dc > 0 ? rng.Range(7.0, 8.6) : rng.Range(8.6, 10.2), 0.1);

            // The dome hall is seven bays wide (five in a compact house), a ballroom with a real dance floor
            // between the stair's arms, and runs back from the garden
            // front deep into the house. Behind it, on the axis, a three-bay entrance hall with a room either side.
            int centerFront = size == MansionSize.Compact ? 5 : 7;
            const int centerBack = 3;
            double entranceDepth = Geom.Snap(rng.Range(5.0, 6.0), 0.1);

            PavilionSpec? gardenPavilion = rng.Chance(style.PavilionChance) ? new PavilionSpec { Bays = centerFront, Depth = Geom.Snap(rng.Range(2.0, 4.0), 0.1) } : null;
            // Pavilions only ever widen the central room, so they always cover whole rooms.
            PavilionSpec? entrancePavilion = rng.Chance(0.5) ? new PavilionSpec { Bays = centerBack, Depth = Geom.Snap(rng.Range(1.0, 2.0), 0.1) } : null;
            PorticoSpec? gardenPortico = null;
            if (rng.Chance(style.PorticoChance))
            {
                double depth = Geom.Snap(rng.Range(2.8, 3.6), 0.1);
                gardenPortico = new PorticoSpec { Depth = depth, Giant = mainLevels >= 2 && rng.Chance(0.7) };
            }
            PorticoSpec? entrancePortico = rng.Chance(0.6) ? new PorticoSpec { Depth = Geom.Snap(rng.Range(2.6, 3.2), 0.1) } : null;

            // The hall must take its stair in either shape. It is roomy by construction, so this only
            // ever bites on the shortest piles: then the garden pavilion deepens, then the front pile.
            if (mainLevels >= 2)
            {
                double clearW = centerFront * bay - ExteriorT;
                const double shell = InteriorT / 2 + ExteriorT / 2;
                double DepthOf() => df + dc + db - entranceDepth + (gardenPavilion?.Depth ?? 0);
                for (int guard = 0; guard < 80 && !AtriumLayout.Fits(clearW, DepthOf() - shell, levels[0].Height); guard++)
                {
                    if (gardenPavilion == null)
                        gardenPavilion = new PavilionSpec { Bays = centerFront, Depth = 2.0 };
                    else if (gardenPavilion.Depth < 4.0)
                        gardenPavilion = new PavilionSpec { Bays = centerFront, Depth = Geom.Snap(gardenPavilion.Depth + 0.2, 0.1) };
                    else
                        df = Geom.Snap(df + 0.2, 0.1);
                }
            }

            double D = Geom.Snap(df + dc + db, 0.01);
            double zGarden = Geom.Snap(D / 2, 0.01);
            double zEntrance = Geom.Snap(-D / 2, 0.01);
            double zFrontInner = Geom.Snap(zGarden - df, 0.01);
            double zBackInner = Geom.Snap(zFrontInner - dc, 0.01);
            double[] upperCorridor = dc > 0 ? new[] { zBackInner, zFrontInner } : new[] { Geom.Snap(zFrontInner - corridorWidth, 0.01), zFrontInner };
            // Back wall of the hall: never behind the upper corridor, so the corridor always meets the gallery.
            double zHallBack = Geom.Snap(Math.Min(zEntrance + entranceDepth, upperCorridor[0]), 0.01);

            // Wings: two bays wide, aligned with the main grid so walls stack and
            // window rhythm carries round the corner.
            var wings = new List<WingSpec>();
            double ww = 2 * bay;
            // Glass-roofed houses keep their wings to one storey, as orangery ranges.
            int wingLevels = mainLevels >= 3 && rng.Chance(0.6) && style.GlassRoofs != true ? 2 : 1;
            void AddWings(FacadeSide toward)
            {
                int nb = rng.Int(3, size == MansionSize.Palatial ? 6 : 5);
                double L = Geom.Snap(nb * bay, 0.01);
                foreach (FacadeSide side in WestEast)
                {
                    double x0 = side == FacadeSide.West ? -W / 2 : W / 2 - ww;
                    double z0 = toward == FacadeSide.Garden ? zGarden : zEntrance - L;
                    wings.Add(
                        new WingSpec
                        {
                            Id = "wing-" + toward.Text() + "-" + side.Text(),
                            Side = side,
                            Toward = toward,
                            Rect = Rect.Of(Geom.Snap(x0, 0.01), Geom.Snap(z0, 0.01), Geom.Snap(x0 + ww, 0.01), Geom.Snap(z0 + L, 0.01)),
                            Bays = nb,
                            Levels = wingLevels,
                        }
                    );
                }
            }
            if (type == MassingType.UGarden || type == MassingType.H)
                AddWings(FacadeSide.Garden);
            if (type == MassingType.UEntrance || type == MassingType.H)
                AddWings(FacadeSide.Entrance);

            // Conservatory on an open end of the front pile.
            ConservatorySpec? conservatory = null;
            // About half of all houses have one: usual where the garden front has open ends, occasional beside a garden wing.
            if (rng.Chance(type == MassingType.Block || type == MassingType.UEntrance ? 0.7 : 0.25))
            {
                FacadeSide side = rng.Pick(WestEast);
                double cw = Geom.Snap(rng.Range(6.5, 9.0), 0.1);
                double x0 = side == FacadeSide.East ? W / 2 : -W / 2 - cw;
                conservatory = new ConservatorySpec { Side = side, Rect = Rect.Of(Geom.Snap(x0, 0.01), zFrontInner, Geom.Snap(x0 + cw, 0.01), zGarden) };
            }

            FacadeSide serviceSide = rng.Pick(WestEast);

            return new MassingPlan
            {
                Type = type,
                Bay = bay,
                Bays = bays,
                W = W,
                D = D,
                Df = df,
                Dc = dc,
                Db = db,
                ZGarden = zGarden,
                ZEntrance = zEntrance,
                ZFrontInner = zFrontInner,
                ZBackInner = zBackInner,
                ZHallBack = zHallBack,
                UpperCorridor = upperCorridor,
                Levels = levels,
                MainLevels = mainLevels,
                GroundFloorY = groundFloorY,
                Slab = slab,
                CenterFront = centerFront,
                CenterBack = centerBack,
                GardenPavilion = gardenPavilion,
                EntrancePavilion = entrancePavilion,
                GardenPortico = gardenPortico,
                EntrancePortico = entrancePortico,
                Wings = wings,
                Conservatory = conservatory,
                ServiceSide = serviceSide,
                PartyUpstairs = style.GiantWindows == true,
            };
        }

        /// <summary>x coordinate of bay grid line i (0..bays).</summary>
        public static double BayLine(MassingPlan m, double i) => Geom.Snap(-m.W / 2 + i * m.Bay, 0.01);
    }
}
