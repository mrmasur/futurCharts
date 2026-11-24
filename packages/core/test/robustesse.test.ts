import { describe, expect, it } from 'vitest';
import { Table } from '../src/data/table';
import { applyTransforms } from '../src/data/transforms';
import { MAX_BRICKS, renkoBricks } from '../src/marks/stock';

// Guards found by the robustness suite (tests/visual/robustesse.pw.ts): hostile data must not throw nor explode.
describe('données hostiles', () => {
  it('une table vide répond pour tout champ demandé, avec le type du catalogue', () => {
    const t = Table.from([], { when: 'time', name: 'string' });
    expect(t.length).toBe(0);
    expect(t.column('sales').type).toBe('number');
    expect(t.column('sales').values.length).toBe(0);
    expect(t.column('when').type).toBe('time');
    expect(t.column('name').type).toBe('string');
  });

  it('une table non vide refuse toujours un champ inconnu', () => {
    expect(() => Table.from([{ a: 1 }]).column('b')).toThrow(/unknown field "b"/);
  });

  it('une colonne sans aucune valeur est numérique', () => {
    const t = Table.from([{ v: null }, { v: undefined }]);
    expect(t.column('v').type).toBe('number');
  });

  it('un pas de classes fixe sur des valeurs démesurées ne crée pas des millions de classes', () => {
    const t = Table.from([{ v: 0 }, { v: 5e12 }]);
    const out = applyTransforms(t, [{ type: 'bin', field: 'v', step: 1 }]);
    expect(out.length).toBeLessThan(100);
  });

  it('Renko plafonne le nombre de briques', () => {
    const close = [100, 100 + 5e9];
    expect(renkoBricks(close, 1).length).toBeLessThanOrEqual(MAX_BRICKS + 1);
  });
});
