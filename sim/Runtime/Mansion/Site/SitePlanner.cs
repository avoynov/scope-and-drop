using System;
using System.Collections.Generic;
using ScopeAndDrop.Sim.Core;

namespace ScopeAndDrop.Sim.Mansion
{
    public sealed class SiteInput
    {
        public Rng Rng = null!;
        public MassingPlan M = null!;
        public StyleDef Style = null!;
        public List<Portico> Porticos = new List<Portico>();

        /// <summary>Plan bounds of all masses.</summary>
        public Rect Footprint;
        public double? PerchDistance;
        public double? PerchAzimuthDeg;
        public double? PerchElevationDeg;
    }

    public sealed class SiteOutput
    {
        public Site Site = new Site();
        public List<Prop> Props = new List<Prop>();
        public List<LightSpec> Lights = new List<LightSpec>();
    }

    /// <summary>
    /// Site (stage 6): raised garden terrace, formal parterre, fountain, tree belts that frame the vista without blocking it, the sniper's
    /// perch on a wooded rise, and blue-hour sky parameters. Port of src/mansion/site/site.ts.
    /// </summary>
    public static class SitePlanner
    {
        /// <summary>Bridson Poisson-disc sampling inside a rect (deterministic given rng).</summary>
        public static List<Vec2> PoissonDisc(Rng rng, Rect area, double minDist, Func<double, double, bool> accept, int max = 400)
        {
            double cell = minDist / Math.Sqrt(2);
            int cols = (int)Math.Max(1, Math.Ceiling((area.X1 - area.X0) / cell));
            int rows = (int)Math.Max(1, Math.Ceiling((area.Z1 - area.Z0) / cell));
            var grid = new int[cols * rows];
            for (int i = 0; i < grid.Length; i++)
                grid[i] = -1;
            var pts = new List<Vec2>();
            var active = new List<int>();
            void Put(Vec2 p)
            {
                int c = (int)Math.Floor((p.X - area.X0) / cell);
                int r = (int)Math.Floor((p.Z - area.Z0) / cell);
                grid[r * cols + c] = pts.Count;
                pts.Add(p);
                active.Add(pts.Count - 1);
            }
            bool Far(Vec2 p)
            {
                int c = (int)Math.Floor((p.X - area.X0) / cell);
                int r = (int)Math.Floor((p.Z - area.Z0) / cell);
                for (int j = Math.Max(0, r - 2); j <= Math.Min(rows - 1, r + 2); j++)
                {
                    for (int i = Math.Max(0, c - 2); i <= Math.Min(cols - 1, c + 2); i++)
                    {
                        int k = grid[j * cols + i];
                        if (k >= 0)
                        {
                            Vec2 q = pts[k];
                            double dx = q.X - p.X;
                            double dz = q.Z - p.Z;
                            if (dx * dx + dz * dz < minDist * minDist)
                                return false;
                        }
                    }
                }
                return true;
            }
            for (int s = 0; s < 30 && pts.Count == 0; s++)
            {
                double x = rng.Range(area.X0, area.X1);
                double z = rng.Range(area.Z0, area.Z1);
                if (accept(x, z))
                    Put(new Vec2(x, z));
            }
            while (active.Count > 0 && pts.Count < max)
            {
                int ai = rng.Int(0, active.Count - 1);
                Vec2 basePt = pts[active[ai]];
                bool found = false;
                for (int k = 0; k < 18; k++)
                {
                    double ang = rng.Range(0, Math.PI * 2);
                    double rad = rng.Range(minDist, 2 * minDist);
                    var p = new Vec2(basePt.X + Math.Cos(ang) * rad, basePt.Z + Math.Sin(ang) * rad);
                    if (p.X < area.X0 || p.X >= area.X1 || p.Z < area.Z0 || p.Z >= area.Z1)
                        continue;
                    if (!Far(p) || !accept(p.X, p.Z))
                        continue;
                    Put(p);
                    found = true;
                    break;
                }
                if (!found)
                    active.RemoveAt(ai);
            }
            return pts;
        }

