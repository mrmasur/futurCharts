import { createChart, createSpreadsheet, type Chart, type ChartSpec, type ChartView, type Spreadsheet, type WorkbookSpec } from '@futurcharts/core';
import { ordersSheet, projectWorkbook } from './sheets';
import { auditCharts } from './audit';
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
  nav.innerHTML = `
    <h3>Tableaux de bord</h3>
    ${DASHBOARDS.map((d) => `<a href="#/${d.id}" data-route="${d.id}">${icon(d.id)}${d.title}</a>`).join('')}
    <h3 style="margin-top:18px">Galerie</h3>
    <a href="#/tableur" data-route="tableur">${icon('lib')}Tableur</a>
    <a href="#/galerie" data-route="galerie">${icon('lib')}Tous les graphiques<span class="count">${entries.length}</span></a>
    ${families.map((f) => `<a href="#/galerie/${f.id}" data-route="galerie/${f.id}" class="sub">${f.name}<span class="count">${f.entries.length}</span></a>`).join('')}`;
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
    const isFlow = spec.layers.some((l) => ['flow', 'network', 'chord', 'pack', 'race', 'tree', 'icicle', 'venn', 'wordcloud', 'timeline', 'ridgeline', 'horizon', 'splom', 'scatter3d', 'polarHeatmap', 'globe'].includes(l.mark));
    return {
      id: slug(e.title),
      title: spec.title ?? e.title,
      subtitle: spec.subtitle,
      span: e.wide ? 12 : 6,
      height: e.tiles ? 'xs' : isFlow ? 'l' : 'm',
      bare: !!e.tiles && !e.stack,
      spec,
      tiles: e.tiles,
      stack: e.stack,
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
  body.className = card.stack ? 'body stack' : card.tiles ? 'body tiles' : 'body';
  el.appendChild(body);
  if (card.spec.facet) body.style.height = 'auto';
  const m: Mounted = { card, charts: [], root: el };
  const specs = card.tiles ?? [card.spec];
  for (const [i, spec] of specs.entries()) {
    const box = document.createElement('div');
    // Small multiples take the height they need (the card grows); everything else fills the card.
    box.style.height = card.stack ? `${card.stack[i] ?? 160}px` : spec.facet ? 'auto' : '100%';
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
    for (const c of thumbCharts) c.update({ ...c.getSpec(), theme: thumbTheme() });
    for (const s of sheets) {
      const cur = s.getSpec();
      s.update('sheets' in cur ? ({ ...cur, theme: themeFor(), sheets: cur.sheets.map((x) => ({ ...x, theme: undefined })) } as WorkbookSpec) : { ...cur, theme: themeFor() });
    }
  }
}

