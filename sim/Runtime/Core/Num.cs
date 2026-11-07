using System;
using System.Collections.Generic;
using System.Globalization;

namespace ScopeAndDrop.Sim.Core
{
    /// <summary>
    /// The sim's number rules, in one place.
    /// <para>Rounding: <see cref="Round"/> rounds halves up (toward +infinity), the rule every threshold and table in the game was written with.
    /// Never call Math.Round in sim code: it rounds halves to even by default (2.5 gives 2).</para>
    /// <para>Text: <see cref="ToText"/> writes a number the way the game always has (shortest form that reads back exactly, "1e-7", never "1E-07"),
    /// in the invariant culture, so ids, RNG keys and saves are the same on every PC whatever its locale.</para>
    /// <para>32-bit integers: <see cref="Imul"/>, <see cref="ToInt32"/>, <see cref="ToUint32"/> keep the RNG and hashes bit-exact.</para>
    /// </summary>
    public static class Num
    {
        /// <summary>Round to the nearest integer, halves toward +infinity: 2.5 gives 3, -2.5 gives -2.</summary>
        public static double Round(double x)
        {
            if (double.IsNaN(x) || double.IsInfinity(x))
                return x;
            double f = Math.Floor(x);
            // x - floor(x) is exact for every double, so the half test is exact too.
            return x - f >= 0.5 ? f + 1 : f;
        }

        /// <summary><see cref="Round"/> as an int, for indices and counts.</summary>
        public static int RoundInt(double x) => (int)Round(x);

        /// <summary>Sign as a double: -1, 0 or 1, and NaN for NaN. Math.Sign throws on NaN.</summary>
        public static double Sign(double x) =>
            x > 0 ? 1
            : x < 0 ? -1
            : x;

        /// <summary>Length of (x, y).</summary>
        public static double Hypot(double x, double y) => Math.Sqrt(x * x + y * y);

        /// <summary>Length of (x, y, z).</summary>
        public static double Hypot(double x, double y, double z) => Math.Sqrt(x * x + y * y + z * z);

        /// <summary>Clamp v into [lo, hi]; NaN stays NaN.</summary>
        public static double Clamp(double v, double lo, double hi) =>
            v < lo ? lo
            : v > hi ? hi
            : v;

        /// <summary>Low 32 bits of a * b, as a signed int.</summary>
        public static int Imul(int a, int b) => unchecked(a * b);

        /// <summary>A number's value modulo 2^32 as a signed int (truncated toward zero first); NaN and infinities give 0.</summary>
        public static int ToInt32(double x) => unchecked((int)ToUint32(x));

        /// <summary>A number's value modulo 2^32 as an unsigned int (truncated toward zero first); NaN and infinities give 0.</summary>
        public static uint ToUint32(double x)
        {
            if (double.IsNaN(x) || double.IsInfinity(x))
                return 0;
            double t = Math.Truncate(x);
            if (t >= 0 && t < 4294967296.0)
                return (uint)t;
            if (t < 0 && t >= -2147483648.0)
                return unchecked((uint)(int)t);
            double m = t % 4294967296.0;
            if (m < 0)
                m += 4294967296.0;
            return (uint)m;
        }

        /// <summary>
        /// A number as text: the shortest digits that read back as exactly this number, with plain notation from 1e-6 up to 1e21
        /// and exponent notation ("1e-7", "1.5e+21") outside it. Integers print without a decimal point; -0 prints as "0".
        /// </summary>
        public static string ToText(double x)
        {
            if (double.IsNaN(x))
                return "NaN";
            if (x == 0)
                return "0";
            if (double.IsPositiveInfinity(x))
                return "Infinity";
            if (double.IsNegativeInfinity(x))
                return "-Infinity";
            if (x < 0)
                return "-" + ToText(-x);
            if (x < 9007199254740992.0 && x == Math.Floor(x))
                return ((long)x).ToString(CultureInfo.InvariantCulture);

            ShortestDigits(x, out string digits, out int n);
            int k = digits.Length;
            if (k <= n && n <= 21)
                return digits + new string('0', n - k);
            if (0 < n && n <= 21)
                return digits.Substring(0, n) + "." + digits.Substring(n);
            if (-6 < n && n <= 0)
                return "0." + new string('0', -n) + digits;
            int e = n - 1;
            string exp = (e < 0 ? "e-" : "e+") + Math.Abs(e).ToString(CultureInfo.InvariantCulture);
            return k == 1 ? digits + exp : digits.Substring(0, 1) + "." + digits.Substring(1) + exp;
        }

        /// <summary>
        /// Fixed-point text with the given number of decimals, as the TypeScript's toFixed: exact value, ties away from zero,
        /// a small negative that rounds to zero keeps its sign ("-0.000"), but negative zero itself prints as "0.000".
        /// </summary>
        public static string ToFixed(double x, int digits)
        {
            if (double.IsNaN(x))
                return "NaN";
            if (Math.Abs(x) >= 1e21)
                return ToText(x);
            if (x == 0)
                x = 0; // -0 to +0: JavaScript tests x < 0 for the sign, which is false for -0.
            return x.ToString("F" + digits.ToString(CultureInfo.InvariantCulture), CultureInfo.InvariantCulture);
        }

        /// <summary>The TypeScript's `x || fallback` on a number: the fallback when x is 0 or NaN.</summary>
        public static double Or(double x, double fallback) => x == 0 || double.IsNaN(x) ? fallback : x;

        /// <summary>Smallest of several numbers (NaN if any is NaN); +infinity when there are none, as Math.min() with no arguments.</summary>
        public static double Min(IEnumerable<double> values)
        {
            double m = double.PositiveInfinity;
            foreach (double v in values)
            {
                if (double.IsNaN(v))
                    return double.NaN;
                if (v < m)
                    m = v;
            }
            return m;
        }

        /// <summary>Largest of several numbers (NaN if any is NaN); -infinity when there are none, as Math.max() with no arguments.</summary>
        public static double Max(IEnumerable<double> values)
        {
            double m = double.NegativeInfinity;
            foreach (double v in values)
            {
                if (double.IsNaN(v))
                    return double.NaN;
                if (v > m)
                    m = v;
            }
            return m;
        }

        /// <summary>An integer as text, invariant culture.</summary>
        public static string ToText(int x) => x.ToString(CultureInfo.InvariantCulture);

        /// <summary>An integer as text, invariant culture.</summary>
        public static string ToText(long x) => x.ToString(CultureInfo.InvariantCulture);

        /// <summary>
        /// Shortest decimal digits d1..dk (no trailing zeros) with x = 0.d1..dk * 10^n, choosing the correctly rounded digits
        /// at the smallest k that reads back as x. x must be finite and positive.
        /// </summary>
        static void ShortestDigits(double x, out string digits, out int n)
        {
            for (int p = 1; p <= 17; p++)
            {
                string s = x.ToString("E" + (p - 1).ToString(CultureInfo.InvariantCulture), CultureInfo.InvariantCulture);
                if (p < 17 && double.Parse(s, NumberStyles.Float, CultureInfo.InvariantCulture) != x)
                    continue;
                int ePos = s.IndexOf('E');
                string mantissa = s.Substring(0, ePos).Replace(".", "");
                int exp = int.Parse(s.Substring(ePos + 1), NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture);
                digits = mantissa.TrimEnd('0');
                if (digits.Length == 0)
                    digits = "0";
                n = exp + 1;
                return;
            }
            throw new InvalidOperationException("unreachable");
        }
    }
}
