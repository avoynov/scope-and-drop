using System.Collections.Generic;
using ScopeAndDrop.Sim.Core;

namespace ScopeAndDrop.Sim.Mansion
{
    /// <summary>
    /// Architectural style presets and interior palettes. Port of src/mansion/core/styles.ts.
    /// Values are tuned for a ~70% realistic / 30% appealing read: real proportions and materials, with a slightly richer
    /// palette and cleaner silhouettes than a photograph.
    /// </summary>
    public static class Styles
    {
        /// <summary>Style ids in the TypeScript's order (the order a random style is picked from).</summary>
        public static readonly IReadOnlyList<StyleId> Ids = new[] { StyleId.Palladian, StyleId.Georgian, StyleId.Beauxarts, StyleId.Orangery };

        /// <summary>A fresh copy of a style preset (callers may keep it on a blueprint without sharing state).</summary>
        public static StyleDef Get(StyleId id)
        {
            switch (id)
            {
                case StyleId.Palladian:
                    return new StyleDef
                    {
                        Id = StyleId.Palladian,
                        Name = "Palladian Limestone",
                        WallMaterial = WallMaterial.Limestone,
                        WallColor = "#d9cfbd",
                        TrimColor = "#e8e1d2",
                        BaseMaterial = BaseMaterial.Rusticated,
                        Roof = RoofKind.Hipped,
                        RoofMaterial = RoofMaterial.Slate,
                        RoofPitchDeg = new[] { 24.0, 30 },
                        BayWidth = new[] { 3.8, 4.4 },
                        LevelHeights = new[] { new[] { 4.8, 5.6 }, new[] { 4.0, 4.4 }, new[] { 3.1, 3.4 } },
                        Floors = new[] { 2, 3 },
                        Plinth = new[] { 1.2, 1.6 },
                        PorticoChance = 0.75,
                        PavilionChance = 0.55,
                        Quoins = false,
                        BalustradeParapet = true,
                        PedimentedWindows = true,
                        Balconettes = false,
                        WindowFrameColor = "#ece8df",
                        DoorColor = "#2c3a33",
                        ColumnOrder = ColumnOrder.Ionic,
                        MassingWeights = Weights(0.35, 0.25, 0.2, 0.2),
                    };
                case StyleId.Georgian:
                    return new StyleDef
                    {
                        Id = StyleId.Georgian,
                        Name = "Georgian Red Brick",
                        WallMaterial = WallMaterial.Brick,
                        WallColor = "#9a4f3a",
                        TrimColor = "#e4dccb",
                        BaseMaterial = BaseMaterial.Limestone,
                        Roof = RoofKind.Hipped,
                        RoofMaterial = RoofMaterial.Slate,
                        RoofPitchDeg = new[] { 32.0, 40 },
                        BayWidth = new[] { 3.6, 4.1 },
                        LevelHeights = new[] { new[] { 4.5, 5.1 }, new[] { 3.9, 4.3 }, new[] { 3.0, 3.3 } },
                        Floors = new[] { 2, 3 },
                        Plinth = new[] { 1.0, 1.4 },
                        PorticoChance = 0.4,
                        PavilionChance = 0.6,
                        Quoins = true,
                        BalustradeParapet = false,
                        PedimentedWindows = false,
                        Balconettes = false,
                        WindowFrameColor = "#f2efe8",
                        DoorColor = "#1f2b24",
                        ColumnOrder = ColumnOrder.Doric,
                        MassingWeights = Weights(0.4, 0.2, 0.25, 0.15),
                    };
                case StyleId.Beauxarts:
                    return new StyleDef
                    {
                        Id = StyleId.Beauxarts,
                        Name = "Beaux-Arts Mansard",
                        WallMaterial = WallMaterial.Limestone,
                        WallColor = "#e2d6bf",
                        TrimColor = "#efe6d3",
                        BaseMaterial = BaseMaterial.Rusticated,
                        Roof = RoofKind.Mansard,
                        RoofMaterial = RoofMaterial.Zinc,
                        RoofPitchDeg = new[] { 68.0, 74 },
                        BayWidth = new[] { 3.9, 4.5 },
                        LevelHeights = new[] { new[] { 5.0, 5.8 }, new[] { 4.1, 4.6 }, new[] { 3.2, 3.5 } },
                        Floors = new[] { 2, 3 },
                        Plinth = new[] { 1.1, 1.5 },
                        PorticoChance = 0.35,
                        PavilionChance = 0.8,
                        Quoins = false,
                        BalustradeParapet = false,
                        PedimentedWindows = true,
                        Balconettes = true,
                        WindowFrameColor = "#e9e4da",
                        DoorColor = "#26303a",
                        ColumnOrder = ColumnOrder.Corinthian,
                        MassingWeights = Weights(0.3, 0.3, 0.15, 0.25),
                    };
                default:
                    // After the great iron-and-glass conservatories of the 1820s and 30s (Syon): Bath stone, a temple
                    // front under the dome, giant arched windows between pilasters, single-storey glass-roofed wings, and on
                    // the main block the orangery's own roof: flat lead behind a parapet, with glass lanterns standing on it.
                    return new StyleDef
                    {
                        Id = StyleId.Orangery,
                        Name = "Orangery Bath Stone",
                        WallMaterial = WallMaterial.Limestone,
                        WallColor = "#dccba4",
                        TrimColor = "#eadfc4",
                        BaseMaterial = BaseMaterial.Limestone,
                        Roof = RoofKind.Flat,
                        RoofMaterial = RoofMaterial.Lead,
                        GlassRoofs = true,
                        GiantWindows = true,
                        RoofPitchDeg = new[] { 22.0, 27 },
                        BayWidth = new[] { 4.0, 4.5 },
                        LevelHeights = new[] { new[] { 5.0, 5.6 }, new[] { 4.4, 4.9 }, new[] { 3.2, 3.5 } },
                        Floors = new[] { 2, 2 },
                        Plinth = new[] { 0.9, 1.2 },
                        PorticoChance = 0,
                        PavilionChance = 1,
                        Quoins = false,
                        BalustradeParapet = false,
                        PedimentedWindows = false,
                        Balconettes = false,
                        WindowFrameColor = "#f3f1ea",
                        DoorColor = "#2f3d36",
                        ColumnOrder = ColumnOrder.Ionic,
                        MassingWeights = Weights(0.3, 0.35, 0.1, 0.25),
                    };
            }
        }

