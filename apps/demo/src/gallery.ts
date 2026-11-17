import { createChart, type Chart, type ChartSpec, type ChartView } from '@futurcharts/core';
import { CATEGORIES, CHANNELS, COUNTRIES, DASHBOARDS, type Card, type Dashboard, type Filters } from './dashboards';
import { entries, GROUPS, PALETTES, type Entry } from './library';

// ------------------------------------------------------------------ state

const store = {
  get(key: string) {
    try {
      return localStorage.getItem(`futurcharts:${key}`);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(`futurcharts:${key}`, value);
    } catch {
      /* private mode: preferences simply do not persist */
    }
  },
};

let mode: 'light' | 'dark' = store.get('mode') === 'dark' ? 'dark' : 'light';
let palette = store.get('palette') ?? 'default';
const filters: Filters = { period: 90 };

const themeFor = (): ChartSpec['theme'] => {
  const p = PALETTES[palette] ?? PALETTES.default;
  if (!p.light.length) return mode;
  return { extends: mode, palette: { categorical: mode === 'dark' ? p.dark : p.light, sequential: mode === 'dark' ? [...p.ramp].reverse() : p.ramp } };
};

const slug = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '');

// ------------------------------------------------------------- navigation

const ICONS: Record<string, string> = {
  ventes: '<path d="M3 17l5-5 4 4 8-8" /><path d="M14 8h6v6" />',
  operations: '<circle cx="12" cy="12" r="8" /><path d="M12 7v5l3 2" />',
  donnees: '<circle cx="5" cy="12" r="2" /><circle cx="19" cy="6" r="2" /><circle cx="19" cy="18" r="2" /><path d="M7 12h4l6-6M11 12l6 6" />',
  lib: '<rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" />',
};
const icon = (name: string) =>
  `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] ?? ICONS.lib}</svg>`;

const families = GROUPS.map(([name, titles]) => ({
  id: slug(name),
  name,
  entries: titles.map((t) => entries.find((e) => e.title === t)).filter((e): e is Entry => !!e),
}));

function buildNav() {
  const nav = document.getElementById('nav')!;
  const count = (list: Entry[]) => list.reduce((a, e) => a + (e.tiles?.length ?? 1), 0);
  nav.innerHTML = `
    <h3>Tableaux de bord</h3>
    ${DASHBOARDS.map((d) => `<a href="#/${d.id}" data-route="${d.id}">${icon(d.id)}${d.title}</a>`).join('')}
    <h3 style="margin-top:18px">Bibliothèque</h3>
    ${families.map((f) => `<a href="#/bib/${f.id}" data-route="bib/${f.id}">${icon('lib')}${f.name}<span class="count">${count(f.entries)}</span></a>`).join('')}`;
}

// --------------------------------------------------------------- rendering

interface Mounted {
  card: Card;
  charts: ChartView[];
  root: HTMLElement;
}
let mounted: Mounted[] = [];
let current: { dashboard?: Dashboard; family?: (typeof families)[number] } = {};

const withTheme = (spec: ChartSpec): ChartSpec => ({ ...spec, title: undefined, subtitle: undefined, theme: themeFor() });
const tileSpec = (spec: ChartSpec): ChartSpec => ({ ...spec, theme: themeFor() });

function cardsForFamily(f: (typeof families)[number]): Card[] {
  return f.entries.map((e) => {
    const spec = e.spec ?? { layers: [] };
    const isFlow = spec.layers.some((l) => l.mark === 'flow' || l.mark === 'network' || l.mark === 'chord' || l.mark === 'pack');
    return {
      id: slug(e.title),
      title: spec.title ?? e.title,
      subtitle: spec.subtitle,
      span: e.wide ? 12 : 6,
      height: e.tiles ? 'xs' : isFlow ? 'l' : 'm',
      bare: !!e.tiles,
      spec,
      tiles: e.tiles,
      note: e.caption,
      showLayout: e.showLayout,
    } satisfies Card;
  });
}

