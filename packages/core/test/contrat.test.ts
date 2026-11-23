import { describe, expect, it } from 'vitest';
import { sessionPosition } from '../src/chart/annotations';
import { fitText, polygonsOverlap, rotatedBounds, rotatedCorners, truncateText } from '../src/chart/labels';
import { groupMargins, reportMargins, type SyncMember } from '../src/chart/sync';
import { DateBandScale, sessionTicks } from '../src/scale/scales';
import { themeColor, resolveTheme } from '../src/theme/theme';

// Seven px per character: enough to reason about widths without a canvas.
const measure = (t: string) => [...t].length * 7;

describe('truncateText / fitText', () => {
  it('keeps a text that fits', () => {
    expect(truncateText('Budget', 42, measure)).toBe('Budget');
  });

  it('cuts with an ellipsis, as long as possible', () => {
    const out = truncateText('Budget de fonctionnement', 70, measure);
    expect(out).toBe('Budget de…');
    expect(measure(out)).toBeLessThanOrEqual(70);
    expect(measure('Budget de …')).toBeGreaterThan(70);
  });

  it('does not leave a space before the ellipsis', () => {
    // Ten characters would end on the space after "de".
    expect(truncateText('Budget de fonctionnement', 77, measure)).toBe('Budget de…');
  });

  it('always returns something for a title', () => {
    expect(truncateText('Budget', 3, measure)).toBe('B…');
    expect(truncateText('B', 3, measure)).toBe('B');
  });

  it('fitText gives up when not even one character and the ellipsis fit', () => {
    expect(fitText('Budget', (t) => measure(t) <= 10)).toBeNull();
    expect(fitText('Budget', (t) => measure(t) <= 14)).toBe('B…');
    expect(fitText('Budget', (t) => measure(t) <= 1000)).toBe('Budget');
  });

  it('counts characters, not UTF-16 units', () => {
    expect(truncateText('😀😀😀😀', 21, measure)).toBe('😀😀…');
  });
});

describe('rotatedBounds', () => {
  it('is the rectangle itself without rotation', () => {
    expect(rotatedBounds(-20, -5, 40, 10, 0)).toEqual({ x0: -20, y0: -5, x1: 20, y1: 5 });
  });

  it('swaps width and height at a quarter turn', () => {
    const b = rotatedBounds(-20, -5, 40, 10, 90);
    expect(b.x0).toBeCloseTo(-5);
    expect(b.x1).toBeCloseTo(5);
    expect(b.y0).toBeCloseTo(-20);
    expect(b.y1).toBeCloseTo(20);
  });

  it('turns clockwise on screen around the anchor: a left-aligned text at -90° goes up', () => {
    const b = rotatedBounds(0, -5, 40, 10, -90);
    expect(b.y0).toBeCloseTo(-40);
    expect(b.y1).toBeCloseTo(0);
    expect(b.x0).toBeCloseTo(-5);
    expect(b.x1).toBeCloseTo(5);
  });

  it('grows to the diagonal at 45°', () => {
    const b = rotatedBounds(0, 0, 40, 10, 45);
    expect(b.x1 - b.x0).toBeCloseTo((40 + 10) * Math.SQRT1_2);
    expect(b.y1 - b.y0).toBeCloseTo((40 + 10) * Math.SQRT1_2);
  });
});

