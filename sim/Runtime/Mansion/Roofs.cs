using System;
using System.Collections.Generic;
using ScopeAndDrop.Sim.Core;

namespace ScopeAndDrop.Sim.Mansion
{
    /// <summary>
    /// Roof surface heights, as pure maths shared by the generator (which sizes the dome's drum) and the renderer (which builds the same roofs).
    /// Port of src/mansion/core/roofs.ts.
    /// </summary>
    public static class Roofs
    {
        const double Deg = Math.PI / 180;

        /// <summary>Roof planes start this far above the eave line (top of the cornice).</summary>
        public const double RoofBase = 0.06;

        /// <summary>Eaves overhang of roofs without a parapet.</summary>
        public const double EaveOverhang = 0.62;

        /// <summary>Low, as on a temple front: a steep pediment would stand between the sniper and the hall's glass roof.</summary>
        public const double PavilionPitch = 15;

        /// <summary>A roof lantern: a kerb this high on the flat roof, then a hipped glass roof of at most LanternRise.</summary>
        public const double LanternKerb = 0.55;
        public const double LanternRise = 1.7;
        public const double LanternPitchMax = 30;

        /// <summary>Pitch of the shallow upper slopes of a mansard.</summary>
        public const double MansardTopPitch = 8;

        /// <summary>
        /// A hipped roof over a deep block does not run up to a ridge: it stops at this rise and is leaded flat on top, as on real double-pile houses.
        /// It also keeps the dome's base low.
        /// </summary>
        public const double HipMaxRise = 3.0;

        /// <summary>Pitch of a lantern over a rect: 30 degrees, flatter over a wide room so it never stands too tall.</summary>
        public static double LanternPitch(Rect r)
        {
            double half = Math.Min(r.X1 - r.X0, r.Z1 - r.Z0) / 2;
            return Math.Min(LanternPitchMax, Math.Atan(LanternRise / half) / Deg);
        }

        /// <summary>Plan rectangle a mass's roof covers.</summary>
        public static Rect RoofRect(Mass m)
        {
            double e = m.Roof.Balustrade ? 0 : EaveOverhang;
            return new Rect(m.Rect.X0 - e, m.Rect.Z0 - e, m.Rect.X1 + e, m.Rect.Z1 + e);
        }

        /// <summary>Mansard break height above the roof base, and how far the steep slope leans in.</summary>
        public static (double height, double inset) MansardBreak(Mass m)
        {
            Rect r = RoofRect(m);
            double height = Math.Min(3.2, 0.3 * Math.Min(r.X1 - r.X0, r.Z1 - r.Z0));
            return (height, height / Math.Tan(70 * Deg));
        }

        /// <summary>Pitch and base lift the renderer uses for a hipped roof, and how far in the slopes run before the flat top (infinity: to the ridge).</summary>
        public static (double pitchDeg, double lift, double inset) HipParams(Mass m)
        {
            double pitchDeg = m.Roof.Balustrade ? Math.Min(m.Roof.PitchDeg, 24) : m.Roof.PitchDeg;
            double lift = m.Roof.Balustrade ? 0.2 : 0;
            Rect r = RoofRect(m);
            double t = Math.Tan(pitchDeg * Deg);
            double full = (Math.Min(r.X1 - r.X0, r.Z1 - r.Z0) / 2) * t;
            return (pitchDeg, lift, full > HipMaxRise + 0.4 ? HipMaxRise / t : double.PositiveInfinity);
        }

        /// <summary>
        /// Height of the roof surface over plan point (x, z), or -infinity where no roof covers it.
        /// <paramref name="mainMass"/> is the main block (a pavilion's roof runs back into it); found by kind when null.
        /// </summary>
        public static double RoofSurfaceY(IReadOnlyList<Mass> masses, double x, double z, Mass? mainMass = null)
        {
            Mass? main = mainMass;
            if (main == null)
            {
                for (int i = 0; i < masses.Count; i++)
                {
                    if (masses[i].Kind == MassKind.Main)
                    {
                        main = masses[i];
                        break;
                    }
                }
            }
            double best = double.NegativeInfinity;
            for (int i = 0; i < masses.Count; i++)
            {
                Mass m = masses[i];
                double yb = m.Roof.EaveY + RoofBase;
                if (m.Kind == MassKind.Pavilion)
                {
                    if (main == null)
                        continue;
                    bool garden = (m.Roof.Pediment ?? FacadeSide.Garden) == FacadeSide.Garden;
                    double x0 = m.Rect.X0 - EaveOverhang;
                    double x1 = m.Rect.X1 + EaveOverhang;
                    double zA = garden ? main.Rect.Z1 - 2.5 : m.Rect.Z0 - EaveOverhang;
                    double zB = garden ? m.Rect.Z1 + EaveOverhang : main.Rect.Z0 + 2.5;
                    if (x < x0 || x > x1 || z < zA || z > zB)
                        continue;
                    double half = (x1 - x0) / 2;
                    best = Math.Max(best, yb + (half - Math.Abs(x - (x0 + x1) / 2)) * Math.Tan(PavilionPitch * Deg));
                    continue;
                }
                Rect r = RoofRect(m);
                if (x < r.X0 || x > r.X1 || z < r.Z0 || z > r.Z1)
                    continue;
                double d = Math.Min(Math.Min(x - r.X0, r.X1 - x), Math.Min(z - r.Z0, r.Z1 - z));
                switch (m.Roof.Kind)
                {
                    case RoofKind.Flat:
                        best = Math.Max(best, yb + 0.05);
                        break;
                    case RoofKind.Glass:
                        best = Math.Max(best, yb + d * Math.Tan(32 * Deg));
                        break;
                    case RoofKind.Mansard:
                    {
                        var (height, inset) = MansardBreak(m);
                        best = Math.Max(best, d < inset ? yb + (d / inset) * height : yb + height + (d - inset) * Math.Tan(MansardTopPitch * Deg));
                        break;
                    }
                    default:
                    {
                        var (pitchDeg, lift, inset) = HipParams(m);
                        best = Math.Max(best, yb + lift + Math.Min(d, inset) * Math.Tan(pitchDeg * Deg));
                        break;
                    }
                }
            }
            return best;
        }
    }
}
