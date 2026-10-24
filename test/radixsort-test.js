import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { radixsort } from '../radixsort.js';

// Seeded random numbers, so failures can be reproduced with SEED=<seed>.
const seed = Number(process.env.SEED) || Math.floor(Math.random() * 2 ** 32);
console.log(`# seed ${seed}`);
let state = seed;
function random() {
  // mulberry32
  state = state + 0x6d2b79f5 | 0;
  let t = Math.imul(state ^ state >>> 15, 1 | state);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
}

const floatExtremes = [Infinity, -Infinity, 0, -0, NaN, -NaN, Number.MAX_VALUE, -Number.MAX_VALUE, Number.MIN_VALUE, -Number.MIN_VALUE];
const intExtremes = bits => [0, 1, -1, 2 ** (bits - 1) - 1, -(2 ** (bits - 1)), -(2 ** (bits - 1)) + 1];
const uintExtremes = bits => [0, 1, 2 ** bits - 1, 2 ** bits - 2, 2 ** (bits - 1), 2 ** (bits - 1) - 1];

const types = [
  [Float32Array, randomFloats, floatExtremes],
  [Float64Array, randomFloats, floatExtremes],
  [Int32Array, n => randomInts(n, 32), intExtremes(32)],
  [Uint32Array, n => randomUints(n, 32), uintExtremes(32)],
  [Int16Array, n => randomInts(n, 16), intExtremes(16)],
  [Uint16Array, n => randomUints(n, 16), uintExtremes(16)],
  [Int8Array, n => randomInts(n, 8), intExtremes(8)],
  [Uint8Array, n => randomUints(n, 8), uintExtremes(8)],
  [Uint8ClampedArray, n => randomUints(n, 8), uintExtremes(8)]
];

// Sizes on either side of every native sort threshold, and some larger ones.
const sizes = [0, 1, 2, 100, 159, 160, 161, 223, 224, 225, 319, 320, 321, 1151, 1152, 1153, 1279, 1280, 1281, 5000];

// Small sizes, and either side of the argsort insertion sort thresholds.
const argsortSizes = [0, 1, 2, 3, 5, 8, 17, 63, 64, 65, 79, 80, 81, 1000, 5000];

// Generators of values where some digits never vary, so their passes are skipped.
const constantDigits = [
  () => 7,
  () => random() < .5 ? -1 : 1,
  () => Math.floor(random() * 100),
  () => Math.floor(random() * 100) * 128,
  () => Math.floor(random() * 100) * 256,
  () => Math.round((random() - .5) * 2000),
  () => Math.floor((random() - .5) * 2 ** 22),
  () => Math.fround((random() - .5) * 1e6),
  () => 1 + random(),
  () => 1 + random() / 2
];

