using System;
using System.Collections.Generic;
using System.Reflection;
using System.Text;

namespace ScopeAndDrop.Sim.Core
{
    /// <summary>Gives an enum member its text name when kebab-case of the member name would not match the TypeScript's string ("+x").</summary>
    [AttributeUsage(AttributeTargets.Field)]
    public sealed class TextAttribute : Attribute
    {
        public string Text { get; }

        public TextAttribute(string text) => Text = text;
    }

    /// <summary>
    /// The TypeScript's string-literal unions are enums in C#; this gives each member back its original text: kebab-case of the member name
    /// (GrandSalon is "grand-salon", UGarden is "u-garden") unless a <see cref="TextAttribute"/> says otherwise. Ids, RNG labels, digests and
    /// JSON use these names, so they match the TypeScript's.
    /// </summary>
    public static class EnumText<T>
        where T : struct, Enum
    {
        static readonly Dictionary<T, string> Names = new Dictionary<T, string>();
        static readonly Dictionary<string, T> Values = new Dictionary<string, T>(StringComparer.Ordinal);

        static EnumText()
        {
            foreach (FieldInfo f in typeof(T).GetFields(BindingFlags.Public | BindingFlags.Static))
            {
                var value = (T)f.GetValue(null)!;
                var attr = f.GetCustomAttribute<TextAttribute>();
                string text = attr != null ? attr.Text : Kebab(f.Name);
                Names[value] = text;
                Values[text] = value;
            }
        }

        public static string Of(T value) => Names[value];

        public static T Parse(string text) => Values.TryGetValue(text, out var v) ? v : throw new ArgumentException("No " + typeof(T).Name + " named " + text);

        public static bool TryParse(string text, out T value) => Values.TryGetValue(text, out value);

        static string Kebab(string name)
        {
            var sb = new StringBuilder(name.Length + 4);
            for (int i = 0; i < name.Length; i++)
            {
                char ch = name[i];
                if (char.IsUpper(ch))
                {
                    if (i > 0)
                        sb.Append('-');
                    sb.Append(char.ToLowerInvariant(ch));
                }
                else
                    sb.Append(ch);
            }
            return sb.ToString();
        }
    }

    public static class EnumTextExtensions
    {
        /// <summary>The member's text name, as the TypeScript wrote it.</summary>
        public static string Text<T>(this T value)
            where T : struct, Enum => EnumText<T>.Of(value);
    }
}
