/**
 * Project rules checked by the machine rather than by discipline (see CLAUDE.md).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { lightTheme } from '../src/theme/theme';

const src = fileURLToPath(new URL('../src/', import.meta.url));
const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : []));
const sources = files(src).map((path) => ({ path: relative(src, path), text: readFileSync(path, 'utf8') }));

describe('règles du projet', () => {
  it('WebGPU reste possible : aucun concept WebGL hors de render/webgl2/', () => {
    // GL types and calls, context creation, WebGL extensions.
    const forbidden = /\bWebGL2?RenderingContext\b|\bWebGL(Buffer|Program|Shader|VertexArrayObject|UniformLocation)\b|getContext\(\s*['"]webgl|\bWEBGL_\w+|\bgl\.(createBuffer|bindBuffer|bufferData|drawArrays\w*|useProgram|uniform\w+)\(/;
    const offenders = sources
      .filter((f) => !f.path.startsWith('render/webgl2/'))
      .flatMap((f) => f.text.split('\n').map((line, i) => ({ f, line, i })).filter(({ line }) => !line.trim().startsWith('*') && !line.trim().startsWith('//') && forbidden.test(line)))
      .map(({ f, line, i }) => `${f.path}:${i + 1} ${line.trim()}`);
    expect(offenders).toEqual([]);
  });

  it('seul render/index.ts importe le moteur WebGL2', () => {
    const offenders = sources.filter((f) => f.path !== 'render/index.ts' && !f.path.startsWith('render/webgl2/') && /from\s+['"][^'"]*webgl2[^'"]*['"]/.test(f.text)).map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it('paquets sans effet de bord : aucun import pour effet de bord', () => {
    const offenders = sources.filter((f) => /^import\s+['"][^'"]+['"];?\s*$/m.test(f.text)).map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it('chaque option de style a un même type dans toutes les marques (MarkStyle est leur intersection)', () => {
    // Two marks giving one option name two different types make it `never` in MarkStyle: a spec can then
    // set it for neither. Compare the runtime types of the defaults, mark by mark.
    const seen = new Map<string, { kind: string; mark: string }>();
    const conflicts: string[] = [];
    const kindOf = (v: unknown) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
    for (const [mark, options] of Object.entries(lightTheme.marks as Record<string, Record<string, unknown>>)) {
      for (const [name, value] of Object.entries(options)) {
        const kind = kindOf(value);
        const before = seen.get(name);
        if (!before) seen.set(name, { kind, mark });
        else if (before.kind !== kind) conflicts.push(`${name} : ${before.kind} dans ${before.mark}, ${kind} dans ${mark}`);
      }
    }
    expect(conflicts).toEqual([]);
  });
});
