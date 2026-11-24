import { describe, expect, it } from 'vitest';
import { Table } from '../src/data/table';
import { announce, chartKind, chartLabel, chartSummary, dataTable, facetLabel, navGroups, navMove, type A11yInput } from '../src/chart/a11y';
import type { Built, HoverItem, Picked } from '../src/chart/types';
import { englishTexts } from '../src/theme/texts';
import { resolveTheme } from '../src/theme/theme';
import type { HitData } from '../src/marks/registry';
import type { Scale } from '../src/scale/scales';
import type { ChartSpec, LayerSpec } from '../src/spec/types';

/** A built layer as the chart would hold it, from series given as x (category index or number) and values. */
function built(layer: LayerSpec, series: { key: string; x: number[]; value: number[]; hidden?: boolean }[], index = 0, table = Table.from([])): Built {
  const shown = series.filter((s) => !s.hidden);
  const n = shown.reduce((k, s) => k + s.x.length, 0);
  const hit: HitData = { n, tx: new Float32Array(n), ty: new Float32Array(n), x: new Float64Array(n), value: new Float64Array(n), row: new Int32Array(n), series: new Int32Array(n), color: new Float32Array(n * 4) };
  let k = 0;
  series.forEach((s, si) => {
    if (s.hidden) return;
    s.x.forEach((x, i) => {
      hit.x[k] = x;
      hit.value[k] = s.value[i];
      hit.series[k] = si;
      k++;
    });
  });
  return {
    data: {
      layer,
      index,
      table,
      series: series.map((s) => ({ key: s.key, hidden: !!s.hidden, x: new Float64Array(s.x), y0: new Float64Array(s.x.length), y1: new Float64Array(s.value), value: new Float64Array(s.value), rows: new Int32Array(s.x.length) })),
      stacked: false,
      ranged: false,
      stackMode: 'zero',
      colorMode: 'series',
      colorExtent: [0, 1],
      sizeExtent: [0, 1],
    },
    def: { build: () => ({ draws: [], hit }) },
    mark: { draws: [], hit },
  };
}

function standalone(layer: LayerSpec, table: Table, index = 0): Built {
  const b = built(layer, [], index, table);
  b.def.standalone = true;
  return b;
}

const band = (cats: string[]): Scale => ({ type: 'band', norm: (v) => v, invert: (t) => t, ticks: () => [], format: (v) => cats[v] ?? String(v), band: 0.1 });
const linear: Scale = { type: 'linear', norm: (v) => v, invert: (t) => t, ticks: () => [], format: (v) => String(v), band: 0 };

/** The chart's description of datums, with a "k€" format. */
const describer = (all: Built[], cat: Scale) => (picked: Picked[]): HoverItem[] =>
  picked.map((p) => {
    const b = all[p.layer];
    const h = b.mark.hit;
    const v = h.value[p.index];
    return { layer: p.layer, series: b.data.series[h.series[p.index]].key, x: h.x[p.index], xLabel: cat.format(h.x[p.index]), value: v, valueLabel: `${v.toLocaleString('fr-FR')} k€`, color: '#000', row: {} };
  });

const input = (spec: ChartSpec, all: Built[], cat: Scale, o: Partial<A11yInput> = {}): A11yInput => ({ spec, built: all, cat, horizontal: false, mode: 'x', describe: describer(all, cat), ...o });

const shops = ['Atlas', 'Nova', 'Orion', 'Lyra', 'Vega', 'Helios'];
const revenue = [4276, 3800, 3000, 2600, 1200, 704];
const barLayer: LayerSpec = { mark: 'bar', encode: { x: 'shop', y: 'revenue' } };
const barSpec: ChartSpec = { title: 'Chiffre d’affaires', subtitle: 'Par boutique', fields: { revenue: { label: 'CA' }, shop: { label: 'Boutique' } }, layers: [barLayer] };