test('radix sort', async t => {
  const sort = radixsort();

  for (const [type, random, extremes] of types) {
    await t.test(type.name, () => {
      for (const n of sizes) {
        const data = random(n);
        assertSorted(data, sort(new type(data)), type);
      }
    });

    await t.test(`${type.name} with auxiliary array`, () => {
      for (const n of sizes) {
        const data = random(n);
        assertSorted(data, sort(new type(data), new type(n)), type);
        // Larger, and at an offset.
        assertSorted(data, sort(new type(data), new type(n + 3).subarray(1)), type);
      }
    });

    await t.test(`${type.name} with offset`, () => {
      const data = random(5000);
      const array = new type(data.length + 16);
      array.set(data, 8);
      assertSorted(data, sort(array.subarray(8, 8 + data.length)), type);
      assert.deepEqual(Array.from(array.subarray(0, 8)), new Array(8).fill(0));
      assert.deepEqual(Array.from(array.subarray(8 + data.length)), new Array(8).fill(0));
    });

    await t.test(`${type.name} extreme values`, () => {
      for (const n of [100, 5000]) {
        const data = Array.from({ length: n }, () => extremes[Math.floor(random() * extremes.length)]);
        assertSorted(data, sort(new type(data)), type);
      }
    });

    // Inputs where some digits never vary, so their passes are skipped.
    await t.test(`${type.name} with constant digits`, () => {
      for (const generate of constantDigits) {
        const data = Array.from({ length: 5000 }, generate);
        assertSorted(data, sort(new type(data)), type);
      }
    });

    await t.test(`${type.name} with each bit varying alone`, () => {
      for (const array of singleBitVariations(type)) assertSorted(Array.from(array), sort(array.slice()), type);
    });
  }

  await t.test('NaNs sort last, whatever their sign', () => {
    for (const type of [Float32Array, Float64Array]) {
      const data = Array.from({ length: 5000 }, (_, i) => i % 7 ? i - 2500 : i % 2 ? NaN : -NaN);
      const array = new type(data);
      // Check the sign bit of -NaN survives conversion, so both kinds are tested.
      const signs = new Set();
      for (let i = 0; i < array.length; i++) if (array[i] !== array[i]) signs.add(signBit(array, i));
      assert.equal(signs.size, 2);
      assertSorted(data, sort(array), type);
    }
  });

  await t.test('returns the input array when it holds the result', () => {
    const small = new Float32Array([3, 1, 2]);
    assert.equal(sort(small), small);
    const bytes = new Uint8Array(randomUints(5000, 8));
    assert.equal(sort(bytes), bytes);
    const shorts = new Int16Array(randomInts(5000, 16));
    assert.equal(sort(shorts), shorts);
  });

  await t.test('returns the input or a view of the auxiliary array', () => {
    for (const [type, random] of types) {
      for (const n of [5000, 100000]) {
        const array = new type(random(n)), aux = new type(n);
        const sorted = sort(array, aux);
        assert.ok(sorted === array || (sorted.buffer === aux.buffer && sorted.byteOffset === aux.byteOffset));
      }
    }
    // Three passes leave random 32-bit data in aux; 8-bit arrays never use it.
    const floats = new Float32Array(randomFloats(5000)), aux = new Float32Array(5000);
    assert.equal(sort(floats, aux).buffer, aux.buffer);
    const bytes = new Uint8Array(5000), unused = new Uint8Array(5000).fill(7);
    sort(bytes, unused);
    assert.ok(unused.every(x => x === 7));
  });

  await t.test('typed arrays from another realm', () => {
    const array = runInNewContext('Float64Array.from(data)', { data: randomFloats(5000) });
    const data = Array.from(array);
    const sorted = sort(array);
    assertSorted(data, new Float64Array(sorted.buffer, sorted.byteOffset, sorted.length), Float64Array);
  });

  await t.test('subclasses', () => {
    class Doubled extends Float32Array {
      constructor(n) { super(n * 2); }
    }
    const array = new Doubled(2500);
    const data = randomFloats(5000);
    array.set(data);
    const sorted = sort(array);
    assert.equal(sorted.length, 5000);
    assertSorted(data, new Float32Array(sorted.buffer, sorted.byteOffset, sorted.length), Float32Array);
  });

  await t.test('invalid auxiliary arrays', () => {
    const array = new Float32Array(randomFloats(5000));
    assert.throws(() => sort(array, new Float64Array(5000)), TypeError);
    assert.throws(() => sort(array, Array.from(array)), TypeError);
    assert.throws(() => sort(array, new Float32Array(4999)), RangeError);
    assert.throws(() => sort(new Float32Array(3), new Float32Array(2)), RangeError);
    const buffer = new Float32Array(9000);
    assert.throws(() => sort(buffer.subarray(0, 5000), buffer.subarray(4000)), RangeError);
    assert.throws(() => sort(buffer.subarray(4000), buffer.subarray(0, 5000)), RangeError);
    // Adjacent ranges of one buffer don't overlap, in either order.
    const data = randomFloats(4500);
    buffer.set(data);
    assertSorted(data, sort(buffer.subarray(0, 4500), buffer.subarray(4500)), Float32Array);
    buffer.set(data, 4500);
    assertSorted(data, sort(buffer.subarray(4500), buffer.subarray(0, 4500)), Float32Array);
    // Only as much of aux as the array needs must not overlap.
    buffer.set(data);
    assertSorted(data, sort(buffer.subarray(0, 4500), buffer.subarray(4500, 9000)), Float32Array);
  });

  await t.test('unsupported type', () => {
    assert.throws(() => sort([3, 2, 1]), TypeError);
    assert.throws(() => sort(new BigInt64Array(3)), TypeError);
    assert.throws(() => sort({ [Symbol.toStringTag]: 'Float32Array', length: 0 }), TypeError);
  });
});

