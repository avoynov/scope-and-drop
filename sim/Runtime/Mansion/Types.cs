using System.Collections.Generic;
using ScopeAndDrop.Sim.Core;

// Mansion blueprint schema. Port of src/mansion/core/types.ts.
//
// The blueprint is pure data: the party sim, the spy, tests and the renderer all read the same object.
// Conventions: metres, y up, plan = (x, z). The garden front faces +z, toward the sniper perch; the entrance front faces -z.
// Field names are the TypeScript's in PascalCase; enum members print as the TypeScript's strings (EnumText).
namespace ScopeAndDrop.Sim.Mansion
{
    public enum StyleId
    {
        Palladian,
        Georgian,
        Beauxarts,
        Orangery,
    }

    public enum MassingType
    {
        Block,
        UGarden,
        UEntrance,
        H,
    }

    public enum MansionSize
    {
        Compact,
        Grand,
        Palatial,
    }

    public enum FacadeSide
    {
        Garden,
        Entrance,
        East,
        West,
    }

    public enum RoomType
    {
        Ballroom,
        GrandSalon,
        DrawingRoom,
        MusicRoom,
        Library,
        DiningRoom,
        Gallery,
        BilliardRoom,
        CardRoom,
        MorningRoom,
        Conservatory,
        GreatRoom,
        Bar,
        Cinema,
        Spa,
        Theatre,
        Disco,
        Gym,
        Kitchen,
        EntranceHall,
        StairHall,
        Corridor,
        Study,
        Cloakroom,
        Pantry,
        ServiceStair,
        Landing,
        HallGallery,
        RoofTerrace,
        Bedroom,
        SittingRoom,
        DressingRoom,
        Bathroom,
    }

    /// <summary>Party: guests mingle here. Circulation: halls, corridors, stairs.</summary>
    public enum RoomRole
    {
        Party,
        Circulation,
        Private,
        Service,
    }

    public enum WallFinish
    {
        Damask,
        Silk,
        Stripe,
        Paneling,
        Paint,
        Stone,
    }

    public enum FloorFinish
    {
        Herringbone,
        Parquet,
        Marble,
        Checker,
        Stone,
        Carpet,
        Boards,
    }

    public enum Axis
    {
        X,
        Z,
    }

    /// <summary>A direction along a plan axis.</summary>
    public enum Dir4
    {
        [Text("+x")]
        PosX,

        [Text("-x")]
        NegX,

        [Text("+z")]
        PosZ,

        [Text("-z")]
        NegZ,
    }

    public sealed class RoomFinish
    {
        public WallFinish Wall;

        /// <summary>Hex sRGB.</summary>
        public string WallColor = "";
        public string TrimColor = "";
        public FloorFinish Floor;
        public string FloorColor = "";
        public string CeilingColor = "";
        public string Drapery = "";
        public bool Dado;

        public RoomFinish Clone() => (RoomFinish)MemberwiseClone();
    }

    public sealed class LevelSpec
    {
        public int Index;

        /// <summary>Finished floor elevation (m). Level 0 is the raised piano nobile.</summary>
        public double FloorY;
        public double Height;
        public double CeilingY;
    }

    public enum RoofKind
    {
        Hipped,
        Mansard,
        Flat,
        Glass,
    }

    public sealed class RoofLantern
    {
        public string RoomId = "";
        public Rect Rect;
    }

    public sealed class RoofSpec
    {
        public RoofKind Kind;

        /// <summary>Top of the cornice / wall plate.</summary>
        public double EaveY;
        public double PitchDeg;

        /// <summary>Plan rectangles where a pitched roof is glass (the whole roof of an orangery wing).</summary>
        public List<Rect>? Glazed;

        /// <summary>Glass lanterns standing on a flat roof, one over each room below: plan rectangle of each kerb.</summary>
        public List<RoofLantern>? Lanterns;

        /// <summary>Parapet with balustrade hiding the roof foot (Palladian).</summary>
        public bool Balustrade;

        /// <summary>Pediment gable over this mass on the given side (central pavilions).</summary>
        public FacadeSide? Pediment;
        public bool Dormers;
    }

    public enum MassKind
    {
        Main,
        Wing,
        Pavilion,
        Conservatory,
    }

