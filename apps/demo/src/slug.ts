/** Address of an example or a family: `#/demo/<slug>`, `visual.html?nom=<slug>`. */
export const slug = (s: string): string =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '');