test('argsort', async t => {
  const sort = radixsort();

  for (const [type, random, extremes] of types) {
    await t.test(type.name, () => {
      for (const n of argsortSizes) {
        const data = random(n);
        assertArgsorted(data, sort.argsort, type);
      }
    });

    await t.test(`${type.name} extreme values and duplicates`, () => {
      for (const n of [50, 150, 5000]) {
        assertArgsorted(Array.from({ length: n }, () => extremes[Math.floor(random() * extremes.length)]), sort.argsort, type);
        assertArgsorted(Array.from({ length: n }, () => Math.floor(random() * 4)), sort.argsort, type);
      }
    });

    await t.test(`${type.name} with constant digits`, () => {
      for (const generate of constantDigits) {
        assertArgsorted(Array.from({ length: 5000 }, generate), sort.argsort, type);
      }
    });

    await t.test(`${type.name} with each bit varying alone`, () => {
      for (const n of [50, 2000]) {
        for (const array of singleBitVariations(type, n)) {
          const values = array.slice();
          assertArgsortResult(array, values, sort.argsort(values), type);
        }
      }
    });

    await t.test(`${type.name} with offset`, () => {
      const data = random(5000);
      const array = new type(data.length + 16);
      array.set(data, 8);
      const values = array.subarray(8, 8 + data.length);
      const indices = sort.argsort(values);
      assertArgsortResult(new type(data), values, indices, type);
      assert.deepEqual(Array.from(array.subarray(0, 8)), new Array(8).fill(0));
      assert.deepEqual(Array.from(array.subarray(8 + data.length)), new Array(8).fill(0));
    });
  }

  await t.test('NaNs keep their original order', () => {
    for (const type of [Float32Array, Float64Array]) {
      const words = type.BYTES_PER_ELEMENT / 4;
      for (const n of [3, 10, 200, 5000]) {
        // NaNs of both signs and several payloads, among other values or alone.
        for (const alone of [false, true]) {
          const array = new type(n), bits = new Uint32Array(array.buffer);
          for (let i = 0; i < n; i++) {
            if (alone || i % 3 === 0) {
              // Quiet NaNs, or signalling NaNs (with a payload but no quiet bit).
              const sign = i % 2 ? 0x80000000 : 0, payload = Math.floor(random() * 4);
              if (words === 1) {
                bits[i] = sign | (payload ? 0x7f800000 | payload : 0x7fc00000);
              } else {
                bits[i * 2 + 1] = sign | (payload ? 0x7ff00000 : 0x7ff80000);
                bits[i * 2] = payload;
              }
            } else {
              array[i] = i;
            }
          }
          const signs = new Set(Array.from(array, (x, i) => x !== x ? signBit(array, i) : null).filter(x => x !== null));
          assert.equal(signs.size, n >= 10 || alone ? 2 : signs.size);
          const original = array.slice(), indices = sort.argsort(array);
          assertArgsortResult(original, array, indices, type);
          const nans = Array.from(indices).filter(i => original[i] !== original[i]);
          assert.deepEqual(nans, nans.slice().sort((a, b) => a - b));
        }
      }
    }
  });

  await t.test('typed arrays from another realm', () => {
    const array = runInNewContext('Float64Array.from(data)', { data: randomFloats(5000) });
    const original = Float64Array.from(array);
    const indices = sort.argsort(array);
    assertArgsortResult(original, new Float64Array(array.buffer), indices, Float64Array);
  });

  await t.test('subclasses', () => {
    class Doubled extends Float32Array {
      constructor(n) { super(n * 2); }
    }
    const array = new Doubled(2500), data = randomFloats(5000);
    array.set(data);
    const indices = sort.argsort(array);
    assertArgsortResult(new Float32Array(data), new Float32Array(array.buffer), indices, Float32Array);
  });

  await t.test('writes to a given indices array', () => {
    for (const [type, random] of types) {
      for (const n of [0, 50, 5000]) {
        const data = random(n);
        // The same length: indices itself is returned.
        const original = new type(data), values = original.slice(), indices = new Uint32Array(n);
        assert.equal(sort.argsort(values, indices), indices);
        assertArgsortResult(original, values, indices, type);
        // Longer: a view of its first elements is returned, and the rest is untouched.
        const longer = new Uint32Array(n + 3).fill(7), values2 = original.slice();
        const result = sort.argsort(values2, longer);
        assert.equal(result.buffer, longer.buffer);
        assertArgsortResult(original, values2, result, type);
        assert.deepEqual(Array.from(longer.subarray(n)), [7, 7, 7]);
      }
    }
  });

  await t.test('results are independent of later calls', () => {
    const first = new Float64Array(randomFloats(5000)), firstOriginal = first.slice();
    const indices = sort.argsort(first), copy = indices.slice();
    sort.argsort(new Float64Array(randomFloats(5000)));
    sort.argsort(new Float64Array(randomFloats(20000)));
    assert.deepEqual(indices, copy);
    assertArgsortResult(firstOriginal, first, indices, Float64Array);
  });

  await t.test('invalid arguments', () => {
    assert.throws(() => sort.argsort([3, 2, 1]), TypeError);
    assert.throws(() => sort.argsort(new BigInt64Array(3)), TypeError);
    assert.throws(() => sort.argsort({ [Symbol.toStringTag]: 'Float32Array', length: 0 }), TypeError);
    const array = new Float32Array(randomFloats(5000));
    assert.throws(() => sort.argsort(array, new Int32Array(5000)), TypeError);
    assert.throws(() => sort.argsort(array, Array.from({ length: 5000 })), TypeError);
    assert.throws(() => sort.argsort(array, new Uint32Array(4999)), RangeError);
    assert.throws(() => sort.argsort(array, new Uint32Array(5000), null), TypeError);
    // Indices sharing memory with the array, overlapping or not.
    const buffer = new ArrayBuffer(40000);
    assert.throws(() => sort.argsort(new Float32Array(buffer, 0, 5000), new Uint32Array(buffer, 16000, 5000)), RangeError);
    assert.throws(() => sort.argsort(new Float32Array(buffer, 16000, 5000), new Uint32Array(buffer, 0, 5000)), RangeError);
    const data = randomFloats(5000), values = new Float32Array(buffer, 0, 5000);
    values.set(data);
    assertArgsortResult(new Float32Array(data), values, sort.argsort(values, new Uint32Array(buffer, 20000, 5000)), Float32Array);
  });

  await t.test('out-of-bounds arrays', { skip: !ArrayBuffer.prototype.resize && 'needs resizable buffers' }, () => {
    const buffer = new ArrayBuffer(32, { maxByteLength: 64 });
    const array = new Float64Array(buffer, 16);
    buffer.resize(8);
    assert.throws(() => sort(array), TypeError);
    assert.throws(() => sort.argsort(array), TypeError);
  });
});

