// Collect sightline occluders from the blueprint parts.
using System;
using System.Collections.Generic;
using ScopeAndDrop.Sim.Core;

namespace ScopeAndDrop.Sim.Mansion
{
    public sealed class OccluderInput
    {
        public List<Wall> Walls = new List<Wall>();
        public List<Room> Rooms = new List<Room>();
        public List<LevelSpec> Levels = new List<LevelSpec>();
        public List<Mass> Masses = new List<Mass>();
        public List<Portico> Porticos = new List<Portico>();
        public List<Prop> Props = new List<Prop>();
        public Site? Site;

        /// <summary>Dome hall: its gallery columns stand in the sniper's way.</summary>
        public Atrium? Atrium;

        /// <summary>Stairs with curved arms (the dome hall's) hide whoever stands behind them.</summary>
        public List<Stair>? Stairs;

        /// <summary>Roof terraces: their parapets hide the legs of whoever stands on them.</summary>
        public List<RoofTerrace>? RoofTerraces;

        /// <summary>Include furniture (second pass) or only architecture (first pass).</summary>
        public bool WithProps;
    }

    public static class Occluders
    {
        /// <summary>The hall's attic above the eaves: a stone sill, then arched lights between piers (about two thirds glass).</summary>
        const double AtticSill = 0.55;
        const double AtticTransmit = 0.6;

        /// <summary>A glass roof with its rafters and glazing bars.</summary>
        const double RoofGlassTransmit = 0.75;

        static double? PropTransmit(PropKind kind) =>
            kind switch
            {
                PropKind.Statue => 0.4,
                PropKind.Bust => 0.6,
                PropKind.Plant => 0.5,
                PropKind.Harp => 0.6,
                PropKind.Bookcase => 0,
                PropKind.Wardrobe => 0,
                PropKind.Cabinet => 0,
                PropKind.BarShelf => 0,
                PropKind.Clock => 0.3,
                _ => null,
            };

        public static double RoofRise(Mass m)
        {
            double span = Math.Min(m.Rect.X1 - m.Rect.X0, m.Rect.Z1 - m.Rect.Z0);
            switch (m.Roof.Kind)
            {
                case RoofKind.Flat:
                    return 1.1;
                case RoofKind.Glass:
                    return Math.Min(2.4, span * 0.25);
                case RoofKind.Mansard:
                    return Math.Min(4.6, span * 0.35);
                default:
                    return Math.Min(Roofs.HipMaxRise + 0.4, Math.Min(span / 2, 9) * Math.Tan(m.Roof.PitchDeg * Math.PI / 180));
            }
        }

