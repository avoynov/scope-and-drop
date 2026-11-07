using ScopeAndDrop.Sim.Core;

namespace ScopeAndDrop.Sim.Tests.Core;

/// <summary>Every draw must match the TypeScript bit for bit: same seed, same evening.</summary>
public class RngTests
{
    static IEnumerable<TestCaseData> Seeds() => Vectors.Load("core").GetProperty("rng").EnumerateArray().Select(v => new TestCaseData(v).SetArgDisplayNames(v.GetProperty("seed").GetString()!));

    static Rng Make(System.Text.Json.JsonElement v)
    {
        var numeric = v.GetProperty("numeric");
        return numeric.ValueKind == System.Text.Json.JsonValueKind.Null ? new Rng(v.GetProperty("seed").GetString()!) : new Rng(Vectors.Bits(numeric));
    }

    [TestCaseSource(nameof(Seeds))]
    public void KeyAndRawDraws(System.Text.Json.JsonElement v)
    {
        var r = Make(v);
        Assert.That(r.Key, Is.EqualTo(v.GetProperty("key").GetString()));
        var expected = v.GetProperty("uints").EnumerateArray().Select(e => e.GetUInt32()).ToArray();
        var actual = expected.Select(_ => r.NextUint()).ToArray();
        Assert.That(actual, Is.EqualTo(expected));
    }

    [TestCaseSource(nameof(Seeds))]
    public void ForksDeriveFromTheKey(System.Text.Json.JsonElement v)
    {
        var parent = Make(v);
        for (int i = 0; i < 5; i++)
            parent.NextUint();
        var f = parent.Fork("party").Fork(3);
        Assert.That(f.Key, Is.EqualTo(v.GetProperty("forkKey").GetString()));
        var expected = v.GetProperty("forkUints").EnumerateArray().Select(e => e.GetUInt32()).ToArray();
        Assert.That(expected.Select(_ => f.NextUint()).ToArray(), Is.EqualTo(expected));
    }

    [TestCaseSource(nameof(Seeds))]
    public void DerivedDraws(System.Text.Json.JsonElement v)
    {
        var r = Make(v);
        Assert.That(Vectors.BitsArray(v.GetProperty("next")), Is.EqualTo(Enumerable.Range(0, 8).Select(_ => r.Next()).ToArray()));
        r = Make(v);
        Assert.That(Vectors.BitsArray(v.GetProperty("range")), Is.EqualTo(Enumerable.Range(0, 8).Select(_ => r.Range(-2, 5)).ToArray()));
        r = Make(v);
        Assert.That(v.GetProperty("int").EnumerateArray().Select(e => e.GetInt32()).ToArray(), Is.EqualTo(Enumerable.Range(0, 16).Select(_ => r.Int(-3, 9)).ToArray()));
        r = Make(v);
        Assert.That(v.GetProperty("chance").EnumerateArray().Select(e => e.GetBoolean()).ToArray(), Is.EqualTo(Enumerable.Range(0, 16).Select(_ => r.Chance(0.3)).ToArray()));
        r = Make(v);
        var items = Enumerable.Range(0, 10).ToArray();
        Assert.That(v.GetProperty("pick").EnumerateArray().Select(e => e.GetInt32()).ToArray(), Is.EqualTo(Enumerable.Range(0, 16).Select(_ => r.Pick(items)).ToArray()));
        r = Make(v);
        var entries = new[] { ("a", 1.0), ("b", 0.0), ("c", 2.5), ("d", -1.0), ("e", 0.25) };
        Assert.That(v.GetProperty("weighted").EnumerateArray().Select(e => e.GetString()).ToArray(), Is.EqualTo(Enumerable.Range(0, 16).Select(_ => r.Weighted(entries)).ToArray()));
        r = Make(v);
        var deck = Enumerable.Range(0, 20).ToArray();
        foreach (var expected in v.GetProperty("shuffle").EnumerateArray())
            Assert.That(r.Shuffle(deck), Is.EqualTo(expected.EnumerateArray().Select(e => e.GetInt32()).ToArray()));
        r = Make(v);
        Assert.That(Vectors.BitsArray(v.GetProperty("normal")), Is.EqualTo(Enumerable.Range(0, 16).Select(_ => r.Normal(10, 2)).ToArray()));
    }

    [Test]
    public void NumericAndTextSeedsAreEquivalent()
    {
        var a = new Rng(42);
        var b = new Rng("42");
        Assert.That(Enumerable.Range(0, 32).Select(_ => a.NextUint()), Is.EqualTo(Enumerable.Range(0, 32).Select(_ => b.NextUint())));
        Assert.That(new Rng(0.5).Key, Is.EqualTo("0.5"));
        Assert.That(new Rng("x").Fork(1.5).Key, Is.EqualTo("x/1.5"));
    }

    [Test]
    public void ForkIgnoresDrawsOnTheParent()
    {
        var a = new Rng("house");
        var b = new Rng("house");
        for (int i = 0; i < 100; i++)
            b.Next();
        Assert.That(a.Fork("rooms").NextUint(), Is.EqualTo(b.Fork("rooms").NextUint()));
    }

    [Test]
    public void EmptyInputsThrow()
    {
        var r = new Rng("x");
        Assert.That(() => r.Pick(Array.Empty<int>()), Throws.TypeOf<InvalidOperationException>());
        Assert.That(() => r.Weighted(new[] { ("a", 0.0), ("b", -1.0) }), Throws.TypeOf<InvalidOperationException>());
    }
}
