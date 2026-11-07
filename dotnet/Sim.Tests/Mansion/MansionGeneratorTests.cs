using ScopeAndDrop.Sim.Core;
using ScopeAndDrop.Sim.Mansion;

namespace ScopeAndDrop.Sim.Tests.Mansion;

/// <summary>
/// The generator's own rules, from tests/generator.test.ts, so they keep holding when the C# is tuned away from the TypeScript.
/// Fewer seeds than the TypeScript runs: the parity tests already tie these houses to it.
/// </summary>
public class MansionGeneratorTests
{
    static readonly Dictionary<string, MansionBlueprint> Built = new();

    static MansionBlueprint Gen(MansionOptions o)
    {
        string key = Canonical.Text(o)!;
        lock (Built)
        {
            if (!Built.TryGetValue(key, out MansionBlueprint? bp))
                Built[key] = bp = MansionGenerator.Generate(o);
            return bp;
        }
    }

    static string Whole(MansionBlueprint bp) => string.Join("\n", Canonical.Parts(bp).Select(p => p.key + "=" + p.text));

    static string Errors(MansionBlueprint bp) => string.Join("; ", bp.Validation.Issues.Where(i => i.Severity == Severity.Error).Select(i => i.Message));

    [Test]
    public void SameSeedGivesTheSameBlueprint()
    {
        string a = Whole(MansionGenerator.Generate(new MansionOptions("determinism")));
        string b = Whole(MansionGenerator.Generate(new MansionOptions("determinism")));
        Assert.That(a, Is.EqualTo(b));
        Assert.That(Whole(Gen(new MansionOptions("one"))), Is.Not.EqualTo(Whole(Gen(new MansionOptions("two")))));
    }

    public static IEnumerable<object[]> Combinations()
    {
        foreach (StyleId s in Styles.Ids)
        {
            foreach (MassingType m in new[] { MassingType.Block, MassingType.UGarden, MassingType.UEntrance, MassingType.H })
            {
                foreach (MansionSize z in new[] { MansionSize.Compact, MansionSize.Grand, MansionSize.Palatial })
                    yield return new object[] { s, m, z };
            }
        }
    }

    [TestCaseSource(nameof(Combinations))]
    public void EveryStyleMassingAndSizeIsValid(StyleId style, MassingType massing, MansionSize size)
    {
        MansionBlueprint bp = Gen(
            new MansionOptions("t-" + style.Text() + "-" + massing.Text() + "-" + size.Text() + "-0")
            {
                Style = style,
                Massing = massing,
                Size = size,
            }
        );
        Assert.That(Errors(bp), Is.Empty);
        Assert.That(bp.Style.Id, Is.EqualTo(style));
    }

    [Test]
    public void RandomSeedsAreValidMostlyFirstTime()
    {
        int attempts = 0;
        const int n = 20;
        for (int i = 0; i < n; i++)
        {
            MansionBlueprint bp = Gen(new MansionOptions("random-" + i));
            Assert.That(bp.Validation.Ok, Is.True, bp.Seed + ": " + Errors(bp));
            attempts += bp.Attempt + 1;
        }
        Assert.That(attempts / (double)n, Is.LessThan(1.5));
    }

    [Test]
    public void WallsOpeningsAndRoomsAreSound()
    {
        MansionBlueprint bp = Gen(new MansionOptions("structure") { Massing = MassingType.H, Size = MansionSize.Grand });
        foreach (Room r in bp.Rooms)
        {
            Assert.That(r.Inner.X1 - r.Inner.X0, Is.GreaterThan(1.5), r.Id);
            Assert.That(r.Inner.Z1 - r.Inner.Z0, Is.GreaterThan(1.5), r.Id);
        }
        foreach (Wall w in bp.Walls)
        {
            double len = Walls.WallLength(w);
            Assert.That(len, Is.GreaterThan(0), w.Id);
            var sorted = w.Openings.ToList();
            Sorting.SortBy(sorted, o => o.U0);
            for (int i = 0; i < sorted.Count; i++)
            {
                Assert.That(sorted[i].U0, Is.GreaterThanOrEqualTo(0), w.Id);
                Assert.That(sorted[i].U1, Is.LessThanOrEqualTo(len + 1e-6), w.Id);
                Assert.That(sorted[i].Y1, Is.GreaterThan(sorted[i].Y0), w.Id);
                if (i > 0)
                    Assert.That(sorted[i].U0, Is.GreaterThanOrEqualTo(sorted[i - 1].U1), w.Id);
            }
        }
    }