        public static OccluderSet Collect(OccluderInput input)
        {
            var walls = new List<WallOccluder>();
            foreach (Wall w in input.Walls)
            {
                var holes = new WallHole[w.Openings.Count];
                for (int i = 0; i < holes.Length; i++)
                {
                    Opening o = w.Openings[i];
                    double transmit;
                    if (!o.Glazed)
                        transmit = w.Exterior && o.Kind == OpeningKind.Entrance ? 0 : 1;
                    else if (o.Frosted == true)
                        transmit = 0;
                    else if (o.Curtain == Curtain.Drawn)
                        transmit = 0;
                    else if (o.Curtain == Curtain.Sheer)
                        transmit = 0.45;
                    else
                        transmit = 0.92;
                    double b = w.Axis == Axis.X ? w.A.X : w.A.Z;
                    holes[i] = new WallHole(b + o.U0, b + o.U1, o.Y0, o.Y1, transmit);
                }
                walls.Add(
                    new WallOccluder
                    {
                        Axis = w.Axis,
                        Line = w.Axis == Axis.X ? w.A.Z : w.A.X,
                        T0 = w.Axis == Axis.X ? w.A.X : w.A.Z,
                        T1 = w.Axis == Axis.X ? w.B.X : w.B.Z,
                        // Exterior walls continue down to the ground as the plinth.
                        Y0 = w.Exterior && w.Level == 0 ? 0 : w.Y0,
                        Y1 = w.Y1,
                        Holes = holes,
                    }
                );
            }

            var boxes = new List<BoxOccluder>();
            var cyls = new List<CylOccluder>();
            // Roofs. The dome hall is roofed in glass from wall to wall: the roof is open over it, edged by
            // a low curb, so a sniper high enough sees down into the hall.
            Dome? dome = input.Atrium?.Dome;
            Rect? hole = input.Atrium?.Inner;
            foreach (Mass m in input.Masses)
            {
                double rise = RoofRise(m);
                var r = new Rect(m.Rect.X0 - 0.3, m.Rect.Z0 - 0.3, m.Rect.X1 + 0.3, m.Rect.Z1 + 0.3);
                double y0 = m.Roof.EaveY - 0.05;
                double y1 = m.Roof.EaveY + rise * 0.55;
                double transmit = m.Roof.Kind == RoofKind.Glass ? 0.8 : 0;
                // Open over the dome hall; glass over each skylight (a roof lantern's well, or a whole room under an all-glass roof).
                var skylights = new List<Rect>();
                foreach (Room q in input.Rooms)
                {
                    if (q.Skylight != null && q.MassId == m.Id && q.Level == m.Levels - 1)
                        skylights.Add(q.Skylight.Value);
                }
                var cut = new List<Rect>(skylights.Count + 1);
                if (hole != null)
                    cut.Add(hole.Value);
                cut.AddRange(skylights);
                foreach (Rect p in Geom.RectMinus(r, cut))
                    boxes.Add(new BoxOccluder(p, y0, y1, transmit));
                foreach (Rect sk in skylights)
                    boxes.Add(new BoxOccluder(sk, y0, y0 + 0.1, RoofGlassTransmit));
            }
            if (dome != null && hole != null)
            {
                Rect h = hole.Value;
                Mass? main = input.Masses.Find(m => m.Kind == MassKind.Main);
                double baseY = (main != null ? main.Roof.EaveY : dome.BaseY) - 0.05;
                const double t = 0.4;
                // The glazed attic round the hall, then the glass roof on it (the drum and dome above are glass too).
                Rect[] sides =
                {
                    new Rect(h.X0 - t, h.Z0 - t, h.X1 + t, h.Z0),
                    new Rect(h.X0 - t, h.Z1, h.X1 + t, h.Z1 + t),
                    new Rect(h.X0 - t, h.Z0, h.X0, h.Z1),
                    new Rect(h.X1, h.Z0, h.X1 + t, h.Z1),
                };
                foreach (Rect b in sides)
                {
                    boxes.Add(new BoxOccluder(b, baseY, baseY + AtticSill, 0));
                    boxes.Add(new BoxOccluder(b, baseY + AtticSill, dome.DeckY - 0.4, AtticTransmit));
                    boxes.Add(new BoxOccluder(b, dome.DeckY - 0.4, dome.DeckY, 0));
                }
                boxes.Add(new BoxOccluder(h, dome.DeckY, dome.DeckY + 0.1, 0.85));
            }
            foreach (Portico p in input.Porticos)
            {
                foreach (Vec2 c in p.Columns)
                    cyls.Add(new CylOccluder(c.X, c.Z, p.ColumnRadius, p.BaseY, p.TopY, 0));
                boxes.Add(new BoxOccluder(p.Rect, p.TopY - 0.9, p.TopY + 0.4, 0));
            }
            if (input.Atrium != null)
            {
                Atrium a = input.Atrium;
                LevelSpec top = input.Levels[input.Levels.Count - 1];
                // Columns carry the galleries; none stands on the top one.
                foreach (Vec2 c in a.Columns)
                    cyls.Add(new CylOccluder(c.X, c.Z, a.ColumnRadius, input.Levels[0].FloorY, top.FloorY, 0));
            }
            if (input.RoofTerraces != null)
            {
                foreach (RoofTerrace t in input.RoofTerraces)
                {
                    (Axis axis, double line, double t0, double t1)[] edges =
                    {
                        (Axis.X, t.Rect.Z0, t.Rect.X0, t.Rect.X1),
                        (Axis.X, t.Rect.Z1, t.Rect.X0, t.Rect.X1),
                        (Axis.Z, t.Rect.X0, t.Rect.Z0, t.Rect.Z1),
                        (Axis.Z, t.Rect.X1, t.Rect.Z0, t.Rect.Z1),
                    };
                    foreach (var (axis, line, t0, t1) in edges)
                    {
                        walls.Add(
                            new WallOccluder
                            {
                                Axis = axis,
                                Line = line,
                                T0 = t0,
                                T1 = t1,
                                Y0 = t.Y - 0.5,
                                Y1 = t.Y + 1.1,
                                Holes = new[] { new WallHole(-1e9, 1e9, t.Y + 0.4, t.Y + 0.96, 0.5) },
                            }
                        );
                    }
                }
            }
            if (input.Stairs != null)
            {
                foreach (Stair st in input.Stairs)
                {
                    if (st.Arms == null)
                        continue;
                    foreach (StairArm arm in st.Arms)
                        ArmBoxes(arm, boxes);
                }
            }
            if (input.WithProps)
            {
                foreach (Prop p in input.Props)
                {
                    if (!p.Occludes || p.Mount != PropMount.Floor)
                        continue;
                    int q = Num.ToInt32(Num.Round(p.Yaw / (Math.PI / 2))) & 1;
                    double hw = (q != 0 ? p.D : p.W) / 2;
                    double hd = (q != 0 ? p.W : p.D) / 2;
                    double transmit = PropTransmit(p.Kind) ?? 0.2;
                    if (p.Kind == PropKind.Statue || p.Kind == PropKind.Bust || p.Kind == PropKind.Plant)
                        cyls.Add(new CylOccluder(p.X, p.Z, Math.Min(hw, hd) * 0.8, p.Y, p.Y + p.H, transmit));
                    else
                        boxes.Add(new BoxOccluder(new Rect(p.X - hw, p.Z - hd, p.X + hw, p.Z + hd), p.Y, p.Y + p.H, transmit));
                }
            }

            Site? site = input.Site;
            if (site != null)
            {
                double ty = site.Terrace.Y;
                foreach (Balustrade b in site.Terrace.Balustrades)
                {
                    Axis axis = Math.Abs(b.A.Z - b.B.Z) < 1e-6 ? Axis.X : Axis.Z;
                    walls.Add(
                        new WallOccluder
                        {
                            Axis = axis,
                            Line = axis == Axis.X ? b.A.Z : b.A.X,
                            T0 = axis == Axis.X ? Math.Min(b.A.X, b.B.X) : Math.Min(b.A.Z, b.B.Z),
                            T1 = axis == Axis.X ? Math.Max(b.A.X, b.B.X) : Math.Max(b.A.Z, b.B.Z),
                            Y0 = 0,
                            Y1 = ty + b.Height,
                            // Balusters: the lower part is solid (terrace wall), the railing zone is half see-through.
                            Holes = new[] { new WallHole(-1e9, 1e9, ty + 0.18, ty + b.Height - 0.14, 0.5) },
                        }
                    );
                }
                foreach (Tree t in site.Trees)
                {
                    double trunkTop = t.Y + t.Height * (t.Kind == TreeKind.Cypress || t.Kind == TreeKind.Poplar ? 0.15 : 0.35);
                    cyls.Add(new CylOccluder(t.X, t.Z, Math.Max(0.25, t.Height / 50), t.Y, trunkTop, 0));
                    cyls.Add(new CylOccluder(t.X, t.Z, t.Crown, trunkTop, t.Y + t.Height, 0.15));
                }
                foreach (Topiary t in site.Topiary)
                    cyls.Add(new CylOccluder(t.X, t.Z, t.Radius, 0, t.Height, 0.3));
                if (site.Fountain != null)
                    cyls.Add(new CylOccluder(site.Fountain.X, site.Fountain.Z, 0.7, 0, 1.6 + site.Fountain.Tiers * 0.8, 0.2));
            }

            // Floor slabs at each storey above the ground.
            var slabs = new List<SlabOccluder>();
            foreach (LevelSpec lv in input.Levels)
            {
                if (lv.Index == 0)
                    continue;
                var slab = new SlabOccluder { Y = lv.FloorY - 0.2 };
                foreach (Room r in input.Rooms)
                {
                    if (r.Level != lv.Index)
                        continue;
                    slab.Rects.Add(r.Rect);
                    slab.Holes.AddRange(r.FloorHoles);
                }
                if (slab.Rects.Count == 0)
                    continue;
                slabs.Add(slab);
            }

            return new OccluderSet
            {
                Walls = walls,
                Boxes = boxes,
                Cyls = cyls,
                Slabs = slabs,
                Terrain = site?.Terrain,
            };
        }

