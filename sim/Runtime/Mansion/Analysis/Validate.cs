// Validity rules. A mansion is accepted only if it is a sound building AND a
// fair level: the sniper can watch enough of the party (but not all of it),
// mission objects exist and are reachable, and every room can be walked to.
using System;
using System.Collections.Generic;
using ScopeAndDrop.Sim.Core;

namespace ScopeAndDrop.Sim.Mansion
{
    public sealed class ValidateExtras
    {
        public List<string> Unreachable = new List<string>();
        public List<string> PassViolations = new List<string>();
        public List<string> MissingStairs = new List<string>();
    }

    public static class Validation
    {
        /// <summary>The default mission objects: at least min of each, at least visible of them watchable from the perch.</summary>
        public static OrderedMap<PoiType, PoiNeed> DefaultRequiredPois() =>
            new OrderedMap<PoiType, PoiNeed>
            {
                [PoiType.Statue] = new PoiNeed(3, 1),
                [PoiType.Bookshelf] = new PoiNeed(1, 0),
                [PoiType.Bar] = new PoiNeed(1, 1),
                [PoiType.Painting] = new PoiNeed(6, 2),
                [PoiType.Piano] = new PoiNeed(1, 0),
                [PoiType.Fireplace] = new PoiNeed(1, 0),
                [PoiType.Ledger] = new PoiNeed(1, 0),
            };

        /// <summary>Rooms no house is without (and at least two bathrooms, and a globe in the study).</summary>
        public static readonly RoomType[] RequiredRooms =
        {
            RoomType.Ballroom,
            RoomType.EntranceHall,
            RoomType.GreatRoom,
            RoomType.DiningRoom,
            RoomType.Kitchen,
            RoomType.Library,
            RoomType.Bar,
            RoomType.DrawingRoom,
            RoomType.Study,
        };

        /// <summary>At least this share of the guests' ground floor must be out of the sniper's sight.</summary>
        public const double MinHidden = 0.15;

        /// <summary>A POI counts as visible from the perch above this person-visibility.</summary>
        public const double PoiVisible = 0.35;

