/**
 * Texts the marks write for the reader live in `theme.texts` (French by default, `englishTexts` ready):
 * both languages have the same keys and the same `{variables}`, and no mark writes them by hand any more.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { englishTexts, fillText, frenchTexts, textVariables } from '../src/theme/texts';
import { darkTheme, lightTheme, resolveTheme } from '../src/theme/theme';

const marks = fileURLToPath(new URL('../src/marks/', import.meta.url));

/** The words the marks used to write in French, as they were (inventory of 2026-11-24). */
const FORBIDDEN = [
  'Médiane', 'Moyenne', 'Effectif', 'Écart', 'Conversion', 'Total', 'Rang', 'Variation', 'Tendance', 'Part', 'Cumul',
  'Aujourd’hui', 'lignes', 'ligne', 'autres', 'autre', 'passent', 'symbole', 'était', 'précédent', 'semaine', 'Intervalle',
  'Rétention', 'Cohorte', 'cohorte', 'Objectif', 'Réalisé', 'Niveau', 'Remplissage', 'Groupe', 'Lignes', 'Liens', 'Lien',
  'Entrant', 'Sortant', 'Nœuds', 'Enfants', 'Éléments', 'Ensembles', 'Uniquement', 'Début', 'Fin', 'Durée', 'Jalon',
  'Avancement', 'Phase', 'Après', 'Ressource', 'Étape', 'Décision', 'Sortie', 'Entrée', 'Sous-processus', 'Sous-flux',
  'Jointure', 'Depuis', 'Perdus', 'Émis', 'Reçus', 'Réel', 'Prédit', 'Précision', 'Rappel', 'Exactitude', 'exactitude',
  'classés', 'Cas', 'Quartiles', 'Observations', 'Observation', 'Densité', 'Quantile', 'Dans la pile', 'Minimum', 'Maximum',
  'Comparaison', 'Amplitude', 'Hauteur', 'Défavorable', 'Favorable', 'Base :', 'Toutes', 'Tout afficher', 'survolez',
  'cliquer', 'Nombre', 'Valeur', 'Volume', 'Période', 'Condition', 'Note', 'Type', 'Points', 'Point ', 'Ligne ', 'Quadrant',
  'max. ', '1 symbole', 'SO', 'NO',
];

/** The text of every string literal and template chunk of a source (comments left out). */
function literals(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:])\/\/ .*$/gm, '$1');
  const out: string[] = [];
  for (const m of code.matchAll(/'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g)) out.push(m[1] ?? m[2]);
  return out;
}

describe('textes des marques', () => {
  it('le thème clair les porte, en français, et le sombre les hérite', () => {
    expect(lightTheme.texts).toBe(frenchTexts);
    expect(darkTheme.texts).toEqual(frenchTexts);
    expect(lightTheme.texts.median).toBe('Médiane');
    expect(lightTheme.texts.moreRows).toBe('+ {n} lignes');
    expect(lightTheme.texts.compass).toEqual(['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO']);
  });

  it('une spec en surcharge une seule ou toutes', () => {
    const one = resolveTheme({ texts: { median: 'Median' } });
    expect(one.texts.median).toBe('Median');
    expect(one.texts.mean).toBe('Moyenne');
    expect(resolveTheme({ extends: 'dark', texts: englishTexts }).texts).toEqual(englishTexts);
    expect(resolveTheme({ texts: { compass: englishTexts.compass } }).texts.compass).toEqual(['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']);
  });

  it('englishTexts a exactement les clés des textes par défaut', () => {
    expect(Object.keys(englishTexts).sort()).toEqual(Object.keys(frenchTexts).sort());
  });

  it('les gabarits ont les mêmes {variables} dans les deux langues', () => {
    const differ = Object.entries(frenchTexts)
      .filter(([, v]) => typeof v === 'string')
      .filter(([k, v]) => textVariables(v as string).join() !== textVariables(englishTexts[k as keyof typeof englishTexts] as string).join())
      .map(([k]) => k);
    expect(differ).toEqual([]);
    expect(englishTexts.compass).toHaveLength(8);
  });

  it('fillText remplace une fois, laisse les inconnues et ne réinterprète pas les valeurs', () => {
    expect(fillText('+ {n} lignes', { n: 3 })).toBe('+ 3 lignes');
    expect(fillText('{a} et {b}', { a: '{b}', b: 'x' })).toBe('{b} et x');
    expect(fillText('Part de {name}', {})).toBe('Part de {name}');
    expect(fillText('{name}', { name: '$& $1 {constructor}' })).toBe('$& $1 {constructor}');
    expect(fillText('{toString}', {})).toBe('{toString}');
  });

  it('aucune marque n’écrit plus ces textes en dur', () => {
    const offenders: string[] = [];
    for (const file of readdirSync(marks).filter((f) => f.endsWith('.ts'))) {
      const strings = literals(readFileSync(join(marks, file), 'utf8'));
      for (const word of FORBIDDEN) {
        const re = new RegExp(`(^|[^\\p{L}])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}])`, 'u');
        const hit = strings.find((s) => re.test(s));
        if (hit !== undefined) offenders.push(`${file} : « ${word} » dans '${hit}'`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