    public sealed class Mass
    {
        public string Id = "";
        public MassKind Kind;

        /// <summary>Wall-centreline footprint.</summary>
        public Rect Rect;
        public int Levels;
        public RoofSpec Roof = new RoofSpec();

        /// <summary>Facades of this mass that are exposed to the outside (not abutting another mass).</summary>
        public List<FacadeSide> Exposed = new List<FacadeSide>();
    }

    public enum OpeningKind
    {
        Window,
        FrenchWindow,
        Door,
        DoubleDoor,
        Arch,
        Entrance,
    }

    public enum PedimentShape
    {
        Triangle,
        Segment,
    }

    public sealed class OpeningDressing
    {
        public PedimentShape? Pediment;
        public bool? Keystone;
        public bool? Balconette;
        public bool? Surround;

        /// <summary>Arched head: the top `arch` metres of the opening are under a semi-elliptical arch (the data stays a rectangle).</summary>
        public double? Arch;

        /// <summary>One of a stack of windows read as a single giant window: no drapes, slender iron joinery.</summary>
        public bool? Giant;

        /// <summary>Iron panel carried this far above the head, hiding the floor edge between this window and the one above.</summary>
        public double? Spandrel;
    }

    public enum Curtain
    {
        Open,
        Sheer,
        Drawn,
    }

    public sealed class Opening
    {
        public string Id = "";
        public OpeningKind Kind;

        /// <summary>Span along the wall measured from wall.a (m).</summary>
        public double U0;
        public double U1;

        /// <summary>Absolute elevation of sill and head (m).</summary>
        public double Y0;
        public double Y1;

        /// <summary>Has glass: sightlines pass, NPCs do not (unless passable).</summary>
        public bool Glazed;

        /// <summary>NPCs can walk through.</summary>
        public bool Passable;

        /// <summary>Obscured glass (bathrooms): blocks sightlines.</summary>
        public bool? Frosted;

        /// <summary>Glazing bars per leaf: [columns, rows].</summary>
        public int[]? Panes;
        public int? Leaves;
        public OpeningDressing? Dressing;

        /// <summary>Interior drapery state: sheer reduces visibility, drawn blocks it.</summary>
        public Curtain? Curtain;

        public Opening Clone() => (Opening)MemberwiseClone();
    }

    public sealed class Wall
    {
        public string Id = "";
        public int Level;
        public string MassId = "";

        /// <summary>Centreline endpoints; axis-aligned with a &lt; b along Axis.</summary>
        public Vec2 A;
        public Vec2 B;
        public Axis Axis;
        public double Thickness;
        public double Y0;
        public double Y1;
        public bool Exterior;

        /// <summary>For exterior walls: the direction the outside face looks.</summary>
        public FacadeSide? Side;

        /// <summary>Room on each side of the wall. Neg is toward -z (axis x) or -x (axis z); Pos is the other side. null = outside.</summary>
        public string? Neg;
        public string? Pos;
        public List<Opening> Openings = new List<Opening>();

        /// <summary>Conservatory-style curtain wall: entirely glazed between mullions.</summary>
        public bool? Glazed;
    }

    public sealed class Room
    {
        public string Id = "";

        /// <summary>Dense index, used as the lighting scope and in nav grids.</summary>
        public int Index;
        public RoomType Type;
        public RoomRole Role;
        public string Label = "";
        public int Level;
        public string MassId = "";

        /// <summary>Wall-centreline rectangle.</summary>
        public Rect Rect;

        /// <summary>Clear interior between wall faces.</summary>
        public Rect Inner;
        public double FloorY;
        public double CeilingY;

        /// <summary>Openings in this room's floor (stairwells, gallery voids).</summary>
        public List<Rect> FloorHoles = new List<Rect>();

        /// <summary>Lit from above through glass: seen from above.</summary>
        public bool? Skylit;

        /// <summary>The opening in this room's ceiling under its glass.</summary>
        public Rect? Skylight;

        /// <summary>True when the room rises through the level above (ballroom, stair hall).</summary>
        public bool DoubleHeight;

        /// <summary>May be walked through to reach other rooms (enfilade).</summary>
        public bool PassThrough;

        /// <summary>Has windows on the garden (stage) facade.</summary>
        public bool Stage;