    [Test]
    public void EveryStoreyIsOneWalkableComponentReachingEveryRoom()
    {
        MansionBlueprint bp = Gen(new MansionOptions("structure") { Massing = MassingType.H, Size = MansionSize.Grand });
        foreach (NavLevel n in bp.Nav.Levels)
        {
            int[] comp = NavGrid.Components(n);
            Assert.That(comp.Where(c => c >= 0).Distinct().Count(), Is.EqualTo(1));
            foreach (Room r in bp.Rooms.Where(q => q.Level == n.Level && q.Type != RoomType.ServiceStair))
            {
                int cells = 0;
                for (int k = 0; k < n.Room.Length; k++)
                {
                    if (n.Room[k] == r.Index && n.Walk[k] != 0)
                        cells++;
                }
                Assert.That(cells, Is.GreaterThan(0), r.Label);
            }
        }
        for (int L = 0; L + 1 < bp.Levels.Count; L++)
            Assert.That(bp.Stairs.Exists(s => s.FromLevel == L && s.ToLevel == L + 1), Is.True);
        Assert.That(bp.Nav.Links.Exists(l => l.Kind == NavLinkKind.Stair), Is.True);
        foreach (Poi p in bp.Pois)
        {
            NavLevel n = bp.Nav.Levels.First(q => q.Level == p.Level);
            bool near = false;
            for (int a = -1; a <= 1; a++)
            {
                for (int b = -1; b <= 1; b++)
                {
                    int k = NavGrid.CellAt(n, p.Stand.X + a * n.Cell, p.Stand.Z + b * n.Cell);
                    near |= k >= 0 && n.Walk[k] == 1;
                }
            }
            Assert.That(near, Is.True, p.Id + " " + p.Type.Text());
        }
    }

    [Test]
    public void TheTerraceIsInViewAndBehindTheHouseIsNot()
    {
        MansionBlueprint bp = Gen(new MansionOptions("sight") { Massing = MassingType.Block });
        var tracer = new SightlineTracer(
            bp.Site.Perch.Eye,
            Occluders.Collect(
                new OccluderInput
                {
                    Walls = bp.Walls,
                    Rooms = bp.Rooms,
                    Levels = bp.Levels,
                    Masses = bp.Masses,
                    Porticos = bp.Porticos,
                    Props = bp.Props,
                    Site = bp.Site,
                    Atrium = bp.Atrium,
                    Stairs = bp.Stairs,
                    RoofTerraces = bp.RoofTerraces,
                    WithProps = true,
                }
            )
        );
        Terrace t = bp.Site.Terrace;
        Assert.That(tracer.Person(0, t.Rect.Z1 - 1.5, t.Y), Is.GreaterThan(0.8));
        Assert.That(tracer.Person(0, bp.Stats.Footprint.Z0 - 3, 0), Is.EqualTo(0));
        Assert.That(bp.Sightlines.PartyVisible, Is.InRange(bp.Options.PartyVisibility[0], bp.Options.PartyVisibility[1]));
        Assert.That(bp.Sightlines.HiddenShare, Is.GreaterThanOrEqualTo(Validation.MinHidden));
    }

    [Test]
    public void MovingThePerchChangesOnlyWhatTheEyeSees()
    {
        MansionBlueprint bp = Gen(new MansionOptions("bearing"));
        Assert.That(Whole(MansionGenerator.MovePerch(bp, bp.Site.Perch.AzimuthDeg)), Is.EqualTo(Whole(bp)));
        MansionBlueprint moved = MansionGenerator.MovePerch(bp, bp.Site.Perch.AzimuthDeg > 0 ? -30 : 30);
        Assert.That(moved.Site.Perch.Eye, Is.Not.EqualTo(bp.Site.Perch.Eye));
        Assert.That(Canonical.Text(moved.Rooms), Is.EqualTo(Canonical.Text(bp.Rooms)));
        Assert.That(Canonical.Text(moved.Props), Is.EqualTo(Canonical.Text(bp.Props)));
        Assert.That(moved.Nav.Levels[0].Walk, Is.EqualTo(bp.Nav.Levels[0].Walk));
        Assert.That(moved.Nav.Levels[0].Vis, Is.Not.EqualTo(bp.Nav.Levels[0].Vis));
        Assert.That(MansionGenerator.MovePerch(bp, -90).Site.Perch.AzimuthDeg, Is.EqualTo(bp.Site.Perch.ArcDeg[0]));
        Assert.That(MansionGenerator.MovePerch(bp, 90).Site.Perch.AzimuthDeg, Is.EqualTo(bp.Site.Perch.ArcDeg[1]));
        // The original is untouched.
        Assert.That(Whole(MansionGenerator.MovePerch(bp, bp.Site.Perch.AzimuthDeg)), Is.EqualTo(Whole(bp)));
    }

