using System;
using System.Collections.Generic;

namespace ScopeAndDrop.Sim.Core
{
    /// <summary>
    /// Deterministic, forkable PRNG (sfc32 seeded through cyrb128). Port of src/mansion/core/rng.ts; a seed gives the same draws as the TypeScript.
    /// <para><see cref="Fork(string)"/> derives a child stream from the parent's key, not its current state, so adding or removing draws in one
    /// stage never reshuffles another stage. Never use System.Random in the sim.</para>
    /// </summary>
    public sealed class Rng
    {
        public string Key { get; }

        uint a;
        uint b;
        uint c;
        uint d;

        public Rng(string seed)
        {
            Key = seed;
            Cyrb128(seed, out a, out b, out c, out d);
            // Warm up so near-identical keys diverge immediately.
            for (int i = 0; i < 12; i++)
                NextUint();
        }

        /// <summary>A numeric seed is the same as its text: new Rng(42) equals new Rng("42").</summary>
        public Rng(double seed)
            : this(Num.ToText(seed)) { }

        /// <summary>Independent child stream, stable regardless of draws made on this one.</summary>
        public Rng Fork(string label) => new Rng(Key + "/" + label);

        /// <summary>Independent child stream; a numeric label is the same as its text.</summary>
        public Rng Fork(double label) => Fork(Num.ToText(label));

        public uint NextUint()
        {
            unchecked
            {
                uint t = a + b;
                a = b ^ (b >> 9);
                b = c + (c << 3);
                c = (c << 21) | (c >> 11);
                d = d + 1;
                t = t + d;
                c = c + t;
                return t;
            }
        }

        /// <summary>Uniform double in [0, 1).</summary>
        public double Next() => NextUint() / 4294967296.0;

        /// <summary>Uniform double in [min, max).</summary>
        public double Range(double min, double max) => min + (max - min) * Next();

        /// <summary>Uniform integer in [min, max] (inclusive).</summary>
        public int Int(int min, int max) => min + (int)Math.Floor(Next() * ((double)max - min + 1));

        public bool Chance(double p) => Next() < p;

        public T Pick<T>(IReadOnlyList<T> items)
        {
            if (items.Count == 0)
                throw new InvalidOperationException("Rng.Pick on empty list");
            return items[(int)Math.Floor(Next() * items.Count)];
        }

        /// <summary>Weighted pick from (item, weight) pairs. Zero and negative weights are never picked.</summary>
        public T Weighted<T>(IReadOnlyList<(T item, double weight)> entries)
        {
            double total = 0;
            for (int i = 0; i < entries.Count; i++)
                total += Math.Max(0, entries[i].weight);
            if (total <= 0)
                throw new InvalidOperationException("Rng.Weighted with no positive weights");
            double r = Next() * total;
            for (int i = 0; i < entries.Count; i++)
            {
                double w = entries[i].weight;
                if (w <= 0)
                    continue;
                r -= w;
                if (r < 0)
                    return entries[i].item;
            }
            return entries[entries.Count - 1].item;
        }

        /// <summary>A shuffled copy (Fisher-Yates from the end).</summary>
        public List<T> Shuffle<T>(IReadOnlyList<T> items)
        {
            var output = new List<T>(items);
            for (int i = output.Count - 1; i > 0; i--)
            {
                int j = (int)Math.Floor(Next() * (i + 1));
                (output[i], output[j]) = (output[j], output[i]);
            }
            return output;
        }

        /// <summary>Approximately normal (Irwin-Hall, 4 samples), clamped to +-3 sd.</summary>
        public double Normal(double mean, double sd)
        {
            double s = Next() + Next() + Next() + Next() - 2;
            return mean + Math.Max(-3, Math.Min(3, s * 1.7320508)) * sd;
        }

        static void Cyrb128(string str, out uint r1, out uint r2, out uint r3, out uint r4)
        {
            unchecked
            {
                uint h1 = 1779033703;
                uint h2 = 3144134277;
                uint h3 = 1013904242;
                uint h4 = 2773480762;
                for (int i = 0; i < str.Length; i++)
                {
                    uint k = str[i];
                    h1 = h2 ^ ((h1 ^ k) * 597399067u);
                    h2 = h3 ^ ((h2 ^ k) * 2869860233u);
                    h3 = h4 ^ ((h3 ^ k) * 951274213u);
                    h4 = h1 ^ ((h4 ^ k) * 2716044179u);
                }
                h1 = (h3 ^ (h1 >> 18)) * 597399067u;
                h2 = (h4 ^ (h2 >> 22)) * 2869860233u;
                h3 = (h1 ^ (h3 >> 17)) * 951274213u;
                h4 = (h2 ^ (h4 >> 19)) * 2716044179u;
                h1 ^= h2 ^ h3 ^ h4;
                h2 ^= h1;
                h3 ^= h1;
                h4 ^= h1;
                r1 = h1;
                r2 = h2;
                r3 = h3;
                r4 = h4;
            }
        }
    }
}