        /// <summary>0 = dark, 1 = full party lighting.</summary>
        public double Lit;
        public RoomFinish Finish = new RoomFinish();
    }

    public sealed class StairFlight
    {
        /// <summary>Foot of the flight (centre of the first tread nosing line), at its floor level.</summary>
        public double X;
        public double Y;
        public double Z;

        /// <summary>Climbing direction in plan.</summary>
        public Dir4 Dir;
        public double Width;
        public double Run;
        public double Rise;
        public int Steps;
    }

    /// <summary>One curved arm of the split stair in the dome hall.</summary>
    public sealed class StairArm
    {
        /// <summary>Centreline in plan, from the first riser to the gallery. Treads are equal divisions of its length.</summary>
        public List<Vec2> Path = new List<Vec2>();
        public double Width;
        public double Y0;
        public double Rise;
        public int Steps;
    }

    public enum StairKind
    {
        Grand,
        Service,
    }

    public sealed class StairLanding
    {
        public Rect Rect;
        public double Y;
    }

    public sealed class Stair
    {
        public string Id = "";
        public StairKind Kind;
        public int FromLevel;
        public int ToLevel;
        public string BottomRoom = "";
        public string TopRoom = "";
        public Rect Rect;

        /// <summary>Straight flights (service stairs). Empty for the dome hall's curved stair, which uses Arms.</summary>
        public List<StairFlight> Flights = new List<StairFlight>();
        public List<StairLanding> Landings = new List<StairLanding>();
        public List<StairArm>? Arms;
    }

    /// <summary>The door onto a roof terrace: plan position and the room it opens from.</summary>
    public sealed class TerraceDoor
    {
        public double X;
        public double Z;
        public string From = "";
        public string OpeningId = "";
    }

    /// <summary>A flat wing roof used as a terrace, reached by a glazed door from the storey beside it.</summary>
    public sealed class RoofTerrace
    {
        public string RoomId = "";
        public string MassId = "";

        /// <summary>Storey whose floor the deck is level with.</summary>
        public int Level;
        public Rect Rect;

        /// <summary>Deck height.</summary>
        public double Y;
        public TerraceDoor Door = new TerraceDoor();
    }

    /// <summary>Shape of the dome hall: a rectangular room with curved galleries, or a true apse with curved walls.</summary>
    public enum HallShape
    {
        Gallery,
        Rotunda,
    }

    public sealed class AtriumGallery
    {
        public int Level;
        public string RoomId = "";
        public double Y;

        /// <summary>Walkable floor.</summary>
        public List<Vec2> Outline = new List<Vec2>();

        /// <summary>Balustrade runs along the edge.</summary>
        public List<List<Vec2>> Rails = new List<List<Vec2>>();
    }

    /// <summary>
    /// The hall's lantern. Above the eaves the hall's walls continue as a glazed attic up to DeckY, where a glass roof spans the hall;
    /// from it a glazed drum rises to SpringY and carries the glass dome, Height tall. BaseY is the top storey's ceiling line.
    /// </summary>
    public sealed class Dome
    {
        public double X;
        public double Z;
        public double Radius;
        public double BaseY;
        public double DeckY;
        public double SpringY;
        public double Height;
    }

    /// <summary>The dome hall: the ball room open through every storey to a glass dome, with ring galleries on its left, back and right on each upper floor.</summary>
    public sealed class Atrium
    {
        /// <summary>The ball room (ground floor).</summary>
        public string RoomId = "";
        public HallShape Shape;

        /// <summary>Clear interior of the hall's rectangle.</summary>
        public Rect Inner;
        public double GalleryWidth;

        /// <summary>Outline of the open void above the dance floor (closed along the garden wall).</summary>
        public List<Vec2> Void = new List<Vec2>();

        /// <summary>Hall outline at floor level: the rectangle, or the rotunda's curve.</summary>
        public List<Vec2> Footprint = new List<Vec2>();

        /// <summary>Rotunda only: curved wall runs, full height.</summary>
        public List<List<Vec2>> CurvedWalls = new List<List<Vec2>>();
        public List<AtriumGallery> Galleries = new List<AtriumGallery>();

