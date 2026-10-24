// Measures the time per element to sort random Float32Array values of
// different sizes with the native sort, radixsort.js 1.0.1 and this version,
// writing the results to sizes.json for chart.js.
//
// Usage: node benchmark/sizes.js

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { cpus, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { radixsort } from '../radixsort.js';

// A seeded pseudo-random number generator, so every run sorts the same data.
let seed = 1;
const random = () => (seed = seed * 16807 % 2147483647) / 2147483647;

const sizes = [100, 200, 500, 1e3, 2e3, 5e3, 1e4, 2e4, 5e4, 1e5, 2e5, 5e5, 1e6, 2e6, 5e6, 1e7];
const script = fileURLToPath(import.meta.url);

if (process.argv[2]) {
  // Measure one size, in its own process so sizes can't affect each other.
  const [n, previousPath] = process.argv.slice(2);
  console.log(JSON.stringify(measure(+n, createRequire(script)(previousPath).radixsort)));
} else {
  const dir = mkdtempSync(join(tmpdir(), 'radixsort-'));
  const previousPath = join(dir, 'radixsort-1.0.1.cjs');
  writeFileSync(previousPath, execFileSync('git', ['show', 'v1.0.1:radixsort.js']));
  const results = sizes.map(n => {
    const result = JSON.parse(execFileSync(process.execPath, [script, n, previousPath], { encoding: 'utf8' }));
    console.log(JSON.stringify(result));
    return result;
  });
  writeFileSync(new URL('sizes.json', import.meta.url), JSON.stringify({
    node: process.version,
    cpu: cpus()[0].model,
    results
  }, null, 2) + '\n');
}

// Returns nanoseconds per element for each implementation, sorting a batch of
// fresh copies per round so small sizes aren't dominated by timer overhead.
function measure(n, previous) {
  const data = Float32Array.from({ length: n }, () =>
    Math.exp((random() - .5) * 100) * (random() < .5 ? 1 : -1));
  const aux = new Float32Array(n), sortPrevious = previous(), sort = radixsort();
  const implementations = {
    native: a => a.sort(),
    previous: a => sortPrevious(a, aux),
    current: a => sort(a, aux)
  };
  const expected = data.slice().sort();
  const batch = Math.max(1, Math.round(2 ** 20 / n)), rounds = n >= 2e6 ? 5 : 12;
  const result = { n };
  for (const [name, f] of Object.entries(implementations)) {
    const sorted = f(data.slice());
    if (!sorted.every((x, i) => Object.is(x, expected[i]))) throw new Error(`${name} sorted ${n} values incorrectly`);
    let best = Infinity;
    for (let round = 0; round < rounds + 3; round++) {
      const copies = Array.from({ length: batch }, () => data.slice());
      const start = process.hrtime.bigint();
      for (const copy of copies) f(copy);
      const elapsed = Number(process.hrtime.bigint() - start) / batch;
      if (round >= 3) best = Math.min(best, elapsed);
    }
    result[name] = +(best / n).toFixed(3);
  }
  return result;
}
