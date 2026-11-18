import type { SheetSpec } from '@futurcharts/core';

const euro = { style: 'currency', currency: 'EUR', decimals: 0 } as const;

/** A small budget: four quarters typed in, totals and shares computed by formulas. */
export function budgetSheet(): SheetSpec {
  const lines: [string, number, number, number, number][] = [
    ['Salons professionnels', 42000, 18000, 51000, 12000],
    ['Publicité en ligne', 31000, 34500, 29800, 41200],
    ['Contenus et vidéo', 12000, 15500, 14800, 16100],
    ['Événements clients', 8000, 22000, 6500, 27000],
    ['Relations presse', 9500, 9500, 9500, 9500],
    ['Outils et licences', 14200, 3100, 3100, 3300],
  ];
  const n = lines.length;
  return {
    rows: lines.map(([poste, t1, t2, t3, t4], i) => ({
      poste,
      t1,
      t2,
      t3,
      t4,
      total: `=SOMME(B${i + 1}:E${i + 1})`,
      part: `=F${i + 1}/SOMME(F1:F${n})`,
      evolution: `=SI(B${i + 1}=0; 0; E${i + 1}/B${i + 1}-1)`,
    })),
    columns: [
      { key: 'poste', label: 'Poste', width: 190 },
      { key: 't1', label: 'T1', format: euro },
      { key: 't2', label: 'T2', format: euro },
      { key: 't3', label: 'T3', format: euro },
      { key: 't4', label: 'T4', format: euro },
      { key: 'total', label: 'Total', format: euro, type: 'number', editable: false, bar: true },
      { key: 'part', label: 'Part', format: { style: 'percent', decimals: 1 }, type: 'number', editable: false, total: 'sum' },
      { key: 'evolution', label: 'T4 / T1', format: { style: 'percent', decimals: 0 }, type: 'number', editable: false, total: 'none' },
    ],
    totals: true,
    rules: [
      { column: 'evolution', when: { gt: 0.2 }, style: { color: '#1f8a4c', bold: true } },
      { column: 'evolution', when: { lt: -0.2 }, style: { color: '#d03b3b', bold: true } },
    ],
  };
}

/** Many rows, to scroll: shaded amounts, bars, a rule on late orders. */
export function ordersSheet(): SheetSpec {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const regions = ['Nord', 'Sud', 'Est', 'Ouest', 'Centre'];
  const status = ['Livrée', 'Livrée', 'Livrée', 'En cours', 'En retard'];
  const rows = Array.from({ length: 10000 }, (_, i) => {
    const qty = 1 + Math.floor(rnd() * 40);
    const price = Math.round((8 + rnd() * 140) * 100) / 100;
    return {
      commande: `C-${String(100000 + i)}`,
      region: regions[Math.floor(rnd() * regions.length)],
      quantite: qty,
      prix: price,
      montant: `=C${i + 1}*D${i + 1}`,
      marge: Math.round((rnd() * 0.45 - 0.05) * 1000) / 1000,
      statut: status[Math.floor(rnd() * status.length)],
    };
  });
  return {
    rows,
    columns: [
      { key: 'commande', label: 'Commande', width: 120 },
      { key: 'region', label: 'Région', width: 100 },
      { key: 'quantite', label: 'Quantité', width: 90, total: 'sum' },
      { key: 'prix', label: 'Prix unitaire', format: { style: 'currency', currency: 'EUR', decimals: 2 }, total: 'average' },
      { key: 'montant', label: 'Montant', type: 'number', format: euro, editable: false, heat: true },
      { key: 'marge', label: 'Marge', format: { style: 'percent', decimals: 1 }, bar: true, total: 'average' },
      { key: 'statut', label: 'Statut', width: 110 },
    ],
    totals: true,
    rowHeight: 28,
    rules: [{ column: 'statut', when: { equals: 'En retard' }, style: { color: '#d03b3b', bold: true } }],
  };
}
