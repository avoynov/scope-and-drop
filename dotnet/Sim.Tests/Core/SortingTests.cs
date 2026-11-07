using ScopeAndDrop.Sim.Core;

namespace ScopeAndDrop.Sim.Tests.Core;

public class SortingTests
{
    sealed class Item
    {
        public int Id;
        public double K;
    }

    [Test]
    public void TiesKeepTheirOrderLikeTheTypeScript()
    {
        foreach (var v in Vectors.Load("core").GetProperty("sorts").EnumerateArray())
        {
            var keys = v.GetProperty("keys").EnumerateArray().Select(e => e.GetDouble()).ToArray();
            var items = keys.Select((k, i) => new Item { Id = i, K = k }).ToList();
            Sorting.StableSort(items, (a, b) => Sorting.Cmp(a.K - b.K));
            Assert.That(items.Select(it => it.Id), Is.EqualTo(v.GetProperty("order").EnumerateArray().Select(e => e.GetInt32())));
        }
    }

    [Test]
    public void DefaultStringOrderIsOrdinal()
    {
        var core = Vectors.Load("core");
        var strings = core.GetProperty("strings").EnumerateArray().Select(e => e.GetString()!).ToList();
        Sorting.SortOrdinal(strings);
        Assert.That(strings, Is.EqualTo(core.GetProperty("stringSort").EnumerateArray().Select(e => e.GetString())));
    }

    [Test]
    public void MatchesLinqOrderByOnLargeInputs()
    {
        var r = new Rng("sort-stress");
        foreach (int n in new[] { 0, 1, 2, 15, 16, 17, 31, 33, 100, 1000, 4097 })
        {
            var items = Enumerable.Range(0, n).Select(i => new Item { Id = i, K = r.Int(0, 20) }).ToList();
            var expected = items.OrderBy(it => it.K).Select(it => it.Id).ToList();
            var arr = items.ToArray();
            Sorting.StableSort(items, (a, b) => a.K.CompareTo(b.K));
            Sorting.StableSort(arr, (a, b) => a.K.CompareTo(b.K));
            Assert.That(items.Select(it => it.Id), Is.EqualTo(expected), $"list n={n}");
            Assert.That(arr.Select(it => it.Id), Is.EqualTo(expected), $"array n={n}");
        }
    }

    [Test]
    public void SortByTreatsNaNAsEqual()
    {
        var items = new List<double> { 3, double.NaN, 1, 2 };
        Sorting.SortBy(items, x => x);
        Assert.That(items.Count, Is.EqualTo(4));
        Assert.That(Sorting.Cmp(double.NaN), Is.EqualTo(0));
    }
}
