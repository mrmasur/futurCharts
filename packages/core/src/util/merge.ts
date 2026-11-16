export type DeepPartial<T> = T extends (infer U)[]
  ? U[]
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

function isPlain(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && !ArrayBuffer.isView(v);
}

/** Recursive merge; arrays and scalars are replaced, `undefined` is ignored. */
export function deepMerge<T>(base: T, ...overrides: (DeepPartial<T> | undefined)[]): T {
  let out: any = isPlain(base) ? { ...base } : base;
  for (const o of overrides) {
    if (o === undefined) continue;
    if (!isPlain(o) || !isPlain(out)) {
      out = o;
      continue;
    }
    for (const [k, v] of Object.entries(o)) {
      if (v === undefined) continue;
      out[k] = isPlain(v) && isPlain(out[k]) ? deepMerge(out[k], v as any) : v;
    }
  }
  return out as T;
}
