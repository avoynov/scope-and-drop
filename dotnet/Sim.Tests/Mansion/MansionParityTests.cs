using System.Text.Json;
using ScopeAndDrop.Sim.Core;
using ScopeAndDrop.Sim.Mansion;

namespace ScopeAndDrop.Sim.Tests.Mansion;

/// <summary>
/// The C# generator against today's TypeScript (dotnet/vectors/mansion.ts): each part of each blueprint must give the same digest.
/// Set SIM_MANSION_DUMP to a folder to write the C# canonical text there, for diffing against the TypeScript's dump.
/// </summary>
public class MansionParityTests
{
    public static IEnumerable<string> CaseNames()
    {
        string path = Path.Combine(AppContext.BaseDirectory, "Vectors", "mansion.json");
        using JsonDocument doc = JsonDocument.Parse(File.ReadAllText(path));
        return doc.RootElement.GetProperty("cases").EnumerateArray().Select(c => c.GetProperty("name").GetString()!).ToList();
    }

    static JsonElement Case(string name) => Vectors.Load("mansion").GetProperty("cases").EnumerateArray().First(c => c.GetProperty("name").GetString() == name);

    public static MansionOptions Options(JsonElement o)
    {
        var opts = new MansionOptions(o.GetProperty("seed").GetString()!);
        foreach (JsonProperty p in o.EnumerateObject())
        {
            switch (p.Name)
            {
                case "seed":
                    break;
                case "size":
                    opts.Size = EnumText<MansionSize>.Parse(p.Value.GetString()!);
                    break;
                case "style":
                    opts.Style = EnumText<StyleId>.Parse(p.Value.GetString()!);
                    break;
                case "massing":
                    opts.Massing = EnumText<MassingType>.Parse(p.Value.GetString()!);
                    break;
                case "hall":
                    opts.Hall = EnumText<HallShape>.Parse(p.Value.GetString()!);
                    break;
                case "minVisible":
                    opts.MinVisible = p.Value.GetDouble();
                    break;
                case "perchDistance":
                    opts.PerchDistance = p.Value.GetDouble();
                    break;
                case "perchAzimuthDeg":
                    opts.PerchAzimuthDeg = p.Value.GetDouble();
                    break;
                case "perchElevationDeg":
                    opts.PerchElevationDeg = p.Value.GetDouble();
                    break;
                default:
                    throw new ArgumentException("unknown option " + p.Name);
            }
        }
        return opts;
    }

    static List<string> Compare(JsonElement expected, List<(string key, string text)> parts, string name, string? dumpSuffix)
    {
        string? dump = Environment.GetEnvironmentVariable("SIM_MANSION_DUMP");
        if (!string.IsNullOrEmpty(dump))
        {
            Directory.CreateDirectory(dump);
            File.WriteAllText(Path.Combine(dump, name + (dumpSuffix ?? "") + ".txt"), string.Join("\n", parts.Select(p => p.key + "=" + p.text)) + "\n");
        }
        var bad = new List<string>();
        foreach (var (key, text) in parts)
        {
            if (!expected.TryGetProperty(key, out JsonElement want))
                bad.Add(key + " (not in the TypeScript)");
            else if (want.GetString() != Canonical.Sha(text))
                bad.Add(key);
        }
        foreach (JsonProperty p in expected.EnumerateObject())
        {
            if (!parts.Exists(q => q.key == p.Name))
                bad.Add(p.Name + " (missing in C#)");
        }
        return bad;
    }

    [TestCaseSource(nameof(CaseNames))]
    public void BlueprintMatchesTypeScript(string name)
    {
        JsonElement c = Case(name);
        MansionBlueprint bp = MansionGenerator.Generate(Options(c.GetProperty("options")));
        List<string> bad = Compare(c.GetProperty("parts"), Canonical.Parts(bp), name, null);
        if (c.TryGetProperty("move", out JsonElement move))
        {
            MansionBlueprint moved = MansionGenerator.MovePerch(bp, move[0].GetDouble(), move[1].GetDouble());
            bad.AddRange(Compare(c.GetProperty("moved"), Canonical.Parts(moved), name, ".moved").Select(k => "moved." + k));
        }
        Assert.That(bad, Is.Empty, $"attempt {bp.Attempt} (TypeScript {c.GetProperty("attempt").GetInt32()}), ok {bp.Validation.Ok}");
    }
}
