using System;
using System.Collections.Generic;

namespace ScopeAndDrop.Sim.Core
{
    /// <summary>A plan point or offset in metres: (x, z), y is up.</summary>
    public struct Vec2 : IEquatable<Vec2>
    {
        public double X;
        public double Z;

        public Vec2(double x, double z)
        {
            X = x;
            Z = z;
        }

        public bool Equals(Vec2 o) => X == o.X && Z == o.Z;

        public override bool Equals(object? obj) => obj is Vec2 o && Equals(o);

        public override int GetHashCode() => HashCode.Combine(X, Z);

        public override string ToString() => "(" + Num.ToText(X) + ", " + Num.ToText(Z) + ")";
    }

    /// <summary>A point in metres, y up. Double precision: the sim never uses Unity's float vectors.</summary>
    public struct Vec3 : IEquatable<Vec3>
    {
        public double X;
        public double Y;
        public double Z;

        public Vec3(double x, double y, double z)
        {
            X = x;
            Y = y;
            Z = z;
        }

        public bool Equals(Vec3 o) => X == o.X && Y == o.Y && Z == o.Z;

        public override bool Equals(object? obj) => obj is Vec3 o && Equals(o);

        public override int GetHashCode() => HashCode.Combine(X, Y, Z);

        public override string ToString() => "(" + Num.ToText(X) + ", " + Num.ToText(Y) + ", " + Num.ToText(Z) + ")";
    }

    /// <summary>Axis-aligned rectangle in plan, X0 &lt; X1, Z0 &lt; Z1. A value: copying it copies the numbers.</summary>
    public struct Rect : IEquatable<Rect>
    {
        public double X0;
        public double Z0;
        public double X1;
        public double Z1;

        /// <summary>The rectangle exactly as given (no reordering).</summary>
        public Rect(double x0, double z0, double x1, double z1)
        {
            X0 = x0;
            Z0 = z0;
            X1 = x1;
            Z1 = z1;
        }

        /// <summary>The rectangle spanned by two corners, in either order (the TypeScript's rect()).</summary>
        public static Rect Of(double x0, double z0, double x1, double z1) => new Rect(Math.Min(x0, x1), Math.Min(z0, z1), Math.Max(x0, x1), Math.Max(z0, z1));

        public bool Equals(Rect o) => X0 == o.X0 && Z0 == o.Z0 && X1 == o.X1 && Z1 == o.Z1;

        public override bool Equals(object? obj) => obj is Rect o && Equals(o);

        public override int GetHashCode() => HashCode.Combine(X0, Z0, X1, Z1);

        public override string ToString() => "[" + Num.ToText(X0) + ", " + Num.ToText(Z0) + " .. " + Num.ToText(X1) + ", " + Num.ToText(Z1) + "]";
    }

    /// <summary>Small 2D/3D helpers. Port of src/mansion/core/geom.ts (and snap from rng.ts); same names, same results.</summary>
    public static class Geom
    {
        public const double Eps = 1e-6;

        public static double Rw(Rect r) => r.X1 - r.X0;

        public static double Rd(Rect r) => r.Z1 - r.Z0;

        public static double Area(Rect r) => Rw(r) * Rd(r);

        public static Vec2 Center(Rect r) => new Vec2((r.X0 + r.X1) / 2, (r.Z0 + r.Z1) / 2);

        public static Rect Inset(Rect r, double d) => new Rect(r.X0 + d, r.Z0 + d, r.X1 - d, r.Z1 - d);

        public static Rect Expand(Rect r, double dx) => Expand(r, dx, dx);

        public static Rect Expand(Rect r, double dx, double dz) => new Rect(r.X0 - dx, r.Z0 - dz, r.X1 + dx, r.Z1 + dz);

        public static bool Overlaps(Rect a, Rect b, double tol = Eps) => a.X0 < b.X1 - tol && b.X0 < a.X1 - tol && a.Z0 < b.Z1 - tol && b.Z0 < a.Z1 - tol;

        public static bool ContainsPoint(Rect r, double x, double z, double tol = 0) => x >= r.X0 - tol && x <= r.X1 + tol && z >= r.Z0 - tol && z <= r.Z1 + tol;

