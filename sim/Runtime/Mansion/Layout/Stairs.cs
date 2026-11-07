using System;
using System.Collections.Generic;
using ScopeAndDrop.Sim.Core;

namespace ScopeAndDrop.Sim.Mansion
{
    public sealed class StairParams
    {
        public double MaxRiser;
        public double[] Treads = Array.Empty<double>();
        public double MinWidth;
        public double MaxWidth;
        public double Gap;
        public double ApproachMin;
    }

    public sealed class StairFit
    {
        public List<StairFlight> Flights = new List<StairFlight>();
        public List<StairLanding> Landings = new List<StairLanding>();

        /// <summary>Hole to cut in the upper floor.</summary>
        public Rect Hole;

        /// <summary>Plan area occupied by flights and landing (blocked for walking at the lower level).</summary>
        public Rect Footprint;

        /// <summary>Free approach zone at the near end.</summary>
        public Rect Approach;
    }

    /// <summary>
    /// Stairs (stage 4): U-return stairs fitted inside stair rooms. Port of src/mansion/layout/stairs.ts.
    /// Built in a local frame (u along the flights, v across) and mapped to the plan. The upper floor gets a stairwell hole over everything
    /// but the approach zone, which is where the top flight arrives.
    /// </summary>
    public static class Stairs
    {
        public static StairParams GrandStair() =>
            new StairParams
            {
                MaxRiser = 0.18,
                Treads = new[] { 0.3, 0.28, 0.27, 0.26, 0.25 },
                MinWidth = 1.2,
                MaxWidth = 1.8,
                Gap = 0.25,
                ApproachMin = 1.2,
            };

        public static StairParams ServiceStair() =>
            new StairParams
            {
                MaxRiser = 0.2,
                Treads = new[] { 0.26, 0.25, 0.24 },
                MinWidth = 0.9,
                MaxWidth = 1.1,
                Gap = 0.15,
                ApproachMin = 0.9,
            };

        /// <summary>
        /// Fit a U-return stair in region.
        /// along: axis the flights run along. nearAtMin: true if the approach (near) end is at the region's min coordinate along it.
        /// bandsAtMin: true if the flights hug the region's min edge across the flights.
        /// </summary>
        public static StairFit? FitUStair(Rect region, Axis along, bool nearAtMin, bool bandsAtMin, double y0, double rise, StairParams p)
        {
            double len = along == Axis.X ? region.X1 - region.X0 : region.Z1 - region.Z0;
            double span = along == Axis.X ? region.Z1 - region.Z0 : region.X1 - region.X0;
            double fw = Math.Min(p.MaxWidth, (span - p.Gap) / 2);
            if (fw < p.MinWidth)
                return null;
            double n = Math.Ceiling(rise / p.MaxRiser);
            double riser = rise / n;
            double f1 = Math.Ceiling(n / 2);
            double f2 = n - f1;
            foreach (double tread in p.Treads)
            {
                double run1 = f1 * tread;
                double run2 = f2 * tread;
                double approach = len - fw - Math.Max(run1, run2);
                if (approach < p.ApproachMin)
                    continue;
                double bands = 2 * fw + p.Gap;
                // Local (u, v) -> plan (x, z).
                Vec2 ToPlan(double u, double v)
                {
                    double U = nearAtMin ? u : len - u;
                    double V = bandsAtMin ? v : span - v;
                    return along == Axis.X ? new Vec2(region.X0 + U, region.Z0 + V) : new Vec2(region.X0 + V, region.Z0 + U);
                }
                Rect RectUV(double u0, double v0, double u1, double v1)
                {
                    Vec2 a = ToPlan(u0, v0);
                    Vec2 b = ToPlan(u1, v1);
                    return Rect.Of(a.X, a.Z, b.X, b.Z);
                }
                Dir4 farward =
                    along == Axis.X ? (nearAtMin ? Dir4.PosX : Dir4.NegX)
                    : nearAtMin ? Dir4.PosZ
                    : Dir4.NegZ;
                Dir4 nearward =
                    along == Axis.X ? (nearAtMin ? Dir4.NegX : Dir4.PosX)
                    : nearAtMin ? Dir4.NegZ
                    : Dir4.PosZ;
                Vec2 foot1 = ToPlan(approach, fw / 2);
                Vec2 foot2 = ToPlan(len - fw, fw + p.Gap + fw / 2);
                var flights = new List<StairFlight>
                {
                    new StairFlight
                    {
                        X = foot1.X,
                        Y = y0,
                        Z = foot1.Z,
                        Dir = farward,
                        Width = fw,
                        Run = run1,
                        Rise = f1 * riser,
                        Steps = (int)f1,
                    },
                    new StairFlight
                    {
                        X = foot2.X,
                        Y = y0 + f1 * riser,
                        Z = foot2.Z,
                        Dir = nearward,
                        Width = fw,
                        Run = run2,
                        Rise = f2 * riser,
                        Steps = (int)f2,
                    },
                };
                return new StairFit
                {
                    Flights = flights,
                    Landings = new List<StairLanding>
                    {
                        new StairLanding { Rect = RectUV(len - fw, 0, len, bands), Y = y0 + f1 * riser },
                    },
                    // Starts where the top flight arrives, so the arrival tread has floor.
                    Hole = RectUV(len - fw - run2, 0, len, bands),
                    Footprint = RectUV(approach, 0, len, bands),
                    Approach = RectUV(0, 0, approach, span),
                };
            }
            return null;
        }

        /// <summary>
        /// Fit a stair connecting two stacked rooms. Tries both axes and orientations, preferring flights along the room's long side and an
        /// approach near prefer.
        /// </summary>
        public static (Stair stair, StairFit fit)? FitBetween(string id, StairKind kind, string bottomId, Rect bottomInner, string topId, Rect topInner, LevelSpec from, LevelSpec to, Vec2 prefer)
        {
            Rect? region0n = Geom.Intersect(bottomInner, topInner);
            if (region0n == null)
                return null;
            Rect region0 = region0n.Value;
            Rect region = Rect.Of(region0.X0 + 0.05, region0.Z0 + 0.05, region0.X1 - 0.05, region0.Z1 - 0.05);
            StairParams parameters = kind == StairKind.Grand ? GrandStair() : ServiceStair();
            double w = region.X1 - region.X0;
            double d = region.Z1 - region.Z0;
            Axis[] axes = w >= d ? new[] { Axis.X, Axis.Z } : new[] { Axis.Z, Axis.X };
            double cx = (region.X0 + region.X1) / 2;
            double cz = (region.Z0 + region.Z1) / 2;
            foreach (Axis along in axes)
            {
                // Approach at the end nearest the preferred entry; flights against the far side.
                bool nearAtMin = along == Axis.X ? prefer.X <= cx : prefer.Z <= cz;
                bool bandsAtMin = along == Axis.X ? prefer.Z > cz : prefer.X > cx;
                foreach (var (nm, bm) in new[] { (nearAtMin, bandsAtMin), (nearAtMin, !bandsAtMin), (!nearAtMin, bandsAtMin) })
                {
                    StairFit? fit = FitUStair(region, along, nm, bm, from.FloorY, to.FloorY - from.FloorY, parameters);
                    if (fit != null)
                    {
                        var stair = new Stair
                        {
                            Id = id,
                            Kind = kind,
                            FromLevel = from.Index,
                            ToLevel = to.Index,
                            BottomRoom = bottomId,
                            TopRoom = topId,
                            Rect = fit.Footprint,
                            Flights = fit.Flights,
                            Landings = fit.Landings,
                        };
                        return (stair, fit);
                    }
                }
            }
            return null;
        }
    }
}