        /// <summary>Checks a blueprint whose Validation and Stats are not yet filled in.</summary>
        public static ValidationReport Validate(MansionBlueprint bp, ValidateExtras extras)
        {
            var issues = new List<ValidationIssue>();
            void Err(string code, string message, string? r = null) =>
                issues.Add(
                    new ValidationIssue
                    {
                        Code = code,
                        Severity = Severity.Error,
                        Message = message,
                        Ref = r,
                    }
                );
            void Warn(string code, string message, string? r = null) =>
                issues.Add(
                    new ValidationIssue
                    {
                        Code = code,
                        Severity = Severity.Warn,
                        Message = message,
                        Ref = r,
                    }
                );
            var metrics = new OrderedMap<string, double>();
            OrderedMap<string, double> sightRooms = bp.Sightlines.Rooms;

            // Geometry: rooms within a storey never overlap and are large enough.
            foreach (LevelSpec lv in bp.Levels)
            {
                List<Room> rs = bp.Rooms.FindAll(r => r.Level == lv.Index || (r.DoubleHeight && r.Level == lv.Index - 1));
                for (int i = 0; i < rs.Count; i++)
                {
                    for (int j = i + 1; j < rs.Count; j++)
                    {
                        if (Geom.Overlaps(rs[i].Rect, rs[j].Rect, 0.01))
                            Err("room-overlap", rs[i].Id + " overlaps " + rs[j].Id, rs[i].Id);
                    }
                }
            }
            foreach (Room r in bp.Rooms)
            {
                double w = r.Inner.X1 - r.Inner.X0;
                double d = r.Inner.Z1 - r.Inner.Z0;
                double min =
                    r.Type == RoomType.Corridor ? 1.6
                    : r.Role == RoomRole.Party ? 3.0
                    : 2.0;
                if (Math.Min(w, d) < min)
                    Err("room-too-small", r.Label + " (" + r.Id + ") is " + Num.ToFixed(w, 1) + "×" + Num.ToFixed(d, 1) + " m", r.Id);
            }

            // Circulation.
            foreach (string id in extras.Unreachable)
                Err("unreachable", "Room " + id + " has no route from the stairs/entrance", id);
            foreach (string id in extras.PassViolations)
                Warn("pass-through", "Room " + id + " is only reachable through a private room", id);
            foreach (string s in extras.MissingStairs)
                Err("stair-fit", "No stair fits: " + s, s);
            bool hasGrand = bp.Stairs.Exists(s => s.Kind == StairKind.Grand);
            if (bp.Levels.Count > 1 && !hasGrand)
                Err("no-grand-stair", "Grand stair missing");

            // Windows: habitable rooms on a façade need daylight.
            foreach (Room r in bp.Rooms)
            {
                // Internal dressing rooms and bathrooms behind a wing roof are fine; party rooms are not.
                if (r.Role != RoomRole.Party)
                    continue;
                bool glazed = bp.Walls.Exists(w => w.Exterior && (w.Neg == r.Id || w.Pos == r.Id) && w.Openings.Exists(o => o.Glazed));
                bool onFacade = bp.Walls.Exists(w => w.Exterior && (w.Neg == r.Id || w.Pos == r.Id));
                if (onFacade && !glazed)
                    Warn("no-window", r.Label + " (" + r.Id + ") has façade but no window", r.Id);
            }

            // Sightlines: watchable, but not a fishbowl.
            double lo = bp.Options.PartyVisibility[0];
            double hi = bp.Options.PartyVisibility[1];
            Sightlines sl = bp.Sightlines;
            metrics["partyVisible"] = Round(sl.PartyVisible);
            metrics["terraceVisible"] = Round(sl.Terrace);
            if (sl.PartyVisible < lo)
                Err("too-hidden", "Only " + Num.ToFixed(sl.PartyVisible * 100, 0) + "% of the party is visible (min " + Num.ToText(lo * 100) + "%)");
            if (sl.PartyVisible > hi)
                Err("too-exposed", Num.ToFixed(sl.PartyVisible * 100, 0) + "% of the party is visible (max " + Num.ToText(hi * 100) + "%)");
            List<Room> stageRooms = bp.Rooms.FindAll(r => r.Level == 0 && r.Role == RoomRole.Party && r.Stage);
            int watchable = 0;
            foreach (Room r in stageRooms)
            {
                if (sightRooms.GetValueOrDefault(r.Id, 0) >= 0.2)
                    watchable++;
            }
            metrics["watchableStageRooms"] = watchable;
            if (watchable < Math.Min(2, stageRooms.Count))
                Err("stage-blind", "Only " + Num.ToText(watchable) + " garden-front party rooms can be watched");
            int hidden = 0;
            foreach (Room r in bp.Rooms)
            {
                if (r.Level == 0 && (r.Role == RoomRole.Party || r.Role == RoomRole.Circulation) && sightRooms.GetValueOrDefault(r.Id, 0) < 0.05)
                    hidden++;
            }
            metrics["blindSpots"] = hidden;
            // The cap on openness: the spy must always have somewhere to go that the sniper cannot watch.
            metrics["hiddenShare"] = Round(sl.HiddenShare);
            if (sl.HiddenShare < MinHidden)
                Err("no-blind-spots", "Only " + Num.ToFixed(sl.HiddenShare * 100, 0) + "% of the ground floor is out of sight: the spy has nowhere to hide");
            // Fairness along the arc: no bearing the sniper may choose should be hopeless.
            double worst = double.PositiveInfinity;
            foreach (BearingOption o in bp.Site.Perch.Options)
                worst = Math.Min(worst, o.PartyVisible);
            if (double.IsFinite(worst))
            {
                metrics["worstBearingVisible"] = Round(worst);
                if (worst < lo * 0.6)
                    Warn("weak-bearing", "One bearing on the perch arc sees only " + Num.ToFixed(worst * 100, 0) + "% of the party");
            }

            // Mission objects.
            foreach (KeyValuePair<PoiType, PoiNeed> entry in bp.Options.RequiredPois)
            {
                string type = entry.Key.Text();
                PoiNeed need = entry.Value;
                int all = 0;
                int vis = 0;
                foreach (Poi p in bp.Pois)
                {
                    if (p.Type != entry.Key)
                        continue;
                    all++;
                    if (p.Visibility >= PoiVisible)
                        vis++;
                }
                metrics["poi." + type] = all;
                metrics["poi." + type + ".visible"] = vis;
                if (all < need.Min)
                    Err("poi-missing", "Need ≥" + Num.ToText(need.Min) + " " + type + ", have " + Num.ToText(all), type);
                else if (vis < need.Visible)
                    Err("poi-hidden", "Need ≥" + Num.ToText(need.Visible) + " visible " + type + ", have " + Num.ToText(vis), type);
            }

            // Navigation: one connected walkable component per storey contains all POI stand points and doors.
            foreach (NavLevel n in bp.Nav.Levels)
            {
                int[] comp = NavGrid.Components(n);
                var sizes = new OrderedMap<int, int>();
                foreach (int c in comp)
                {
                    if (c >= 0)
                        sizes[c] = sizes.GetValueOrDefault(c, 0) + 1;
                }
                int main = -1;
                int best = -1;
                foreach (KeyValuePair<int, int> e in sizes)
                {
                    if (e.Value > best)
                    {
                        best = e.Value;
                        main = e.Key;
                    }
                }
                foreach (Poi p in bp.Pois)
                {
                    if (p.Level != n.Level)
                        continue;
                    int k = NavGrid.CellAt(n, p.Stand.X, p.Stand.Z);
                    if (k < 0 || comp[k] != main)
                    {
                        // Snap within one cell before declaring it stranded.
                        bool near = false;
                        for (int a = -1; a <= 1 && !near; a++)
                        {
                            for (int b = -1; b <= 1 && !near; b++)
                            {
                                int q = NavGrid.CellAt(n, p.Stand.X + a * n.Cell, p.Stand.Z + b * n.Cell);
                                near = q >= 0 && comp[q] == main;
                            }
                        }
                        if (!near)
                            Err("poi-stranded", "POI " + p.Id + " (" + p.Type.Text() + ") stand point not on the main walkable area", p.Id);
                    }
                }
                foreach (Room r in bp.Rooms)
                {
                    if (r.Level != n.Level)
                        continue;
                    int cells = 0;
                    int inMain = 0;
                    for (int k = 0; k < n.Room.Length; k++)
                    {
                        if (n.Room[k] == r.Index && n.Walk[k] != 0)
                        {
                            cells++;
                            if (comp[k] == main)
                                inMain++;
                        }
                    }
                    if (cells == 0 && r.Type != RoomType.ServiceStair)
                        Err("room-unwalkable", r.Label + " (" + r.Id + ") has no walkable floor", r.Id);
                    else if (cells > 0 && inMain == 0)
                        Err("room-cut-off", r.Label + " (" + r.Id + ") is cut off from the storey", r.Id);
                }
                metrics["nav.L" + Num.ToText(n.Level) + ".components"] = sizes.Count;
            }

            // The rooms every house has.
            foreach (RoomType t in RequiredRooms)
            {
                if (!bp.Rooms.Exists(r => r.Type == t))
                    Err("missing-room", "No " + ReplaceFirst(t.Text(), "-", " "));
            }
            int baths = bp.Rooms.FindAll(r => r.Type == RoomType.Bathroom).Count;
            metrics["bathrooms"] = baths;
            if (baths < 2)
                Err("missing-room", "Only " + Num.ToText(baths) + " bathroom" + (baths == 1 ? "" : "s") + " (min 2)");
            bool studyGlobe = bp.Pois.Exists(p => p.Type == PoiType.Globe && bp.Rooms.Find(r => r.Id == p.RoomId)?.Type == RoomType.Study);
            if (!studyGlobe)
                Err("missing-room", "The study has no globe");

            // Party capacity.
            double partyArea = 0;
            foreach (Room r in bp.Rooms)
            {
                if (r.Role == RoomRole.Party && r.Type != RoomType.RoofTerrace)
                    partyArea += (r.Inner.X1 - r.Inner.X0) * (r.Inner.Z1 - r.Inner.Z0);
            }
            metrics["partyArea"] = Round(partyArea);
            if (partyArea < 180)
                Err("party-too-small", "Party floor only " + Num.ToFixed(partyArea, 0) + " m²");

            return new ValidationReport
            {
                Ok = !issues.Exists(i => i.Severity == Severity.Error),
                Issues = issues,
                Metrics = metrics,
            };
        }

        /// <summary>The TypeScript's string replace with a string pattern: the first match only.</summary>
        static string ReplaceFirst(string s, string find, string with)
        {
            int i = s.IndexOf(find, StringComparison.Ordinal);
            return i < 0 ? s : s.Substring(0, i) + with + s.Substring(i + find.Length);
        }

        static double Round(double v) => Num.Round(v * 1000) / 1000;
    }
}
