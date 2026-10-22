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
      const generators = [
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
      for (const generate of generators) {
        const data = Array.from({ length: 5000 }, generate);
        assertSorted(data, sort(new type(data)), type);
      }
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

// Compares with the native sort after converting to the array's type.  Strict
// equality uses Object.is, so NaNs match and signed zeroes are distinguished.
function assertSorted(data, sorted, type) {
  const expected = Array.from(new type(data).sort());
  assert.ok(sorted instanceof type);
  assert.deepEqual(Array.from(sorted), expected);
}