        static (double h0, double h1, double c0, double c1) TreeSize(TreeKind kind) =>
            kind switch
            {
                TreeKind.Oak => (15, 21, 6, 8.5),
                TreeKind.Beech => (18, 26, 5, 7.5),
                TreeKind.Cedar => (17, 24, 7, 10),
                TreeKind.Cypress => (11, 17, 1.4, 2.2),
                TreeKind.Yew => (6, 10, 2.8, 4),
                _ => (20, 28, 2.4, 3.4),
            };

        static readonly ParterrePattern[] Patterns = { ParterrePattern.Cross, ParterrePattern.Diamond, ParterrePattern.Ring, ParterrePattern.Quarters };
        static readonly TopiaryShape[] Shapes = { TopiaryShape.Cone, TopiaryShape.Ball, TopiaryShape.Spiral };

        sealed class Cone
        {
            public Vec2 E;
            public double ALo;
            public double AHi;
            public double Reach;

            public double AngOf(double x, double z) => Math.Atan2(x - E.X, E.Z - z);
        }

        static Balustrade Rail(double ax, double az, double bx, double bz) =>
            new Balustrade
            {
                A = new Vec2(ax, az),
                B = new Vec2(bx, bz),
                Height = 1.0,
            };

        public static SiteOutput Plan(SiteInput input)
        {
            Rng rng = input.Rng;
            MassingPlan m = input.M;
            Rect footprint = input.Footprint;
            var props = new List<Prop>();
            var lights = new List<LightSpec>();
            int pid = 0;
            int lid = 0;
            static double[] Warm(double k) => new[] { 1, 0.62 + 0.08 * k, 0.32 + 0.1 * k };

            /* ---------------- Terrace ---------------- */
            Portico? gardenPortico = input.Porticos.Find(p => p.Side == FacadeSide.Garden);
            double pav = m.GardenPavilion?.Depth ?? 0;
            WingSpec? gardenWing = m.Wings.Find(w => w.Toward == FacadeSide.Garden);
            double frontMost = Math.Max(
                m.ZGarden + pav,
                Math.Max(gardenPortico != null ? gardenPortico.Rect.Z1 : double.NegativeInfinity, gardenWing != null ? gardenWing.Rect.Z1 : double.NegativeInfinity)
            );
            double td = Geom.Snap(rng.Range(gardenWing != null ? 4.5 : 6.5, gardenWing != null ? 7.5 : 10.5), 0.1);
            double ext = Geom.Snap(gardenWing != null ? rng.Range(2.0, 4.0) : rng.Range(0.0, 3.0), 0.1);
            double tx0 = Math.Min(-m.W / 2, footprint.X0) - ext;
            double tx1 = Math.Max(m.W / 2, footprint.X1) + ext;
            double tz1 = Geom.Snap(frontMost + td, 0.01);
            double terraceY = Geom.Snap(m.GroundFloorY - 0.15, 0.01);
            int stepCount = (int)Math.Max(3, Math.Ceiling(terraceY / 0.155));
            double stepRun = Geom.Snap(stepCount * 0.4, 0.01);
            double stepW = Geom.Snap(Math.Max(gardenPortico != null ? gardenPortico.Rect.X1 - gardenPortico.Rect.X0 : 0, rng.Range(5.5, 9)), 0.1);
            var terrace = new Terrace
            {
                Rect = Rect.Of(tx0, m.ZGarden - 0.3, tx1, tz1),
                Y = terraceY,
                Balustrades = new List<Balustrade> { Rail(tx0, tz1, -stepW / 2, tz1), Rail(stepW / 2, tz1, tx1, tz1) },
                Steps = new List<TerraceSteps>
                {
                    new TerraceSteps
                    {
                        Rect = Rect.Of(-stepW / 2, tz1, stepW / 2, tz1 + stepRun),
                        Dir = Dir4.PosZ,
                        Y0 = terraceY,
                        Y1 = 0,
                        Count = stepCount,
                    },
                },
            };
            // Side balustrades run back to the facade; optional side stairs halfway.
            bool sideSteps = rng.Chance(0.5);
            foreach (double sx in new[] { tx0, tx1 })
            {
                double back = m.ZGarden;
                if (sideSteps)
                {
                    double zc = (back + tz1) / 2;
                    const double sw = 3.2;
                    terrace.Balustrades.Add(Rail(sx, back, sx, zc - sw / 2));
                    terrace.Balustrades.Add(Rail(sx, zc + sw / 2, sx, tz1));
                    terrace.Steps.Add(
                        new TerraceSteps
                        {
                            Rect = sx < 0 ? Rect.Of(sx - stepRun, zc - sw / 2, sx, zc + sw / 2) : Rect.Of(sx, zc - sw / 2, sx + stepRun, zc + sw / 2),
                            Dir = sx < 0 ? Dir4.NegX : Dir4.PosX,
                            Y0 = terraceY,
                            Y1 = 0,
                            Count = stepCount,
                        }
                    );
                }
                else
                    terrace.Balustrades.Add(Rail(sx, back, sx, tz1));
            }

            /* ---------------- Formal garden ---------------- */
            double walkZ0 = tz1 + stepRun;
            double fountainZ = Geom.Snap(walkZ0 + rng.Range(24, 38), 0.1);
            double fountainR = Geom.Snap(rng.Range(3.5, 6.5), 0.1);
            double pathW = Geom.Snap(Math.Min(stepW, rng.Range(4, 6.5)), 0.1);
            double gardenEnd = fountainZ + fountainR + rng.Range(18, 34);
            var paths = new List<SitePath>
            {
                new SitePath { Rect = Rect.Of(tx0 - 2, walkZ0, tx1 + 2, walkZ0 + 3.2), Kind = PathKind.Gravel },
                new SitePath { Rect = Rect.Of(-pathW / 2, walkZ0, pathW / 2, gardenEnd), Kind = PathKind.Gravel },
                new SitePath { Rect = Rect.Of(-fountainR - 16, fountainZ - 1.6, fountainR + 16, fountainZ + 1.6), Kind = PathKind.Gravel },
            };
            var parterres = new List<Parterre>();
            var topiary = new List<Topiary>();
            ParterrePattern pattern = rng.Pick(Patterns);
            double bedW = Geom.Snap(rng.Range(9, 15), 0.1);
            double bedZ0 = walkZ0 + 5;
            double bedZ1 = fountainZ - fountainR - 4;
            bool split = bedZ1 - bedZ0 > 22 && rng.Chance(0.6);
            foreach (int side in new[] { -1, 1 })
            {
                double x0 = side < 0 ? -pathW / 2 - 2.5 - bedW : pathW / 2 + 2.5;
                double[] zs = split ? new[] { bedZ0, (bedZ0 + bedZ1) / 2 - 1.5, (bedZ0 + bedZ1) / 2 + 1.5, bedZ1 } : new[] { bedZ0, bedZ1 };
                for (int i = 0; i + 1 < zs.Length; i += 2)
                {
                    Rect r = Rect.Of(x0, zs[i], x0 + bedW, zs[i + 1]);
                    if (r.Z1 - r.Z0 < 5)
                        continue;
                    parterres.Add(new Parterre { Rect = r, Pattern = pattern });
                    foreach (var (cx, cz) in new[] { (r.X0, r.Z0), (r.X1, r.Z0), (r.X0, r.Z1), (r.X1, r.Z1) })
                    {
                        topiary.Add(
                            new Topiary
                            {
                                X = cx,
                                Z = cz,
                                Height = 1.7,
                                Radius = 0.55,
                                Shape = TopiaryShape.Cone,
                            }
                        );
                    }
                }
            }
            foreach (double sx in new[] { -stepW / 2 - 1.2, stepW / 2 + 1.2 })
            {
                topiary.Add(
                    new Topiary
                    {
                        X = sx,
                        Z = walkZ0 + 1.6,
                        Height = 2.3,
                        Radius = 0.75,
                        Shape = rng.Pick(Shapes),
                    }
                );
            }

            /* ---------------- Exterior props + lights ---------------- */
            void Lamp(double x, double z, double y)
            {
                props.Add(
                    new Prop
                    {
                        Id = "px" + Num.ToText(pid++),
                        Kind = PropKind.Lamppost,
                        RoomId = null,
                        Level = 0,
                        X = x,
                        Y = y,
                        Z = z,
                        Yaw = 0,
                        W = 0.5,
                        D = 0.5,
                        H = 3.4,
                        Variant = 0,
                        Mount = PropMount.Floor,
                        BlocksNav = true,
                        Occludes = false,
                    }
                );
                lights.Add(
                    new LightSpec
                    {
                        Id = "lx" + Num.ToText(lid++),
                        Kind = LightKind.Lamppost,
                        Scope = "exterior",
                        X = x,
                        Y = y + 3.25,
                        Z = z,
                        Color = Warm(0.2),
                        Intensity = 160,
                        Range = 18,
                    }
                );
            }
            Lamp(-stepW / 2 - 0.5, tz1 - 0.6, terraceY);
            Lamp(stepW / 2 + 0.5, tz1 - 0.6, terraceY);
            for (double z = walkZ0 + 8; z < fountainZ - fountainR - 3; z += 14)
            {
                Lamp(-pathW / 2 - 0.9, z, 0);
                Lamp(pathW / 2 + 0.9, z, 0);
            }
            // Urns on the balustrade piers.
            foreach (Balustrade b in terrace.Balustrades)
            {
                foreach (Vec2 p in new[] { b.A, b.B })
                {
                    props.Add(
                        new Prop
                        {
                            Id = "px" + Num.ToText(pid++),
                            Kind = PropKind.Urn,
                            RoomId = null,
                            Level = 0,
                            X = p.X,
                            Y = terraceY + b.Height,
                            Z = p.Z,
                            Yaw = 0,
                            W = 0.6,
                            D = 0.6,
                            H = 0.9,
                            Variant = 0,
                            Mount = PropMount.Floor,
                            BlocksNav = false,
                            Occludes = false,
                        }
                    );
                }
            }
            if (gardenPortico != null)
            {
                foreach (Vec2 c in gardenPortico.Columns)
                {
                    // Floodlights a little in front of each column: they wash the shaft, not the paving.
                    lights.Add(
                        new LightSpec
                        {
                            Id = "lx" + Num.ToText(lid++),
                            Kind = LightKind.Uplight,
                            Scope = "exterior",
                            X = c.X,
                            Y = gardenPortico.BaseY + 0.25,
                            Z = c.Z + gardenPortico.ColumnRadius + 0.7,
                            Color = Warm(0.5),
                            Intensity = 140,
                            Range = 14,
                            Dir = new[] { 0, 0.94, -0.34 },
                            Cone = 0.9,
                        }
                    );
                }
            }
            lights.Add(
                new LightSpec
                {
                    Id = "lx" + Num.ToText(lid++),
                    Kind = LightKind.Uplight,
                    Scope = "exterior",
                    X = 0,
                    Y = 0.6,
                    Z = fountainZ,
                    Color = new[] { 1, 0.86, 0.66 },
                    Intensity = 90,
                    Range = fountainR + 8,
                }
            );

            /* ---------------- Perch, terrain, sky ---------------- */
            // Always draw both, so overriding one never reshuffles the rest of the site.
            double drawnDist = rng.Range(135, 205);
            double drawnAz = rng.Range(-24, 24);
            double dist = Geom.Snap(input.PerchDistance ?? drawnDist, 0.1);
            double az = Geom.Snap(Math.Max(-Perches.ArcDeg, Math.Min(Perches.ArcDeg, input.PerchAzimuthDeg ?? drawnAz)), 0.1);
            double elevation = Geom.Snap(Math.Max(0, Math.Min(Perches.MaxElevationDeg, input.PerchElevationDeg ?? 0)), 0.1);
            double azr = (az * Math.PI) / 180;
            Vec2 pp = Perches.PerchPlan(m.ZGarden, az, dist);
            double px = pp.X;
            double pz = pp.Z;
            double fountainReach = Num.Hypot(fountainR + 20, gardenEnd);
            var terrain = new TerrainSpec();
            terrain.FlatRadius = Geom.Snap(Math.Min(dist - 55, Math.Max(70, fountainReach + 8)), 0.1);
            terrain.PerchRise = Geom.Snap(rng.Range(4, 11), 0.1);
            terrain.Crest = new Vec2(Geom.Snap(px + Math.Sin(azr) * 7, 0.01), Geom.Snap(pz + Math.Cos(azr) * 7, 0.01));
            terrain.Ridge = new Ridge
            {
                Cz = m.ZGarden,
                Radius = Geom.Snap(dist + 7, 0.01),
                HalfAngle = Geom.Snap(((Perches.ArcDeg + 4) * Math.PI) / 180, 0.0001),
            };
            terrain.Undulation = Geom.Snap(rng.Range(0.3, 0.9), 0.01);
            terrain.Seed = rng.Int(1, 1 << 20);
            var target = new Vec3(0, Geom.Snap(m.GroundFloorY + 3.0, 0.01), m.ZGarden);
            var perch = new Perch
            {
                Eye = Perches.PerchEyeAt(terrain, m.ZGarden, m.GroundFloorY, az, elevation, dist),
                Target = target,
                Distance = dist,
                AzimuthDeg = az,
                FovMinDeg = 1.2,
                FovMaxDeg = 24,
                ArcDeg = new[] { -Perches.ArcDeg, Perches.ArcDeg },
                Options = new List<BearingOption>(),
                ElevationDeg = elevation,
                ElevationRangeDeg = new[] { 0, Perches.MaxElevationDeg },
                ElevationOptions = new List<ElevationOption>(),
            };
            int sunSide = rng.Chance(0.5) ? 1 : -1;
            double sunAz = Geom.Snap(180 + sunSide * rng.Range(22, 60), 0.1);
            var sky = new SkySpec();
            sky.SunAzimuthDeg = sunAz;
            sky.SunElevationDeg = Geom.Snap(rng.Range(-6.5, -3.0), 0.1);
            sky.MoonAzimuthDeg = Geom.Snap(sunAz - sunSide * rng.Range(12, 34), 0.1);
            sky.MoonElevationDeg = Geom.Snap(rng.Range(9, 21), 0.1);
            sky.Cloudiness = Geom.Snap(rng.Range(0.1, 0.55), 0.01);

            /* ---------------- Trees ---------------- */
            // Keep the cone from every bearing on the perch arc to the facade (plus margin) clear,
            // so the sniper can pick a direction without a tree belt in the way.
            double fx0 = Math.Min(footprint.X0, tx0) - 8;
            double fx1 = Math.Max(footprint.X1, tx1) + 8;
            double arcX = Math.Sin((Perches.ArcDeg * Math.PI) / 180) * dist;
            double arcZ = m.ZGarden + Math.Cos((Perches.ArcDeg * Math.PI) / 180) * dist;
            var cones = new List<Cone>();
            for (double a = -Perches.ArcDeg; a <= Perches.ArcDeg + 1e-6; a += 2)
            {
                var c = new Cone { E = Perches.PerchPlan(m.ZGarden, a, dist) };
                double aA = c.AngOf(fx0, m.ZGarden);
                double aB = c.AngOf(fx1, m.ZGarden);
                c.ALo = Math.Min(aA, aB);
                c.AHi = Math.Max(aA, aB);
                c.Reach = Num.Hypot(c.E.X, c.E.Z - footprint.Z0) + 5;
                cones.Add(c);
            }
            bool InCone(double x, double z, double r)
            {
                foreach (Cone c in cones)
                {
                    double d = Num.Hypot(x - c.E.X, z - c.E.Z);
                    if (d < 6 + r)
                        return true; // a firing position
                    // Behind this position (measured along its own line of fire) or behind the house.
                    if ((x - c.E.X) * -c.E.X + (z - c.E.Z) * (m.ZGarden - c.E.Z) < -r * Num.Hypot(c.E.X, m.ZGarden - c.E.Z) || d > c.Reach)
                        continue;
                    double ang = c.AngOf(x, z);
                    double margin = Math.Asin(Math.Min(1, (r + 2.5) / d));
                    if (ang > c.ALo - margin && ang < c.AHi + margin)
                        return true;
                }
                return false;
            }
            var trees = new List<Tree>();
            bool NearHouse(double x, double z, double r) => x > footprint.X0 - 6 - r && x < footprint.X1 + 6 + r && z > footprint.Z0 - 6 - r && z < tz1 + stepRun + 6 + r;
            bool NearGarden(double x, double z, double r) => x > -fountainR - 26 - r && x < fountainR + 26 + r && z > walkZ0 - 2 && z < gardenEnd + 4 + r;
            void AddTrees(Rect area, double minDist, TreeKind[] kinds, int cap)
            {
                List<Vec2> pts = PoissonDisc(rng, area, minDist, (x, z) => !InCone(x, z, 8) && !NearHouse(x, z, 6) && !NearGarden(x, z, 6), cap);
                foreach (Vec2 p in pts)
                {
                    TreeKind kind = rng.Pick(kinds);
                    var s = TreeSize(kind);
                    double crown = Geom.Snap(rng.Range(s.c0, s.c1), 0.1);
                    if (InCone(p.X, p.Z, crown) || NearHouse(p.X, p.Z, crown) || NearGarden(p.X, p.Z, crown))
                        continue;
                    double x = Geom.Snap(p.X, 0.01);
                    double z = Geom.Snap(p.Z, 0.01);
                    double y = Geom.Snap(Terrain.Height(terrain, p.X, p.Z), 0.01);
                    double height = Geom.Snap(rng.Range(s.h0, s.h1), 0.1);
                    trees.Add(
                        new Tree
                        {
                            X = x,
                            Z = z,
                            Y = y,
                            Height = height,
                            Crown = crown,
                            Kind = kind,
                        }
                    );
                }
            }
            // Woods behind the house: silhouettes above the roofline.
            AddTrees(
                Rect.Of(footprint.X0 - 70, footprint.Z0 - 110, footprint.X1 + 70, footprint.Z0 - 16),
                9,
                new[] { TreeKind.Beech, TreeKind.Oak, TreeKind.Cedar, TreeKind.Beech, TreeKind.Poplar },
                160
            );
            // Flanking belts.
            AddTrees(Rect.Of(fx1 + 18, footprint.Z0 - 30, fx1 + 140, arcZ - 25), 10, new[] { TreeKind.Oak, TreeKind.Beech, TreeKind.Oak, TreeKind.Cedar }, 120);
            AddTrees(Rect.Of(fx0 - 140, footprint.Z0 - 30, fx0 - 18, arcZ - 25), 10, new[] { TreeKind.Oak, TreeKind.Beech, TreeKind.Oak, TreeKind.Cedar }, 120);
            // The sniper's treeline along the ridge, behind and beside every firing position.
            AddTrees(Rect.Of(-arcX - 150, arcZ - 30, arcX + 150, m.ZGarden + dist + 50), 7.5, new[] { TreeKind.Oak, TreeKind.Beech, TreeKind.Yew, TreeKind.Oak }, 420);
            // A specimen cedar or two on the lawn.
            foreach (int side in new[] { -1, 1 })
            {
                if (!rng.Chance(0.7))
                    continue;
                double x = side * (Math.Max(Math.Abs(fx0), Math.Abs(fx1)) + rng.Range(6, 22));
                double z = m.ZGarden + rng.Range(8, 40);
                double crown = rng.Range(8, 10.5);
                if (InCone(x, z, crown))
                    continue;
                double tx = Geom.Snap(x, 0.01);
                double tz = Geom.Snap(z, 0.01);
                double ty = Geom.Snap(Terrain.Height(terrain, x, z), 0.01);
                double height = Geom.Snap(rng.Range(18, 24), 0.1);
                trees.Add(
                    new Tree
                    {
                        X = tx,
                        Z = tz,
                        Y = ty,
                        Height = height,
                        Crown = Geom.Snap(crown, 0.1),
                        Kind = TreeKind.Cedar,
                    }
                );
            }
            // Clipped yews along the terrace foot.
            if (rng.Chance(0.6))
            {
                for (double x = tx0 + 3; x <= tx1 - 3; x += 6)
                {
                    if (Math.Abs(x) < stepW / 2 + 2)
                        continue;
                    topiary.Add(
                        new Topiary
                        {
                            X = Geom.Snap(x, 0.01),
                            Z = Geom.Snap(walkZ0 + 3.8, 0.01),
                            Height = 2.6,
                            Radius = 0.7,
                            Shape = TopiaryShape.Cone,
                        }
                    );
                }
            }

            var site = new Site
            {
                Terrace = terrace,
                Lawn = Rect.Of(-260 - arcX, footprint.Z0 - 130, 260 + arcX, m.ZGarden + dist + 80),
                Paths = paths,
                Fountain = new Fountain
                {
                    X = 0,
                    Z = fountainZ,
                    Radius = fountainR,
                    Tiers = rng.Int(1, 3),
                },
                Parterres = parterres,
                Topiary = topiary,
                Trees = trees,
                Terrain = terrain,
                Perch = perch,
                Sky = sky,
            };
            return new SiteOutput
            {
                Site = site,
                Props = props,
                Lights = lights,
            };
        }
    }
}
