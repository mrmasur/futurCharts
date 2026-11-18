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
