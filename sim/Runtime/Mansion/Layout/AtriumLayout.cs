using System;
using System.Collections.Generic;
using ScopeAndDrop.Sim.Core;

namespace ScopeAndDrop.Sim.Mansion
{
    public sealed class AtriumGeometry
    {
        public HallShape Shape;
        public Rect Inner;

        /// <summary>Gallery and stair widths.</summary>
        public double GalleryWidth;
        public double StairWidth;

        /// <summary>Void outline, closed along the garden wall.</summary>
        public List<Vec2> Void = new List<Vec2>();

        /// <summary>Hall footprint at floor level (the inner rectangle, or the rotunda's curved outline).</summary>
        public List<Vec2> Footprint = new List<Vec2>();

        /// <summary>Rotunda only: the two curved wall runs (west, east), each from the side wall round to the back wall.</summary>
        public List<List<Vec2>> CurvedWalls = new List<List<Vec2>>();

        /// <summary>Walkable gallery floor: with stair landings (first gallery) and without (galleries above).</summary>
        public List<Vec2> OutlineWithLandings = new List<Vec2>();
        public List<Vec2> OutlinePlain = new List<Vec2>();

        /// <summary>Balustrade runs along the gallery edge (open polylines), with and without the landing openings.</summary>
        public List<List<Vec2>> RailsWithLandings = new List<List<Vec2>>();
        public List<List<Vec2>> RailsPlain = new List<List<Vec2>>();
        public List<StairArm> Arms = new List<StairArm>();

        /// <summary>Where each arm lands on the first gallery.</summary>
        public List<Rect> Landings = new List<Rect>();
        public List<Vec2> Columns = new List<Vec2>();
        public double ColumnRadius;

        /// <summary>Ground floor: not walkable (rotunda corners, low headroom under the stair).</summary>
        public List<Rect> Blocked0 = new List<Rect>();

        /// <summary>Gallery levels: where there is no floor (the void and rotunda corners). First keeps the stair landings.</summary>
        public List<Rect> HolesFirst = new List<Rect>();
        public List<Rect> HolesPlain = new List<Rect>();

        /// <summary>Footprints of the gallery columns, blocked on every storey.</summary>
        public List<Rect> ColumnBlocks = new List<Rect>();

        /// <summary>Lengths of straight wall a room may furnish, per side; the rotunda hides its back corners.</summary>
        public double[] WallSpanBackX = new double[2];
        public double[] WallSpanSideZ = new double[2];
        public List<Vec2> Foot = new List<Vec2>();
        public double DomeX;
        public double DomeZ;
        public double DomeRadius;
    }

    /// <summary>
    /// The dome hall (stage 4b): the central ball room rises through every storey to a glass dome. Port of src/mansion/layout/atrium.ts.
    /// Ring galleries wrap its left, back and right sides on each upper floor, and a split stair sweeps from the back of the dance floor
    /// round both sides up to the first gallery.
    /// <para>One outline drives everything: the void edge, a U open to the garden windows whose back corners are rounded. Offsetting it
    /// inward gives the stair arms, offsetting it outward gives the gallery (and, for the rotunda, the curved wall). The rest of the
    /// generator still thinks in rectangles, so the curved shapes are handed to it as thin rectangular strips.</para>
    /// </summary>
    public static class AtriumLayout
    {
        struct Sample
        {
            public double X;
            public double Z;
            public double Nx;
            public double Nz;

            public Sample(double x, double z, double nx, double nz)
            {
                X = x;
                Z = z;
                Nx = nx;
                Nz = nz;
            }
        }

        const double Row = 0.25;

        static double R(double v) => Geom.Snap(v, 0.001);

        /// <summary>East half of the void edge from the back centre to the garden wall, with outward normals.</summary>
        static List<Sample> EastEdge(double cx, double vw, double zV, double zF, double rx, double rz)
        {
            var output = new List<Sample>();
            double xs = cx + vw - rx;
            if (xs > cx + 1e-6)
                output.Add(new Sample(cx, zV, 0, -1));
            double steps = Math.Max(8, Math.Ceiling(((Math.PI / 2) * Math.Max(rx, rz)) / 0.12));
            for (int i = 0; i <= steps; i++)
            {
                double t = (i / steps) * (Math.PI / 2);
                double s = Math.Sin(t);
                double c = Math.Cos(t);
                double nl = Num.Or(Num.Hypot(s / rx, c / rz), 1);
                output.Add(new Sample(xs + rx * s, zV + rz - rz * c, s / rx / nl, -c / rz / nl));
            }
            output.Add(new Sample(cx + vw, zF, 1, 0));
            return output;
        }

