using System;
using ScopeAndDrop.Sim.Core;

namespace ScopeAndDrop.Sim.Mansion
{
    /// <summary>
    /// Deterministic terrain height field: a flat lawn plateau around the house, a wooded ridge along the sniper's perch arc, and gentle
    /// undulation. Pure function of the TerrainSpec so the sim, the AI and the renderer agree. Port of src/mansion/site/terrain.ts.
    /// </summary>
    public static class Terrain
    {
        static double Hash2(double ix, double iz, int seed)
        {
            int h = Num.Imul(Num.ToInt32(ix), 374761393) ^ Num.Imul(Num.ToInt32(iz), 668265263) ^ Num.Imul(seed, 2147483647);
            h = Num.Imul(h ^ (int)((uint)h >> 13), 1274126177);
            h ^= (int)((uint)h >> 16);
            return (uint)h / 4294967296.0;
        }

        static double ValueNoise(double x, double z, int seed)
        {
            double ix = Math.Floor(x);
            double iz = Math.Floor(z);
            double fx = x - ix;
            double fz = z - iz;
            double sx = fx * fx * (3 - 2 * fx);
            double sz = fz * fz * (3 - 2 * fz);
            double a = Hash2(ix, iz, seed);
            double b = Hash2(ix + 1, iz, seed);
            double c = Hash2(ix, iz + 1, seed);
            double d = Hash2(ix + 1, iz + 1, seed);
            return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
        }

        static double Smooth(double e0, double e1, double x)
        {
            double t = Math.Min(1, Math.Max(0, (x - e0) / (e1 - e0)));
            return t * t * (3 - 2 * t);
        }

        public static double Height(TerrainSpec t, double x, double z)
        {
            // The lawn plateau round the house is flat: nothing to compute there.
            double r = Math.Sqrt(x * x + z * z);
            if (r <= t.FlatRadius)
                return 0;
            // Wooded ridge following the perch arc, so every bearing the sniper may pick looks down on the house.
            double rz = z - t.Ridge.Cz;
            double rho = Math.Sqrt(x * x + rz * rz);
            double over = Math.Max(0, Math.Abs(Math.Atan2(x, rz)) - t.Ridge.HalfAngle);
            double along = (over * t.Ridge.Radius) / 2.6;
            double across = rho - t.Ridge.Radius;
            double d = Math.Sqrt(along * along + across * across);
            double rise = t.PerchRise * (1 - Smooth(0, 95, d));
            // Plateau mask: zero near the house, full beyond.
            double mask = Smooth(t.FlatRadius, t.FlatRadius + 60, r);
            double n = (ValueNoise(x / 55, z / 55, t.Seed) - 0.5) * 2 + (ValueNoise(x / 19, z / 19, t.Seed + 7) - 0.5) * 0.5;
            return (rise + n * t.Undulation) * mask;
        }
    }
}
