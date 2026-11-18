/**
 * `Workbook`: several sheets under one grid, with tabs at the bottom (add,
 * rename with a double-click, close). Formulas reach across sheets:
 * `=Budget!F7`, `=SOMME('Ventes 2026'!B1:B12)`.
 */
import { resolveTheme, type ThemeSpec } from '../theme/theme';
import { columnName, type CellValue } from './formula';
import { SheetModel, type SheetSpec } from './model';
import { Sheet, type SheetEvents } from './sheet';

export interface WorkbookSpec {
  /** One spec per sheet; `name` is its tab and its name in formulas. */
  sheets: SheetSpec[];
  /** Index of the sheet shown first. Default 0. */
  active?: number;
  /** Applies to every sheet that has none of its own. */
  theme?: ThemeSpec;
  /** Tabs to switch, add, rename and close sheets. Default true. */
  tabs?: boolean;
}

/** What a single sheet and a workbook have in common (the framework wrappers use it). */
export interface Spreadsheet {
  update(spec: SheetSpec | WorkbookSpec): void;
  getSpec(): SheetSpec | WorkbookSpec;
  on<K extends keyof SheetEvents>(type: K, handler: (payload: SheetEvents[K]) => void): () => void;
  destroy(): void;
}

/** An empty sheet to type in: columns A to H, 50 rows. */
function blankSheet(name: string): SheetSpec {
  const keys = Array.from({ length: 8 }, (_, i) => columnName(i));
  return {
    name,
    rows: Array.from({ length: 50 }, () => Object.fromEntries(keys.map((k) => [k, null as CellValue]))),
    columns: keys.map((key) => ({ key, label: '', width: 100 })),
  };
}

export class Workbook implements Spreadsheet {
  private spec!: WorkbookSpec;
  private models: SheetModel[] = [];
  private active = 0;
  private view!: Sheet;
  private root!: HTMLDivElement;
  private host!: HTMLDivElement;
  private tabs!: HTMLDivElement;
  private colors = { ink: '#000', muted: '#666', grid: '#ddd', bg: '#fff', accent: '#3a6fd8' };

  private constructor(private container: HTMLElement) {}

  static async create(container: HTMLElement, spec: WorkbookSpec): Promise<Workbook> {
    const w = new Workbook(container);
    w.root = document.createElement('div');
    w.root.className = 'fc-workbook';
    w.root.style.cssText = 'display:flex;flex-direction:column;width:100%;height:100%;';
    w.host = document.createElement('div');
    w.host.style.cssText = 'flex:1;min-height:0;';
    w.tabs = document.createElement('div');
    w.tabs.setAttribute('role', 'tablist');
    w.root.append(w.host, w.tabs);
    container.appendChild(w.root);
    w.load(spec);
    w.view = await Sheet.create(w.host, w.models[w.active]);
    // An edit anywhere can change a formula elsewhere.
    w.view.onEdit = () => w.models.forEach((m) => m.invalidate());
    w.renderTabs();
    return w;
  }

  private load(spec: WorkbookSpec): void {
    this.spec = spec;
    const sheets = spec.sheets.length ? spec.sheets : [blankSheet('Feuille 1')];
    this.models = sheets.map((s, i) => new SheetModel({ ...s, name: s.name ?? `Feuille ${i + 1}`, theme: s.theme ?? spec.theme }, (name) => this.find(name)));
    this.active = Math.max(0, Math.min(this.models.length - 1, spec.active ?? 0));
    const t = resolveTheme(spec.theme);
    this.colors = { ink: t.text.primary, muted: t.text.muted, grid: t.grid.y.color, bg: t.background === 'transparent' ? '#fff' : t.background, accent: t.palette.categorical[0] };
  }

  private find(name: string): SheetModel | undefined {
    const n = name.trim().toLowerCase();
    return this.models.find((m) => m.name.toLowerCase() === n);
  }

  update(spec: SheetSpec | WorkbookSpec): void {
    if (!('sheets' in spec)) return;
    this.load(spec);
    this.view.setModel(this.models[this.active]);
    this.renderTabs();
  }

  getSpec(): WorkbookSpec {
    return { ...this.spec, sheets: this.models.map((m) => m.getSpec()), active: this.active };
  }

  /** The sheet on screen. */
  get sheet(): Sheet {
    return this.view;
  }

  on<K extends keyof SheetEvents>(type: K, handler: (payload: SheetEvents[K]) => void): () => void {
    return this.view.on(type, handler);
  }