describe('accessibilité : résumé', () => {
  it('nomme le type de graphique', () => {
    expect(chartKind(['bar'])).toBe('Barres');
    expect(chartKind(['bar', 'line', 'line'])).toBe('Barres et lignes');
    expect(chartKind(['bar', 'line', 'point'])).toBe('Barres, lignes et nuage de points');
    expect(chartKind(['inconnue'])).toBe('Graphique');
  });

  it('barres : catégories, plage des valeurs et extrêmes', () => {
    const all = [built(barLayer, [{ key: 'CA', x: [0, 1, 2, 3, 4, 5], value: revenue }])];
    expect(chartSummary(input(barSpec, all, band(shops)))).toBe(`Barres, 6 catégories, de 704 k€ (Helios) à ${(4276).toLocaleString('fr-FR')} k€ (Atlas)`);
  });

  it('plusieurs séries : leur nombre, leurs noms, et la série des extrêmes', () => {
    const all = [
      built({ mark: 'bar', encode: { x: 'm', y: 'v', color: 's' } }, [
        { key: 'Nord', x: [0, 1, 2], value: [10, 20, 30] },
        { key: 'Sud', x: [0, 1, 2], value: [5, 25, 40] },
      ]),
    ];
    expect(chartSummary(input({ layers: [all[0].data.layer] }, all, band(['jan', 'fév', 'mar'])))).toBe('Barres, 2 séries (Nord, Sud), 3 catégories, de 5 k€ (jan, Sud) à 40 k€ (mar, Sud)');
  });

  it('une série masquée par la légende ne compte plus', () => {
    const all = [
      built({ mark: 'bar', encode: { x: 'm', y: 'v', color: 's' } }, [
        { key: 'Nord', x: [0, 1, 2], value: [10, 20, 30] },
        { key: 'Sud', x: [0, 1, 2], value: [5, 25, 40], hidden: true },
      ]),
    ];
    expect(chartSummary(input({ layers: [all[0].data.layer] }, all, band(['jan', 'fév', 'mar'])))).toBe('Barres, 3 catégories, de 10 k€ (jan) à 30 k€ (mar)');
  });

  it('axe continu : nombre de points et étendue de x, extrêmes nommés par leur mesure', () => {
    const layer: LayerSpec = { mark: 'line', encode: { x: 'jour', y: 'ventes' } };
    const all = [built(layer, [{ key: 'Ventes', x: [1, 2, 3, 4], value: [8, 3, 9, 5] }])];
    const spec: ChartSpec = { fields: { jour: { label: 'Jour' }, ventes: { label: 'Ventes' } }, layers: [layer] };
    expect(chartSummary(input(spec, all, linear))).toBe('Lignes, 4 points, Jour de 1 à 4, Ventes de 3 k€ (2) à 9 k€ (3)');
  });

  it('double axe : les extrêmes de chaque mesure à part', () => {
    const a: LayerSpec = { mark: 'bar', encode: { x: 'm', y: 'ca' } };
    const b: LayerSpec = { mark: 'line', axis: 'secondary', encode: { x: 'm', y: 'marge' } };
    const all = [built(a, [{ key: 'CA', x: [0, 1], value: [100, 200] }], 0), built(b, [{ key: 'Marge', x: [0, 1], value: [0.3, 0.1] }], 1)];
    const spec: ChartSpec = { fields: { ca: { label: 'CA' }, marge: { label: 'Marge' } }, layers: [a, b] };
    expect(chartSummary(input(spec, all, band(['T1', 'T2'])))).toBe(
      'Barres et lignes, 2 séries (CA, Marge), 2 catégories, CA de 100 k€ (T1, CA) à 200 k€ (T2, CA), Marge de 0,1 k€ (T2, Marge) à 0,3 k€ (T1, Marge)',
    );
  });

  it('les calques d’annotations ne comptent pas', () => {
    const all = [standalone({ mark: 'rule', encode: {} }, Table.from([]), -1), built(barLayer, [{ key: 'CA', x: [0, 1], value: [1, 2] }])];
    expect(chartSummary(input(barSpec, all, band(shops)))).toBe('Barres, 2 catégories, de 1 k€ (Atlas) à 2 k€ (Nova)');
  });

  it('marque autonome : éléments, mesure et extrêmes depuis la table du calque', () => {
    const layer: LayerSpec = { mark: 'pie', encode: { key: 'pays', value: 'surface' } };
    const t = Table.from([
      { pays: 'France', surface: 552 },
      { pays: 'Espagne', surface: 506 },
      { pays: 'Malte', surface: 3 },
    ]);
    const spec: ChartSpec = { fields: { surface: { label: 'Superficie', format: { suffix: ' k km²' } } }, layers: [layer] };
    expect(chartSummary(input(spec, [standalone(layer, t)], linear))).toBe('Secteurs, 3 éléments, Superficie de 3 k km² (Malte) à 552 k km² (France)');
  });

  it('diagramme de flux : étapes et liens', () => {
    const layer: LayerSpec = { mark: 'flow', encode: {}, graph: { nodes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], edges: [{ from: 'a', to: 'b' }] } as LayerSpec['graph'] };
    expect(chartSummary(input({ layers: [layer] }, [standalone(layer, Table.from([]))], linear))).toBe('Diagramme de flux, 3 étapes, 1 lien');
    expect(dataTable(input({ layers: [layer] }, [standalone(layer, Table.from([]))], linear))).toBeNull();
  });

  it('nom de la figure : titre, sous-titre, puis la description de la spec si elle est donnée', () => {
    expect(chartLabel(barSpec, 'Barres, 6 catégories')).toBe('Chiffre d’affaires. Par boutique. Barres, 6 catégories');
    expect(chartLabel({ ...barSpec, description: 'Atlas mène.' }, 'Barres')).toBe('Chiffre d’affaires. Par boutique. Atlas mène');
    expect(chartLabel({}, 'Barres')).toBe('Barres');
    expect(facetLabel({ layers: [], title: 'Ventes', facet: { field: 'r' }, fields: { r: { label: 'Région' } } }, 4)).toBe('Ventes. Petits multiples, 4 panneaux par Région');
  });

  it('en anglais avec englishTexts : résumé, tableau, annonce et petits multiples', () => {
    const all = [built(barLayer, [{ key: 'CA', x: [0, 1, 2, 3, 4, 5], value: revenue }])];
    const o = { ...input(barSpec, all, band(shops)), texts: englishTexts };
    expect(chartSummary(o)).toBe(`Bars, 6 categories, from 704 k€ (Helios) to ${(4276).toLocaleString('fr-FR')} k€ (Atlas)`);
    expect(chartKind(['bar', 'line', 'point'], englishTexts)).toBe('Bars, lines and scatter plot');
    expect(chartKind(['inconnue'], englishTexts)).toBe('Chart');
    expect(chartSummary({ ...o, built: [] })).toBe('Chart, no data shown');
    expect(dataTable({ ...o, spec: {} as ChartSpec }, 2)?.caption).toBe('Chart data');
    const item: HoverItem = { layer: 0, series: 'CA', x: 'Atlas', xLabel: 'Atlas', value: 4276, valueLabel: '4276 k€', color: '#000', row: {} };
    expect(announce(item, 1, 6, false, englishTexts)).toBe('Atlas: 4276 k€, 1 of 6');
    expect(facetLabel({ layers: [], facet: { field: 'r' } }, 1, englishTexts)).toBe('Small multiples, 1 panel by r');
    // One name overridden from a spec, the others kept.
    const t = resolveTheme({ texts: { markNames: { bar: 'Bâtons' } } }).texts;
    expect(chartKind(['bar', 'line'], t)).toBe('Bâtons et lignes');
  });
});