        public static bool ContainsRect(Rect outer, Rect inner, double tol = Eps) =>
            inner.X0 >= outer.X0 - tol && inner.X1 <= outer.X1 + tol && inner.Z0 >= outer.Z0 - tol && inner.Z1 <= outer.Z1 + tol;

        /// <summary>A rectangle with other rectangles cut out of it, as a list of rectangles (slivers under 2 cm dropped).</summary>
        public static List<Rect> RectMinus(Rect r, IReadOnlyList<Rect> holes)
        {
            var pieces = new List<Rect> { r };
            for (int hi = 0; hi < holes.Count; hi++)
            {
                Rect h = holes[hi];
                var next = new List<Rect>();
                foreach (var p in pieces)
                {
                    if (h.X0 >= p.X1 - Eps || h.X1 <= p.X0 + Eps || h.Z0 >= p.Z1 - Eps || h.Z1 <= p.Z0 + Eps)
                    {
                        next.Add(p);
                        continue;
                    }
                    double cx0 = Math.Max(p.X0, h.X0);
                    double cx1 = Math.Min(p.X1, h.X1);
                    AddPiece(next, new Rect(p.X0, p.Z0, cx0, p.Z1));
                    AddPiece(next, new Rect(cx1, p.Z0, p.X1, p.Z1));
                    AddPiece(next, new Rect(cx0, p.Z0, cx1, Math.Max(p.Z0, h.Z0)));
                    AddPiece(next, new Rect(cx0, Math.Min(p.Z1, h.Z1), cx1, p.Z1));
                }
                pieces = next;
            }
            return pieces;
        }

        static void AddPiece(List<Rect> into, Rect q)
        {
            if (q.X1 - q.X0 > 0.02 && q.Z1 - q.Z0 > 0.02)
                into.Add(q);
        }

        /// <summary>The overlap of two rectangles, or null when they only touch or are apart.</summary>
        public static Rect? Intersect(Rect a, Rect b)
        {
            var r = new Rect(Math.Max(a.X0, b.X0), Math.Max(a.Z0, b.Z0), Math.Min(a.X1, b.X1), Math.Min(a.Z1, b.Z1));
            return r.X1 > r.X0 + Eps && r.Z1 > r.Z0 + Eps ? r : (Rect?)null;
        }

        /// <summary>Overlap of 1D intervals [a0, a1] and [b0, b1]; null when they only touch.</summary>
        public static (double lo, double hi)? Overlap1(double a0, double a1, double b0, double b1, double tol = Eps)
        {
            double lo = Math.Max(Math.Min(a0, a1), Math.Min(b0, b1));
            double hi = Math.Min(Math.Max(a0, a1), Math.Max(b0, b1));
            return hi > lo + tol ? (lo, hi) : ((double, double)?)null;
        }

        public static bool Near(double a, double b, double tol = 1e-4) => Math.Abs(a - b) <= tol;

        public static double Clamp(double v, double lo, double hi) => Num.Clamp(v, lo, hi);

        public static double Lerp(double a, double b, double t) => a + (b - a) * t;

        /// <summary>Round to millimetres, for compact, stable output.</summary>
        public static double R3(double v) => Num.Round(v * 1000) / 1000;

        /// <summary>Quantise to a grid step so plans stay on tidy dimensions. Divides by an integer (1/step) so results print cleanly.</summary>
        public static double Snap(double v, double step = 0.05)
        {
            double k = Num.Round(1 / step);
            return Num.Round(v * k) / k;
        }

        /// <summary>Rotate a plan offset by a yaw angle (radians, the renderer's rotation about y).</summary>
        public static Vec2 RotateY(double x, double z, double yaw)
        {
            double c = Math.Cos(yaw);
            double s = Math.Sin(yaw);
            return new Vec2(x * c + z * s, -x * s + z * c);
        }

        /// <summary>Footprint of a box of width w (local x) and depth d (local z) rotated by a multiple of 90 degrees.</summary>
        public static Rect Footprint(double cx, double cz, double w, double d, double yaw)
        {
            int q = Num.ToInt32(Num.Round(yaw / (Math.PI / 2))) & 1;
            double hw = (q != 0 ? d : w) / 2;
            double hd = (q != 0 ? w : d) / 2;
            return new Rect(cx - hw, cz - hd, cx + hw, cz + hd);
        }
    }
}
