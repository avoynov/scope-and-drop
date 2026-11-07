using ScopeAndDrop.Sim.Core;

namespace ScopeAndDrop.Sim.Tests.Core;

public class GeomTests
{
    static Rect Box(System.Text.Json.JsonElement e)
    {
        var b = Vectors.BitsArray(e);
        return new Rect(b[0], b[1], b[2], b[3]);
    }

    [Test]
    public void SnapAndMillimetresMatchTheTypeScript()
    {
        var core = Vectors.Load("core");
        foreach (var v in core.GetProperty("snaps").EnumerateArray())
            Assert.That(Geom.Snap(Vectors.Bits(v.GetProperty("v")), Vectors.Bits(v.GetProperty("step"))), Is.EqualTo(Vectors.Bits(v.GetProperty("out"))));
        foreach (var v in core.GetProperty("r3s").EnumerateArray())
            Assert.That(Geom.R3(Vectors.Bits(v.GetProperty("x"))), Is.EqualTo(Vectors.Bits(v.GetProperty("out"))));
        Assert.That(Geom.Snap(3.6500000000000004), Is.EqualTo(3.65));
    }

    [Test]
    public void RectangleMathsMatchesTheTypeScript()
    {
        foreach (var v in Vectors.Load("core").GetProperty("rects").EnumerateArray())
        {
            Rect a = Box(v.GetProperty("a"));
            Rect b = Box(v.GetProperty("b"));
            var holes = v.GetProperty("holes").EnumerateArray().Select(Box).ToList();
            Assert.That(Geom.RectMinus(a, holes), Is.EqualTo(v.GetProperty("minus").EnumerateArray().Select(Box).ToList()));

            var i = v.GetProperty("intersect");
            Assert.That(Geom.Intersect(a, b), Is.EqualTo(i.ValueKind == System.Text.Json.JsonValueKind.Null ? null : Box(i)));

            var o = v.GetProperty("overlap1");
            var mine = Geom.Overlap1(a.X0, a.X1, b.X0, b.X1);
            if (o.ValueKind == System.Text.Json.JsonValueKind.Null)
                Assert.That(mine, Is.Null);
            else
                Assert.That(mine, Is.EqualTo((Vectors.Bits(o[0]), Vectors.Bits(o[1]))));
        }
    }

    [Test]
    public void FootprintsMatchTheTypeScript()
    {
        foreach (var v in Vectors.Load("core").GetProperty("footprints").EnumerateArray())
        {
            double B(string k) => Vectors.Bits(v.GetProperty(k));
            Assert.That(Geom.Footprint(B("cx"), B("cz"), B("w"), B("d"), B("yaw")), Is.EqualTo(Box(v.GetProperty("out"))));
        }
    }

    [Test]
    public void RectOfOrdersCorners()
    {
        Assert.That(Rect.Of(3, 4, 1, 2), Is.EqualTo(new Rect(1, 2, 3, 4)));
        Assert.That(Geom.Area(Rect.Of(0, 0, 2, 3)), Is.EqualTo(6));
        Assert.That(Geom.Center(new Rect(0, 0, 2, 4)), Is.EqualTo(new Vec2(1, 2)));
    }

    [Test]
    public void RotateYTurnsCounterClockwiseSeenFromAbove()
    {
        var p = Geom.RotateY(1, 0, Math.PI / 2);
        Assert.That(p.X, Is.EqualTo(0).Within(1e-12));
        Assert.That(p.Z, Is.EqualTo(-1).Within(1e-12));
    }

    [Test]
    public void ContainmentAndOverlapUseTolerances()
    {
        var a = new Rect(0, 0, 1, 1);
        Assert.That(Geom.Overlaps(a, new Rect(1, 0, 2, 1)), Is.False, "touching is not overlapping");
        Assert.That(Geom.Overlaps(a, new Rect(0.5, 0.5, 2, 2)), Is.True);
        Assert.That(Geom.ContainsRect(a, new Rect(0, 0, 1 + 1e-7, 1)), Is.True);
        Assert.That(Geom.ContainsPoint(a, 1.05, 0.5, 0.1), Is.True);
    }
}