function renderFilters() {
  const box = document.getElementById('filters')!;
  const chips = document.getElementById('chips')!;
  if (!current.dashboard?.filters && box.querySelector('.search, .btn')) return;
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

// ------------------------------------------------------------------ gallery

let thumbObserver: IntersectionObserver | undefined;
let thumbCharts: ChartView[] = [];

/** A small, quiet version of the theme for previews. */
const thumbTheme = (): ChartSpec['theme'] => {
  const base = themeFor();
  const overrides = { padding: 8, legend: { label: { size: 10 }, symbolSize: 7, itemGap: 10 }, axis: { label: { size: 9 } } };
  return typeof base === 'string' ? { extends: base, ...overrides } : { ...base, ...overrides };
};

const marksOf = (e: Entry) => [...new Set((e.tiles ?? [e.spec!]).flatMap((s) => s.layers.map((l) => l.mark)))];

function familyOf(e: Entry) {
  return families.find((f) => f.entries.includes(e));
}

function renderGallery(board: HTMLElement, only?: (typeof families)[number]) {
  const list = only ? [only] : families;
  const search = document.createElement('input');
  search.type = 'search';
  search.placeholder = 'Rechercher un graphique, une marque…';
  search.className = 'search';
  search.setAttribute('aria-label', 'Rechercher un graphique');
  document.getElementById('filters')!.appendChild(search);
  thumbObserver = new IntersectionObserver(
    (seen) => {
      for (const it of seen) {
        if (!it.isIntersecting) continue;
        const box = it.target as HTMLElement & { entry?: Entry };
        thumbObserver!.unobserve(box);
        const e = box.entry!;
        const spec = e.tiles ? e.tiles[0] : e.spec!;
        // Fewer bars in a race preview, so each name stays legible.
        const layers = spec.layers.map((l) => (l.mark === 'race' ? { ...l, style: { ...l.style, top: 6 } } : l));
        createChart(box, { ...spec, layers, title: undefined, subtitle: undefined, theme: thumbTheme(), interactions: { tooltip: false, player: false } })
          .then((c) => thumbCharts.push(c))
          .catch((error) => (box.textContent = String(error)));
      }
    },
    { rootMargin: '200px' },
  );
  const cards: { el: HTMLElement; text: string; section: HTMLElement }[] = [];
  for (const f of list) {
    const section = document.createElement('section');
    section.className = 'gal-section';
    section.innerHTML = `<h2 class="section-title"></h2><div class="thumbs"></div>`;
    section.querySelector('h2')!.textContent = `${f.name} · ${f.entries.length}`;
    const grid = section.querySelector('.thumbs')!;
    for (const e of f.entries) {
      const a = document.createElement('a');
      a.className = 'thumb';
      a.href = `#/demo/${slug(e.title)}`;
      const preview = document.createElement('div') as HTMLDivElement & { entry?: Entry };
      preview.className = 'preview';
      preview.entry = e;
      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.innerHTML = `<h3></h3><p></p>`;
      meta.querySelector('h3')!.textContent = e.title;
      meta.querySelector('p')!.textContent = marksOf(e).join(' · ');
      a.append(preview, meta);
      grid.appendChild(a);
      thumbObserver.observe(preview);
      cards.push({ el: a, text: `${e.title} ${e.caption} ${marksOf(e).join(' ')} ${f.name}`.toLowerCase(), section });
    }
    board.appendChild(section);
  }
  search.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    for (const c of cards) c.el.hidden = !!q && !q.split(/\s+/).every((w) => c.text.includes(w));
    for (const sec of board.querySelectorAll<HTMLElement>('.gal-section')) sec.hidden = !sec.querySelector('.thumb:not([hidden])');
  });
}

async function renderDemo(board: HTMLElement, e: Entry) {
  const f = familyOf(e);
  const list = f?.entries ?? [e];
  const i = list.indexOf(e);
  const nav = document.getElementById('filters')!;
  const link = (target: Entry | undefined, label: string) => {
    const a = document.createElement('a');
    a.className = 'btn';
    a.textContent = label;
    if (target) a.href = `#/demo/${slug(target.title)}`;
    else a.setAttribute('aria-disabled', 'true');
    return a;
  };
  const back = document.createElement('a');
  back.className = 'btn';
  back.href = f ? `#/galerie/${f.id}` : '#/galerie';
  back.textContent = `← ${f?.name ?? 'Galerie'}`;
  nav.append(back, link(list[i - 1], '‹ Précédent'), link(list[i + 1], 'Suivant ›'));
  // Data states: switching one is a transition (the chart keeps each datum's identity).
  if (e.states) {
    const seg = document.createElement('div');
    seg.className = 'seg';
    e.states.forEach((st, k) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = st.label;
      b.setAttribute('aria-pressed', String(k === 0));
      b.addEventListener('click', () => {
        for (const o of seg.querySelectorAll('button')) o.setAttribute('aria-pressed', String(o === b));
        for (const c of mounted.flatMap((m) => m.charts)) c.update({ ...c.getSpec(), data: st.data });
      });
      seg.appendChild(b);
    });
    nav.appendChild(seg);
  }
  const card = cardsForFamily({ id: 'x', name: '', entries: [e] })[0];
  card.span = 12;
  card.height = card.tiles ? 'xs' : 'l';
  mounted.push(await mountCard(board, card));
  // What it is, and the spec that draws it.
  const info = document.createElement('section');
  info.className = 'card span-12 info';
  const specs = e.tiles ?? [e.spec!];
  const json = JSON.stringify(specs.length === 1 ? printable(specs[0]) : specs.map(printable), null, 2);
  info.innerHTML = `<div class="about"><h2>À propos</h2><p></p><h2>Marques</h2><div class="tags"></div></div><div class="code"><div class="code-head"><h2>Spec JSON</h2><button class="btn" type="button">Copier</button></div><pre></pre></div>`;
  info.querySelector('.about p')!.textContent = e.caption;
  info.querySelector('.tags')!.innerHTML = marksOf(e).map((m) => `<code>${m}</code>`).join(' ');
  info.querySelector('pre')!.textContent = json;
  const copy = info.querySelector('.code button') as HTMLButtonElement;
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(json);
      copy.textContent = 'Copié';
    } catch {
      copy.textContent = 'Copie impossible';
    }
    setTimeout(() => (copy.textContent = 'Copier'), 1500);
  });
  board.appendChild(info);
}

