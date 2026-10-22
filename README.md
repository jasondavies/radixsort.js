radixsort.js
============

Radix sort has linear time complexity, *O(kN)*, where *k* is the number of
radices per value, and *N* is the number of values.

How is this possible?  The theoretical lower bound of *O(N log N)* only applies
to comparison-based sorting algorithms, whereas radix sort doesn't actually
perform any *comparisons* on the input data.

Usage
-----
```javascript
import { radixsort } from 'radixsort';

const sort = radixsort();
const data = new Float32Array([…]);

const sorted = sort(data);

// You can also preallocate the auxiliary array, e.g. to reuse it.
const aux = new Float32Array(data.length);
const sorted2 = sort(otherData, aux);
```

To sort associated data too, use `argsort`.  This sorts the array in place,
and returns a `Uint32Array` of the original index of each sorted value, so you
can reorder anything else to match:

```javascript
const points = [[10, 10], [25, 7], [15, 12], [12, 16]];
const xs = new Float64Array(points.map(p => p[0]));

const indices = sort.argsort(xs); // [0, 3, 2, 1]
// xs is now [10, 12, 15, 25]

const sortedPoints = Array.from(indices, i => points[i]);
```

The order is stable: equal values, including any NaNs, keep their original
order.  Values are ordered as by `sort`, and the same types are supported.
Arrays of 2³⁰ or more elements throw a `RangeError`.

radixsort.js is an ES module, and requires Node.js 18 or later.

Supported types are `Float32Array`, `Float64Array`, `Int32Array`,
`Uint32Array`, `Int16Array`, `Uint16Array`, `Int8Array`, `Uint8Array` and
`Uint8ClampedArray`, including typed arrays from other realms.  Other inputs
throw a `TypeError`.

Radix sort uses the input array as scratch space, even when given an auxiliary
array.  The sorted result ends up in either the input or the auxiliary array,
depending on which passes were needed, so always use the returned typed array.
If the result is in the input array, that array is returned; otherwise a new
typed array of the base type (e.g. `Float32Array`) viewing the auxiliary
array's memory is returned, and the input array's contents are unspecified.
Copy the input first if you need to keep it.

The auxiliary array must have the same type as the input and be at least as
long, and its first elements (as many as the input has) must not overlap the
input; otherwise a `TypeError` or `RangeError` is thrown.  8-bit arrays are
sorted in place by counting values, so they never use the auxiliary array.

Values are ordered as by the native `sort`: `-0` before `+0`, and NaNs last.
Small arrays (below 160 to 1,280 elements, depending on the type) are sorted in
place using the native sort, which is faster at those sizes, as are arrays of
2³⁰ or more elements, which would overflow 32-bit counts.

Arrays must not be modified by other threads while being sorted.  An auxiliary
array in a different `SharedArrayBuffer` object that aliases the same memory
as the input can't be detected as overlapping.

Sorting assumes a little-endian platform, which includes all common hardware.

Upgrading from 1.x
------------------

 * radixsort.js is now an ES module, so use `import` rather than `require` or
   a `<script>` tag.  The minified build is no longer provided.
 * `sort.radix()` has been removed; digits are always 11 bits (8 bits for
   16-bit types).
 * The sorted result may now be in either array depending on the data, rather
   than always the same one for a given type, and the returned array may be the
   input array itself.  8-bit arrays are now sorted in place, ignoring the
   auxiliary array.
 * Subclasses of typed arrays are no longer preserved: unless the input array
   itself is returned, the result is a view of the base type.
 * NaNs now sort last, including those with the sign bit set.
 * The auxiliary array must now be of the same type as the input, and at least
   as long.
 * Only the package's main module (and `package.json`) can be imported.
 * Unsupported inputs throw a `TypeError` rather than giving incorrect results,
   and `Uint8ClampedArray` is now supported.
 * New: `sort.argsort()` sorts values along with their original indices, for
   sorting associated data.

Informal Benchmark
------------------

The most common usage scenario for this will probably be sorting 32-bit floats
e.g. for geometry algorithms.  My informal benchmark (`npm run benchmark`)
repeatedly sorts an array of 65,536 random 32-bit floats, comparing against the
native `Float32Array#sort`.  On Node.js 24:

 * Radixsort.js: ~**4,300** sorts per second.
 * Radixsort.js `argsort`: ~**3,000** sorts per second.
 * Native sort: ~**340** sorts per second.

Radixsort.js is roughly **13x** faster!  The speed difference gets even larger
as you increase the input size, as radix sort's time per element stays flat
while the native sort's grows.  Small arrays use the native sort, so they're
no slower:

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/jasondavies/radixsort.js/v2.0.0/benchmark/sizes-dark.png">
  <img alt="Line chart of nanoseconds per element to sort random Float32Array values, for 100 to 10 million elements. The native sort rises from about 7 to 68 ns. radixsort.js 1.0.1 starts at 49 ns for 100 elements, falling to 4.5 ns. radixsort.js 2.0 matches the native sort below 320 elements, then falls to a flat 3.1 ns from 10,000 elements." src="https://raw.githubusercontent.com/jasondavies/radixsort.js/v2.0.0/benchmark/sizes-light.png">
</picture>

The advantage is smaller for integer types, which the native sort handles
faster: around 3–5x for large arrays of 16-bit and 32-bit integers, and 6–10x
for 8-bit types.  Passes for digits that are the same in every value are
skipped, so data with fewer significant bits, such as small integers or
integer-valued floats, sorts faster still.

To regenerate the chart, run `node benchmark/sizes.js` and then
`node benchmark/chart.js`.