    [Test]
    public void TheSniperMayClimbToSixtyDegrees()
    {
        MansionBlueprint bp = Gen(new MansionOptions("elevation"));
        Assert.That(bp.Site.Perch.ElevationDeg, Is.EqualTo(0));
        Assert.That(bp.Site.Perch.ElevationRangeDeg, Is.EqualTo(new double[] { 0, 60 }));
        Assert.That(MansionGenerator.MovePerch(bp, 0, 90).Site.Perch.ElevationDeg, Is.EqualTo(60));
        MansionBlueprint up = MansionGenerator.MovePerch(bp, bp.Site.Perch.AzimuthDeg, 45);
        Assert.That(up.Site.Perch.Eye.Y, Is.GreaterThan(bp.Site.Perch.Eye.Y + 80));
        Assert.That(Whole(MansionGenerator.MovePerch(up, bp.Site.Perch.AzimuthDeg, 0)), Is.EqualTo(Whole(bp)));
    }

    [Test]
    public void AMinimumVisibleShareIsMetOrReported()
    {
        foreach (string seed in new[] { "mv-1", "mv-2" })
        {
            MansionBlueprint bp = Gen(new MansionOptions(seed) { MinVisible = 0.45 });
            Assert.That(bp.Options.PartyVisibility[0], Is.EqualTo(0.45));
            Assert.That(bp.Validation.Ok, Is.True, Errors(bp));
            Assert.That(bp.Sightlines.PartyVisible, Is.GreaterThanOrEqualTo(0.45));
        }
        MansionBlueprint impossible = Gen(new MansionOptions("mv-impossible") { MinVisible = 0.95, MaxAttempts = 3 });
        Assert.That(impossible.Validation.Ok, Is.False);
        Assert.That(impossible.Validation.Issues.Exists(i => i.Severity == Severity.Error && (i.Code + i.Message).Contains("visib", StringComparison.OrdinalIgnoreCase)), Is.True);
    }

    [Test]
    public void EveryHouseHasItsRoomsAndTheirFurniture()
    {
        foreach (MansionSize size in new[] { MansionSize.Compact, MansionSize.Grand, MansionSize.Palatial })
        {
            for (int i = 0; i < 3; i++)
            {
                MansionBlueprint bp = Gen(new MansionOptions("prog-" + size.Text() + "-" + i) { Size = size });
                Assert.That(bp.Validation.Ok, Is.True, Errors(bp));
                foreach (RoomType t in Validation.RequiredRooms)
                    Assert.That(bp.Rooms.Exists(r => r.Type == t), Is.True, bp.Seed + " has no " + t.Text());
                Assert.That(bp.Rooms.Count(r => r.Type == RoomType.Bathroom), Is.GreaterThanOrEqualTo(2));
                bool Has(RoomType type, PropKind kind) => bp.Rooms.Where(r => r.Type == type).Any(r => bp.Props.Exists(p => p.RoomId == r.Id && p.Kind == kind));
                Assert.That(Has(RoomType.Study, PropKind.Globe), Is.True, bp.Seed + ": study without a globe");
                Assert.That(Has(RoomType.Bar, PropKind.BarCounter), Is.True, bp.Seed + ": bar without a counter");
                Assert.That(Has(RoomType.Kitchen, PropKind.Range) && Has(RoomType.Kitchen, PropKind.KitchenIsland), Is.True, bp.Seed + ": kitchen without range and island");
                foreach (RoomType t in new[] { RoomType.MusicRoom, RoomType.BilliardRoom, RoomType.Gallery, RoomType.GreatRoom, RoomType.DiningRoom, RoomType.Kitchen, RoomType.Library, RoomType.Bar })
                    Assert.That(bp.Rooms.Count(r => r.Type == t), Is.LessThanOrEqualTo(1), bp.Seed + ": " + t.Text());
            }
        }
    }
}
