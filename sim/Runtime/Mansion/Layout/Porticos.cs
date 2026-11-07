using System;
using System.Collections.Generic;
using ScopeAndDrop.Sim.Core;

namespace ScopeAndDrop.Sim.Mansion
{
    /// <summary>Porticos: free-standing colonnades with a pediment, on the bay grid. Port of src/mansion/layout/porticos.ts.</summary>
    public static class Porticos
    {
        public static List<Portico> Plan(MassingPlan m, StyleDef style)
        {
            var output = new List<Portico>();
            double terraceY = Geom.Snap(m.GroundFloorY - 0.15, 0.01);
            if (m.GardenPortico != null)
            {
                int bays = m.CenterFront;
                double half = (bays * m.Bay) / 2;
                double zFace = m.ZGarden + (m.GardenPavilion?.Depth ?? 0);
                bool giant = m.GardenPortico.Giant && m.Levels.Count >= 2;
                double r = giant ? Math.Min(0.5, Math.Max(0.4, 0.11 * m.Bay)) : 0.3;
                double z = Geom.Snap(zFace + m.GardenPortico.Depth - r - 0.15, 0.01);
                LevelSpec top = giant ? m.Levels[1] : m.Levels[0];
                output.Add(
                    new Portico
                    {
                        Id = "portico-garden",
                        Side = FacadeSide.Garden,
                        Columns = Columns(bays, half, m.Bay, z),
                        ColumnRadius = r,
                        BaseY = terraceY,
                        TopY = Geom.Snap(top.FloorY + top.Height, 0.01),
                        Order = style.ColumnOrder,
                        Rect = Rect.Of(Geom.Snap(-half - r - 0.35, 0.01), zFace, Geom.Snap(half + r + 0.35, 0.01), Geom.Snap(zFace + m.GardenPortico.Depth + 0.1, 0.01)),
                        Pediment = true,
                    }
                );
            }
            if (m.EntrancePortico != null)
            {
                int bays = Math.Max(3, m.CenterBack);
                double half = (bays * m.Bay) / 2;
                double zFace = m.ZEntrance - (m.EntrancePavilion?.Depth ?? 0);
                const double r = 0.3;
                double z = Geom.Snap(zFace - m.EntrancePortico.Depth + r + 0.15, 0.01);
                LevelSpec top = m.Levels[0];
                output.Add(
                    new Portico
                    {
                        Id = "portico-entrance",
                        Side = FacadeSide.Entrance,
                        Columns = Columns(bays, half, m.Bay, z),
                        ColumnRadius = r,
                        BaseY = terraceY,
                        TopY = Geom.Snap(top.FloorY + top.Height, 0.01),
                        Order = style.ColumnOrder == ColumnOrder.Corinthian ? ColumnOrder.Ionic : style.ColumnOrder,
                        Rect = Rect.Of(Geom.Snap(-half - r - 0.35, 0.01), Geom.Snap(zFace - m.EntrancePortico.Depth - 0.1, 0.01), Geom.Snap(half + r + 0.35, 0.01), zFace),
                        Pediment = true,
                    }
                );
            }
            return output;
        }

        static List<Vec2> Columns(int bays, double half, double bay, double z)
        {
            var cols = new List<Vec2>(bays + 1);
            for (int i = 0; i < bays + 1; i++)
                cols.Add(new Vec2(Geom.Snap(-half + i * bay, 0.01), z));
            return cols;
        }
    }
}
