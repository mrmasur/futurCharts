import type { Meta, StoryObj } from '@storybook/html';
import { createSpreadsheet, type SheetSpec, type Spreadsheet, type WorkbookSpec } from '@futurcharts/core';
import { budgetSheet, ordersSheet, planningSheet, projectWorkbook } from '../../demo/src/sheets';

/** Options of the whole sheet, as controls. */
interface Args {
  rowHeight: number;
  fontSize: number;
  frozenColumns: number;
  headers: boolean;
  editable: boolean;
  totals: boolean;
  zebra: boolean;
  formulaBar: boolean;
  statusBar: boolean;
  hauteur: number;
}

const sheets = new Map<HTMLElement, { el: HTMLElement; sheet?: Spreadsheet }>();

/** The options on one sheet, or on every sheet of a workbook. */
function withOptions(spec: SheetSpec | WorkbookSpec, options: Partial<SheetSpec>, theme: string): SheetSpec | WorkbookSpec {
  return 'sheets' in spec ? { ...spec, theme, sheets: spec.sheets.map((s) => ({ ...s, ...options, theme: undefined })) } : { ...spec, ...options, theme };
}

function story(base: () => SheetSpec | WorkbookSpec, defaults: Partial<Args> = {}): StoryObj<Args> {
  return {
    args: { rowHeight: 30, fontSize: 13, frozenColumns: 1, headers: true, editable: true, totals: true, zebra: true, formulaBar: true, statusBar: true, hauteur: 420, ...defaults },
    argTypes: {
      rowHeight: { control: { type: 'range', min: 20, max: 60, step: 1 }, description: 'Hauteur des lignes, px' },
      fontSize: { control: { type: 'range', min: 10, max: 20, step: 1 }, description: 'Taille du texte, px' },
      frozenColumns: { control: { type: 'range', min: 0, max: 4, step: 1 }, description: 'Colonnes figées à gauche' },
      headers: { control: 'boolean', description: 'Numéros de ligne et lettres de colonne' },
      editable: { control: 'boolean', description: 'Cellules modifiables' },
      totals: { control: 'boolean', description: 'Ligne de totaux en bas' },
      zebra: { control: 'boolean', description: 'Une ligne sur deux teintée' },
      formulaBar: { control: 'boolean', description: 'Barre de formule' },
      statusBar: { control: 'boolean', description: 'Somme, moyenne et nombre de la sélection' },
      hauteur: { control: { type: 'range', min: 200, max: 900, step: 10 }, table: { category: 'cadre' } },
    },
    render(a, context) {
      const theme = context.globals.theme === 'dark' ? 'dark' : 'light';
      const { hauteur, ...options } = a;
      const key = (context as { canvasElement?: HTMLElement }).canvasElement ?? document.body;
      const spec = withOptions(base(), options as Partial<SheetSpec>, theme);
      let m = sheets.get(key);
      if (m?.el.isConnected && m.sheet) {
        m.el.style.height = `${hauteur}px`;
        // Keep what was typed: options change, the cells stay.
        m.sheet.update(withOptions(m.sheet.getSpec(), options as Partial<SheetSpec>, theme));
        return m.el;
      }
      const el = document.createElement('div');
      el.style.height = `${hauteur}px`;
      m = { el };
      sheets.set(key, m);
      createSpreadsheet(el, spec).then((s) => (m!.sheet = s));
      return el;
    },
  };
}

const meta: Meta<Args> = {
  title: 'Tableur',
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Une grille éditable, configurable en JSON comme les graphiques. Double-clic ou saisie pour modifier, formules (`=SOMME(B1:E1)`, `=SI(…)`, `=Budget!F1`), dates, cellules fusionnées et mise en forme depuis la barre (⊞, G, I, alignement, couleurs), plusieurs feuilles avec onglets, bord d’un en-tête pour élargir (double-clic : ajuster), bas d’un numéro de ligne pour la hauteur, clic sur un en-tête pour trier, Ctrl+C / Ctrl+V avec Excel, Ctrl+Z.',
      },
    },
  },
};
export default meta;

export const Budget: StoryObj<Args> = { name: 'Budget avec formules', ...story(budgetSheet) };
export const Classeur: StoryObj<Args> = { name: 'Classeur de trois feuilles', ...story(projectWorkbook) };
export const Planning: StoryObj<Args> = { name: 'Dates et cellules fusionnées', ...story(planningSheet, { frozenColumns: 2 }) };
export const Commandes: StoryObj<Args> = { name: '10 000 commandes', ...story(ordersSheet, { rowHeight: 28 }) };
