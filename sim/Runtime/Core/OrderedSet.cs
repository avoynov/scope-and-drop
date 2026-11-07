using System;
using System.Collections;
using System.Collections.Generic;

namespace ScopeAndDrop.Sim.Core
{
    /// <summary>
    /// A set that iterates in insertion order, the way the TypeScript's Set does. Same rules as <see cref="OrderedMap{TKey, TValue}"/>:
    /// adding an existing item keeps its place, removing and re-adding moves it to the end, and changing the set while iterating is allowed.
    /// Plain HashSet is fine for sets that are only tested, never iterated.
    /// </summary>
    public sealed class OrderedSet<T> : IReadOnlyCollection<T>
        where T : notnull
    {
        struct Slot
        {
            public T Item;
            public bool Alive;
        }

        readonly Dictionary<T, int> index;
        Slot[] slots;
        int used;
        int live;
        int iterating;

        public OrderedSet()
            : this(0) { }

        public OrderedSet(int capacity)
        {
            index = new Dictionary<T, int>(capacity);
            slots = capacity > 0 ? new Slot[capacity] : Array.Empty<Slot>();
        }

        public OrderedSet(IEnumerable<T> items)
            : this(0)
        {
            foreach (var item in items)
                Add(item);
        }

        public int Count => live;

        public bool Contains(T item) => index.ContainsKey(item);

        /// <summary>Adds the item at the end; returns false (and keeps its place) when it is already in the set.</summary>
        public bool Add(T item)
        {
            if (index.ContainsKey(item))
                return false;
            if (used == slots.Length)
                Grow();
            slots[used] = new Slot { Item = item, Alive = true };
            index[item] = used;
            used++;
            live++;
            return true;
        }

        public bool Remove(T item)
        {
            if (!index.Remove(item, out int i))
                return false;
            slots[i] = default;
            live--;
            if (iterating == 0 && used > 16 && live * 2 < used)
                Compact();
            return true;
        }

        public void Clear()
        {
            index.Clear();
            if (iterating == 0)
            {
                Array.Clear(slots, 0, used);
                used = 0;
            }
            else
            {
                for (int i = 0; i < used; i++)
                    slots[i] = default;
            }
            live = 0;
        }

        public Enumerator GetEnumerator() => new Enumerator(this);

        IEnumerator<T> IEnumerable<T>.GetEnumerator() => GetEnumerator();

        IEnumerator IEnumerable.GetEnumerator() => GetEnumerator();

        void Grow()
        {
            var next = new Slot[Math.Max(4, slots.Length * 2)];
            Array.Copy(slots, next, used);
            slots = next;
        }

        void Compact()
        {
            int w = 0;
            for (int r = 0; r < used; r++)
            {
                if (!slots[r].Alive)
                    continue;
                if (w != r)
                {
                    slots[w] = slots[r];
                    index[slots[w].Item] = w;
                }
                w++;
            }
            Array.Clear(slots, w, used - w);
            used = w;
        }

        public struct Enumerator : IEnumerator<T>
        {
            readonly OrderedSet<T> set;
            int pos;
            bool done;

            internal Enumerator(OrderedSet<T> set)
            {
                this.set = set;
                pos = -1;
                done = false;
                set.iterating++;
            }

            public T Current => set.slots[pos].Item;

            object IEnumerator.Current => Current;

            public bool MoveNext()
            {
                while (++pos < set.used)
                {
                    if (set.slots[pos].Alive)
                        return true;
                }
                pos = set.used;
                return false;
            }

            public void Reset() => pos = -1;

            public void Dispose()
            {
                if (done)
                    return;
                done = true;
                set.iterating--;
            }
        }
    }
}