async function mountCard(board: HTMLElement, card: Card): Promise<Mounted> {
  const el = document.createElement('section');
  el.className = `card span-${card.span} h-${card.height}${card.bare ? ' bare' : ''}`;
  el.innerHTML = `<header><div><h2></h2><p></p></div><button class="menu" type="button" aria-label="Options du graphique">⋯</button></header>`;
  el.querySelector('h2')!.textContent = card.title;
  const sub = el.querySelector('header p')!;
  sub.textContent = card.subtitle ?? '';
  board.appendChild(el);

  const body = document.createElement('div');
  body.className = card.tiles ? 'body tiles' : 'body';
  el.appendChild(body);
  if (card.spec.facet) body.style.height = 'auto';
  const m: Mounted = { card, charts: [], root: el };
  const specs = card.tiles ?? [card.spec];
  for (const spec of specs) {
    const box = document.createElement('div');
    box.style.height = '100%';
    box.style.minWidth = '0';
    body.appendChild(box);
    try {
      const chart = await createChart(box, card.tiles ? tileSpec(spec) : withTheme(spec));
      m.charts.push(chart);
      wire(m, chart);
    } catch (error) {
      box.textContent = String(error);
      console.error(card.title, error);
    }
  }
  if (card.showLayout) {
    const pre = document.createElement('pre');
    pre.textContent = 'Déplacez une étape : les positions à enregistrer dans le JSON s’affichent ici.';
    el.appendChild(pre);
    m.charts[0]?.on('layout', ({ positions }) => {
      pre.textContent = `{\n${Object.entries(positions).map(([id, p]) => `  "${id}": { "x": ${p.x}, "y": ${p.y} }`).join(',\n')}\n}`;
    });
  }
  if (card.note) {
    const foot = document.createElement('footer');
    foot.textContent = card.note;
    el.appendChild(foot);
  }
  el.querySelector('.menu')!.addEventListener('click', (ev) => openMenu(ev.currentTarget as HTMLElement, m));
  return m;
}

/** Cross-filtering: a click on a card that owns a dimension sets (or clears) that filter. */
function wire(m: Mounted, chart: ChartView) {
  const key = m.card.filter;
  if (!key) return;
  chart.on('drill', ({ path }) => setFilter(key, path[0]));
  chart.on('click', ({ items }) => {
    const value = items[0]?.row?.[key] as string | undefined;
    if (value !== undefined) setFilter(key, filters[key] === value ? undefined : value);
  });
}

function setFilter(key: keyof Filters, value: string | undefined) {
  if (key === 'period') return;
  if (filters[key] === value) return;
  filters[key] = value as never;
  if (value === undefined) {
    // The card that owned the filter forgets its own focus (a pulled-out slice…).
    for (const m of mounted) if (m.card.filter === key) for (const c of m.charts) (c as Chart).resetInteractions?.();
  }
  refresh();
}

/** Redraw the current dashboard with new filters or a new theme, keeping every chart (and its zoom, drill, layout). */
function refresh() {
  renderFilters();
  if (current.dashboard) {
    const cards = current.dashboard.cards(filters);
    for (const m of mounted) {
      const next = cards.find((c) => c.id === m.card.id);
      if (!next) continue;
      m.card = { ...next, filter: m.card.filter };
      m.root.querySelector('header p')!.textContent = next.subtitle ?? '';
      const specs = next.tiles ?? [next.spec];
      m.charts.forEach((c, i) => c.update(next.tiles ? tileSpec(specs[i]) : withTheme(specs[i])));
    }
  } else {
    for (const m of mounted) {
      const specs = m.card.tiles ?? [m.card.spec];
      m.charts.forEach((c, i) => c.update(m.card.tiles ? tileSpec(specs[i]) : withTheme(specs[i])));
    }
  }
}

function renderFilters() {
  const box = document.getElementById('filters')!;
  const chips = document.getElementById('chips')!;
  box.replaceChildren();
  chips.replaceChildren();
  if (!current.dashboard?.filters) return;
  const seg = document.createElement('div');
  seg.className = 'seg';
  for (const [p, label] of [[30, '30 j'], [90, '90 j'], [365, '12 mois']] as const) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.setAttribute('aria-pressed', String(filters.period === p));
    b.addEventListener('click', () => {
      filters.period = p;
      refresh();
    });
    seg.appendChild(b);
  }
  box.appendChild(seg);
  const select = (key: 'country' | 'channel' | 'category', all: string, values: string[]) => {
    const s = document.createElement('select');
    s.setAttribute('aria-label', all);
    s.add(new Option(all, ''));
    for (const v of values) s.add(new Option(v, v));
    s.value = filters[key] ?? '';
    s.addEventListener('change', () => setFilter(key, s.value || undefined));
    box.appendChild(s);
  };
  select('country', 'Tous les pays', COUNTRIES.map((c) => c[0]));
  select('channel', 'Tous les canaux', CHANNELS.map((c) => c[0]));
  select('category', 'Toutes les catégories', CATEGORIES.map((c) => c[0]));
  for (const key of ['country', 'channel', 'category'] as const) {
    const v = filters[key];
    if (!v) continue;
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.innerHTML = `<b></b><span aria-hidden="true">×</span>`;
    chip.querySelector('b')!.textContent = v;
    chip.setAttribute('aria-label', `Retirer le filtre ${v}`);
    chip.addEventListener('click', () => setFilter(key, undefined));
    chips.appendChild(chip);
  }
}