describe('accessibilité : tableau de données', () => {
  it('une ligne par catégorie, une colonne par série, valeurs formatées', () => {
    const all = [
      built({ mark: 'bar', encode: { x: 'm', y: 'v', color: 's' } }, [
        { key: 'Nord', x: [0, 1, 2], value: [10, 20, 30] },
        { key: 'Sud', x: [0, 2], value: [5, 40] },
      ]),
    ];
    const t = dataTable(input({ title: 'Ventes', fields: { m: { label: 'Mois' } }, layers: [all[0].data.layer] }, all, band(['jan', 'fév', 'mar'])))!;
    expect(t.caption).toBe('Ventes');
    expect(t.head).toEqual(['Mois', 'Nord', 'Sud']);
    expect(t.rows).toEqual([
      ['jan', '10 k€', '5 k€'],
      ['fév', '20 k€', ''],
      ['mar', '30 k€', '40 k€'],
    ]);
    expect(t.more).toBe(0);
  });

  it('une ligne et ses points (deux calques, même série) : une seule colonne', () => {
    const a = built({ mark: 'line', encode: { x: 'm', y: 'v' } }, [{ key: 'V', x: [0, 1], value: [1, 2] }], 0);
    const b = built({ mark: 'point', encode: { x: 'm', y: 'v' } }, [{ key: 'V', x: [0, 1], value: [1, 2] }], 1);
    const t = dataTable(input({ layers: [a.data.layer, b.data.layer] }, [a, b], band(['a', 'b'])))!;
    expect(t.head).toEqual(['m', 'V']);
    expect(t.rows).toEqual([['a', '1 k€'], ['b', '2 k€']]);
  });

  it('plafonné : les lignes en trop sont comptées', () => {
    const x = Array.from({ length: 120 }, (_, i) => i);
    const all = [built(barLayer, [{ key: 'CA', x, value: x }])];
    const t = dataTable(input(barSpec, all, band(x.map(String))))!;
    expect(t.rows).toHaveLength(50);
    expect(t.more).toBe(70);
  });

  it('nuage (mode nearest) : une ligne par point', () => {
    const layer: LayerSpec = { mark: 'point', encode: { x: 'surface', y: 'ca', color: 'type' } };
    const all = [built(layer, [{ key: 'A', x: [1, 2], value: [3, 4] }, { key: 'B', x: [5], value: [6] }])];
    const spec: ChartSpec = { fields: { surface: { label: 'Surface' }, ca: { label: 'CA' } }, layers: [layer] };
    const t = dataTable(input(spec, all, linear, { mode: 'nearest' }))!;
    expect(t.head).toEqual(['Série', 'Surface', 'CA']);
    expect(t.rows).toEqual([['A', '1', '3 k€'], ['A', '2', '4 k€'], ['B', '5', '6 k€']]);
  });

  it('marque autonome : les champs encodés de la table du calque', () => {
    const layer: LayerSpec = { mark: 'pie', encode: { key: 'pays', value: 'surface' } };
    const t = Table.from([{ pays: 'France', surface: 552, autre: 1 }, { pays: 'Malte', surface: 3, autre: 2 }]);
    const spec: ChartSpec = { title: 'Superficies', fields: { pays: { label: 'Pays' }, surface: { label: 'Superficie', format: { suffix: ' k km²' } } }, layers: [layer] };
    const table = dataTable(input(spec, [standalone(layer, t)], linear))!;
    expect(table).toEqual({ caption: 'Superficies', head: ['Pays', 'Superficie'], rows: [['France', '552 k km²'], ['Malte', '3 k km²']], more: 0 });
  });
});