        static OrderedMap<MassingType, double> Weights(double block, double uGarden, double uEntrance, double h)
        {
            var m = new OrderedMap<MassingType, double>();
            m.Set(MassingType.Block, block);
            m.Set(MassingType.UGarden, uGarden);
            m.Set(MassingType.UEntrance, uEntrance);
            m.Set(MassingType.H, h);
            return m;
        }

        /* Interior palettes. Jewel tones under warm light read rich through cool twilight glass; that warm/cool split is the core of the look. */

        static readonly string[] PaletteBallroom = { "#efe4cf", "#e8dcc4", "#e9e0d0", "#dfe3da" };
        static readonly string[] PaletteSalon = { "#7d8f78", "#8aa0a8", "#b98a83", "#9c8a5a", "#6f7f99", "#a7a07d" };
        static readonly string[] PaletteLibrary = { "#3b2a1f", "#4a3424", "#2f3a2c", "#5a2e26" };
        static readonly string[] PaletteDining = { "#7a2b26", "#2f4a3c", "#6b2f3d", "#304458", "#8a5a2b" };
        static readonly string[] PaletteMusic = { "#a9b7c4", "#c4b5a5", "#b7c2b0", "#c9aeb0" };
        static readonly string[] PaletteGallery = { "#5d6b5f", "#6b5d58", "#58606d", "#7b2f2f" };
        static readonly string[] PaletteBilliard = { "#2d4a35", "#5a2a24", "#3a3f4a" };
        static readonly string[] PaletteHall = { "#ddd3c0", "#d4ccbb", "#cfc6b4" };
        static readonly string[] PalettePrivate = { "#c9c2a8", "#a9b8b0", "#c7aea6", "#b9b3c9", "#d1c7b0", "#9fb0a0" };
        static readonly string[] PaletteService = { "#cfc8b8", "#bfb8a6" };
        static readonly string[] PaletteConservatory = { "#e5e0d2" };

