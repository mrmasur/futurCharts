import { Dictionary, Int32, Int8, Table, TimestampMillisecond, Utf8, makeVector, vectorFromArray } from 'apache-arrow';
import type { ChartSpec } from '@futurcharts/core';
import type { Family } from './index';

// What `SELECT day, region, sessions, orders FROM … FORMAT Arrow` gives once decoded by `tableFromIPC`:
// a timestamp column, a dictionary (LowCardinality(String)), a Float64 column (read without copy) and
// an Int32 column. Built here at load time, deterministic: no clock, no randomness.
const REGIONS = ['Nord', 'Sud', 'Est', 'Ouest'];
const DAYS = 56;
const START = Date.UTC(2026, 8, 7, 12);

const day: number[] = [];
const region: string[] = [];
const sessions = new Float64Array(DAYS * REGIONS.length);
const orders = new Int32Array(DAYS * REGIONS.length);
for (let d = 0; d < DAYS; d++) {
  REGIONS.forEach((name, r) => {
    const i = d * REGIONS.length + r;
    const weekend = d % 7 >= 5 ? 0.72 : 1;
    day.push(START + d * 86400000);
    region.push(name);
    sessions[i] = Math.round((1800 + 520 * r + 9 * d * (r + 1) + 260 * Math.sin((d + 3 * r) / 4.5)) * weekend);
    orders[i] = Math.round(sessions[i] * (0.031 + 0.004 * r + 0.006 * Math.sin(d / 9 + r)));
  });
}

const table = new Table({
  day: vectorFromArray(day, new TimestampMillisecond()),
  region: vectorFromArray(region, new Dictionary(new Utf8(), new Int8())),
  sessions: makeVector(sessions),
  orders: makeVector({ type: new Int32(), data: orders }),
});

/** Gallery examples of this family: `family` is the gallery section (an existing one, or a new one). */
export const FAMILIES: Family[] = [
  {
    family: 'Évolution',
    entries: [
      {
        title: 'Données Arrow',
        caption: 'line · table Apache Arrow donnée telle quelle à data (Timestamp, Dictionary, Float64 sans copie, Int32) : ce que rend ClickHouse en FORMAT Arrow',
        spec: {
          title: 'Sessions par région',
          subtitle: 'Huit semaines, lues dans une table Arrow',
          // The spec type has no Arrow member yet (see docs/RECOMMANDATIONS.md): the table is read by its shape.
          data: table,
          fields: { day: { label: 'Jour' }, region: { label: 'Région' }, sessions: { label: 'Sessions' } },
          layers: [{ mark: 'line', encode: { x: 'day', y: 'sessions', color: 'region' } }],
        },
      },
    ],
  },
];
