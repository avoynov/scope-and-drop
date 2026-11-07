using System.Collections;
using System.Globalization;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using ScopeAndDrop.Sim.Core;
using ScopeAndDrop.Sim.Mansion;

namespace ScopeAndDrop.Sim.Tests.Mansion;

/// <summary>
/// The canonical text of dotnet/vectors/mansion.ts, from C# objects: public fields as camelCase keys sorted ordinally; null and false
/// left out; numbers rounded to 1e-6 and printed as JavaScript prints them; enums by their text names; nav grids as counts and hashes.
/// </summary>
public static class Canonical
{
    public static List<(string key, string text)> Parts(MansionBlueprint bp)
    {
        var parts = new List<(string, string)>();
        foreach (FieldInfo f in Fields(typeof(MansionBlueprint)))
        {
            string key = Camel(f.Name);
            object? value = f.GetValue(bp);
            if (key == "nav")
                value = NavSummary(bp.Nav);
            parts.Add((key, Text(value) ?? "null"));
        }
        parts.Sort((a, b) => string.CompareOrdinal(a.Item1, b.Item1));
        return parts;
    }

    public static string Sha(string s) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(s))).ToLowerInvariant().Substring(0, 16);

    static Dictionary<string, object?> NavSummary(Nav nav)
    {
        var levels = new List<object?>();
        foreach (NavLevel n in nav.Levels)
        {
            int walk = 0;
            long vis = 0;
            for (int k = 0; k < n.Walk.Length; k++)
            {
                walk += n.Walk[k];
                vis += n.Vis[k];
            }
            levels.Add(
                new Dictionary<string, object?>
                {
                    ["level"] = n.Level,
                    ["y"] = n.Y,
                    ["originX"] = n.OriginX,
                    ["originZ"] = n.OriginZ,
                    ["cell"] = n.Cell,
                    ["cols"] = n.Cols,
                    ["rows"] = n.Rows,
                    ["walk"] = new Dictionary<string, object?>
                    {
                        ["cells"] = n.Walk.Length,
                        ["count"] = walk,
                        ["hash"] = Fnv(n.Walk.Select(b => (int)b)),
                    },
                    ["room"] = new Dictionary<string, object?> { ["hash"] = Fnv(n.Room.Select(s => (int)s)) },
                    ["vis"] = new Dictionary<string, object?> { ["sum"] = (double)vis, ["hash"] = Fnv(n.Vis.Select(b => (int)b)) },
                }
            );
        }
        return new Dictionary<string, object?> { ["levels"] = levels, ["links"] = nav.Links };
    }

    static string Fnv(IEnumerable<int> values)
    {
        uint h = 0x811c9dc5;
        foreach (int value in values)
        {
            uint v = (uint)value & 0xffff;
            h = unchecked((h ^ (v & 0xff)) * 0x01000193);
            h = unchecked((h ^ (v >> 8)) * 0x01000193);
        }
        return h.ToString("x8", CultureInfo.InvariantCulture);
    }

    static IEnumerable<FieldInfo> Fields(Type t) => t.GetFields(BindingFlags.Public | BindingFlags.Instance).Where(f => !f.IsLiteral && !f.IsStatic);

    static string Camel(string name) => name.Length == 0 ? name : char.ToLowerInvariant(name[0]) + name.Substring(1);

    static string Number(double x)
    {
        if (double.IsNaN(x))
            return "NaN";
        if (double.IsInfinity(x))
            return x > 0 ? "Infinity" : "-Infinity";
        double v = ScopeAndDrop.Sim.Core.Num.Round(x * 1e6) / 1e6;
        return ScopeAndDrop.Sim.Core.Num.ToText(v == 0 ? 0 : v);
    }

    public static string Quote(string s)
    {
        var sb = new StringBuilder(s.Length + 2);
        sb.Append('"');
        for (int i = 0; i < s.Length; i++)
        {
            char c = s[i];
            switch (c)
            {
                case '"':
                    sb.Append("\\\"");
                    break;
                case '\\':
                    sb.Append("\\\\");
                    break;
                case '\b':
                    sb.Append("\\b");
                    break;
                case '\f':
                    sb.Append("\\f");
                    break;
                case '\n':
                    sb.Append("\\n");
                    break;
                case '\r':
                    sb.Append("\\r");
                    break;
                case '\t':
                    sb.Append("\\t");
                    break;
                default:
                    bool lone = char.IsHighSurrogate(c) ? !(i + 1 < s.Length && char.IsLowSurrogate(s[i + 1])) : char.IsLowSurrogate(c) && !(i > 0 && char.IsHighSurrogate(s[i - 1]));
                    if (c < 0x20 || lone)
                        sb.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                    else
                        sb.Append(c);
                    break;
            }
        }
        sb.Append('"');
        return sb.ToString();
    }

    static string? EnumName(object e)
    {
        Type t = e.GetType();
        MethodInfo of = typeof(EnumText<>).MakeGenericType(t).GetMethod("Of")!;
        return (string)of.Invoke(null, new[] { e })!;
    }

    public static string? Text(object? v)
    {
        switch (v)
        {
            case null:
                return null;
            case bool b:
                return b ? "true" : null;
            case string s:
                return Quote(s);
            case double d:
                return Number(d);
            case float f:
                return Number(f);
            case int i:
                return Number(i);
            case long l:
                return Number(l);
            case short sh:
                return Number(sh);
            case byte by:
                return Number(by);
            case uint u:
                return Number(u);
            case Enum e:
                return Quote(EnumName(e)!);
            case IDictionary<string, object?> dict:
                return Obj(dict.Select(kv => (kv.Key, kv.Value)));
        }
        Type t = v.GetType();
        Type? ro = t.GetInterfaces().FirstOrDefault(i => i.IsGenericType && i.GetGenericTypeDefinition() == typeof(IReadOnlyDictionary<,>));
        if (ro != null)
        {
            var entries = new List<(string, object?)>();
            foreach (object kv in (IEnumerable)v)
            {
                Type kt = kv.GetType();
                object key = kt.GetProperty("Key")!.GetValue(kv)!;
                object? value = kt.GetProperty("Value")!.GetValue(kv);
                entries.Add((key is Enum ek ? EnumName(ek)! : Convert.ToString(key, CultureInfo.InvariantCulture)!, value));
            }
            return Obj(entries);
        }
        if (v is IEnumerable list)
        {
            var sb = new StringBuilder("[");
            bool first = true;
            foreach (object? x in list)
            {
                if (!first)
                    sb.Append(',');
                first = false;
                sb.Append(Text(x) ?? "null");
            }
            return sb.Append(']').ToString();
        }
        return Obj(Fields(t).Select(f => (Camel(f.Name), f.GetValue(v))));
    }

    static string Obj(IEnumerable<(string key, object? value)> entries)
    {
        var sorted = entries.ToList();
        sorted.Sort((a, b) => string.CompareOrdinal(a.key, b.key));
        var sb = new StringBuilder("{");
        bool first = true;
        foreach (var (key, value) in sorted)
        {
            if (key == "generationMs")
                continue;
            string? c = Text(value);
            if (c == null)
                continue;
            if (!first)
                sb.Append(',');
            first = false;
            sb.Append(Quote(key)).Append(':').Append(c);
        }
        return sb.Append('}').ToString();
    }
}