        static readonly string[] Drapery = { "#7d1f22", "#8a6a1f", "#2d4b39", "#3f2f5a", "#6a1d33", "#9a7b3a", "#284058" };

        static readonly string[] StoneWalls = { "#d8cfbf", "#cfc5b2", "#ddd5c6" };
        static readonly string[] PaneledGrandWalls = { "#efe7d6", "#e6ddc8" };
        static readonly string[] Trims = { "#f1ece2", "#ebe3d2", "#efe9dc" };
        static readonly string[] Ceilings = { "#f3efe6", "#efe9dc", "#f1eadb" };

        static readonly WallFinish[] WallsGreatRoom = { WallFinish.Damask, WallFinish.Silk, WallFinish.Paneling };
        static readonly WallFinish[] WallsCinema = { WallFinish.Damask, WallFinish.Stripe };
        static readonly WallFinish[] WallsBallroom = { WallFinish.Paneling, WallFinish.Silk, WallFinish.Paint };
        static readonly WallFinish[] WallsSalon = { WallFinish.Damask, WallFinish.Silk, WallFinish.Stripe, WallFinish.Damask };
        static readonly WallFinish[] WallsGallery = { WallFinish.Silk, WallFinish.Paint };
        static readonly WallFinish[] WallsPrivate = { WallFinish.Damask, WallFinish.Stripe, WallFinish.Paint };

        static readonly FloorFinish[] FloorsBallroom = { FloorFinish.Herringbone, FloorFinish.Marble, FloorFinish.Herringbone };
        static readonly FloorFinish[] FloorsGrandSalon = { FloorFinish.Marble, FloorFinish.Herringbone };
        static readonly FloorFinish[] FloorsHall = { FloorFinish.Checker, FloorFinish.Marble, FloorFinish.Stone };
        static readonly FloorFinish[] FloorsConservatory = { FloorFinish.Checker, FloorFinish.Stone };
        static readonly FloorFinish[] FloorsCorridor = { FloorFinish.Parquet, FloorFinish.Boards, FloorFinish.Stone };
        static readonly FloorFinish[] FloorsBedroom = { FloorFinish.Carpet, FloorFinish.Boards, FloorFinish.Parquet };
        static readonly FloorFinish[] FloorsDefault = { FloorFinish.Herringbone, FloorFinish.Parquet, FloorFinish.Herringbone };

        static readonly string[] FloorHerringbone = { "#8a5a32", "#7a4e2c", "#9a6a3c" };
        static readonly string[] FloorParquet = { "#7b5233", "#6e4a2e", "#8c6440" };
        static readonly string[] FloorBoards = { "#6b4a30", "#7d5a3a" };
        static readonly string[] FloorMarble = { "#e6e1d8", "#ddd6ca", "#d8d2c8" };
        static readonly string[] FloorChecker = { "#e8e3d8" };
        static readonly string[] FloorStone = { "#b9b1a2", "#c4bcab" };
        static readonly string[] FloorCarpet = { "#6a2a2a", "#2f3e5a", "#5a4a2a", "#3a4a3a" };

        enum PaletteKey
        {
            Ballroom,
            Salon,
            Library,
            Dining,
            Music,
            Gallery,
            Billiard,
            Hall,
            Private,
            Service,
            Conservatory,
        }