describe('accessibilité : parcours au clavier', () => {
  const all = [
    built({ mark: 'line', encode: { x: 'm', y: 'v', color: 's' } }, [
      { key: 'Nord', x: [2, 0, 1], value: [30, 10, 20] },
      { key: 'Sud', x: [0, 3], value: [5, 40] },
    ], 0),
    // The points of the same line: the same datums, walked once.
    built({ mark: 'point', encode: { x: 'm', y: 'v', color: 's' } }, [{ key: 'Nord', x: [0, 1, 2], value: [10, 20, 30] }], 1),
  ];

  it('un groupe par série, trié par x, sans doublon', () => {
    const groups = navGroups(all);
    expect(groups.map((g) => g.key)).toEqual(['Nord', 'Sud']);
    expect(groups[0].x).toEqual([0, 1, 2]);
    expect(groups[0].points.every((p) => p.layer === 0)).toBe(true);
    expect(groups[1].x).toEqual([0, 3]);
  });

  it('flèches, début, fin et changement de série', () => {
    const g = navGroups(all);
    let pos = navMove(g, undefined, 'ArrowRight');
    expect(pos).toEqual({ g: 0, i: 0 });
    pos = navMove(g, pos, 'ArrowLeft');
    expect(pos).toEqual({ g: 0, i: 0 });
    pos = navMove(g, pos, 'End');
    expect(pos).toEqual({ g: 0, i: 2 });
    pos = navMove(g, pos, 'ArrowRight');
    expect(pos).toEqual({ g: 0, i: 2 });
    // x = 2: on Sud, the closest x is 3.
    pos = navMove(g, pos, 'ArrowDown');
    expect(pos).toEqual({ g: 1, i: 1 });
    expect(navMove(g, pos, 'ArrowDown')).toEqual(pos);
    expect(navMove(g, pos, 'ArrowUp')).toEqual({ g: 0, i: 2 });
    expect(navMove(g, undefined, 'End')).toEqual({ g: 0, i: 2 });
    expect(navMove([], undefined, 'ArrowRight')).toBeUndefined();
  });

  it('annonce : catégorie, valeur et rang (la série d’abord s’il y en a plusieurs)', () => {
    const item: HoverItem = { layer: 0, series: 'CA', x: 'Atlas', xLabel: 'Atlas', value: 4276, valueLabel: '4276 k€', color: '#000', row: {} };
    expect(announce(item, 1, 6, false)).toBe('Atlas : 4276 k€, 1 sur 6');
    expect(announce(item, 2, 6, true)).toBe('CA, Atlas : 4276 k€, 2 sur 6');
  });
});