  show(index: number): void {
    if (index < 0 || index >= this.models.length || index === this.active) return;
    this.active = index;
    this.view.setModel(this.models[index]);
    this.renderTabs();
  }

  addSheet(spec?: SheetSpec): void {
    let k = this.models.length + 1;
    while (this.find(`Feuille ${k}`)) k++;
    const s = spec ?? blankSheet(`Feuille ${k}`);
    this.models.push(new SheetModel({ ...s, theme: s.theme ?? this.spec.theme }, (name) => this.find(name)));
    this.show(this.models.length - 1);
  }

  renameSheet(index: number, name: string): void {
    const clean = name.trim();
    if (!clean || this.find(clean)) return this.renderTabs();
    const m = this.models[index];
    m.spec = { ...m.spec, name: clean };
    this.renderTabs();
  }

  removeSheet(index: number): void {
    if (this.models.length < 2) return;
    this.models.splice(index, 1);
    this.models.forEach((m) => m.invalidate());
    this.active = Math.min(this.active, this.models.length - 1);
    this.view.setModel(this.models[this.active]);
    this.renderTabs();
  }

  destroy(): void {
    this.view.destroy();
    this.root.remove();
  }

  private renderTabs(): void {
    const t = this.tabs;
    t.style.cssText = `display:${this.spec.tabs === false ? 'none' : 'flex'};align-items:flex-end;gap:2px;padding:0 8px;flex:none;border-top:1px solid ${this.colors.grid};font-size:12.5px;overflow-x:auto;`;
    t.replaceChildren();
    this.models.forEach((m, i) => {
      const on = i === this.active;
      const tab = document.createElement('div');
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = 0;
      tab.title = 'Double-clic pour renommer';
      tab.style.cssText = `display:flex;align-items:center;gap:6px;padding:6px 12px;cursor:pointer;white-space:nowrap;color:${on ? this.colors.ink : this.colors.muted};font-weight:${on ? 650 : 400};background:${on ? this.colors.bg : 'transparent'};border:1px solid ${on ? this.colors.grid : 'transparent'};border-top:2px solid ${on ? this.colors.accent : 'transparent'};margin-top:-1px;border-radius:0 0 6px 6px;`;
      const label = document.createElement('span');
      label.textContent = m.name;
      tab.appendChild(label);
      tab.addEventListener('click', () => this.show(i));
      tab.addEventListener('keydown', (e) => e.key === 'Enter' && this.show(i));
      tab.addEventListener('dblclick', () => {
        const input = document.createElement('input');
        input.value = m.name;
        input.style.cssText = `width:${Math.max(60, m.name.length * 8)}px;font:inherit;color:inherit;border:1px solid ${this.colors.accent};border-radius:3px;padding:0 3px;`;
        label.replaceWith(input);
        input.focus();
        input.select();
        const done = (commit: boolean) => (commit ? this.renameSheet(i, input.value) : this.renderTabs());
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') done(true);
          if (e.key === 'Escape') done(false);
          e.stopPropagation();
        });
        input.addEventListener('blur', () => done(true));
      });
      if (on && this.models.length > 1) {
        const close = document.createElement('button');
        close.type = 'button';
        close.textContent = '×';
        close.title = 'Supprimer la feuille';
        close.setAttribute('aria-label', `Supprimer la feuille ${m.name}`);
        close.style.cssText = `all:unset;cursor:pointer;color:${this.colors.muted};font-size:14px;line-height:1;`;
        close.addEventListener('click', (e) => {
          e.stopPropagation();
          if (confirm(`Supprimer la feuille « ${m.name} » ?`)) this.removeSheet(i);
        });
        tab.appendChild(close);
      }
      t.appendChild(tab);
    });
    const add = document.createElement('button');
    add.type = 'button';
    add.textContent = '+';
    add.title = 'Ajouter une feuille';
    add.setAttribute('aria-label', 'Ajouter une feuille');
    add.style.cssText = `all:unset;cursor:pointer;padding:5px 10px;color:${this.colors.muted};font-size:15px;`;
    add.addEventListener('click', () => this.addSheet());
    t.appendChild(add);
  }
}

export function createWorkbook(container: HTMLElement, spec: WorkbookSpec): Promise<Workbook> {
  return Workbook.create(container, spec);
}

/** A sheet or a workbook, from its spec (`sheets` makes it a workbook). */
export function createSpreadsheet(container: HTMLElement, spec: SheetSpec | WorkbookSpec): Promise<Spreadsheet> {
  return 'sheets' in spec ? Workbook.create(container, spec) : (Sheet.create(container, spec) as Promise<Sheet & Spreadsheet>);
}