        /// <summary>Columns under the gallery edge, one stack through every storey.</summary>
        public List<Vec2> Columns = new List<Vec2>();
        public double ColumnRadius;
        public string StairId = "";
        public Dome Dome = new Dome();
    }

    public enum ColumnOrder
    {
        Doric,
        Ionic,
        Corinthian,
    }

    public sealed class Portico
    {
        public string Id = "";
        public FacadeSide Side;

        /// <summary>Column centres.</summary>
        public List<Vec2> Columns = new List<Vec2>();
        public double ColumnRadius;
        public double BaseY;
        public double TopY;
        public ColumnOrder Order;

        /// <summary>Roofed area in front of the facade.</summary>
        public Rect Rect;
        public bool Pediment;
    }

    public enum PropKind
    {
        Sofa,
        Armchair,
        Chair,
        CoffeeTable,
        SideTable,
        DiningTable,
        CocktailTable,
        CardTable,
        Console,
        Sideboard,
        Bookcase,
        Desk,
        GrandPiano,
        BarCounter,
        BarShelf,
        BilliardTable,
        Fireplace,
        Statue,
        Bust,
        Painting,
        Mirror,
        Clock,
        Plant,
        Rug,
        Chandelier,
        Sconce,
        Lamp,
        Bed,
        Wardrobe,
        Bench,
        Globe,
        MusicStand,
        Harp,
        Cabinet,
        Safe,
        Urn,
        Lamppost,
        Lantern,
        KitchenIsland,
        Range,
        CinemaScreen,
        WineRack,
        Pool,
        Treadmill,
        Weights,
        Stage,
        Bathtub,
        DanceFloor,
        DiscoFloor,
        DjBooth,
        Speaker,
        MirrorBall,
        Buffet,
    }

    public enum PoiType
    {
        Statue,
        Bookshelf,
        Bar,
        Piano,
        Painting,
        Fireplace,
        Clock,
        Ledger,
        Safe,
        Globe,
        Window,
    }

    public enum PropMount
    {
        Floor,
        Wall,
        Ceiling,
    }

    public sealed class Prop
    {
        public string Id = "";
        public PropKind Kind;

        /// <summary>null = exterior (terrace, garden).</summary>
        public string? RoomId;
        public int Level;

        /// <summary>Base centre (floor contact point; for wall/ceiling mounts the mount point).</summary>
        public double X;
        public double Y;
        public double Z;

        /// <summary>Rotation about +y (radians). Local +z is the prop's front.</summary>
        public double Yaw;
        public double W;
        public double D;
        public double H;
        public int Variant;
        public string? Color;
        public PropMount Mount;
        public bool BlocksNav;

        /// <summary>Tall/solid enough to block a sightline.</summary>
        public bool Occludes;
        public PoiType? Poi;
    }

    /// <summary>Where an NPC stands to interact, and which way it faces.</summary>
    public sealed class Stand
    {
        public double X;
        public double Z;
        public double Yaw;
    }

    public sealed class Poi
    {
        public string Id = "";
        public PoiType Type;
        public string? PropId;
        public string? RoomId;
        public int Level;
        public double X;
        public double Y;
        public double Z;
        public Stand Stand = new Stand();

        /// <summary>Fraction (0..1) of a person at Stand visible from the perch.</summary>
        public double Visibility;

        public Poi Clone() => (Poi)MemberwiseClone();
    }

    public enum LightKind
    {
        Chandelier,
        Sconce,
        Lamp,
        Candles,
        Fire,
        Lantern,
        Lamppost,
        Uplight,
        Spill,
        Bounce,
    }

    public sealed class LightSpec
    {
        public string Id = "";
        public LightKind Kind;

        /// <summary>Lighting scope: a room id, or "exterior". Lights never leak across scopes.</summary>
        public string Scope = "";
        public double X;
        public double Y;
        public double Z;

        /// <summary>Linear RGB, roughly unit luminance.</summary>
        public double[] Color = new double[3];

        /// <summary>Luminous intensity, candela.</summary>
        public double Intensity;

        /// <summary>Soft cutoff distance (m).</summary>
        public double Range;

        /// <summary>Spot lights only: unit aim direction and cosine of the cone half-angle.</summary>
        public double[]? Dir;
        public double? Cone;
    }

    public enum TreeKind
    {
        Oak,
        Beech,
        Cedar,
        Cypress,
        Yew,
        Poplar,
    }