        static PaletteKey WallKey(RoomType type)
        {
            switch (type)
            {
                case RoomType.Ballroom:
                case RoomType.GrandSalon:
                case RoomType.HallGallery:
                    return PaletteKey.Ballroom;
                case RoomType.DrawingRoom:
                case RoomType.MorningRoom:
                case RoomType.CardRoom:
                case RoomType.GreatRoom:
                    return PaletteKey.Salon;
                case RoomType.Bar:
                case RoomType.Cinema:
                case RoomType.Theatre:
                case RoomType.Disco:
                    return PaletteKey.Billiard;
                case RoomType.Spa:
                    return PaletteKey.Conservatory;
                case RoomType.Kitchen:
                case RoomType.Gym:
                    return PaletteKey.Service;
                case RoomType.Library:
                case RoomType.Study:
                    return PaletteKey.Library;
                case RoomType.DiningRoom:
                    return PaletteKey.Dining;
                case RoomType.MusicRoom:
                    return PaletteKey.Music;
                case RoomType.Gallery:
                    return PaletteKey.Gallery;
                case RoomType.BilliardRoom:
                    return PaletteKey.Billiard;
                case RoomType.EntranceHall:
                case RoomType.StairHall:
                case RoomType.Landing:
                case RoomType.Corridor:
                    return PaletteKey.Hall;
                case RoomType.Conservatory:
                    return PaletteKey.Conservatory;
                case RoomType.Pantry:
                case RoomType.ServiceStair:
                case RoomType.Cloakroom:
                case RoomType.Bathroom:
                    return PaletteKey.Service;
                default:
                    return PaletteKey.Private;
            }
        }

        static string[] WallPalette(PaletteKey key) =>
            key switch
            {
                PaletteKey.Ballroom => PaletteBallroom,
                PaletteKey.Salon => PaletteSalon,
                PaletteKey.Library => PaletteLibrary,
                PaletteKey.Dining => PaletteDining,
                PaletteKey.Music => PaletteMusic,
                PaletteKey.Gallery => PaletteGallery,
                PaletteKey.Billiard => PaletteBilliard,
                PaletteKey.Hall => PaletteHall,
                PaletteKey.Private => PalettePrivate,
                PaletteKey.Service => PaletteService,
                _ => PaletteConservatory,
            };

        static WallFinish WallFinishFor(RoomType type, Rng rng)
        {
            switch (type)
            {
                case RoomType.Library:
                case RoomType.Study:
                case RoomType.BilliardRoom:
                case RoomType.Bar:
                    return WallFinish.Paneling;
                case RoomType.Spa:
                    return WallFinish.Stone;
                case RoomType.GreatRoom:
                    return rng.Pick(WallsGreatRoom);
                case RoomType.Cinema:
                case RoomType.Theatre:
                    return rng.Pick(WallsCinema);
                case RoomType.Ballroom:
                case RoomType.GrandSalon:
                    return rng.Pick(WallsBallroom);
                case RoomType.EntranceHall:
                case RoomType.StairHall:
                case RoomType.Conservatory:
                    return WallFinish.Stone;
                case RoomType.DrawingRoom:
                case RoomType.DiningRoom:
                case RoomType.MusicRoom:
                case RoomType.MorningRoom:
                case RoomType.CardRoom:
                    return rng.Pick(WallsSalon);
                case RoomType.Gallery:
                    return rng.Pick(WallsGallery);
                case RoomType.Bedroom:
                case RoomType.SittingRoom:
                case RoomType.DressingRoom:
                    return rng.Pick(WallsPrivate);
                default:
                    return WallFinish.Paint;
            }
        }

        static FloorFinish FloorFinishFor(RoomType type, Rng rng)
        {
            switch (type)
            {
                case RoomType.Ballroom:
                    return rng.Pick(FloorsBallroom);
                case RoomType.GrandSalon:
                    return rng.Pick(FloorsGrandSalon);
                case RoomType.EntranceHall:
                case RoomType.StairHall:
                    return rng.Pick(FloorsHall);
                case RoomType.Conservatory:
                    return rng.Pick(FloorsConservatory);
                case RoomType.RoofTerrace:
                    return FloorFinish.Stone;
                case RoomType.Corridor:
                case RoomType.Landing:
                    return rng.Pick(FloorsCorridor);
                case RoomType.Pantry:
                case RoomType.ServiceStair:
                case RoomType.Cloakroom:
                    return FloorFinish.Stone;
                case RoomType.Bathroom:
                case RoomType.Spa:
                case RoomType.Kitchen:
                    return FloorFinish.Marble;
                case RoomType.Bar:
                    return FloorFinish.Stone;
                case RoomType.Cinema:
                case RoomType.Theatre:
                    return FloorFinish.Carpet;
                case RoomType.Gym:
                case RoomType.Disco:
                    return FloorFinish.Boards;
                case RoomType.Bedroom:
                case RoomType.DressingRoom:
                    return rng.Pick(FloorsBedroom);
                default:
                    return rng.Pick(FloorsDefault);
            }
        }