        static List<Vec2> Offset(List<Sample> edge, double d)
        {
            var output = new List<Vec2>(edge.Count);
            foreach (Sample p in edge)
                output.Add(new Vec2(p.X + d * p.Nx, p.Z + d * p.Nz));
            return output;
        }

        static List<Vec2> Mirror(IReadOnlyList<Vec2> pts, double cx)
        {
            var output = new List<Vec2>(pts.Count);
            foreach (Vec2 p in pts)
                output.Add(new Vec2(2 * cx - p.X, p.Z));
            return output;
        }

        static List<double> Lengths(IReadOnlyList<Vec2> pts)
        {
            var output = new List<double> { 0 };
            for (int i = 1; i < pts.Count; i++)
                output.Add(output[i - 1] + Num.Hypot(pts[i].X - pts[i - 1].X, pts[i].Z - pts[i - 1].Z));
            return output;
        }

        /// <summary>Point at arc length s along a polyline.</summary>
        public static Vec2 PointAt(IReadOnlyList<Vec2> pts, IReadOnlyList<double> cum, double s)
        {
            double total = cum[cum.Count - 1];
            double t = Math.Max(0, Math.Min(total, s));
            int i = 1;
            while (i < cum.Count - 1 && cum[i] < t)
                i++;
            Vec2 a = pts[i - 1];
            Vec2 b = pts[i];
            double span = Num.Or(cum[i] - cum[i - 1], 1);
            double k = (t - cum[i - 1]) / span;
            return new Vec2(a.X + (b.X - a.X) * k, a.Z + (b.Z - a.Z) * k);
        }

        /// <summary>Sub-polyline between two arc lengths (keeps the interior vertices).</summary>
        static List<Vec2> Slice(IReadOnlyList<Vec2> pts, IReadOnlyList<double> cum, double s0, double s1)
        {
            var output = new List<Vec2> { PointAt(pts, cum, s0) };
            for (int i = 0; i < pts.Count; i++)
            {
                if (cum[i] > s0 + 1e-6 && cum[i] < s1 - 1e-6)
                    output.Add(pts[i]);
            }
            output.Add(PointAt(pts, cum, s1));
            return output;
        }

        /// <summary>x-intervals where the horizontal line at z lies inside a polygon.</summary>
        static List<(double a, double b)> Scan(IReadOnlyList<Vec2> poly, double z)
        {
            var xs = new List<double>();
            for (int i = 0; i < poly.Count; i++)
            {
                Vec2 a = poly[i];
                Vec2 b = poly[(i + 1) % poly.Count];
                if (a.Z > z != b.Z > z)
                    xs.Add(a.X + ((z - a.Z) / (b.Z - a.Z)) * (b.X - a.X));
            }
            Sorting.StableSort(xs, (p, q) => Sorting.Cmp(p - q));
            var output = new List<(double, double)>();
            for (int i = 0; i + 1 < xs.Count; i += 2)
                output.Add((xs[i], xs[i + 1]));
            return output;
        }

        sealed class StripRow
        {
            public double Z0;
            public double Z1;
            public List<(double a, double b)> Spans = new List<(double, double)>();
        }

        /// <summary>Rows of rectangles covering the inside (or, within bounds, the outside) of a polygon; equal neighbours are merged.</summary>
        public static List<Rect> Strips(IReadOnlyList<Vec2> poly, Rect bounds, bool outside, double shrink = 0)
        {
            var rows = new List<StripRow>();
            for (double z = bounds.Z0; z < bounds.Z1 - 1e-6; z += Row)
            {
                double z1 = Math.Min(bounds.Z1, z + Row);
                var spans = new List<(double a, double b)>();
                foreach (var (a, b) in Scan(poly, (z + z1) / 2))
                    spans.Add((Math.Max(bounds.X0, a), Math.Min(bounds.X1, b)));
                if (outside)
                {
                    var inv = new List<(double, double)>();
                    double x = bounds.X0;
                    foreach (var (a, b) in spans)
                    {
                        if (a > x + 1e-6)
                            inv.Add((x, a));
                        x = Math.Max(x, b);
                    }
                    if (bounds.X1 > x + 1e-6)
                        inv.Add((x, bounds.X1));
                    spans = inv;
                }
                var kept = new List<(double a, double b)>(spans.Count);
                foreach (var (a, b) in spans)
                {
                    double ra = R(a + shrink);
                    double rb = R(b - shrink);
                    if (rb - ra > 0.02)
                        kept.Add((ra, rb));
                }
                StripRow? last = rows.Count > 0 ? rows[rows.Count - 1] : null;
                if (last != null && last.Spans.Count == kept.Count && SameSpans(last.Spans, kept))
                    last.Z1 = z1;
                else
                    rows.Add(
                        new StripRow
                        {
                            Z0 = z,
                            Z1 = z1,
                            Spans = kept,
                        }
                    );
            }
            var output = new List<Rect>();
            foreach (StripRow r in rows)
            {
                foreach (var (a, b) in r.Spans)
                    output.Add(Rect.Of(a, R(r.Z0), b, R(r.Z1)));
            }
            return output;
        }