    public sealed class Tree
    {
        public double X;
        public double Z;

        /// <summary>Ground elevation at the trunk.</summary>
        public double Y;
        public double Height;
        public double Crown;
        public TreeKind Kind;
    }

    public sealed class Balustrade
    {
        public Vec2 A;
        public Vec2 B;
        public double Height;
    }

    public sealed class TerraceSteps
    {
        public Rect Rect;
        public Dir4 Dir;
        public double Y0;
        public double Y1;
        public int Count;
    }

    public sealed class Terrace
    {
        public Rect Rect;
        public double Y;

        /// <summary>Balustrade runs (centreline) with their top height above the terrace.</summary>
        public List<Balustrade> Balustrades = new List<Balustrade>();
        public List<TerraceSteps> Steps = new List<TerraceSteps>();
    }

    public sealed class BearingOption
    {
        public double AzimuthDeg;
        public double PartyVisible;
    }

    public sealed class ElevationOption
    {
        public double ElevationDeg;
        public double PartyVisible;
    }

    public sealed class Perch
    {
        /// <summary>Sniper eye position (prone in the treeline).</summary>
        public Vec3 Eye;

        /// <summary>Default aim point (garden facade centre).</summary>
        public Vec3 Target;
        public double Distance;
        public double AzimuthDeg;
        public double FovMinDeg;
        public double FovMaxDeg;

        /// <summary>Bearings the sniper may choose before the mission (deg off the garden axis).</summary>
        public double[] ArcDeg = new double[2];

        /// <summary>Indoor party visibility sampled along the arc, for the briefing.</summary>
        public List<BearingOption> Options = new List<BearingOption>();

        /// <summary>Elevation above the horizon (deg). 0 = prone in the treeline; higher is an aerial vantage at the same range.</summary>
        public double ElevationDeg;
        public double[] ElevationRangeDeg = new double[2];

        /// <summary>Indoor party visibility sampled up the elevation range (at the generated bearing), for the briefing.</summary>
        public List<ElevationOption> ElevationOptions = new List<ElevationOption>();

        public Perch Clone() => (Perch)MemberwiseClone();
    }

    public sealed class SkySpec
    {
        /// <summary>Sun azimuth (deg, 0 = +z, 90 = +x) and elevation (negative = below horizon).</summary>
        public double SunAzimuthDeg;
        public double SunElevationDeg;
        public double MoonAzimuthDeg;
        public double MoonElevationDeg;

        /// <summary>0 = clear, 1 = overcast.</summary>
        public double Cloudiness;
    }

    public sealed class Ridge
    {
        public double Cz;
        public double Radius;
        public double HalfAngle;
    }

    public sealed class TerrainSpec
    {
        /// <summary>Lawn plateau half-extent around the house where the ground is flat.</summary>
        public double FlatRadius;

        /// <summary>Height of the wooded rise the perch sits on.</summary>
        public double PerchRise;

        /// <summary>Plan position of the rise crest behind the default perch.</summary>
        public Vec2 Crest;

        /// <summary>The rise is a ridge along the perch arc: centre z on the garden axis, radius, and half-angle (rad).</summary>
        public Ridge Ridge = new Ridge();
        public double Undulation;
        public int Seed;
    }

    public enum PathKind
    {
        Gravel,
        Flagstone,
    }

    public sealed class SitePath
    {
        public Rect Rect;
        public PathKind Kind;
    }

    public sealed class Fountain
    {
        public double X;
        public double Z;
        public double Radius;
        public int Tiers;
    }

    public enum ParterrePattern
    {
        Cross,
        Diamond,
        Ring,
        Quarters,
    }

    public sealed class Parterre
    {
        public Rect Rect;
        public ParterrePattern Pattern;
    }

    public enum TopiaryShape
    {
        Cone,
        Ball,
        Spiral,
    }

    public sealed class Topiary
    {
        public double X;
        public double Z;
        public double Height;
        public double Radius;
        public TopiaryShape Shape;
    }

