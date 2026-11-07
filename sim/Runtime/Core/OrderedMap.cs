using System;
using System.Collections;
using System.Collections.Generic;

namespace ScopeAndDrop.Sim.Core
{
    /// <summary>
    /// A dictionary that iterates in insertion order, the way the TypeScript's Map does. Use it wherever the game's logic depends on the order
    /// of a map (first candidate wins, ties keep their order). Plain Dictionary is fine for maps that are only looked up, never iterated.
    /// <list type="bullet">
    /// <item>Setting an existing key keeps its place; removing a key and adding it again moves it to the end.</item>
    /// <item>Changing the map while iterating it is allowed: entries added during the loop are visited, entries removed before they are reached are skipped.</item>
    /// <item>Keys compare with the default equality comparer, so class keys compare by reference, as in the TypeScript.</item>
    /// </list>
    /// No allocations per lookup, set or iteration once the map has grown to size.
    /// </summary>
    public sealed class OrderedMap<TKey, TValue> : IReadOnlyDictionary<TKey, TValue>
        where TKey : notnull
    {
        struct Slot
        {
            public TKey Key;
            public TValue Value;
            public bool Alive;
        }

        readonly Dictionary<TKey, int> index;
        Slot[] slots;
        int used;
        int live;
        int iterating;

        public OrderedMap()
            : this(0) { }

        public OrderedMap(int capacity)
        {
            index = new Dictionary<TKey, int>(capacity);
            slots = capacity > 0 ? new Slot[capacity] : Array.Empty<Slot>();
        }

        public OrderedMap(IEnumerable<KeyValuePair<TKey, TValue>> entries)
            : this(0)
        {
            foreach (var e in entries)
                this[e.Key] = e.Value;
        }

        public int Count => live;

        public TValue this[TKey key]
        {
            get
            {
                if (!index.TryGetValue(key, out int i))
                    throw new KeyNotFoundException("OrderedMap has no key " + key);
                return slots[i].Value;
            }
            set
            {
                if (index.TryGetValue(key, out int i))
                {
                    slots[i].Value = value;
                    return;
                }
                if (used == slots.Length)
                    Grow();
                slots[used] = new Slot
                {
                    Key = key,
                    Value = value,
                    Alive = true,
                };
                index[key] = used;
                used++;
                live++;
            }
        }

        /// <summary>Same as the setter; reads like the TypeScript's map.set(key, value).</summary>
        public void Set(TKey key, TValue value) => this[key] = value;

        public bool ContainsKey(TKey key) => index.ContainsKey(key);

        public bool TryGetValue(TKey key, out TValue value)
        {
            if (index.TryGetValue(key, out int i))
            {
                value = slots[i].Value;
                return true;
            }
            value = default!;
            return false;
        }

        /// <summary>The value, or the given fallback when the key is missing (the TypeScript's map.get(key) ?? fallback).</summary>
        public TValue GetValueOrDefault(TKey key, TValue fallback = default!) => index.TryGetValue(key, out int i) ? slots[i].Value : fallback;

        public bool Remove(TKey key)
        {
            if (!index.Remove(key, out int i))
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

        public KeyCollection Keys => new KeyCollection(this);

        public ValueCollection Values => new ValueCollection(this);

        IEnumerable<TKey> IReadOnlyDictionary<TKey, TValue>.Keys => Keys;

        IEnumerable<TValue> IReadOnlyDictionary<TKey, TValue>.Values => Values;

        public Enumerator GetEnumerator() => new Enumerator(this);

        IEnumerator<KeyValuePair<TKey, TValue>> IEnumerable<KeyValuePair<TKey, TValue>>.GetEnumerator() => GetEnumerator();

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
                    index[slots[w].Key] = w;
                }
                w++;
            }
            Array.Clear(slots, w, used - w);
            used = w;
        }

        /// <summary>Walks live slots in order, re-reading the end each step so entries added mid-loop are visited.</summary>
        public struct Enumerator : IEnumerator<KeyValuePair<TKey, TValue>>
        {
            readonly OrderedMap<TKey, TValue> map;
            int pos;
            bool done;

            internal Enumerator(OrderedMap<TKey, TValue> map)
            {
                this.map = map;
                pos = -1;
                done = false;
                map.iterating++;
            }

            public KeyValuePair<TKey, TValue> Current => new KeyValuePair<TKey, TValue>(map.slots[pos].Key, map.slots[pos].Value);

            object IEnumerator.Current => Current;

            public bool MoveNext()
            {
                while (++pos < map.used)
                {
                    if (map.slots[pos].Alive)
                        return true;
                }
                pos = map.used;
                return false;
            }

            public void Reset() => pos = -1;

            public void Dispose()
            {
                if (done)
                    return;
                done = true;
                map.iterating--;
            }
        }

        public readonly struct KeyCollection : IEnumerable<TKey>
        {
            readonly OrderedMap<TKey, TValue> map;

            internal KeyCollection(OrderedMap<TKey, TValue> map) => this.map = map;

            public KeyEnumerator GetEnumerator() => new KeyEnumerator(map);

            IEnumerator<TKey> IEnumerable<TKey>.GetEnumerator() => GetEnumerator();

            IEnumerator IEnumerable.GetEnumerator() => GetEnumerator();
        }

        public struct KeyEnumerator : IEnumerator<TKey>
        {
            Enumerator inner;

            internal KeyEnumerator(OrderedMap<TKey, TValue> map) => inner = new Enumerator(map);

            public TKey Current => inner.Current.Key;

            object IEnumerator.Current => Current;

            public bool MoveNext() => inner.MoveNext();

            public void Reset() => inner.Reset();

            public void Dispose() => inner.Dispose();
        }

        public readonly struct ValueCollection : IEnumerable<TValue>
        {
            readonly OrderedMap<TKey, TValue> map;

            internal ValueCollection(OrderedMap<TKey, TValue> map) => this.map = map;

            public ValueEnumerator GetEnumerator() => new ValueEnumerator(map);

            IEnumerator<TValue> IEnumerable<TValue>.GetEnumerator() => GetEnumerator();

            IEnumerator IEnumerable.GetEnumerator() => GetEnumerator();
        }

        public struct ValueEnumerator : IEnumerator<TValue>
        {
            Enumerator inner;

            internal ValueEnumerator(OrderedMap<TKey, TValue> map) => inner = new Enumerator(map);

            public TValue Current => inner.Current.Value;

            object? IEnumerator.Current => Current;

            public bool MoveNext() => inner.MoveNext();

            public void Reset() => inner.Reset();

            public void Dispose() => inner.Dispose();
        }
    }
}
