using System.Globalization;
using ScopeAndDrop.Sim.Core;

namespace ScopeAndDrop.Sim.Tests.Core;

public class NumTests
{
    [Test]
    public void TextAndRoundingMatchTheTypeScript()
    {
        var mismatches = new List<string>();
        foreach (var v in Vectors.Load("core").GetProperty("numbers").EnumerateArray())
        {
            double x = Vectors.Bits(v.GetProperty("x"));
            string text = v.GetProperty("text").GetString()!;
            if (Num.ToText(x) != text)
                mismatches.Add($"text {x:R}: {Num.ToText(x)} != {text}");
            double round = Vectors.Bits(v.GetProperty("round"));
            double mine = Num.Round(x);
            // -0 and +0 are the same number to the game; only the value is compared.
            if (!(mine == round || (double.IsNaN(mine) && double.IsNaN(round))))
                mismatches.Add($"round {x:R}: {mine:R} != {round:R}");
        }
        Assert.That(mismatches, Is.Empty);
    }

    [Test]
    public void RoundsHalvesUp()
    {
        Assert.That(Num.Round(2.5), Is.EqualTo(3));
        Assert.That(Num.Round(-2.5), Is.EqualTo(-2));
        Assert.That(Num.Round(0.49999999999999994), Is.EqualTo(0));
        Assert.That(Num.Round(1.4999999999999998), Is.EqualTo(1));
        Assert.That(Num.RoundInt(7.5), Is.EqualTo(8));
    }

    [Test]
    public void TextIgnoresTheLocale()
    {
        Assert.That(CultureInfo.CurrentCulture.Name, Is.EqualTo("de-DE"), "tests run under a comma-decimal locale");
        Assert.That(Num.ToText(0.5), Is.EqualTo("0.5"));
        Assert.That(Num.ToText(1234567.25), Is.EqualTo("1234567.25"));
        Assert.That(Num.ToText(-12), Is.EqualTo("-12"));
    }

    [Test]
    public void ThirtyTwoBitIntegers()
    {
        Assert.That(Num.Imul(0x7fffffff, 2), Is.EqualTo(-2));
        Assert.That(Num.ToInt32(4294967297.0), Is.EqualTo(1));
        Assert.That(Num.ToInt32(2147483648.0), Is.EqualTo(int.MinValue));
        Assert.That(Num.ToInt32(-1.9), Is.EqualTo(-1));
        Assert.That(Num.ToUint32(-1), Is.EqualTo(uint.MaxValue));
        Assert.That(Num.ToUint32(-4294967297.0), Is.EqualTo(uint.MaxValue));
        Assert.That(Num.ToUint32(double.NaN), Is.EqualTo(0u));
        Assert.That(Num.ToInt32(1e20), Is.EqualTo(1661992960));
    }

    [Test]
    public void SignKeepsNaN()
    {
        Assert.That(Num.Sign(-3), Is.EqualTo(-1));
        Assert.That(Num.Sign(0), Is.EqualTo(0));
        Assert.That(double.IsNaN(Num.Sign(double.NaN)));
    }
}
