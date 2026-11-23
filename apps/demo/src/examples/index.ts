/**
 * Gallery examples kept out of `library.ts`, one file per family of charts.
 * `library.ts` appends them to `entries` and `GROUPS`: gallery, Storybook and visual tests pick them up.
 */
import type { Entry } from '../library';
import { FAMILIES as bourse } from './bourse';
import { FAMILIES as jauges } from './jauges';
import { FAMILIES as gantt } from './gantt';
import { FAMILIES as polaires } from './polaires';
import { FAMILIES as ensembles } from './ensembles';
import { FAMILIES as series } from './series';
import { FAMILIES as axes } from './axes';

export interface Family {
  /** Gallery section: an existing one (its examples follow the others) or a new one. */
  family: string;
  entries: Entry[];
}

export const EXTRA: Family[] = [...bourse, ...jauges, ...gantt, ...polaires, ...ensembles, ...series, ...axes];
