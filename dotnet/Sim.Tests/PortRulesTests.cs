using System.Text.RegularExpressions;

namespace ScopeAndDrop.Sim.Tests;

/// <summary>Cheap guards for the porting rules in sim/README.md: calls that would quietly change behaviour are refused in sim sources.</summary>
public class PortRulesTests
{
    static readonly (string pattern, string why)[] Forbidden =
    {
        (@"\bMath\.Round\s*\(", "rounds halves to even; use Num.Round"),
        (@"\bMath\.Sign\s*\(", "throws on NaN and returns int; use Num.Sign"),
        (@"\bSystem\.Random\b|\bnew Random\s*\(", "use the seeded Rng"),
        (@"\bDateTime\.(Now|UtcNow|Today)\b|\bStopwatch\b|\bEnvironment\.TickCount", "the sim must not read the clock"),
        (@"\bUnityEngine\b|\bUnity\.Mathematics\b", "the sim has no Unity references"),
        (@"\.Sort\s*\(", "List.Sort and Array.Sort are unstable; use Sorting.StableSort"),
        (@"CultureInfo\.CurrentCulture|CultureInfo\.CurrentUICulture", "text must use the invariant culture"),
        (@"\bstring\.Compare\s*\((?![^)]*StringComparison\.Ordinal)", "culture-aware; use string.CompareOrdinal"),
        (@"\.ToLower\s*\(\s*\)|\.ToUpper\s*\(\s*\)", "culture-aware; use ToLowerInvariant / ToUpperInvariant"),
    };

    static string RepoRoot()
    {
        var dir = new DirectoryInfo(TestContext.CurrentContext.TestDirectory);
        while (dir != null && !File.Exists(Path.Combine(dir.FullName, "sim", "package.json")))
            dir = dir.Parent;
        return dir?.FullName ?? throw new InvalidOperationException("repo root not found");
    }

    [Test]
    public void SimSourcesKeepThePortingRules()
    {
        string runtime = Path.Combine(RepoRoot(), "sim", "Runtime");
        var hits = new List<string>();
        foreach (string file in Directory.EnumerateFiles(runtime, "*.cs", SearchOption.AllDirectories))
        {
            string[] lines = File.ReadAllLines(file);
            for (int i = 0; i < lines.Length; i++)
            {
                string line = lines[i];
                int comment = line.IndexOf("//", StringComparison.Ordinal);
                string code = comment >= 0 ? line.Substring(0, comment) : line;
                foreach (var (pattern, why) in Forbidden)
                {
                    if (Regex.IsMatch(code, pattern))
                        hits.Add($"{Path.GetRelativePath(runtime, file)}:{i + 1}: {why}: {line.Trim()}");
                }
            }
        }
        Assert.That(hits, Is.Empty);
    }
}