describe('polygonsOverlap', () => {
  const at = (x: number, y: number, deg: number) => rotatedCorners(0, -5, 60, 10, deg).map(([px, py]) => [x + px, y + py] as [number, number]);

  it('tells apart two leaning labels whose bounding boxes meet', () => {
    // Column headers at -45°, 16 px apart: the boxes overlap, the texts do not.
    const a = at(0, 0, -45);
    const b = at(16, 0, -45);
    const box = (q: [number, number][]) => ({ x0: Math.min(...q.map((p) => p[0])), x1: Math.max(...q.map((p) => p[0])) });
    expect(box(a).x1).toBeGreaterThan(box(b).x0);
    expect(polygonsOverlap(a, b)).toBe(false);
  });

  it('sees two leaning labels that do touch', () => {
    expect(polygonsOverlap(at(0, 0, -45), at(6, 0, -45))).toBe(true);
  });

  it('sees a turned label crossing a straight one', () => {
    expect(polygonsOverlap(at(0, 0, 0), at(30, 20, -90))).toBe(true);
    expect(polygonsOverlap(at(0, 0, 0), at(80, 20, -90))).toBe(false);
  });
});

describe('sessionTicks', () => {
  /** Week days from a date, skipping Saturdays and Sundays. */
  const weekdays = (from: Date, count: number): number[] => {
    const out: number[] = [];
    for (let d = 0; out.length < count; d++) {
      const date = new Date(from.getFullYear(), from.getMonth(), from.getDate() + d);
      if (date.getDay() !== 0 && date.getDay() !== 6) out.push(date.getTime());
    }
    return out;
  };
  // Monday the 5th of January 2026.
  const year = weekdays(new Date(2026, 0, 5), 250);

  it('labels every session when they all fit', () => {
    const t = sessionTicks(year, 0, 4, 8, 'fr-FR');
    expect(t.map((k) => k.index)).toEqual([0, 1, 2, 3, 4]);
    expect(t[0].label).toBe('5 janv.');
  });

  it('goes to the first session of each week', () => {
    const t = sessionTicks(year, 0, 29, 8, 'fr-FR');
    expect(t.map((k) => k.index)).toEqual([0, 5, 10, 15, 20, 25]);
    for (const k of t) expect(new Date(year[k.index]).getDay()).toBe(1);
  });

  it('goes to the first session of each month, the year on the first one', () => {
    const t = sessionTicks(year, 0, 120, 8, 'fr-FR');
    expect(t.map((k) => k.label)).toEqual(['févr. 2026', 'mars', 'avr.', 'mai', 'juin']);
    // The first session of February 2026 is Monday the 2nd.
    expect(new Date(year[t[0].index]).getDate()).toBe(2);
    // No week-end is given room: positions are session indexes.
    expect(t[0].index).toBe(20);
  });

  it('goes to quarters, then years, when months do not fit', () => {
    const quarters = sessionTicks(year, 0, 249, 4, 'fr-FR');
    expect(quarters.map((k) => new Date(year[k.index]).getMonth())).toEqual([3, 6, 9]);
    // Monday the 4th of January 2016 opens its year: it is a graduation too.
    const decade = weekdays(new Date(2016, 0, 4), 2600);
    const years = sessionTicks(decade, 0, decade.length - 1, 12, 'fr-FR');
    expect(years.map((k) => k.label)).toEqual(['2016', '2017', '2018', '2019', '2020', '2021', '2022', '2023', '2024', '2025']);
  });

  it('never returns more graduations than asked', () => {
    for (const count of [2, 3, 5, 8, 12]) {
      for (const n of [10, 40, 90, 250]) expect(sessionTicks(year, 0, n - 1, count, 'fr-FR').length).toBeLessThanOrEqual(count);
    }
  });

  it('only looks at the visible range', () => {
    const t = sessionTicks(year, 100, 110, 12, 'fr-FR');
    expect(t.every((k) => k.index >= 100 && k.index <= 110)).toBe(true);
    expect(sessionTicks(year, 5, 4, 8)).toEqual([]);
  });

  it('a first session that opens its month is a graduation too', () => {
    const fromFirst = weekdays(new Date(2026, 5, 1), 60);
    expect(sessionTicks(fromFirst, 0, 59, 3, 'fr-FR').map((k) => k.label)).toEqual(['juin 2026', 'juil.', 'août']);
  });
});