        /// <summary>The flight as a run of short boxes: the stone below the treads is solid, the balustrade half open.</summary>
        static void ArmBoxes(StairArm arm, List<BoxOccluder> boxes)
        {
            List<Vec2> path = arm.Path;
            var cum = new List<double>(path.Count) { 0 };
            for (int i = 1; i < path.Count; i++)
                cum.Add(cum[i - 1] + Num.Hypot(path[i].X - path[i - 1].X, path[i].Z - path[i - 1].Z));
            double total = cum[cum.Count - 1];
            Vec2 At(double s)
            {
                int i = 1;
                while (i < cum.Count - 1 && cum[i] < s)
                    i++;
                double k = (s - cum[i - 1]) / Num.Or(cum[i] - cum[i - 1], 1);
                Vec2 a = path[i - 1];
                Vec2 b = path[i];
                return new Vec2(a.X + (b.X - a.X) * k, a.Z + (b.Z - a.Z) * k);
            }
            double riser = arm.Rise / arm.Steps;
            double hw = arm.Width / 2;
            for (int i = 0; i < arm.Steps; i += 2)
            {
                Vec2 p = At(total * i / arm.Steps);
                Vec2 q = At(total * Math.Min(arm.Steps, i + 2) / arm.Steps);
                double x0 = Math.Min(p.X, q.X) - hw * 0.75;
                double x1 = Math.Max(p.X, q.X) + hw * 0.75;
                double z0 = Math.Min(p.Z, q.Z) - hw * 0.75;
                double z1 = Math.Max(p.Z, q.Z) + hw * 0.75;
                double yTop = arm.Y0 + Math.Min(arm.Steps, i + 2) * riser;
                var r = new Rect(x0, z0, x1, z1);
                boxes.Add(new BoxOccluder(r, Math.Max(arm.Y0, arm.Y0 + i * riser - 0.3), yTop, 0));
                boxes.Add(new BoxOccluder(r, yTop, yTop + 0.95, 0.6));
            }
        }
    }
}