async function render() {
  closeMenu();
  for (const m of mounted) for (const c of m.charts) c.destroy();
  mounted = [];
  const board = document.getElementById('board')!;
  board.replaceChildren();
  const route = location.hash.replace(/^#\/?/, '') || DASHBOARDS[0].id;
  document.querySelectorAll<HTMLAnchorElement>('#nav a').forEach((a) => (a.getAttribute('data-route') === route ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  document.getElementById('app')!.classList.remove('open');
  const dashboard = DASHBOARDS.find((d) => d.id === route);
  const family = families.find((f) => `bib/${f.id}` === route);
  current = { dashboard, family };
  const title = document.getElementById('title')!;
  const subtitle = document.getElementById('subtitle')!;
  let cards: Card[];
  if (dashboard) {
    title.textContent = dashboard.title;
    subtitle.textContent = dashboard.subtitle;
    cards = dashboard.cards(filters);
  } else {
    const f = family ?? families[0];
    title.textContent = f.name;
    subtitle.textContent = 'Bibliothèque · chaque graphique est une spec JSON, ouvrez le menu ⋯ pour la voir';
    cards = cardsForFamily(f);
  }
  renderFilters();
  window.scrollTo(0, 0);
  for (const card of cards) mounted.push(await mountCard(board, card));
  (window as any).gallery = mounted.flatMap((m) => m.charts);
}

// ---------------------------------------------------------- card menu

let popover: HTMLElement | undefined;
function closeMenu() {
  popover?.remove();
  popover = undefined;
}

/** The spec as an app would store it: data rows summarized, typed arrays and GeoJSON elided. */
function printable(spec: ChartSpec): unknown {
  return JSON.parse(
    JSON.stringify(spec, (key, value) => {
      if (key === 'theme') return undefined;
      if (key === 'geo') return '[GeoJSON : contours des pays]';
      if (key === 'data' && Array.isArray(value)) return value.length > 3 ? [...value.slice(0, 3), `… ${value.length - 3} lignes de plus`] : value;
      if (key === 'columns' && value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, `[${(v as ArrayLike<unknown>).length} valeurs]`]));
      }
      if (ArrayBuffer.isView(value)) return `[${(value as unknown as ArrayLike<unknown>).length} valeurs]`;
      return value;
    }),
  );
}

function openMenu(anchor: HTMLElement, m: Mounted) {
  closeMenu();
  const pop = document.createElement('div');
  pop.className = 'popover';
  const chart = m.charts[0] as Chart | undefined;
  const actions: [string, () => void][] = [
    [
      'Voir la spec JSON',
      () => {
        const dlg = document.getElementById('json') as HTMLDialogElement;
        document.getElementById('json-title')!.textContent = m.card.title;
        const specs = m.card.tiles ?? [{ ...m.card.spec, title: m.card.title, subtitle: m.card.subtitle }];
        document.getElementById('json-body')!.textContent = JSON.stringify(specs.length === 1 ? printable(specs[0]) : specs.map(printable), null, 2);
        dlg.showModal();
      },
    ],
  ];
  if (chart?.toImage) {
    actions.push([
      'Exporter en PNG',
      () => {
        const a = document.createElement('a');
        a.href = chart.toImage();
        a.download = `${slug(m.card.title)}.png`;
        a.click();
      },
    ]);
  }
  if (chart?.resetInteractions) actions.push(['Réinitialiser la vue', () => m.charts.forEach((c) => (c as Chart).resetInteractions?.())]);
  for (const [label, run] of actions) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.addEventListener('click', () => {
      closeMenu();
      run();
    });
    pop.appendChild(b);
  }
  document.body.appendChild(pop);
  const r = anchor.getBoundingClientRect();
  pop.style.top = `${r.bottom + 4}px`;
  pop.style.left = `${Math.max(8, r.right - pop.offsetWidth)}px`;
  popover = pop;
}
document.addEventListener('pointerdown', (e) => {
  if (popover && !popover.contains(e.target as Node) && !(e.target as HTMLElement).closest('.menu')) closeMenu();
});
document.addEventListener('keydown', (e) => e.key === 'Escape' && closeMenu());
document.getElementById('json-close')!.addEventListener('click', () => (document.getElementById('json') as HTMLDialogElement).close());

// ------------------------------------------------------------- toolbar

const themeButton = document.getElementById('theme')!;
const applyMode = () => {
  document.documentElement.dataset.theme = mode;
  themeButton.textContent = mode === 'light' ? 'Sombre' : 'Clair';
};
themeButton.addEventListener('click', () => {
  mode = mode === 'light' ? 'dark' : 'light';
  store.set('mode', mode);
  applyMode();
  refresh();
});
const paletteSelect = document.getElementById('palette') as HTMLSelectElement;
for (const [key, p] of Object.entries(PALETTES)) paletteSelect.add(new Option(`Couleurs : ${p.label}`, key));
paletteSelect.value = palette;
paletteSelect.addEventListener('change', () => {
  palette = paletteSelect.value;
  store.set('palette', palette);
  refresh();
});
document.getElementById('menu-toggle')!.addEventListener('click', () => document.getElementById('app')!.classList.toggle('open'));

applyMode();
buildNav();
window.addEventListener('hashchange', render);
render();