// For each bit, an array of copies of a random value, with that bit flipped in
// a random half of them.
function singleBitVariations(type, n = 2000) {
  const bytes = type.BYTES_PER_ELEMENT, arrays = [];
  for (let bit = 0; bit < bytes * 8; bit++) {
    const array = new type(n), view = new Uint8Array(array.buffer);
    const base = Array.from({ length: bytes }, () => Math.floor(random() * 256));
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < bytes; k++) view[i * bytes + k] = base[k];
      if (random() < .5) view[i * bytes + (bit >> 3)] ^= 1 << (bit & 7);
    }
    arrays.push(array);
  }
  return arrays;
}

function signBit(array, i) {
  const bytes = new Uint8Array(array.buffer, array.byteOffset + i * array.BYTES_PER_ELEMENT, array.BYTES_PER_ELEMENT);
  return bytes[bytes.length - 1] >= 0x80;
}

function randomInts(n, bits) {
  const max = 2 ** bits;
  return Array.from({ length: n }, () => Math.floor(random() * max) - max / 2);
}

function randomUints(n, bits) {
  const max = 2 ** bits;
  return Array.from({ length: n }, () => Math.floor(random() * max));
}

function randomFloats(n) {
  return Array.from({ length: n }, () => {
    const r = random();
    return r < .01 ? Infinity
        : r < .02 ? -Infinity
        : r < .03 ? -0
        : r < .04 ? +0
        : r < .05 ? NaN
        : r < .06 ? -NaN
        : Math.exp((random() - .5) * 100) * (random() < .5 ? 1 : -1);
  });
}

// Argsorts a copy of data converted to type, and checks the result.
function assertArgsorted(data, argsort, type) {
  const original = new type(data), values = original.slice();
  assertArgsortResult(original, values, argsort(values), type);
}

// Checks values is sorted like the native sort, indices[i] is the original
// index of values[i], and equal values keep their original order.
function assertArgsortResult(original, values, indices, type) {
  const n = original.length;
  assert.ok(indices instanceof Uint32Array);
  assert.equal(indices.length, n);
  assert.deepEqual(Array.from(values), Array.from(original.slice().sort()));
  const bytes = type.BYTES_PER_ELEMENT;
  const originalBytes = new Uint8Array(original.buffer, original.byteOffset, original.byteLength);
  const valueBytes = new Uint8Array(values.buffer, values.byteOffset, values.byteLength);
  const same = (a, i, b, j) => a.subarray(i * bytes, (i + 1) * bytes).every((x, k) => x === b[j * bytes + k]);
  const seen = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    assert.ok(indices[i] < n && !seen[indices[i]]++, 'indices are a permutation');
    assert.ok(same(valueBytes, i, originalBytes, indices[i]), 'values match their original index');
    // Equal values, including any two NaNs, keep their original order.
    const equal = same(valueBytes, i, valueBytes, i - 1) || (values[i] !== values[i] && values[i - 1] !== values[i - 1]);
    if (i && equal) assert.ok(indices[i] > indices[i - 1], 'argsort is stable');
  }
}

// Compares with the native sort after converting to the array's type.  Strict
// equality uses Object.is, so NaNs match and signed zeroes are distinguished.
function assertSorted(data, sorted, type) {
  const expected = Array.from(new type(data).sort());
  assert.ok(sorted instanceof type);
  assert.deepEqual(Array.from(sorted), expected);
}