    public sealed class Site
    {
        public Terrace Terrace = new Terrace();
        public Rect Lawn;
        public List<SitePath> Paths = new List<SitePath>();
        public Fountain? Fountain;
        public List<Parterre> Parterres = new List<Parterre>();
        public List<Topiary> Topiary = new List<Topiary>();
        public List<Tree> Trees = new List<Tree>();
        public TerrainSpec Terrain = new TerrainSpec();
        public Perch Perch = new Perch();
        public SkySpec Sky = new SkySpec();

        public Site Clone() => (Site)MemberwiseClone();
    }

    public sealed class NavLevel
    {
        public int Level;
        public double Y;
        public double OriginX;
        public double OriginZ;
        public double Cell;
        public int Cols;
        public int Rows;

        /// <summary>1 = walkable. Row-major, index = row * cols + col (row along z).</summary>
        public byte[] Walk = System.Array.Empty<byte>();

        /// <summary>Room index per cell; -1 outside, -2 terrace.</summary>
        public short[] Room = System.Array.Empty<short>();

        /// <summary>Visibility from the perch, 0..255 (person standing in the cell).</summary>
        public byte[] Vis = System.Array.Empty<byte>();

        public NavLevel Clone() => (NavLevel)MemberwiseClone();
    }

    public enum NavLinkKind
    {
        Door,
        FrenchWindow,
        Stair,
    }

    public sealed class NavLink
    {
        public NavLinkKind Kind;
        public string From = "";
        public string To = "";

        /// <summary>Opening or stair id.</summary>
        public string Via = "";
        public double X;
        public double Z;
        public int Level;
    }

    public sealed class Nav
    {
        public List<NavLevel> Levels = new List<NavLevel>();
        public List<NavLink> Links = new List<NavLink>();
    }

    public sealed class Sightlines
    {
        public Vec3 Eye;

        /// <summary>Mean visibility per room id (0..1), person-height samples.</summary>
        public OrderedMap<string, double> Rooms = new OrderedMap<string, double>();
        public double Terrace;

        /// <summary>Share of indoor party floor (party rooms on any storey) visible from the perch. Terraces are reported separately.</summary>
        public double PartyVisible;

        /// <summary>Share of the floor guests use (party rooms, ground-floor halls and corridors) that the sniper cannot see at all: the spy's cover.</summary>
        public double HiddenShare;
    }

    public enum Severity
    {
        Error,
        Warn,
    }

    public sealed class ValidationIssue
    {
        public string Code = "";
        public Severity Severity;
        public string Message = "";
        public string? Ref;
    }

    public sealed class ValidationReport
    {
        public bool Ok;
        public List<ValidationIssue> Issues = new List<ValidationIssue>();
        public OrderedMap<string, double> Metrics = new OrderedMap<string, double>();
    }

    /// <summary>A mission object that must exist: at least Min of them, Visible of those visible from the perch.</summary>
    public sealed class PoiNeed
    {
        public int Min;
        public int Visible;

        public PoiNeed(int min, int visible)
        {
            Min = min;
            Visible = visible;
        }
    }

    public sealed class MansionOptions
    {
        public string Seed = "";
        public MansionSize? Size;
        public StyleId? Style;
        public MassingType? Massing;

        /// <summary>Override perch distance (m) and azimuth off the garden axis (deg).</summary>
        public double? PerchDistance;
        public double? PerchAzimuthDeg;

        /// <summary>Elevation of the perch above the horizon (deg, 0-60). Default 0: on the ground in the treeline.</summary>
        public double? PerchElevationDeg;

        /// <summary>Shorthand for the lower bound of PartyVisibility (0..1): houses that show the sniper less are regenerated.</summary>
        public double? MinVisible;

        /// <summary>Mission objects that must exist, with minimum counts and how many must be visible.</summary>
        public OrderedMap<PoiType, PoiNeed>? RequiredPois;

        /// <summary>Acceptable share of indoor party floor visible from the perch, [lo, hi].</summary>
        public double[]? PartyVisibility;
        public int? MaxAttempts;

        /// <summary>Nav/visibility grid resolution (m).</summary>
        public double? NavCell;

        /// <summary>Dome hall shape. Default gallery.</summary>
        public HallShape? Hall;

        public MansionOptions() { }

        public MansionOptions(string seed) => Seed = seed;
    }

