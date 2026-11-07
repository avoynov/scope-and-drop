using System;
using System.Buffers;
using System.Collections.Generic;
using System.Runtime.CompilerServices;

namespace ScopeAndDrop.Sim.Core
{
    /// <summary>
    /// Stable sorting. The TypeScript's sort keeps ties in their original order and some game logic relies on it (first candidate wins);
    /// List.Sort and Array.Sort do not. Use these everywhere the sim sorts. Strings compare ordinally (by UTF-16 code unit), never by culture.
    /// <para>Comparators must be pure: the number and order of comparisons differ from the TypeScript, so a comparator that draws from an RNG
    /// would change the draws.</para>
    /// </summary>
    public static class Sorting
    {
        const int InsertionRun = 16;

        /// <summary>A TypeScript-style comparator result (any number, NaN meaning equal) as -1, 0 or 1.</summary>
        public static int Cmp(double d) =>
            d < 0 ? -1
            : d > 0 ? 1
            : 0;

        /// <summary>Ascending by a number key, ties in order (the TypeScript's sort((a, b) => key(a) - key(b))).</summary>
        public static void SortBy<T>(List<T> list, Func<T, double> key) => StableSort(list, (x, y) => Cmp(key(x) - key(y)));

        /// <summary>Ordinal string order, the TypeScript's default sort() on strings.</summary>
        public static void SortOrdinal(List<string> list) => StableSort(list, string.CompareOrdinal);

        public static void StableSort<T>(List<T> list, Comparison<T> cmp)
        {
            int n = list.Count;
            if (n < 2)
                return;
            T[] data = ArrayPool<T>.Shared.Rent(n);
            try
            {
                list.CopyTo(data);
                StableSort(data.AsSpan(0, n), cmp);
                for (int i = 0; i < n; i++)
                    list[i] = data[i];
            }
            finally
            {
                ArrayPool<T>.Shared.Return(data, RuntimeHelpers.IsReferenceOrContainsReferences<T>());
            }
        }

        public static void StableSort<T>(T[] array, Comparison<T> cmp) => StableSort(array.AsSpan(), cmp);

        /// <summary>Bottom-up merge sort over insertion-sorted runs; stable, O(n log n), one pooled buffer.</summary>
        public static void StableSort<T>(Span<T> items, Comparison<T> cmp)
        {
            int n = items.Length;
            if (n < 2)
                return;
            for (int lo = 0; lo < n; lo += InsertionRun)
                InsertionSort(items.Slice(lo, Math.Min(InsertionRun, n - lo)), cmp);
            if (n <= InsertionRun)
                return;

            T[] rented = ArrayPool<T>.Shared.Rent(n);
            try
            {
                Span<T> buffer = rented.AsSpan(0, n);
                Span<T> src = items;
                Span<T> dst = buffer;
                bool inItems = true;
                for (int width = InsertionRun; width < n; width *= 2)
                {
                    for (int lo = 0; lo < n; lo += 2 * width)
                    {
                        int mid = Math.Min(lo + width, n);
                        int hi = Math.Min(lo + 2 * width, n);
                        Merge(src, dst, lo, mid, hi, cmp);
                    }
                    var swap = src;
                    src = dst;
                    dst = swap;
                    inItems = !inItems;
                }
                if (!inItems)
                    src.CopyTo(items);
            }
            finally
            {
                ArrayPool<T>.Shared.Return(rented, RuntimeHelpers.IsReferenceOrContainsReferences<T>());
            }
        }

        static void InsertionSort<T>(Span<T> items, Comparison<T> cmp)
        {
            for (int i = 1; i < items.Length; i++)
            {
                T x = items[i];
                int j = i - 1;
                while (j >= 0 && cmp(items[j], x) > 0)
                {
                    items[j + 1] = items[j];
                    j--;
                }
                items[j + 1] = x;
            }
        }

        static void Merge<T>(Span<T> src, Span<T> dst, int lo, int mid, int hi, Comparison<T> cmp)
        {
            int i = lo;
            int j = mid;
            int k = lo;
            while (i < mid && j < hi)
                dst[k++] = cmp(src[j], src[i]) < 0 ? src[j++] : src[i++];
            while (i < mid)
                dst[k++] = src[i++];
            while (j < hi)
                dst[k++] = src[j++];
        }
    }
}
