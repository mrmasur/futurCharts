import { describe, expect, it } from 'vitest';
import { bridgeSteps, FINANCE_MARKS, labelStride, periodItems, toneOf, varianceOf } from '../src/marks/finance';
import { lightTheme } from '../src/theme/theme';

describe('bridge', () => {
  const steps = bridgeSteps(
    [
      { key: 'Revenue', value: 1000 },
      { key: 'Purchases', value: -400 },
      { key: 'Gross margin', value: NaN },
      { key: 'Staff', value: -250 },
      { key: 'Other income', value: 30 },
      { key: 'EBITDA', value: NaN },
      { key: 'Depreciation', value: -80 },
      { key: 'Operating profit', value: 290 },
    ],
    ['Revenue', 'Gross margin', 'EBITDA', 'Operating profit'],
  );
  it('floats each change between the running levels', () => {
    expect(steps[1]).toMatchObject({ from: 1000, to: 600, delta: -400, total: false });
    expect(steps[3]).toMatchObject({ from: 600, to: 350 });
    expect(steps[4]).toMatchObject({ from: 350, to: 380, delta: 30 });
    expect(steps[6]).toMatchObject({ from: 380, to: 300 });
  });
  it('starts subtotals again from zero, at the running level when they have no value', () => {
    expect(steps[0]).toMatchObject({ from: 0, to: 1000, total: true });
    expect(steps[2]).toMatchObject({ from: 0, to: 600, total: true });
    expect(steps[5]).toMatchObject({ from: 0, to: 380, total: true });
  });
  it('lets a total with a value reset the running level', () => {
    expect(steps[7]).toMatchObject({ from: 0, to: 290, total: true });
    const after = bridgeSteps([{ key: 'A', value: 100 }, { key: 'T', value: 50 }, { key: 'B', value: 10 }], ['T']);
    expect(after[2]).toMatchObject({ from: 50, to: 60 });
  });
});

describe('variances', () => {
  it('give absolute and relative differences to budget', () => {
    expect(varianceOf(110, 100)).toEqual({ abs: 10, rel: 0.1 });
    expect(varianceOf(90, 100).abs).toBe(-10);
    expect(varianceOf(5, 0).rel).toBeNaN();
  });
  it('color a rise as good news unless upIsGood is false (costs)', () => {
    expect(toneOf(10, true)).toBe('good');
    expect(toneOf(-10, true)).toBe('bad');
    expect(toneOf(10, false)).toBe('bad');
    expect(toneOf(-10, false)).toBe('good');
    expect(toneOf(0, true)).toBe('none');
    expect(toneOf(NaN, false)).toBe('none');
  });
});

describe('periods', () => {
  const items = periodItems([
    { key: 'Jan', actual: 120, budget: 100, previous: 90 },
    { key: 'Feb', actual: 80, budget: 100, previous: 95 },
    { key: 'Mar', actual: NaN, budget: 110, previous: NaN },
  ]);
  it('are past when they have an actual, future otherwise', () => {
    expect(items.map((d) => d.past)).toEqual([true, true, false]);
  });
  it('carry the variance to budget only when past', () => {
    expect(items[0].variance).toBe(20);
    expect(items[1].variance).toBe(-20);
    expect(items[2].variance).toBeNaN();
  });
  it('thin out category labels that would not fit', () => {
    expect(labelStride(30, 60)).toBe(1);
    expect(labelStride(30, 20)).toBe(2);
  });
});

describe('finance marks', () => {
  it('are registered with a default style in the theme', () => {
    expect(Object.keys(FINANCE_MARKS).sort()).toEqual(['bridge', 'periodBars', 'variance']);
    for (const name of Object.keys(FINANCE_MARKS)) {
      expect(FINANCE_MARKS[name].standalone).toBe(true);
      expect((lightTheme.marks as Record<string, unknown>)[name]).toBeDefined();
    }
  });
});
