// Every test runs under a European locale, where C# would write 0.5 as "0,5": any culture-dependent text in the sim fails loudly here.
[assembly: SetCulture("de-DE")]
[assembly: SetUICulture("de-DE")]
