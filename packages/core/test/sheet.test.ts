import { describe, expect, it } from 'vitest';
import { columnIndex, columnName, evaluate, FormulaError } from '../src/sheet/formula';
import { parseInput } from '../src/sheet/sheet';

// A 3 × 3 grid: A = 1, 2, 3; B = 10, 20, 30; C = text.
const grid = [
  [1, 10, 'nord'],
  [2, 20, 'sud'],
  [3, 30, 'est'],
];
const ctx = { cols: 3, rows: 3, get: (c: number, r: number) => grid[r][c] };
const run = (f: string) => evaluate(f, ctx);

describe('formulas', () => {
  it('compute arithmetic with precedence, references and percent', () => {
    expect(run('A1+B2*2')).toBe(41);
    expect(run('(A1+B2)*2')).toBe(42);
    expect(run('2^3^2')).toBe(512);
    expect(run('-A3+10%')).toBeCloseTo(-2.9);
  });
  it('know functions in English and French, ranges and both separators', () => {
    expect(run('SUM(A1:B3)')).toBe(66);
    expect(run('SOMME(A1:A3; 4)')).toBe(10);
    expect(run('AVERAGE(B1:B3)')).toBe(20);
    expect(run('MOYENNE(B1:B3)')).toBe(20);
    expect(run('MAX(A1:B3)')).toBe(30);
    expect(run('NB(A1:C3)')).toBe(6);
    expect(run('ARRONDI(10/3; 2)')).toBe(3.33);
    expect(run('SI(B2>15; "haut"; "bas")')).toBe('haut');
    expect(run('IF(A1=1, C1 & "!", "")')).toBe('nord!');
    expect(run('SOMME(1,5; 2,5)')).toBe(4);
  });
  it('report errors like a spreadsheet', () => {
    const code = (f: string) => {
      try {
        run(f);
        return 'ok';
      } catch (e) {
        return (e as FormulaError).message;
      }
    };
    expect(code('A1/0')).toBe('#DIV/0!');
    expect(code('Z9')).toBe('#REF!');
    expect(code('FOO(1)')).toBe('#NOM?');
    expect(code('C1*2')).toBe('#VALEUR!');
    expect(code('1+')).toBe('#ERREUR');
  });
  it('name columns like a spreadsheet', () => {
    expect(columnName(0)).toBe('A');
    expect(columnName(25)).toBe('Z');
    expect(columnName(26)).toBe('AA');
    expect(columnIndex('AB')).toBe(27);
  });
});

describe('typed input', () => {
  it('reads French and English numbers, percents, formulas and text', () => {
    expect(parseInput('1 234,5', 'number')).toBe(1234.5);
    expect(parseInput('12.5', 'number')).toBe(12.5);
    expect(parseInput('15 %', 'number')).toBeCloseTo(0.15);
    expect(parseInput('=A1*2', 'number')).toBe('=A1*2');
    expect(parseInput('Nord', 'text')).toBe('Nord');
    expect(parseInput('  ', 'number')).toBe(null);
  });
});

import { parseDate, SheetModel } from '../src/sheet/model';

describe('sheet model', () => {
  it('reads dates, counts days between them and shows them in the column format', () => {
    expect(parseDate('5/1/2026')).toBe('2026-01-05');
    expect(parseDate('2026-11-18')).toBe('2026-11-18');
    expect(parseDate('31/02')).toMatch(/^\d{4}-03-0[23]$/);
    expect(parseDate('hier')).toBeUndefined();
    const m = new SheetModel({
      rows: [{ a: '2026-01-05', b: '2026-01-23', d: '=B1-A1+1', y: '=ANNEE(A1)' }],
      columns: [{ key: 'a', type: 'date' }, { key: 'b', type: 'date' }, { key: 'd' }, { key: 'y' }],
    });
    expect(m.computed(2, 0)).toBe(19);
    expect(m.computed(3, 0)).toBe(2026);
    // Shown in the reader's locale; edited as day/month/year, which is how input is read.
    expect(m.display(0, 0)).toMatch(/0?5.0?1.2026|0?1.0?5.2026/);
    expect(m.editText(0, 0)).toBe('05/01/2026');
  });
  it('merges ranges, replacing what they overlap, and keeps them in the spec', () => {
    const m = new SheetModel({ rows: [{ a: 1, b: 2 }, { a: 3, b: 4 }], merges: ['A1:A2'] });
    expect(m.mergeAt(0, 1)).toEqual({ c0: 0, r0: 0, c1: 0, r1: 1 });
    m.merge({ c0: 0, r0: 0, c1: 1, r1: 0 });
    expect(m.getSpec().merges).toEqual(['A1:B1']);
    m.unmerge({ c0: 1, r0: 0, c1: 1, r1: 0 });
    expect(m.getSpec().merges).toEqual([]);
  });
  it('stores cell formatting by reference and drops empty styles', () => {
    const m = new SheetModel({ rows: [{ a: 1, b: 2 }] });
    m.setStyle({ c0: 0, r0: 0, c1: 1, r1: 0 }, { bold: true });
    expect(m.getSpec().cells).toEqual({ A1: { bold: true }, B1: { bold: true } });
    m.setStyle({ c0: 1, r0: 0, c1: 1, r1: 0 }, { bold: false });
    expect(m.getSpec().cells).toEqual({ A1: { bold: true } });
  });
  it('computes formulas across sheets, and flags cycles between them', () => {
    const sheets: SheetModel[] = [];
    const find = (n: string) => sheets.find((s) => s.name === n);
    sheets.push(new SheetModel({ name: 'Budget', rows: [{ v: 10 }, { v: 32 }] }, find));
    sheets.push(new SheetModel({ name: 'Ventes 2026', rows: [{ t: '=SOMME(Budget!A1:A2)', u: "='Ventes 2026'!A1*2" }] }, find));
    sheets.push(new SheetModel({ name: 'Boucle', rows: [{ x: '=Budget!A9' }, { x: '=Inconnue!A1' }] }, find));
    expect(sheets[1].computed(0, 0)).toBe(42);
    expect(sheets[1].computed(1, 0)).toBe(84);
    expect(sheets[2].valueOrError(0, 0)).toBe('#REF!');
    expect(sheets[2].valueOrError(0, 1)).toBe('#REF!');
  });
});
