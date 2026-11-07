// Sightline tracer from the sniper perch.
//
// 2.5D: vertical wall planes with rectangular openings (glass, curtains),
// horizontal floor slabs, vertical boxes (tall furniture), vertical cylinders
// (columns, statues, tree crowns) and the terrain. Each blocker has a
// transmittance (sheer curtain 0.45, tree crown 0.15 ...); a ray's visibility
// is the product. Occluders are binned by bearing from the eye, so a query
// only tests what lies along its bearing.
using System;
using System.Collections.Generic;
using ScopeAndDrop.Sim.Core;

namespace ScopeAndDrop.Sim.Mansion
{
    public readonly struct WallHole
    {
        public readonly double T0;
        public readonly double T1;
        public readonly double Y0;
        public readonly double Y1;
        public readonly double Transmit;

        public WallHole(double t0, double t1, double y0, double y1, double transmit)
        {
            T0 = t0;
            T1 = t1;
            Y0 = y0;
            Y1 = y1;
            Transmit = transmit;
        }
    }

    public sealed class WallOccluder
    {
        public Axis Axis;
        public double Line;
        public double T0;
        public double T1;
        public double Y0;
        public double Y1;
        public WallHole[] Holes = Array.Empty<WallHole>();
    }

    public struct BoxOccluder
    {
        public double X0;
        public double Z0;
        public double X1;
        public double Z1;
        public double Y0;
        public double Y1;
        public double Transmit;

        public BoxOccluder(Rect r, double y0, double y1, double transmit)
        {
            X0 = r.X0;
            Z0 = r.Z0;
            X1 = r.X1;
            Z1 = r.Z1;
            Y0 = y0;
            Y1 = y1;
            Transmit = transmit;
        }
    }

    public struct CylOccluder
    {
        public double X;
        public double Z;
        public double R;
        public double Y0;
        public double Y1;
        public double Transmit;

        public CylOccluder(double x, double z, double r, double y0, double y1, double transmit)
        {
            X = x;
            Z = z;
            R = r;
            Y0 = y0;
            Y1 = y1;
            Transmit = transmit;
        }
    }

    public sealed class SlabOccluder
    {
        public double Y;
        public List<Rect> Rects = new List<Rect>();
        public List<Rect> Holes = new List<Rect>();
    }

    public sealed class OccluderSet
    {
        public List<WallOccluder> Walls = new List<WallOccluder>();
        public List<BoxOccluder> Boxes = new List<BoxOccluder>();
        public List<CylOccluder> Cyls = new List<CylOccluder>();
        public List<SlabOccluder> Slabs = new List<SlabOccluder>();
        public TerrainSpec? Terrain;
    }

    /// <summary>
    /// Traces rays from a fixed eye. Read-only after construction (only the Rays counter changes),
    /// so one tracer can serve queries from several threads if the counter is not relied on.
    /// </summary>
    public sealed class SightlineTracer
    {
        const int Bins = 4096;

        // Items are coded as index * 3 + kind (0 wall, 1 box, 2 cylinder), in the order they were binned.
        readonly int[][] bins;
        readonly WallOccluder[] walls;
        readonly BoxOccluder[] boxes;
        readonly CylOccluder[] cyls;
        readonly SlabOccluder[] slabs;
        readonly TerrainSpec? terrain;
        readonly double aMin;
        readonly double aMax;

        public readonly Vec3 Eye;

        /// <summary>Rays traced so far (a statistic only).</summary>
        public int Rays;

