import { performance } from 'node:perf_hooks';
import { radixsort } from '../radixsort.js';

const sort = radixsort();
const n = 1 << 16;
const rounds = 100;
const data = Float32Array.from({ length: n }, () =>
  Math.exp((Math.random() - .5) * 100) * (Math.random() < .5 ? 1 : -1));

// Sorts a fresh copy each round, since radix sort modifies its input.
function sortsPerSecond(f) {
  for (let i = 0; i < 10; i++) f(data.slice());
  let elapsed = 0;
  for (let i = 0; i < rounds; i++) {
    const copy = data.slice();
    const start = performance.now();
    f(copy);
    elapsed += performance.now() - start;
  }
  return Math.round(1000 * rounds / elapsed);
}

const aux = new Float32Array(n);
console.log(`radixsort: ${sortsPerSecond(a => sort(a, aux))} sorts per second.`);
console.log(`radixsort argsort: ${sortsPerSecond(a => sort.argsort(a))} sorts per second.`);
console.log(`Float32Array#sort: ${sortsPerSecond(a => a.sort())} sorts per second.`);

const expected = data.slice().sort(), sorted = sort(data.slice());
const argsorted = data.slice(), indices = sort.argsort(argsorted);
console.log("correct?", sorted.every((x, i) => Object.is(x, expected[i]))
    && argsorted.every((x, i) => Object.is(x, expected[i]) && Object.is(x, data[indices[i]])));
