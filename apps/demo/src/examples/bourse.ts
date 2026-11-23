import type { ChartSpec } from '@futurcharts/core';
import type { Family } from './index';

// Deterministic quotes: a seeded random walk over trading days (no week-ends), with
// slow changes of trend so that averages cross and oscillators swing.
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}
const gauss = (r: () => number) => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
const round2 = (v: number) => Math.round(v * 100) / 100;

type Quote = {
  date: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  /** Thousands of shares traded. */
  volume: number;
  /** Close minus open: the sign colors the volume bars. */
  change: number;
};

function quotes(seed: number, sessions: number, start: number, volatility: number, waves: number, phase = 0.6, trend = 0.0021): Quote[] {
  const r = rng(seed);
  const out: Quote[] = [];
  let price = start;
  for (let day = 0; out.length < sessions; day++) {
    const date = new Date(2026, 0, 5 + day);
    if (date.getDay() === 0 || date.getDay() === 6) continue;
    const i = out.length;
    // The trend turns a few times over the period.
    const drift = 0.0004 + trend * Math.sin((i / sessions) * Math.PI * 2 * waves + phase);
    const open = price * (1 + gauss(r) * volatility * 0.2);
    const close = Math.max(1, open * (1 + drift + gauss(r) * volatility));
    const high = Math.max(open, close) * (1 + Math.abs(gauss(r)) * volatility * 0.4);
    const low = Math.min(open, close) * (1 - Math.abs(gauss(r)) * volatility * 0.4);
    // Big moves trade more.
    const volume = Math.round(180 * (0.65 + r() * 0.7) * (1 + (Math.abs(close - open) / open) * 28));
    out.push({ date, open: round2(open), high: round2(high), low: round2(low), close: round2(close), volume, change: round2(close - open) });
    price = close;
  }
  return out;
}

const helios = quotes(7, 180, 128, 0.011, 1.6);
const boreal = quotes(43, 130, 142, 0.012, 1.25, 2.6, 0.0017);
const vega = quotes(58, 70, 118, 0.012, 1.1);
const atlas = quotes(101, 250, 120, 0.013, 3, 0.6, 0.0013);

const euro2 = { suffix: ' €', decimals: 2 };
const fields: ChartSpec['fields'] = {
  date: { label: 'Séance' },
  high: { label: 'Haut → bas', format: euro2 },
  close: { label: 'Clôture', format: euro2 },
  volume: { label: 'Volume', format: { suffix: ' k', decimals: 0 } },
};
// Whole euros on the axis; tooltips keep the cents.
const euroAxis = { y: { format: { suffix: ' €', decimals: 0 } } };
// Stacked panels: bare numbers of the same length on every y axis, so the plots line up.
const bareAxis = { y: { format: { decimals: 0 } } };
const candles = { x: 'date', y: 'high', y2: 'low', open: 'open', close: 'close' };
// Rising and falling in colors that follow the theme (bars drawn under the candles).
const UP = '$6';
const DOWN = '$8';
const HALF_DAY = 43200000;

/** The same x range on every panel of a stack, whatever row its indicator starts at. */
const period = (data: Quote[]): [number, number] => [data[0].date.getTime() - HALF_DAY, data[data.length - 1].date.getTime() + HALF_DAY];

/**
 * On a narrow screen, the last `n` sessions only (the indicators are still computed
 * on the whole series). `fitY`: the price axis is fitted to those sessions, with `margin`
 * (a share of their range) left around them.
 */
function narrow(data: Quote[], n: number, fitY: boolean, extra: Partial<ChartSpec> = {}, margin = 0.08): NonNullable<ChartSpec['responsive']> {
  const tail = data.slice(-n);
  const lo = Math.min(...tail.map((q) => q.low));
  const hi = Math.max(...tail.map((q) => q.high));
  const pad = (hi - lo) * margin;
  const x: [number, number] = [tail[0].date.getTime() - HALF_DAY, tail[n - 1].date.getTime() + HALF_DAY];
  return [{ maxWidth: 480, spec: { ...extra, scales: { x: { domain: x }, ...(fitY ? { y: { domain: [Math.floor(lo - pad), Math.ceil(hi + pad)] } } : {}) } } }];
}

const bands = [{ type: 'bollinger' as const, field: 'close', period: 20, k: 2 }];
const macd = [{ type: 'macd' as const, field: 'close' }];