    /// <summary>Options with every default filled in, as stored on the blueprint.</summary>
    public sealed class ResolvedOptions
    {
        public string Seed = "";
        public MansionSize Size;
        public StyleId? Style;
        public MassingType? Massing;
        public double? PerchDistance;
        public double? PerchAzimuthDeg;
        public double? PerchElevationDeg;
        public OrderedMap<PoiType, PoiNeed> RequiredPois = new OrderedMap<PoiType, PoiNeed>();
        public double[] PartyVisibility = new double[2];
        public int MaxAttempts;
        public double NavCell;
        public HallShape Hall;
    }

    public enum WallMaterial
    {
        Limestone,
        Brick,
        Stucco,
    }

    public enum BaseMaterial
    {
        Rusticated,
        Limestone,
        Brick,
    }

    public enum RoofMaterial
    {
        Slate,
        Zinc,
        Lead,
    }

    public sealed class StyleDef
    {
        public StyleId Id;
        public string Name = "";
        public WallMaterial WallMaterial;
        public string WallColor = "";
        public string TrimColor = "";
        public BaseMaterial BaseMaterial;

        /// <summary>Main roof: hipped, mansard or flat.</summary>
        public RoofKind Roof;
        public RoofMaterial RoofMaterial;

        /// <summary>A flat leaded main roof with a glass lantern over every top-storey room, and all-glass roofs on the wings.</summary>
        public bool? GlassRoofs;

        /// <summary>Garden-front windows stacked into giant arched windows through every storey, between a giant order of pilasters.</summary>
        public bool? GiantWindows;
        public double[] RoofPitchDeg = new double[2];
        public double[] BayWidth = new double[2];

        /// <summary>[lo, hi] storey height for the ground floor, the first floor, and the floors above.</summary>
        public double[][] LevelHeights = new double[3][];
        public int[] Floors = new int[2];
        public double[] Plinth = new double[2];
        public double PorticoChance;
        public double PavilionChance;
        public bool Quoins;
        public bool BalustradeParapet;
        public bool PedimentedWindows;
        public bool Balconettes;
        public string WindowFrameColor = "";
        public string DoorColor = "";
        public ColumnOrder ColumnOrder;

        /// <summary>Weight of each massing type, in the TypeScript's order (block, u-garden, u-entrance, h).</summary>
        public OrderedMap<MassingType, double> MassingWeights = new OrderedMap<MassingType, double>();
    }

    public sealed class BlueprintStats
    {
        public int Rooms;
        public int PartyRooms;
        public double PartyArea;
        public int Walls;
        public int Openings;
        public int Props;
        public int Lights;
        public Rect Footprint;

        /// <summary>Wall-clock time of generation, filled in by the caller that timed it (the sim never reads the clock).</summary>
        public double GenerationMs;
    }

    public sealed class MansionBlueprint
    {
        public const string SchemaId = "scope-and-drop/mansion@2";

        public string Schema = SchemaId;
        public string Seed = "";

        /// <summary>Generation attempt that passed validation (0 = first try).</summary>
        public int Attempt;
        public ResolvedOptions Options = new ResolvedOptions();
        public StyleDef Style = new StyleDef();
        public MassingType Massing;
        public double Bay;
        public int Bays;
        public List<LevelSpec> Levels = new List<LevelSpec>();

        /// <summary>Ground floor finished level above the lawn.</summary>
        public double GroundFloorY;
        public List<Mass> Masses = new List<Mass>();
        public List<Room> Rooms = new List<Room>();
        public List<Wall> Walls = new List<Wall>();
        public List<Stair> Stairs = new List<Stair>();
        public Atrium? Atrium;

        /// <summary>Flat roofs of lower wings that guests can walk out onto.</summary>
        public List<RoofTerrace> RoofTerraces = new List<RoofTerrace>();
        public List<Portico> Porticos = new List<Portico>();
        public List<Prop> Props = new List<Prop>();
        public List<Poi> Pois = new List<Poi>();
        public List<LightSpec> Lights = new List<LightSpec>();
        public Site Site = new Site();
        public Nav Nav = new Nav();
        public Sightlines Sightlines = new Sightlines();
        public ValidationReport Validation = new ValidationReport();
        public BlueprintStats Stats = new BlueprintStats();

        public MansionBlueprint ShallowCopy() => (MansionBlueprint)MemberwiseClone();
    }
}
