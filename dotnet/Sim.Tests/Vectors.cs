using System.Text.Json;

namespace ScopeAndDrop.Sim.Tests;

/// <summary>Test data written by today's TypeScript (dotnet/vectors/*.ts). Doubles travel as 16 hex digits of their bits.</summary>
public static class Vectors
{
    static readonly Dictionary<string, JsonDocument> Cache = new();

    public static JsonElement Load(string name)
    {
        lock (Cache)
        {
            if (!Cache.TryGetValue(name, out var doc))
            {
                string path = Path.Combine(TestContext.CurrentContext.TestDirectory, "Vectors", name + ".json");
                doc = JsonDocument.Parse(File.ReadAllText(path));
                Cache[name] = doc;
            }
            return doc.RootElement;
        }
    }

    public static double Bits(JsonElement e) => BitConverter.Int64BitsToDouble(unchecked((long)Convert.ToUInt64(e.GetString(), 16)));

    public static double[] BitsArray(JsonElement e) => e.EnumerateArray().Select(Bits).ToArray();
}