describe('DateBandScale', () => {
  const dates = [new Date(2026, 0, 8), new Date(2026, 0, 9), new Date(2026, 0, 12), new Date(2026, 0, 13)].map((d) => d.getTime());
  const scale = new DateBandScale(dates, 0.3, 0.15, false, 'fr-FR');

  it('gives every session the same room, week-end or not', () => {
    const step = scale.norm(1) - scale.norm(0);
    // Friday the 9th to Monday the 12th: one step, like any other.
    expect(scale.norm(2) - scale.norm(1)).toBeCloseTo(step);
    expect(scale.type).toBe('band');
    expect(scale.band).toBeGreaterThan(0);
  });

  it('formats a position as its date', () => {
    expect(scale.format(2)).toBe('12 janv. 2026');
    expect(scale.format(9)).toBe('');
  });

  it('places its graduations on band centers', () => {
    const t = scale.ticks(0, 1, 8);
    expect(t.map((k) => k.label)).toEqual(['8 janv.', '9 janv.', '12 janv.', '13 janv.']);
    expect(t[2].t).toBeCloseTo(scale.norm(2));
  });
});

describe('sessionPosition', () => {
  const dates = [new Date(2026, 0, 8), new Date(2026, 0, 9), new Date(2026, 0, 12)].map((d) => d.getTime());

  it('finds the session of a date, given as epoch ms or as text', () => {
    expect(sessionPosition(dates[1], dates)).toBe(1);
    expect(sessionPosition(new Date(2026, 0, 12).toISOString(), dates)).toBe(2);
  });

  it('puts a day without session between its neighbours', () => {
    // Saturday the 10th: between Friday (1) and Monday (2).
    expect(sessionPosition(new Date(2026, 0, 10).getTime(), dates)).toBe(1.5);
    expect(sessionPosition(new Date(2026, 0, 1).getTime(), dates)).toBe(-0.5);
    expect(sessionPosition(new Date(2026, 1, 1).getTime(), dates)).toBe(2.5);
    expect(sessionPosition('pas une date', dates)).toBeNaN();
  });
});

describe('sync margins', () => {
  const member = (): SyncMember => ({ syncHover() {}, syncRange() {} });

  it('gives each chart the widest margins of the others of the same width', () => {
    const a = member(), b = member(), c = member();
    expect(reportMargins('t1', a, { left: 40, right: 20, width: 800 })).toBe(true);
    expect(reportMargins('t1', b, { left: 62, right: 20, width: 800 })).toBe(true);
    expect(reportMargins('t1', c, { left: 90, right: 60, width: 400 })).toBe(true);
    expect(groupMargins('t1', a, 800)).toEqual({ left: 62, right: 20 });
    expect(groupMargins('t1', b, 800)).toEqual({ left: 40, right: 20 });
    // Another width: not stacked with the others, nothing to align on.
    expect(groupMargins('t1', c, 400)).toEqual({ left: 0, right: 0 });
  });

  it('says whether a report changed anything', () => {
    const a = member();
    expect(reportMargins('t2', a, { left: 40, right: 20, width: 800 })).toBe(true);
    expect(reportMargins('t2', a, { left: 40, right: 20, width: 800 })).toBe(false);
    expect(reportMargins('t2', a, null)).toBe(true);
    expect(reportMargins('t2', a, null)).toBe(false);
    expect(groupMargins('t2', member(), 800)).toEqual({ left: 0, right: 0 });
  });
});

describe('theme tokens', () => {
  it('$up and $down are the good and bad colors of the theme', () => {
    const light = resolveTheme(undefined);
    const dark = resolveTheme('dark');
    expect(themeColor(light, '$up')).toBe(light.marks.kpi.good);
    expect(themeColor(light, '$down')).toBe(light.marks.kpi.bad);
    expect(themeColor(dark, '$up')).toBe(dark.marks.kpi.good);
    expect(themeColor(dark, '$up')).not.toBe(themeColor(light, '$up'));
  });
});
