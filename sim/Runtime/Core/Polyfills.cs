// Lets C# 9 records and init-only setters compile against .NET Standard 2.1, which lacks this marker type.
// Unity's compiler needs the same declaration, so it lives in the sim itself.
namespace System.Runtime.CompilerServices
{
    internal static class IsExternalInit { }
}