        static bool SameSpans(List<(double a, double b)> x, List<(double a, double b)> y)
        {
            for (int i = 0; i < x.Count; i++)
            {
                if (!(Math.Abs(x[i].a - y[i].a) < 0.02 && Math.Abs(x[i].b - y[i].b) < 0.02))
                    return false;
            }
            return true;
        }

        public static bool PointInPoly(IReadOnlyList<Vec2> poly, double x, double z)
        {
            foreach (var (a, b) in Scan(poly, z))
            {
                if (x >= a && x <= b)
                    return true;
            }
            return false;
        }

        /// <summary>Round every point, dropping a point within 1 mm of the point before it (before it in the rounded list, kept or not).</summary>
        static List<Vec2> Clean(List<Vec2> pts)
        {
            var mapped = new List<Vec2>(pts.Count);
            foreach (Vec2 p in pts)
                mapped.Add(new Vec2(R(p.X), R(p.Z)));
            var output = new List<Vec2>(mapped.Count);
            for (int i = 0; i < mapped.Count; i++)
            {
                if (i == 0 || Num.Hypot(mapped[i].X - mapped[i - 1].X, mapped[i].Z - mapped[i - 1].Z) > 1e-3)
                    output.Add(mapped[i]);
            }
            return output;
        }

        static List<Vec2> Cat(params IEnumerable<Vec2>[] parts)
        {
            var output = new List<Vec2>();
            foreach (var part in parts)
                output.AddRange(part);
            return output;
        }

        static List<Vec2> Reversed(List<Vec2> pts)
        {
            var output = new List<Vec2>(pts);
            output.Reverse();
            return output;
        }

        /// <summary>pts[start..end) as a new list; a negative end counts from the end, as Array.prototype.slice.</summary>
        static List<Vec2> Sub(List<Vec2> pts, int start, int end = int.MaxValue)
        {
            int n = pts.Count;
            int s = start < 0 ? Math.Max(0, n + start) : Math.Min(start, n);
            int e =
                end == int.MaxValue ? n
                : end < 0 ? Math.Max(0, n + end)
                : Math.Min(end, n);
            return e > s ? pts.GetRange(s, e - s) : new List<Vec2>();
        }