        public SightlineTracer(Vec3 eye, OccluderSet occ)
        {
            Eye = eye;
            walls = occ.Walls.ToArray();
            boxes = occ.Boxes.ToArray();
            cyls = occ.Cyls.ToArray();
            slabs = occ.Slabs.ToArray();
            terrain = occ.Terrain;

            var codes = new List<int>(walls.Length + boxes.Length + cyls.Length);
            var a0s = new List<double>(codes.Capacity);
            var a1s = new List<double>(codes.Capacity);
            double Ang(double x, double z) => Math.Atan2(x - eye.X, eye.Z - z);
            // Skip anything entirely behind the eye: every target is in front.
            void Push(int code, ReadOnlySpan<double> xs, ReadOnlySpan<double> zs, double pad)
            {
                bool behind = true;
                for (int i = 0; i < zs.Length; i++)
                {
                    if (!(zs[i] > eye.Z))
                    {
                        behind = false;
                        break;
                    }
                }
                if (behind)
                    return;
                double lo = double.PositiveInfinity;
                double hi = double.NegativeInfinity;
                for (int i = 0; i < xs.Length; i++)
                {
                    double a = Ang(xs[i], zs[i]);
                    lo = Math.Min(lo, a);
                    hi = Math.Max(hi, a);
                }
                codes.Add(code);
                a0s.Add(lo - pad);
                a1s.Add(hi + pad);
            }
            Span<double> px = stackalloc double[4];
            Span<double> pz = stackalloc double[4];
            for (int i = 0; i < walls.Length; i++)
            {
                WallOccluder o = walls[i];
                if (o.Axis == Axis.X)
                {
                    px[0] = o.T0;
                    pz[0] = o.Line;
                    px[1] = o.T1;
                    pz[1] = o.Line;
                }
                else
                {
                    px[0] = o.Line;
                    pz[0] = o.T0;
                    px[1] = o.Line;
                    pz[1] = o.T1;
                }
                Push(i * 3, px.Slice(0, 2), pz.Slice(0, 2), 1e-4);
            }
            for (int i = 0; i < boxes.Length; i++)
            {
                BoxOccluder o = boxes[i];
                px[0] = o.X0;
                pz[0] = o.Z0;
                px[1] = o.X1;
                pz[1] = o.Z0;
                px[2] = o.X0;
                pz[2] = o.Z1;
                px[3] = o.X1;
                pz[3] = o.Z1;
                Push(i * 3 + 1, px, pz, 1e-4);
            }
            for (int i = 0; i < cyls.Length; i++)
            {
                CylOccluder o = cyls[i];
                double d = Math.Max(o.R + 0.01, Num.Hypot(o.X - eye.X, o.Z - eye.Z));
                double a = Ang(o.X, o.Z);
                double s = Math.Asin(Math.Min(1, o.R / d));
                codes.Add(i * 3 + 2);
                a0s.Add(a - s - 1e-4);
                a1s.Add(a + s + 1e-4);
            }
            double minA = -0.01;
            double maxA = 0.01;
            for (int i = 0; i < codes.Count; i++)
            {
                minA = Math.Min(minA, a0s[i]);
                maxA = Math.Max(maxA, a1s[i]);
            }
            aMin = Math.Max(-Math.PI / 2, minA);
            aMax = Math.Min(Math.PI / 2, maxA);

            var counts = new int[Bins];
            var b0s = new int[codes.Count];
            var b1s = new int[codes.Count];
            for (int i = 0; i < codes.Count; i++)
            {
                b0s[i] = Bin(a0s[i]);
                b1s[i] = Bin(a1s[i]);
                for (int b = b0s[i]; b <= b1s[i]; b++)
                    counts[b]++;
            }
            bins = new int[Bins][];
            for (int b = 0; b < Bins; b++)
                bins[b] = counts[b] == 0 ? Array.Empty<int>() : new int[counts[b]];
            var fill = new int[Bins];
            for (int i = 0; i < codes.Count; i++)
            {
                for (int b = b0s[i]; b <= b1s[i]; b++)
                    bins[b][fill[b]++] = codes[i];
            }
        }

        int Bin(double a)
        {
            double t = (a - aMin) / (aMax - aMin);
            double b = Math.Min(Bins - 1, Math.Max(0, Math.Floor(t * Bins)));
            // NaN only from a NaN bearing; the TypeScript has no such case either.
            return double.IsNaN(b) ? 0 : (int)b;
        }

        public double Transmit(Vec3 target) => Transmit(target.X, target.Y, target.Z);