        static string[] FloorColors(FloorFinish floor) =>
            floor switch
            {
                FloorFinish.Herringbone => FloorHerringbone,
                FloorFinish.Parquet => FloorParquet,
                FloorFinish.Boards => FloorBoards,
                FloorFinish.Marble => FloorMarble,
                FloorFinish.Checker => FloorChecker,
                FloorFinish.Stone => FloorStone,
                _ => FloorCarpet,
            };

        public static RoomFinish RoomFinish(RoomType type, Rng rng)
        {
            WallFinish wall = WallFinishFor(type, rng);
            FloorFinish floor = FloorFinishFor(type, rng);
            PaletteKey key = WallKey(type);
            string wallColor = rng.Pick(WallPalette(key));
            if (wall == WallFinish.Stone)
                wallColor = rng.Pick(StoneWalls);
            if (wall == WallFinish.Paneling && (type == RoomType.Ballroom || type == RoomType.GrandSalon))
                wallColor = rng.Pick(PaneledGrandWalls);
            // Object literal fields are evaluated in source order: trim, floor colour, ceiling, drapery, dado.
            string trim = wall == WallFinish.Paneling && key == PaletteKey.Library ? "#3a2618" : rng.Pick(Trims);
            string floorColor = rng.Pick(FloorColors(floor));
            string ceiling = type == RoomType.Library ? "#d9cdb5" : rng.Pick(Ceilings);
            string drapery = rng.Pick(Drapery);
            bool dado = wall == WallFinish.Damask || wall == WallFinish.Silk || wall == WallFinish.Stripe ? rng.Chance(0.6) : false;
            return new RoomFinish
            {
                Wall = wall,
                WallColor = wallColor,
                TrimColor = trim,
                Floor = floor,
                FloorColor = floorColor,
                CeilingColor = ceiling,
                Drapery = drapery,
                Dado = dado,
            };
        }

        public static string RoomLabel(RoomType type) =>
            type switch
            {
                RoomType.Ballroom => "Ballroom",
                RoomType.GrandSalon => "Grand Salon",
                RoomType.DrawingRoom => "Drawing Room",
                RoomType.MusicRoom => "Music Room",
                RoomType.Library => "Library",
                RoomType.DiningRoom => "Dining Room",
                RoomType.Gallery => "Picture Gallery",
                RoomType.BilliardRoom => "Billiard Room",
                RoomType.CardRoom => "Card Room",
                RoomType.MorningRoom => "Morning Room",
                RoomType.Conservatory => "Conservatory",
                RoomType.GreatRoom => "Great Room",
                RoomType.Bar => "Bar & Wine Cellar",
                RoomType.Cinema => "Home Cinema",
                RoomType.Spa => "Spa & Pool",
                RoomType.Theatre => "Theatre",
                RoomType.Disco => "Dance Room",
                RoomType.Gym => "Gym",
                RoomType.Kitchen => "Gourmet Kitchen",
                RoomType.EntranceHall => "Entrance Hall",
                RoomType.StairHall => "Stair Hall",
                RoomType.Corridor => "Corridor",
                RoomType.Study => "Study",
                RoomType.Cloakroom => "Cloakroom",
                RoomType.Pantry => "Butler's Pantry",
                RoomType.ServiceStair => "Service Stair",
                RoomType.Landing => "Landing",
                RoomType.HallGallery => "Hall Gallery",
                RoomType.RoofTerrace => "Roof Terrace",
                RoomType.Bedroom => "Bedroom",
                RoomType.SittingRoom => "Sitting Room",
                RoomType.DressingRoom => "Dressing Room",
                _ => "Bathroom",
            };
    }
}