        /// <summary>
        /// Lay out the dome hall inside the clear interior of the ball room.
        /// Returns null when the room is too small for the stair to reach the gallery.
        /// </summary>
        public static AtriumGeometry? Plan(Rect inner, HallShape shape, double floorY, double rise)
        {
            double cx = (inner.X0 + inner.X1) / 2;
            double A = (inner.X1 - inner.X0) / 2;
            double zB = inner.Z0;
            double zF = inner.Z1;
            // Generous by rule: a gallery two couples can pass on, a stair four can climb abreast.
            double gw = Math.Min(4.2, Math.Max(3.0, 0.33 * A));
            double sw = Math.Min(3.6, Math.Max(2.6, 0.29 * A));
            double vw = A - gw;
            double zV = zB + gw;
            double dv = zF - zV;
            double minRadius = sw + 0.4;
            // The stair lands on the straight run of the side gallery; keep that run long enough for the landing.
            double zMax = dv - 3.4;
            if (vw < sw + 2.0 || zMax < minRadius)
                return null;
            double rx;
            double rz;
            if (shape == HallShape.Rotunda)
            {
                // A true apse: the back of the hall is a half oval as wide as the hall allows.
                rz = Math.Min(vw, zMax);
                rx = Math.Min(vw, (rz * rz) / minRadius);
            }
            else
            {
                rx = rz = Math.Max(minRadius, Math.Min(Math.Min(0.7 * vw, 0.42 * dv), Math.Min(5.0, zMax)));
            }
            if (rx < minRadius - 1e-6)
                return null;

            List<Sample> edge = EastEdge(cx, vw, zV, zF, rx, rz);
            List<Vec2> voidE = Offset(edge, 0);
            List<Vec2> outerE = shape == HallShape.Rotunda ? Offset(edge, gw) : new List<Vec2> { new Vec2(cx, zB), new Vec2(inner.X1, zB), new Vec2(inner.X1, zF) };
            if (shape == HallShape.Rotunda && outerE[0].X > cx + 1e-6)
                outerE.Insert(0, new Vec2(cx, zB));

            // Stair arm centreline, east side: from beside the axis door, round the back corner, up the side.
            List<Vec2> centre = Offset(edge, -sw / 2);
            List<double> cum = Lengths(centre);
            double total = cum[cum.Count - 1];
            double sSide = cum[cum.Count - 2];
            const double halfGap = 2.0;
            double s0 = 0;
            for (double s = 0; s < total; s += 0.05)
            {
                if (PointAt(centre, cum, s).X - cx >= halfGap)
                {
                    s0 = s;
                    break;
                }
            }
            double avail = total - s0;
            bool haveFit = false;
            double fitN = 0;
            double fitTread = 0;
            foreach (double maxRiser in new[] { 0.15, 0.16, 0.17, 0.18, 0.19 })
            {
                double n = Math.Ceiling(rise / maxRiser);
                double tread = Math.Min(0.36, (avail - 1.6) / n);
                if (tread >= 0.255 && (!haveFit || fitTread < 0.3))
                {
                    haveFit = true;
                    fitN = n;
                    fitTread = Geom.Snap(tread, 0.001);
                }
            }
            if (!haveFit)
                return null;
            double flight = fitN * fitTread;
            // Land where the side gallery runs straight, as near the back as the climb allows: that keeps the
            // garden end of the hall, and its windows, clear of the stair.
            double sFoot = Math.Max(s0, sSide - (fitN - 1) * fitTread);
            if (sFoot + flight + 1.6 > total)
                sFoot = total - flight - 1.6;
            if (sFoot < s0 - 1e-6)
                return null;
            double landing = Math.Min(3.0, total - sFoot - flight);
            // The last tread is at gallery height: it and the run beyond it are the landing.
            double sTop = sFoot + (fitN - 1) * fitTread;
            if (sTop < sSide - 1e-3)
                return null;
            double zLand0 = R(PointAt(centre, cum, sTop).Z);
            double zLand1 = R(Math.Min(zF, PointAt(centre, cum, sFoot + flight + landing).Z));
            bool toWall = zF - zLand1 < 0.6;
            double zEnd = toWall ? R(zF) : zLand1;
            var armPath = new List<Vec2>();
            foreach (Vec2 p in Slice(centre, cum, sFoot, sFoot + flight))
                armPath.Add(new Vec2(R(p.X), R(p.Z)));
            var armPathW = new List<Vec2>();
            foreach (Vec2 p in Mirror(armPath, cx))
                armPathW.Add(new Vec2(R(p.X), p.Z));
            var arms = new List<StairArm>
            {
                new StairArm
                {
                    Path = armPath,
                    Width = R(sw),
                    Y0 = floorY,
                    Rise = rise,
                    Steps = (int)fitN,
                },
                new StairArm
                {
                    Path = armPathW,
                    Width = R(sw),
                    Y0 = floorY,
                    Rise = rise,
                    Steps = (int)fitN,
                },
            };
            Rect landE = Rect.Of(R(cx + vw - sw), zLand0, R(cx + vw), zEnd);
            Rect landW = Rect.Of(R(cx - vw), zLand0, R(cx - vw + sw), zEnd);

            // Gallery floor outlines (from the west garden corner, round the walls, back along the void edge).
            List<Vec2> outerW = Reversed(Mirror(outerE, cx));
            List<Vec2> outer = Cat(outerW, Sub(outerE, 1));
            List<Vec2> voidW = Mirror(voidE, cx);
            // East void edge walked from the garden wall to the back centre, with the landing as a step out into the void.
            List<Vec2> EastIn(bool withLandings)
            {
                List<Vec2> back = Reversed(Sub(voidE, 0, -1));
                if (!withLandings)
                    return Cat(new[] { new Vec2(cx + vw, zF) }, back);
                var bump = new[] { new Vec2(landE.X0, zEnd), new Vec2(landE.X0, zLand0), new Vec2(cx + vw, zLand0) };
                return toWall ? Cat(bump, back) : Cat(new[] { new Vec2(cx + vw, zF), new Vec2(cx + vw, zEnd) }, bump, back);
            }
            List<Vec2> Inside(bool withLandings)
            {
                List<Vec2> e = EastIn(withLandings);
                return Cat(e, Sub(Reversed(Mirror(e, cx)), 1));
            }
            List<Vec2> outlineWithLandings = Clean(Cat(outer, Inside(true)));
            List<Vec2> outlinePlain = Clean(Cat(outer, Inside(false)));
            List<Vec2> voidPoly = Clean(Cat(Reversed(voidW), Sub(voidE, 1)));
            List<Vec2> footprint = Clean(outer);
            List<Vec2> edgeAll = Clean(Cat(Reversed(voidW), Sub(voidE, 1)));
            // Balustrades: round the back between the two landings, then round each landing to the garden wall.
            List<Vec2> backRail = Clean(Cat(new[] { new Vec2(cx - vw, zLand0) }, Reversed(Sub(voidW, 0, -1)), Sub(voidE, 1, -1), new[] { new Vec2(cx + vw, zLand0) }));
            List<Vec2> LandRail(double x0, double xEdge) =>
                toWall ? new List<Vec2> { new Vec2(x0, zLand0), new Vec2(x0, zEnd) } : new List<Vec2> { new Vec2(x0, zLand0), new Vec2(x0, zEnd), new Vec2(xEdge, zEnd), new Vec2(xEdge, R(zF)) };
            var railsWithLandings = new List<List<Vec2>> { backRail, LandRail(landE.X0, R(cx + vw)), LandRail(landW.X1, R(cx - vw)) };

            // Columns carry the gallery edge, standing just behind it.
            List<Vec2> colLine = Offset(edge, 0.5);
            List<double> colCum = Lengths(colLine);
            double colLen = colCum[colCum.Count - 1] - 0.6;
            double nCol = Math.Max(2, Num.Round(colLen / 4.4));
            var columns = new List<Vec2>();
            for (int k = 0; k < nCol; k++)
            {
                Vec2 p = PointAt(colLine, colCum, (colLen * (k + 0.5)) / nCol);
                if (p.X - cx < 2.8)
                    continue;
                columns.Add(new Vec2(R(p.X), R(p.Z)));
                columns.Add(new Vec2(R(2 * cx - p.X), R(p.Z)));
            }
            const double columnRadius = 0.3;
            var colBlocks = new List<Rect>(columns.Count);
            foreach (Vec2 c in columns)
                colBlocks.Add(Rect.Of(R(c.X - 0.38), R(c.Z - 0.38), R(c.X + 0.38), R(c.Z + 0.38)));

            // Ground floor: you cannot walk where the stair is lower than head height.
            double lowTo = sFoot + flight * Math.Min(1, 2.5 / rise);
            List<Vec2> Band(double from, double to)
            {
                List<Vec2> mid = Slice(centre, cum, from, to);
                var outPts = new List<Vec2>(mid.Count);
                var inn = new List<Vec2>(mid.Count);
                for (int i = 0; i < mid.Count; i++)
                {
                    Vec2 p = mid[i];
                    Vec2 a = mid[Math.Max(0, i - 1)];
                    Vec2 b = mid[Math.Min(mid.Count - 1, i + 1)];
                    double tl = Num.Or(Num.Hypot(b.X - a.X, b.Z - a.Z), 1);
                    // Left of travel is the void side for the east arm (travel runs +x then +z).
                    double nx = (b.Z - a.Z) / tl;
                    double nz = -(b.X - a.X) / tl;
                    outPts.Add(new Vec2(p.X + (nx * sw) / 2, p.Z + (nz * sw) / 2));
                    inn.Add(new Vec2(p.X - (nx * sw) / 2, p.Z - (nz * sw) / 2));
                }
                inn.Reverse();
                return Cat(outPts, inn);
            }
            List<Vec2> low = Band(sFoot, lowTo);
            var blocked0 = new List<Rect>();
            blocked0.AddRange(Strips(low, inner, false, -0.05));
            blocked0.AddRange(Strips(Mirror(low, cx), inner, false, -0.05));
            if (shape == HallShape.Rotunda)
                blocked0.AddRange(Strips(footprint, inner, true));

            var curvedWalls = new List<List<Vec2>>();
            if (shape == HallShape.Rotunda)
            {
                // The arc alone: the straight runs before and after it lie on the rectangular walls.
                bool hasBack = cx + vw - rx > cx + 1e-6;
                List<Vec2> arc = Clean(Offset(edge.GetRange(hasBack ? 1 : 0, edge.Count - 1 - (hasBack ? 1 : 0)), gw));
                var arcW = new List<Vec2>(arc.Count);
                foreach (Vec2 p in Mirror(arc, cx))
                    arcW.Add(new Vec2(R(p.X), p.Z));
                curvedWalls.Add(arcW);
                curvedWalls.Add(arc);
            }
            Vec2 footPoint = PointAt(centre, cum, Math.Max(0, sFoot - 0.45));
            var (domeZ, domeR) = InscribedDome(footprint, cx, zB, zF);
            return new AtriumGeometry
            {
                Shape = shape,
                Inner = inner,
                GalleryWidth = R(gw),
                StairWidth = R(sw),
                Void = voidPoly,
                Footprint = footprint,
                CurvedWalls = curvedWalls,
                OutlineWithLandings = outlineWithLandings,
                OutlinePlain = outlinePlain,
                RailsWithLandings = railsWithLandings,
                RailsPlain = new List<List<Vec2>> { edgeAll },
                Arms = arms,
                Landings = new List<Rect> { landE, landW },
                Columns = columns,
                ColumnRadius = columnRadius,
                Blocked0 = blocked0,
                HolesFirst = Strips(outlineWithLandings, inner, true),
                HolesPlain = Strips(outlinePlain, inner, true),
                ColumnBlocks = colBlocks,
                WallSpanBackX = shape == HallShape.Rotunda ? new[] { R(cx - (vw - rx)), R(cx + (vw - rx)) } : new[] { inner.X0, inner.X1 },
                WallSpanSideZ = shape == HallShape.Rotunda ? new[] { R(zV + rz), inner.Z1 } : new[] { inner.Z0, inner.Z1 },
                Foot = new List<Vec2> { new Vec2(R(footPoint.X), R(footPoint.Z)), new Vec2(R(2 * cx - footPoint.X), R(footPoint.Z)) },
                DomeX = R(cx),
                DomeZ = domeZ,
                DomeRadius = domeR,
            };
        }