export const FAMILIES: Family[] = [
  {
    family: 'Bourse',
    entries: [
      {
        title: 'Chandeliers et moyennes mobiles',
        caption: 'candlestick + line · transforms sma et ema (period) calculés sur la clôture ; sous 480 px de large, la spec ne montre que les 60 dernières séances',
        wide: true,
        spec: {
          title: 'Hélios Énergie',
          subtitle: '180 séances · moyenne mobile simple à 20 séances, exponentielle à 50',
          data: helios,
          fields,
          axes: euroAxis,
          layers: [
            { mark: 'candlestick', name: 'Cours', encode: candles },
            { mark: 'line', name: 'MM 20', encode: { x: 'date', y: 'sma' }, transform: [{ type: 'sma', field: 'close', period: 20 }], style: { color: '$1', width: 1.75 } },
            { mark: 'line', name: 'MME 50', encode: { x: 'date', y: 'ema' }, transform: [{ type: 'ema', field: 'close', period: 50 }], style: { color: '$4', width: 1.75 } },
          ],
          scales: { y: { zero: false } },
          interactions: { zoom: { axes: 'x' } },
          responsive: narrow(helios, 60, true, { subtitle: '60 dernières séances · MM 20 et MME 50' }),
        },
      },
      {
        title: 'Bandes de Bollinger',
        caption: 'area (y, y2) + line + candlestick · transform bollinger : middle, upper et lower (period, k écarts-types)',
        wide: true,
        spec: {
          title: 'Boréal Logistique',
          subtitle: 'Moyenne à 20 séances ± 2 écarts-types : le cours sort rarement du couloir',
          data: boreal,
          fields,
          axes: euroAxis,
          layers: [
            { mark: 'area', name: 'Bandes ± 2 σ', encode: { x: 'date', y: 'lower', y2: 'upper' }, transform: bands, style: { color: '$1', opacity: 0.1, line: false } },
            { mark: 'line', name: 'Bandes ± 2 σ', encode: { x: 'date', y: 'upper' }, transform: bands, style: { color: '$1', width: 1, opacity: 0.7 } },
            { mark: 'line', name: 'Bandes ± 2 σ', encode: { x: 'date', y: 'lower' }, transform: bands, style: { color: '$1', width: 1, opacity: 0.7 } },
            { mark: 'line', name: 'Moyenne 20', encode: { x: 'date', y: 'middle' }, transform: bands, style: { color: '$4', width: 1.5 } },
            { mark: 'candlestick', name: 'Cours', encode: candles },
          ],
          scales: { y: { zero: false } },
          interactions: { zoom: { axes: 'x' } },
          // Room around the candles for the bands.
          responsive: narrow(boreal, 60, true, { subtitle: '60 dernières séances · moyenne 20 ± 2 écarts-types' }, 0.22),
        },
      },
      {
        title: 'Heikin-Ashi',
        caption: 'candlestick · transform heikinAshi : les quatre prix sont lissés sur place, le même encodage dessine les bougies ; en haut, les chandeliers d’origine',
        wide: true,
        stack: [220, 220],
        tiles: [
          {
            title: 'Vega Optique · chandeliers classiques', data: vega, fields, axes: { y: { ...euroAxis.y, tickCount: 4 } }, legend: false,
            layers: [{ mark: 'candlestick', encode: candles }],
            scales: { x: { domain: period(vega) }, y: { zero: false } },
            interactions: { sync: 'heikin', zoom: { axes: 'x' } },
            responsive: narrow(vega, 40, true, { title: 'Chandeliers classiques' }),
          },
          {
            title: 'Heikin-Ashi : la tendance sans le bruit', data: vega, fields, axes: { y: { ...euroAxis.y, tickCount: 4 } }, legend: false,
            layers: [{ mark: 'candlestick', encode: candles, transform: [{ type: 'heikinAshi', open: 'open', high: 'high', low: 'low', close: 'close' }] }],
            scales: { x: { domain: period(vega) }, y: { zero: false } },
            interactions: { sync: 'heikin', zoom: { axes: 'x' } },
            responsive: narrow(vega, 40, true, { title: 'Heikin-Ashi' }),
          },
        ],
      },
      {
        title: 'Cours et RSI',
        caption: 'transform rsi (period 14) dans un panneau synchronisé · zone neutre 30-70 en annotation : au-dessus le titre est suracheté, en dessous survendu',
        wide: true,
        stack: [250, 170],
        tiles: [
          {
            title: 'Hélios Énergie · clôture en €', data: helios, fields, axes: bareAxis, legend: false,
            layers: [{ mark: 'line', encode: { x: 'date', y: 'close' }, style: { width: 1.75 } }],
            scales: { x: { domain: period(helios) }, y: { zero: false } },
            interactions: { sync: 'rsi', zoom: { axes: 'x' } },
          },
          {
            title: 'RSI sur 14 séances', data: helios, fields: { date: { label: 'Séance' }, rsi: { label: 'RSI', format: { decimals: 1 } } }, legend: false,
            layers: [{ mark: 'line', encode: { x: 'date', y: 'rsi' }, transform: [{ type: 'rsi', field: 'close', period: 14 }], style: { color: '$7', width: 1.75 } }],
            scales: { x: { domain: period(helios) }, y: { domain: [0, 100], nice: false } },
            axes: { y: { tickCount: 2, format: { decimals: 0 } } },
            annotations: [{ y: [30, 70], color: '$7', opacity: 0.08 }, { y: 70, text: 'Surachat', color: '$muted' }, { y: 30, text: 'Survente', color: '$muted' }],
            interactions: { sync: 'rsi', zoom: { axes: 'x', fitY: false } },
          },
        ],
      },
      {
        title: 'MACD',
        caption: 'transform macd (fast 12, slow 26, signal 9) · lignes macd et signal, écart en barres colorées par leur signe (overrides)',
        wide: true,
        stack: [230, 220],
        tiles: [
          {
            title: 'Boréal Logistique · cours en €', data: boreal, fields, axes: bareAxis, legend: false,
            layers: [{ mark: 'candlestick', encode: candles }],
            scales: { x: { domain: period(boreal) }, y: { zero: false } },
            interactions: { sync: 'macd', zoom: { axes: 'x' } },
            responsive: narrow(boreal, 60, true),
          },
          {
            title: 'MACD (12, 26, 9)', data: boreal, legend: true, autoCompact: false,
            fields: { date: { label: 'Séance' }, histogram: { label: 'Écart', format: { decimals: 2 } }, macd: { label: 'MACD', format: { decimals: 2 } }, signal: { label: 'Signal', format: { decimals: 2 } } },
            axes: { y: { tickCount: 4, format: { decimals: 1 } } },
            layers: [
              {
                mark: 'bar', name: 'Écart', encode: { x: 'date', y: 'histogram' }, transform: macd,
                style: { color: UP, radius: 0, gap: 0, maxWidth: 0, bandPadding: 0.25, opacity: 0.7 },
                overrides: [{ when: { field: 'histogram', lt: 0 }, style: { color: DOWN } }],
              },
              { mark: 'line', name: 'MACD', encode: { x: 'date', y: 'macd' }, transform: macd, style: { color: '$1', width: 1.75 } },
              { mark: 'line', name: 'Signal', encode: { x: 'date', y: 'signal' }, transform: macd, style: { color: '$2', width: 1.75 } },
            ],
            scales: { x: { domain: period(boreal) } },
            interactions: { sync: 'macd', zoom: { axes: 'x' } },
            responsive: narrow(boreal, 60, false),
          },
        ],
      },
      {
        title: 'Cours et volumes',
        caption: 'candlestick + bar synchronisés · volumes colorés selon le sens de la séance (overrides sur clôture − ouverture)',
        wide: true,
        stack: [270, 140],
        tiles: [
          {
            title: 'Boréal Logistique · cours en €', data: boreal, fields, axes: bareAxis, legend: false,
            layers: [{ mark: 'candlestick', encode: candles }],
            scales: { x: { domain: period(boreal) }, y: { zero: false } },
            interactions: { sync: 'volumes', zoom: { axes: 'x' } },
            responsive: narrow(boreal, 60, true),
          },
          {
            title: 'Milliers de titres échangés', data: boreal, fields, legend: false,
            layers: [
              {
                mark: 'bar', encode: { x: 'date', y: 'volume' },
                style: { color: UP, radius: 0, gap: 0, maxWidth: 0, bandPadding: 0.25, opacity: 0.8 },
                overrides: [{ when: { field: 'change', lt: 0 }, style: { color: DOWN } }],
              },
            ],
            scales: { x: { domain: period(boreal) } },
            axes: { y: { tickCount: 3, format: { decimals: 0 } } },
            interactions: { sync: 'volumes', zoom: { axes: 'x' } },
            responsive: narrow(boreal, 60, false),
          },
        ],
      },
      {
        title: 'Renko',
        caption: 'renko · x = date, y = clôture · une brique par mouvement de style.brick (ici 2 €) : le temps disparaît, les tendances restent',
        wide: true,
        spec: {
          title: 'Atlas Industrie en briques de 2 €',
          subtitle: '250 séances · une brique n’apparaît que si le cours a parcouru 2 €',
          data: atlas,
          fields: { close: { label: 'Clôture', format: { suffix: ' €' } } },
          legend: false,
          layers: [{ mark: 'renko', encode: { x: 'date', y: 'close' }, style: { brick: 2 } }],
          responsive: [{ maxWidth: 480, spec: { subtitle: '250 séances, sans l’axe du temps' } }],
        },
      },
      {
        title: 'Renko à briques fines',
        caption: 'renko · style.brick = 1 : plus de briques, plus de retournements ; style.gap et style.radius règlent leur dessin',
        spec: {
          title: 'Atlas Industrie en briques de 1 €',
          data: atlas,
          fields: { close: { label: 'Clôture', format: { suffix: ' €' } } },
          legend: false,
          layers: [{ mark: 'renko', encode: { x: 'date', y: 'close' }, style: { brick: 1, gap: 0, radius: 0 } }],
        },
      },
      {
        title: 'Kagi',
        caption: 'kagi · x = date, y = clôture · la ligne ne tourne qu’après un repli de style.reversal ; trait épais au-dessus du sommet précédent, fin sous le creux précédent',
        wide: true,
        spec: {
          title: 'Atlas Industrie en ligne Kagi',
          subtitle: 'Retournement à 3 € · trait épais : les acheteurs mènent, trait fin : les vendeurs',
          data: atlas,
          fields: { close: { label: 'Clôture', format: { suffix: ' €' } } },
          legend: false,
          layers: [{ mark: 'kagi', encode: { x: 'date', y: 'close' }, style: { reversal: 3 } }],
          responsive: [{ maxWidth: 480, spec: { subtitle: 'Retournement à 3 € · épais : hausse' } }],
        },
      },
    ],
  },
];
