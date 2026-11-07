using System;
using ScopeAndDrop.Sim.Core;

namespace ScopeAndDrop.Sim.Mansion
{
    /// <summary>
    /// Sniper perch geometry. The sniper may lie anywhere along an arc of the treeline facing the garden front; the bearing is chosen before
    /// the mission. Port of src/mansion/site/perch.ts.
    /// </summary>
    public static class Perches
    {
        /// <summary>Half-width of the arc the sniper can choose from, degrees off the garden axis.</summary>
        public const double ArcDeg = 38;

        /// <summary>Highest the sniper may go: looking down at 60 degrees is enough to see the dance floor through the dome.</summary>
        public const double MaxElevationDeg = 60;

        public static Vec2 PerchPlan(double zGarden, double azimuthDeg, double distance)
        {
            double a = (azimuthDeg * Math.PI) / 180;
            return new Vec2(Geom.Snap(Math.Sin(a) * distance, 0.01), Geom.Snap(zGarden + Math.Cos(a) * distance, 0.01));
        }

        /// <summary>Eye position for a prone sniper at a bearing: on the ground, lifted onto a mound if the brow of the hill would cut the sightline.</summary>
        public static Vec3 PerchEye(TerrainSpec terrain, double zGarden, double groundFloorY, double azimuthDeg, double distance)
        {
            Vec2 p = PerchPlan(zGarden, azimuthDeg, distance);
            double px = p.X;
            double pz = p.Z;
            double eyeY = Terrain.Height(terrain, px, pz) + 0.55;
            double torsoY = groundFloorY + 1.3;
            double lift = 0;
            for (int i = 1; i < 40; i++)
            {
                double t = i / 40.0;
                double x = px + (0 - px) * t;
                double z = pz + (zGarden - pz) * t;
                double rayY = eyeY + (torsoY - eyeY) * t;
                lift = Math.Max(lift, Terrain.Height(terrain, x, z) + 0.3 - rayY);
            }
            eyeY += Math.Min(2.5, Math.Max(0, lift) * 1.15);
            return new Vec3(px, Geom.Snap(eyeY, 0.01), pz);
        }

        /// <summary>
        /// Eye position at a bearing and an elevation (degrees above the horizon, seen from the garden front).
        /// Elevation keeps the range: the eye moves up and in along a sphere centred on the front of the house. At 0, or below what the
        /// treeline already gives, the sniper is prone on the ground. Higher positions have no ground under them; they are an aerial vantage.
        /// </summary>
        public static Vec3 PerchEyeAt(TerrainSpec terrain, double zGarden, double groundFloorY, double azimuthDeg, double elevationDeg, double distance)
        {
            Vec3 ground = PerchEye(terrain, zGarden, groundFloorY, azimuthDeg, distance);
            if (elevationDeg <= 0)
                return ground;
            double el = (Math.Min(MaxElevationDeg, elevationDeg) * Math.PI) / 180;
            double y = groundFloorY + 3 + distance * Math.Sin(el);
            if (y <= ground.Y)
                return ground;
            Vec2 p = PerchPlan(zGarden, azimuthDeg, distance * Math.Cos(el));
            return new Vec3(p.X, Geom.Snap(y, 0.01), p.Z);
        }
    }
}