        /// <summary>
        /// The largest dome the hall carries: a circle on the hall's axis, inscribed in its footprint.
        /// It roofs the whole hall, galleries included; it is the sniper's window from above. Returns the rounded centre z and radius.
        /// </summary>
        static (double z, double radius) InscribedDome(List<Vec2> footprint, double cx, double zB, double zF)
        {
            double Clear(double z)
            {
                double d = double.PositiveInfinity;
                for (int i = 0; i < footprint.Count; i++)
                {
                    Vec2 a = footprint[i];
                    Vec2 b = footprint[(i + 1) % footprint.Count];
                    double ex = b.X - a.X;
                    double ez = b.Z - a.Z;
                    double len2 = Num.Or(ex * ex + ez * ez, 1);
                    double t = Math.Max(0, Math.Min(1, ((cx - a.X) * ex + (z - a.Z) * ez) / len2));
                    d = Math.Min(d, Num.Hypot(cx - a.X - ex * t, z - a.Z - ez * t));
                }
                return d;
            }
            double mid = (zB + zF) / 2;
            double bestZ = mid;
            double bestR = Clear(mid);
            for (double z = zB + 2; z <= zF - 2; z += 0.1)
            {
                double r = Clear(z);
                if (r > bestR + 0.05)
                {
                    bestZ = z;
                    bestR = r;
                }
            }
            return (R(bestZ), R(Math.Min(12, Math.Max(3, bestR - 0.45))));
        }

        /// <summary>Does a hall of this clear size take the stair in both hall shapes? Used by the massing to size the hall.</summary>
        public static bool Fits(double width, double depth, double rise)
        {
            Rect inner = Rect.Of(-width / 2, 0, width / 2, depth);
            return Plan(inner, HallShape.Gallery, 0, rise) != null && Plan(inner, HallShape.Rotunda, 0, rise) != null;
        }
    }
}
