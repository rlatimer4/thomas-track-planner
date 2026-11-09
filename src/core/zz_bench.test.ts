import { it } from 'vitest';
import { BUILTIN_KITS, Catalog, generateLayouts, inventoryTotals } from './index';
it('bench', () => {
  const cat = new Catalog();
  const lines: string[] = [];
  for (const manyLoops of [false, true])
    for (const seed of [1, 2]) {
      const owned = inventoryTotals({ kits: { GLK80: 1, HNP81: 1 }, loose: {} }, BUILTIN_KITS);
      const t = Date.now();
      const res = generateLayouts(cat, { owned, timeBudgetMs: 3000, seed, results: 5, manyLoops });
      lines.push(`--- ${manyLoops ? 'MANY' : 'off'} s${seed} ${Date.now() - t}ms`);
      for (const r of res) lines.push(`${Math.round(r.score)} ${r.name} | ${r.features.filter((f) => /loops|Uses|Second|Passing|bridge/.test(f)).join('; ')} | ${Math.round(r.width / 10)}x${Math.round(r.depth / 10)}`);
    }
  console.log('\nBENCH\n' + lines.join('\n'));
}, 120000);
