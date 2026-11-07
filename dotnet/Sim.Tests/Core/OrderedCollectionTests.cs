using ScopeAndDrop.Sim.Core;

namespace ScopeAndDrop.Sim.Tests.Core;

/// <summary>The ordered map and set behave like the TypeScript's Map and Set, including changes made while iterating.</summary>
public class OrderedCollectionTests
{
    [Test]
    public void MapKeepsInsertionOrder()
    {
        var m = new OrderedMap<string, int>();
        m["c"] = 1;
        m["a"] = 2;
        m["b"] = 3;
        m["a"] = 20;
        Assert.That(m.Keys, Is.EqualTo(new[] { "c", "a", "b" }), "setting an existing key keeps its place");
        Assert.That(m.Values, Is.EqualTo(new[] { 1, 20, 3 }));
        Assert.That(m.Remove("c"), Is.True);
        Assert.That(m.Remove("c"), Is.False);
        m["c"] = 5;
        Assert.That(m.Keys, Is.EqualTo(new[] { "a", "b", "c" }), "removed then re-added moves to the end");
        Assert.That(m.Count, Is.EqualTo(3));
        Assert.That(m.GetValueOrDefault("zz", -1), Is.EqualTo(-1));
        Assert.That(m.TryGetValue("b", out int b) && b == 3);
        Assert.That(() => _ = m["zz"], Throws.TypeOf<KeyNotFoundException>());
    }

    [Test]
    public void MapChangesDuringIterationFollowTheTypeScript()
    {
        var m = new OrderedMap<int, string>();
        for (int i = 0; i < 5; i++)
            m[i] = "v" + i;
        var seen = new List<int>();
        foreach (var kv in m)
        {
            seen.Add(kv.Key);
            if (kv.Key == 1)
            {
                m.Remove(3); // not yet reached: skipped
                m.Remove(0); // already visited
                m[10] = "new"; // added mid-loop: visited
            }
        }
        Assert.That(seen, Is.EqualTo(new[] { 0, 1, 2, 4, 10 }));
        Assert.That(m.Keys, Is.EqualTo(new[] { 1, 2, 4, 10 }));
    }

    [Test]
    public void MapClearDuringIterationEndsTheOldEntries()
    {
        var m = new OrderedMap<int, int>();
        for (int i = 0; i < 4; i++)
            m[i] = i;
        var seen = new List<int>();
        foreach (var kv in m)
        {
            seen.Add(kv.Key);
            if (kv.Key == 1)
            {
                m.Clear();
                m[9] = 9;
            }
        }
        Assert.That(seen, Is.EqualTo(new[] { 0, 1, 9 }));
        Assert.That(m.Keys, Is.EqualTo(new[] { 9 }));
    }

    [Test]
    public void MapCompactsAfterManyRemovalsAndKeepsOrder()
    {
        var m = new OrderedMap<int, int>();
        var expected = new List<int>();
        var r = new Rng("map-churn");
        for (int step = 0; step < 5000; step++)
        {
            int k = r.Int(0, 200);
            if (r.Chance(0.45) && m.Remove(k))
                expected.Remove(k);
            else if (!m.ContainsKey(k))
            {
                m[k] = step;
                expected.Add(k);
            }
            else
                m[k] = step;
        }
        Assert.That(m.Keys, Is.EqualTo(expected));
        Assert.That(m.Count, Is.EqualTo(expected.Count));
    }

    [Test]
    public void SetKeepsInsertionOrder()
    {
        var s = new OrderedSet<string> { };
        Assert.That(s.Add("b"), Is.True);
        Assert.That(s.Add("a"), Is.True);
        Assert.That(s.Add("b"), Is.False);
        s.Add("c");
        s.Remove("a");
        s.Add("a");
        Assert.That(s, Is.EqualTo(new[] { "b", "c", "a" }));
        Assert.That(s.Contains("c"));
        var seen = new List<string>();
        foreach (var x in s)
        {
            seen.Add(x);
            if (x == "b")
            {
                s.Remove("c");
                s.Add("d");
            }
        }
        Assert.That(seen, Is.EqualTo(new[] { "b", "a", "d" }));
    }

    [Test]
    public void IterationAndLookupAllocateNothing()
    {
        var m = new OrderedMap<int, double>(64);
        var s = new OrderedSet<int>(64);
        for (int i = 0; i < 64; i++)
        {
            m[i] = i;
            s.Add(i);
        }
        double sum = 0;
        void Work()
        {
            foreach (var kv in m)
                sum += kv.Value;
            foreach (var v in m.Values)
                sum += v;
            foreach (var k in m.Keys)
                sum += k;
            foreach (var x in s)
                sum += x;
            for (int i = 0; i < 64; i++)
            {
                m[i] = m[i] + 1;
                if (s.Contains(i) && m.TryGetValue(i, out double d))
                    sum += d;
            }
        }
        Work();
        long before = GC.GetAllocatedBytesForCurrentThread();
        for (int rep = 0; rep < 100; rep++)
            Work();
        Assert.That(GC.GetAllocatedBytesForCurrentThread() - before, Is.EqualTo(0));
        Assert.That(sum, Is.GreaterThan(0));
    }
}