        /// <summary>Fraction of light reaching the target from the eye (1 = clear view).</summary>
        public double Transmit(double tx, double ty, double tz)
        {
            Rays++;
            Vec3 E = Eye;
            double dx = tx - E.X;
            double dy = ty - E.Y;
            double dz = tz - E.Z;
            double T = 1;
            double a = Math.Atan2(dx, -dz);
            int[] list = bins[Bin(a)];
            for (int li = 0; li < list.Length; li++)
            {
                int code = list[li];
                int kind = code % 3;
                int idx = code / 3;
                if (kind == 0)
                {
                    WallOccluder w = walls[idx];
                    double t;
                    double u;
                    if (w.Axis == Axis.X)
                    {
                        if (Math.Abs(dz) < 1e-9)
                            continue;
                        t = (w.Line - E.Z) / dz;
                        if (t <= 1e-6 || t >= 1 - 1e-6)
                            continue;
                        u = E.X + t * dx;
                    }
                    else
                    {
                        if (Math.Abs(dx) < 1e-9)
                            continue;
                        t = (w.Line - E.X) / dx;
                        if (t <= 1e-6 || t >= 1 - 1e-6)
                            continue;
                        u = E.Z + t * dz;
                    }
                    if (u < w.T0 || u > w.T1)
                        continue;
                    double y = E.Y + t * dy;
                    if (y < w.Y0 || y > w.Y1)
                        continue;
                    double through = 0;
                    WallHole[] holes = w.Holes;
                    for (int h = 0; h < holes.Length; h++)
                    {
                        if (u >= holes[h].T0 && u <= holes[h].T1 && y >= holes[h].Y0 && y <= holes[h].Y1)
                        {
                            through = holes[h].Transmit;
                            break;
                        }
                    }
                    T *= through;
                }
                else if (kind == 1)
                {
                    ref readonly BoxOccluder b = ref boxes[idx];
                    // Slab method in plan.
                    double t0 = 0;
                    double t1 = 1;
                    if (Math.Abs(dx) < 1e-9)
                    {
                        if (E.X < b.X0 || E.X > b.X1)
                            continue;
                    }
                    else
                    {
                        double ta = (b.X0 - E.X) / dx;
                        double tb = (b.X1 - E.X) / dx;
                        t0 = Math.Max(t0, Math.Min(ta, tb));
                        t1 = Math.Min(t1, Math.Max(ta, tb));
                    }
                    if (Math.Abs(dz) < 1e-9)
                    {
                        if (E.Z < b.Z0 || E.Z > b.Z1)
                            continue;
                    }
                    else
                    {
                        double ta = (b.Z0 - E.Z) / dz;
                        double tb = (b.Z1 - E.Z) / dz;
                        t0 = Math.Max(t0, Math.Min(ta, tb));
                        t1 = Math.Min(t1, Math.Max(ta, tb));
                    }
                    if (t1 <= t0 || t1 <= 1e-6 || t0 >= 1 - 1e-6)
                        continue;
                    double ya = E.Y + t0 * dy;
                    double yb = E.Y + t1 * dy;
                    if (Math.Max(ya, yb) < b.Y0 || Math.Min(ya, yb) > b.Y1)
                        continue;
                    T *= b.Transmit;
                }
                else
                {
                    ref readonly CylOccluder c = ref cyls[idx];
                    double fx = E.X - c.X;
                    double fz = E.Z - c.Z;
                    double A = dx * dx + dz * dz;
                    double B = 2 * (fx * dx + fz * dz);
                    double C = fx * fx + fz * fz - c.R * c.R;
                    double disc = B * B - 4 * A * C;
                    if (disc <= 0 || A < 1e-12)
                        continue;
                    double sq = Math.Sqrt(disc);
                    double ta = Math.Max(0, (-B - sq) / (2 * A));
                    double tb = Math.Min(1, (-B + sq) / (2 * A));
                    if (tb <= ta || tb <= 1e-6 || ta >= 1 - 1e-6)
                        continue;
                    double ya = E.Y + ta * dy;
                    double yb = E.Y + tb * dy;
                    if (Math.Max(ya, yb) < c.Y0 || Math.Min(ya, yb) > c.Y1)
                        continue;
                    T *= c.Transmit;
                }
                if (T <= 0.003)
                    return 0;
            }
            // Floor slabs between storeys.
            foreach (SlabOccluder s in slabs)
            {
                if (Math.Abs(dy) < 1e-9)
                    continue;
                double t = (s.Y - E.Y) / dy;
                if (t <= 1e-6 || t >= 1 - 1e-6)
                    continue;
                double x = E.X + t * dx;
                double z = E.Z + t * dz;
                if (Inside(s.Rects, x, z) && !Inside(s.Holes, x, z))
                    return 0;
            }
            // Brow of the hill.
            if (terrain != null)
            {
                for (int i = 1; i <= 16; i++)
                {
                    double t = i / 16.0 * 0.85;
                    double x = E.X + t * dx;
                    double z = E.Z + t * dz;
                    if (Terrain.Height(terrain, x, z) > E.Y + t * dy)
                        return 0;
                }
            }
            return T;
        }

        static bool Inside(List<Rect> rects, double x, double z)
        {
            foreach (Rect r in rects)
            {
                if (x > r.X0 && x < r.X1 && z > r.Z0 && z < r.Z1)
                    return true;
            }
            return false;
        }

        /// <summary>Visibility of a standing person (torso + head) at plan (x, z) on a floor at floorY.</summary>
        public double Person(double x, double z, double floorY)
        {
            double torso = Transmit(x, floorY + 1.25, z);
            double head = Transmit(x, floorY + 1.62, z);
            return (torso + head) / 2;
        }
    }
}
