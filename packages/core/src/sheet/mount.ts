import type { SheetSpec } from './model';
import type { SheetEvents } from './sheet';
import { createSpreadsheet, type Spreadsheet, type WorkbookSpec } from './workbook';

/** `onChange`, `onResize`, `onSelect`, `onFormat`, plus lifecycle callbacks. */
export type SheetHandlers = {
  [K in keyof SheetEvents as `on${Capitalize<K>}`]?: (payload: SheetEvents[K]) => void;
} & {
  onReady?: (sheet: Spreadsheet) => void;
  onError?: (error: unknown) => void;
};

export interface SheetHandle {
  readonly sheet: Spreadsheet | undefined;
  readonly ready: Promise<Spreadsheet>;
  update(spec: SheetSpec | WorkbookSpec): void;
  setHandlers(handlers: SheetHandlers): void;
  destroy(): void;
}

const EVENTS: (keyof SheetEvents)[] = ['change', 'resize', 'select', 'format'];

/**
 * Lifecycle glue for the framework wrappers, as `mountChart` is for charts: a
 * spec replaced before the sheet exists, a host gone before it exists.
 */
export function mountSpreadsheet(container: HTMLElement, spec: SheetSpec | WorkbookSpec, handlers: SheetHandlers = {}): SheetHandle {
  let sheet: Spreadsheet | undefined;
  let latest = spec;
  let current = handlers;
  let destroyed = false;
  const ready = createSpreadsheet(container, spec).then((s) => {
    if (destroyed) {
      s.destroy();
      return s;
    }
    sheet = s;
    if (latest !== spec) s.update(latest);
    for (const type of EVENTS) {
      const name = `on${type[0].toUpperCase()}${type.slice(1)}` as keyof SheetHandlers;
      s.on(type, (payload) => (current[name] as ((p: unknown) => void) | undefined)?.(payload));
    }
    current.onReady?.(s);
    return s;
  });
  ready.catch((error) => (current.onError ? current.onError(error) : console.error(error)));
  return {
    get sheet() {
      return sheet;
    },
    ready,
    update(next) {
      latest = next;
      // The sheet's own edits come back through getSpec(); only a new object replaces them.
      if (sheet && next !== spec) sheet.update(next);
    },
    setHandlers(next) {
      current = next;
    },
    destroy() {
      destroyed = true;
      sheet?.destroy();
      sheet = undefined;
    },
  };
}
