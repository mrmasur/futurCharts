/**
 * Mobile audit: every gallery example mounted at a given size, with what is
 * left for the drawing once titles, legend and axes are placed. Run from the
 * console of gallery.html: `await fcAudit(343, 260)`.
 */
import { createChart, type ChartSpec } from '@futurcharts/core';
import { entries } from './library';

export interface AuditRow {
  title: string;
  error?: string;
  /** Drawing area, px. */
  plot?: [number, number];
  /** Share of the chart taken by the drawing. */
  share?: number;
  legendRows?: number;
  problems: string[];
}

export async function auditCharts(width = 343, height = 260): Promise<AuditRow[]> {
  const rows: AuditRow[] = [];
  const host = document.createElement('div');
  // In the viewport (charts off screen are not laid out), but invisible.
  host.style.cssText = `position:fixed;left:0;top:0;width:${width}px;height:${height}px;opacity:0.01;pointer-events:none;z-index:-1;`;
  document.body.appendChild(host);
  for (const e of entries) {
    const spec: ChartSpec = e.tiles ? e.tiles[0] : e.spec!;
    const row: AuditRow = { title: e.title, problems: [] };
    host.replaceChildren();
    const box = document.createElement('div');
    box.style.cssText = `width:${width}px;height:${height}px;`;
    host.appendChild(box);
    try {
      const c = await createChart(box, spec);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const chart = ((c as unknown as { charts?: unknown[] }).charts?.[0] ?? c) as { layout?: { plot: { width: number; height: number } }; legend?: { rect?: { y: number } }[] };
      const L = chart.layout;
      if (L) {
        row.plot = [Math.round(L.plot.width), Math.round(L.plot.height)];
        row.share = Math.round(((L.plot.width * L.plot.height) / (width * height)) * 100) / 100;
        row.legendRows = new Set((chart.legend ?? []).map((l) => Math.round(l.rect?.y ?? -1)).filter((y) => y >= 0)).size;
        if (Math.min(L.plot.width, L.plot.height) < 80) row.problems.push('zone de dessin trop petite');
        // A title, a subtitle and axis labels take about a third of a 260 px card: below that, too much.
        if (row.share < 0.28 && !spec.facet) row.problems.push('trop de place prise par titres, légende ou axes');
        if (row.legendRows > 2) row.problems.push(`légende sur ${row.legendRows} lignes`);
      }
      c.destroy();
    } catch (err) {
      row.error = String(err);
      row.problems.push('erreur');
    }
    rows.push(row);
  }
  host.remove();
  return rows;
}
