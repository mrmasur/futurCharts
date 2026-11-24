/**
 * The play bar of a time-driven mark (`Timeline`: bar chart race, Gapminder): a play / pause
 * button, a scrubber and the label of the current frame, in DOM over the chart.
 */
import type { Timeline } from '../marks/registry';
import type { Theme } from '../theme/theme';

export interface PlayBar {
  root: HTMLDivElement;
  button: HTMLButtonElement;
  range: HTMLInputElement;
  label: HTMLSpanElement;
}

/** Make the play bar inside `parent`; `toggle` runs on the button, `seek` when the scrubber moves. */
export function createPlayBar(parent: HTMLElement, toggle: () => void, seek: (frame: number) => void): PlayBar {
  const root = document.createElement('div');
  root.style.cssText = 'position:absolute;left:12px;right:12px;bottom:10px;height:30px;display:flex;align-items:center;gap:10px;z-index:1;';
  const button = document.createElement('button');
  button.type = 'button';
  button.style.cssText = 'width:30px;height:30px;border-radius:50%;border:0;cursor:pointer;display:grid;place-items:center;font-size:12px;padding:0;';
  const range = document.createElement('input');
  range.type = 'range';
  range.min = '0';
  range.step = 'any';
  range.style.cssText = 'flex:1;min-width:0;';
  range.setAttribute('aria-label', 'Position dans le temps');
  const label = document.createElement('span');
  label.style.cssText = 'min-width:72px;text-align:right;font-variant-numeric:tabular-nums;';
  root.append(button, range, label);
  // The controls are not part of the plot: keep their pointer events away from zoom, lasso and drags.
  for (const type of ['pointerdown', 'pointerup', 'pointermove', 'wheel', 'dblclick']) root.addEventListener(type, (e) => e.stopPropagation());
  button.addEventListener('click', toggle);
  range.addEventListener('input', () => seek(Number(range.value)));
  parent.appendChild(root);
  return { root, button, range, label };
}

/** Colors after the theme, scrubber length after the timeline. */
export function stylePlayBar(c: PlayBar, theme: Theme, timeline: Timeline): void {
  const { button, range, label } = c;
  button.style.background = theme.palette.categorical[0];
  button.style.color = '#fff';
  range.style.accentColor = theme.palette.categorical[0];
  label.style.color = theme.text.secondary;
  label.style.font = `600 12px ${theme.font.family}`;
  range.max = String(Math.max(0, timeline.frames.length - 1));
}

/**
 * Show where the timeline is. Returns the frame index when it differs from `shown`
 * (the label was updated: a `frame` event is due), else null.
 */
export function updatePlayBar(c: PlayBar, tl: Timeline, shown: number): number | null {
  const t = tl.get();
  if (document.activeElement !== c.range) c.range.value = String(t);
  c.button.textContent = tl.playing ? '❚❚' : '▶';
  c.button.setAttribute('aria-label', tl.playing ? 'Pause' : 'Lecture');
  const index = Math.min(tl.frames.length - 1, Math.round(t));
  if (index === shown) return null;
  c.label.textContent = tl.frames[index] ?? '';
  return index;
}