let sheets: Spreadsheet[] = [];

/** The spreadsheet page: a budget with formulas, and 10 000 orders to scroll. */
async function renderSheets(board: HTMLElement) {
  const help = document.createElement('p');
  help.className = 'sheet-help';
  help.textContent =
    'Double-clic ou saisie pour modifier · formules (=SOMME(B1:E1), =SI(…), =Budget!F1) · sélection puis ⊞ pour fusionner, G / I / alignement / couleurs dans la barre · onglets en bas (double-clic pour renommer, + pour ajouter) · bord d’un en-tête pour élargir, bas d’un numéro de ligne pour la hauteur · clic sur un en-tête pour trier · Ctrl+C / Ctrl+V avec Excel · Ctrl+Z.';
  board.appendChild(help);
  for (const [title, spec, height] of [
    ['Projet 2026 · classeur de trois feuilles', projectWorkbook, 420],
    ['Commandes · 10 000 lignes', ordersSheet, 460],
  ] as const) {
    const card = document.createElement('section');
    card.className = 'card span-12';
    card.innerHTML = '<header><div><h2></h2><p></p></div></header>';
    card.querySelector('h2')!.textContent = title;
    const body = document.createElement('div');
    body.style.cssText = `height:${height}px;padding:0 12px 12px;`;
    card.appendChild(body);
    board.appendChild(card);
    const made = spec();
    const sheet = await createSpreadsheet(body, 'sheets' in made ? { ...made, theme: themeFor() } : { ...made, theme: themeFor() });
    const sub = card.querySelector('header p')!;
    // The last edit shows here; the line is there from the start, so nothing moves on the first one.
    sub.textContent = 'Aucune modification';
    sheet.on('change', ({ row, column, value }) => (sub.textContent = `Ligne ${row + 1}, ${column} : ${value ?? 'vide'}`));
    sheets.push(sheet);
  }
}

async function render() {
  closeMenu();
  for (const s of sheets) s.destroy();
  sheets = [];
  for (const m of mounted) for (const c of m.charts) c.destroy();
  mounted = [];
  thumbObserver?.disconnect();
  for (const c of thumbCharts) c.destroy();
  thumbCharts = [];
  const board = document.getElementById('board')!;
  board.replaceChildren();
  board.classList.remove('gallery');
  let route = location.hash.replace(/^#\/?/, '') || DASHBOARDS[0].id;
  // Old library links now open the gallery.
  if (route.startsWith('bib/')) route = `galerie/${route.slice(4)}`;
  document.querySelectorAll<HTMLAnchorElement>('#nav a').forEach((a) => (a.getAttribute('data-route') === route ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  document.getElementById('app')!.classList.remove('open');
  const dashboard = DASHBOARDS.find((d) => d.id === route);
  current = { dashboard };
  const title = document.getElementById('title')!;
  const subtitle = document.getElementById('subtitle')!;
  document.getElementById('filters')!.replaceChildren();
  renderFilters();
  window.scrollTo(0, 0);
  if (dashboard) {
    title.textContent = dashboard.title;
    subtitle.textContent = dashboard.subtitle;
    for (const card of dashboard.cards(filters)) mounted.push(await mountCard(board, card));
  } else if (route === 'tableur') {
    title.textContent = 'Tableur';
    subtitle.textContent = 'Une grille éditable, pour qui veut les chiffres eux-mêmes';
    await renderSheets(board);
  } else if (route.startsWith('demo/')) {
    const e = entries.find((x) => slug(x.title) === route.slice(5)) ?? entries[0];
    title.textContent = e.title;
    subtitle.textContent = familyOf(e)?.name ?? '';
    await renderDemo(board, e);
  } else {
    const f = families.find((x) => route === `galerie/${x.id}`);
    title.textContent = f ? f.name : 'Galerie';
    subtitle.textContent = `${f ? f.entries.length : entries.length} graphiques · chaque aperçu est une spec JSON, cliquez pour l’ouvrir en grand`;
    board.classList.add('gallery');
    renderGallery(board, f);
  }
  (window as any).gallery = [...mounted.flatMap((m) => m.charts), ...thumbCharts];
  (window as any).thumbs = thumbCharts;
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

// Mobile audit from the console: `await fcAudit(343, 260)`.
(window as unknown as { fcAudit: typeof auditCharts }).fcAudit = auditCharts;
