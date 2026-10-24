// Based on https://stereopsis.com/radix.html

const TypedArray = Object.getPrototypeOf(Int8Array);
const typedArrayName = Object.getOwnPropertyDescriptor(TypedArray.prototype, Symbol.toStringTag).get;
const typedArraySort = TypedArray.prototype.sort;

// Sorting parameters for each type, by name:
//  * base: the type itself.
//  * view: the type its kernels view the values as.  Each kernel only sees one
//    view type, so its typed array accesses stay monomorphic.
//  * kernel, argsortKernel: the sort and argsort kernels.
//  * flip: toggles the top bit of the most significant digit for signed integers.
//  * nativeThreshold: below this length, the native sort is faster than the
//    fixed cost of clearing and summing the histograms (measured with V8).
//  * insertion, insertionThreshold: likewise, an insertion sort for argsort.
//  * bits: for floats, an integer type for moving NaNs with their exact bits.
const types = new Map([
  [Float32Array, Int32Array, sortFloat32, argsortFloat32, 0, 320, insertionFloat32, 64, Uint32Array],
  [Float64Array, Int32Array, sortFloat64, argsortFloat64, 0, 1280, insertion64, 80, BigUint64Array],
  [Int32Array, Int32Array, sort32, argsort32, 0x200, 1152, insertionInt32, 64, null],
  [Uint32Array, Int32Array, sort32, argsort32, 0, 1152, insertionUint32, 64, null],
  [Int16Array, Uint16Array, sort16, argsort16, 0x80, 224, null, 0, null],
  [Uint16Array, Uint16Array, sort16, argsort16, 0, 224, null, 0, null],
  [Int8Array, Uint8Array, sort8, argsort8, 0x80, 160, null, 0, null],
  [Uint8Array, Uint8Array, sort8, argsort8, 0, 160, null, 0, null],
  [Uint8ClampedArray, Uint8Array, sort8, argsort8, 0, 160, null, 0, null]
].map(([base, view, kernel, argsortKernel, flip, nativeThreshold, insertion, insertionThreshold, bits]) => [
  base.name,
  { base, view, kernel, argsortKernel, flip, nativeThreshold, insertion, insertionThreshold, bits }
]));

// Histogram counts and Float64 scatter indices overflow 32 bits for arrays this
// long, so the native sort is used instead.
const maxLength = 2 ** 30;

export function radixsort() {
  // Large enough for every 11-bit digit of a 64-bit key.
  const histograms = new Int32Array(10752);
  const scratch = createScratch();

  function sort(array, aux) {
    const name = typedArrayName.call(array);
    const type = types.get(name);
    if (!type) throw new TypeError("unsupported array type");
    const { base, view, kernel, flip, nativeThreshold, bits } = type;
    // Read the length once, in case a shared buffer grows during the call.
    const n = array.length, bytes = n * base.BYTES_PER_ELEMENT;
    if (aux != null) {
      if (typedArrayName.call(aux) !== name) throw new TypeError("aux must have the same type as array");
      if (aux.length < n) throw new RangeError("aux is shorter than array");
      if (aux.buffer === array.buffer
          && aux.byteOffset < array.byteOffset + bytes
          && array.byteOffset < aux.byteOffset + bytes) {
        throw new RangeError("aux overlaps array");
      }
    }
    if (n < nativeThreshold || n >= maxLength) return typedArraySort.call(array);
    const length = bytes / view.BYTES_PER_ELEMENT;
    const input = new view(array.buffer, array.byteOffset, length);
    // The 8-bit counting sort needs no scratch array.
    const scratch = kernel === sort8 ? null
        : aux != null ? new view(aux.buffer, aux.byteOffset, length)
        : new view(length);
    const output = kernel(input, scratch, histograms, flip);
    const result = output === input ? array : new base(output.buffer, output.byteOffset, n);
    if (bits) moveNaNs(new base(result.buffer, result.byteOffset, n));
    return result;
  }

  // Sorts array in place, returning the original index of each sorted value,
  // written to indices if given.  Equal values keep their original order.
  sort.argsort = function(array, indices) {
    if (arguments.length > 2) throw new TypeError("argsort takes an array and optional indices");
    const type = types.get(typedArrayName.call(array));
    if (!type) throw new TypeError("unsupported array type");
    const { base, view, argsortKernel, flip, insertion, insertionThreshold, bits } = type;
    // Read the length once, in case a shared buffer grows during the call.
    const n = array.length, bytes = n * base.BYTES_PER_ELEMENT;
    let result;
    if (indices != null) {
      if (typedArrayName.call(indices) !== "Uint32Array") throw new TypeError("indices must be a Uint32Array");
      if (indices.length < n) throw new RangeError("indices is shorter than array");
      if (indices.buffer === array.buffer
          && indices.byteOffset < array.byteOffset + bytes
          && array.byteOffset < indices.byteOffset + n * 4) {
        throw new RangeError("indices overlaps array");
      }
      result = new Uint32Array(indices.buffer, indices.byteOffset, n);
    } else {
      result = new Uint32Array(n);
    }
    if (n === 0) {
      // Throws for detached and out-of-bounds arrays, like sort.
      typedArraySort.call(array);
    } else {
      if (n >= maxLength) throw new RangeError("array is too long");
      const { buffer, byteOffset } = array;
      const input = new view(buffer, byteOffset, bytes / view.BYTES_PER_ELEMENT);
      if (n < insertionThreshold) insertion(input, result);
      else argsortKernel(input, result, histograms, flip, scratch);
      if (bits) moveNaNs(new base(buffer, byteOffset, n), result, new bits(buffer, byteOffset, n));
    }
    return indices != null && indices.length === n ? indices : result;
  };

  return sort;
}

// NaNs with the sign bit set sort before everything else; move them to the end
// to match the native sort, along with their indices if given.  The kernels
// order NaNs by their bits, so for argsort, also put NaNs back in their original
// order, moving their bits (an integer view of array) so they are kept exactly.
function moveNaNs(array, indices, bits) {
  const n = array.length;
  if (array[0] !== array[0]) {
    let c = 1;
    while (c < n && array[c] !== array[c]) c++;
    rotate(array, c);
    if (indices) rotate(indices, c);
  }
  if (indices && array[n - 1] !== array[n - 1]) {
    let start = n - 1;
    while (start > 0 && array[start - 1] !== array[start - 1]) start--;
    sortByIndex(bits, indices, start);
  }
}

// Sorts the elements of bits and indices from start by index.
function sortByIndex(bits, indices, start) {
  let sorted = true;
  for (let i = start + 1; sorted && i < indices.length; i++) sorted = indices[i - 1] < indices[i];
  if (sorted) return;
  const order = Array.from({ length: indices.length - start }, (_, i) => start + i)
      .sort((a, b) => indices[a] - indices[b]);
  const orderedBits = order.map(i => bits[i]), orderedIndices = order.map(i => indices[i]);
  for (let i = 0; i < order.length; i++) {
    bits[start + i] = orderedBits[i];
    indices[start + i] = orderedIndices[i];
  }
}

// Moves the first c elements of array to the end.
function rotate(array, c) {
  const head = array.slice(0, c);
  array.copyWithin(0, c);
  array.set(head, array.length - c);
}

// Converts counts to the index before each bucket's first element.
function accumulate(h, start, end) {
  for (let i = start, sum = 0; i < end; i++) {
    const x = h[i] + sum;
    h[i] = sum - 1;
    sum = x;
  }
}

// Each histogram function clears and fills the histograms for every digit of
// its kernels' keys, and returns the bits that vary between values.  The
// histogram for digit d starts at h[d * 2048], or h[d * 256] for 8-bit digits.

function histogramFloat32(input, h) {
  let or = 0, and = -1;
  h.fill(0, 0, 5120);
  for (let i = 0, n = input.length; i < n; i++) {
    let k = input[i];
    or |= k;
    and &= k;
    k ^= k >> 31 | 0x80000000;
    h[k & 0x7ff]++;
    h[2048 + (k >>> 11 & 0x7ff)]++;
    h[4096 + (k >>> 22)]++;
  }
  return or ^ and;
}

function histogram32(input, h, flip) {
  let or = 0, and = -1;
  h.fill(0, 0, 5120);
  for (let i = 0, n = input.length; i < n; i++) {
    const k = input[i];
    or |= k;
    and &= k;
    h[k & 0x7ff]++;
    h[2048 + (k >>> 11 & 0x7ff)]++;
    h[4096 + (k >>> 22 ^ flip)]++;
  }
  return or ^ and;
}

// Returns the varying bits of the low and high words.
function histogramFloat64(input, h) {
  let or = 0, and = -1, orh = 0, andh = -1;
  h.fill(0, 0, 10752);
  for (let i = 0, n = input.length; i < n; i += 2) {
    let k = input[i], kh = input[i + 1];
    or |= k;
    and &= k;
    orh |= kh;
    andh &= kh;
    const x = kh >> 31;
    kh ^= x | 0x80000000;
    k ^= x;
    h[k & 0x7ff]++;
    h[2048 + (k >>> 11 & 0x7ff)]++;
    h[4096 + ((k >>> 22 | kh << 10) & 0x7ff)]++;
    h[6144 + (kh >>> 1 & 0x7ff)]++;
    h[8192 + (kh >>> 12 & 0x7ff)]++;
    h[10240 + (kh >>> 23)]++;
  }
  return [or ^ and, orh ^ andh];
}

function histogram16(input, h, flip) {
  let or = 0, and = -1;
  h.fill(0, 0, 512);
  for (let i = 0, n = input.length; i < n; i++) {
    const k = input[i];
    or |= k;
    and &= k;
    h[k & 0xff]++;
    h[256 + (k >>> 8 ^ flip)]++;
  }
  return or ^ and;
}

// 8-bit values are only counted, as they have a single digit.
function histogram8(input, h, flip) {
  h.fill(0, 0, 256);
  for (let i = 0, n = input.length; i < n; i++) h[input[i] ^ flip]++;
}

// Each kernel builds the histograms for all digits in one pass, finding which
// bits vary between values, then runs a scatter pass for each digit in turn.
// A digit whose bits never vary is skipped, since it cannot change the order of
// values that tie on the higher digits.  Kernels return whichever of input and
// aux holds the result.

// Floats are viewed as integers and converted to keys that sort as unsigned
// integers, flipping the sign bit of positive values, and all bits of negative
// values.  The first scatter pass converts values to keys, and the last
// converts them back, or this is done in place if those passes are skipped.
function sortFloat32(input, aux, h) {
  const n = input.length, varying = histogramFloat32(input, h);
  if (!varying) return input;
  let src = input, dst = aux;
  if (varying & 0x7ff) {
    accumulate(h, 0, 2048);
    for (let i = 0; i < n; i++) {
      let k = src[i];
      k ^= k >> 31 | 0x80000000;
      dst[++h[k & 0x7ff]] = k;
    }
    [src, dst] = [dst, src];
  } else {
    for (let i = 0; i < n; i++) src[i] ^= src[i] >> 31 | 0x80000000;
  }
  if (varying >>> 11 & 0x7ff) {
    accumulate(h, 2048, 4096);
    for (let i = 0; i < n; i++) {
      const k = src[i];
      dst[++h[2048 + (k >>> 11 & 0x7ff)]] = k;
    }
    [src, dst] = [dst, src];
  }
  if (varying >>> 22) {
    accumulate(h, 4096, 5120);
    for (let i = 0; i < n; i++) {
      const k = src[i];
      dst[++h[4096 + (k >>> 22)]] = k ^ (~k >> 31 | 0x80000000);
    }
    [src, dst] = [dst, src];
  } else {
    for (let i = 0; i < n; i++) src[i] ^= ~src[i] >> 31 | 0x80000000;
  }
  return src;
}

// Integers are stored as is, with flip applied to the most significant digit.
function sort32(input, aux, h, flip) {
  const n = input.length, varying = histogram32(input, h, flip);
  let src = input, dst = aux;
  if (varying & 0x7ff) {
    accumulate(h, 0, 2048);
    for (let i = 0; i < n; i++) {
      const k = src[i];
      dst[++h[k & 0x7ff]] = k;
    }
    [src, dst] = [dst, src];
  }
  if (varying >>> 11 & 0x7ff) {
    accumulate(h, 2048, 4096);
    for (let i = 0; i < n; i++) {
      const k = src[i];
      dst[++h[2048 + (k >>> 11 & 0x7ff)]] = k;
    }
    [src, dst] = [dst, src];
  }
  if (varying >>> 22) {
    accumulate(h, 4096, 5120);
    for (let i = 0; i < n; i++) {
      const k = src[i];
      dst[++h[4096 + (k >>> 22 ^ flip)]] = k;
    }
    [src, dst] = [dst, src];
  }
  return src;
}

// Float64 values are pairs of (low, high) words, converted to keys as in
// sortFloat32.
function sortFloat64(input, aux, h) {
  const n = input.length;
  const [varying, varyingh] = histogramFloat64(input, h);
  if (!varying && !varyingh) return input;
  let src = input, dst = aux;
  if (varying & 0x7ff) {
    accumulate(h, 0, 2048);
    for (let i = 0; i < n; i += 2) {
      let k = src[i], kh = src[i + 1];
      const x = kh >> 31;
      kh ^= x | 0x80000000;
      k ^= x;
      const j = ++h[k & 0x7ff] << 1;
      dst[j] = k;
      dst[j + 1] = kh;
    }
    [src, dst] = [dst, src];
  } else {
    for (let i = 0; i < n; i += 2) {
      const x = src[i + 1] >> 31;
      src[i] ^= x;
      src[i + 1] ^= x | 0x80000000;
    }
  }
  if (varying >>> 11 & 0x7ff) {
    accumulate(h, 2048, 4096);
    for (let i = 0; i < n; i += 2) {
      const k = src[i], j = ++h[2048 + (k >>> 11 & 0x7ff)] << 1;
      dst[j] = k;
      dst[j + 1] = src[i + 1];
    }
    [src, dst] = [dst, src];
  }
  if ((varying >>> 22 | varyingh << 10) & 0x7ff) {
    accumulate(h, 4096, 6144);
    for (let i = 0; i < n; i += 2) {
      const k = src[i], kh = src[i + 1], j = ++h[4096 + ((k >>> 22 | kh << 10) & 0x7ff)] << 1;
      dst[j] = k;
      dst[j + 1] = kh;
    }
    [src, dst] = [dst, src];
  }
  if (varyingh >>> 1 & 0x7ff) {
    accumulate(h, 6144, 8192);
    for (let i = 0; i < n; i += 2) {
      const kh = src[i + 1], j = ++h[6144 + (kh >>> 1 & 0x7ff)] << 1;
      dst[j] = src[i];
      dst[j + 1] = kh;
    }
    [src, dst] = [dst, src];
  }
  if (varyingh >>> 12 & 0x7ff) {
    accumulate(h, 8192, 10240);
    for (let i = 0; i < n; i += 2) {
      const kh = src[i + 1], j = ++h[8192 + (kh >>> 12 & 0x7ff)] << 1;
      dst[j] = src[i];
      dst[j + 1] = kh;
    }
    [src, dst] = [dst, src];
  }
  if (varyingh >>> 23) {
    accumulate(h, 10240, 10752);
    for (let i = 0; i < n; i += 2) {
      const kh = src[i + 1], x = ~kh >> 31, j = ++h[10240 + (kh >>> 23)] << 1;
      dst[j] = src[i] ^ x;
      dst[j + 1] = kh ^ (x | 0x80000000);
    }
    [src, dst] = [dst, src];
  } else {
    for (let i = 0; i < n; i += 2) {
      const x = ~src[i + 1] >> 31;
      src[i] ^= x;
      src[i + 1] ^= x | 0x80000000;
    }
  }
  return src;
}

// 16-bit values are sorted using two 8-bit digits.
function sort16(input, aux, h, flip) {
  const n = input.length, varying = histogram16(input, h, flip);
  let src = input, dst = aux;
  if (varying & 0xff) {
    accumulate(h, 0, 256);
    for (let i = 0; i < n; i++) {
      const k = src[i];
      dst[++h[k & 0xff]] = k;
    }
    [src, dst] = [dst, src];
  }
  if (varying >>> 8) {
    accumulate(h, 256, 512);
    for (let i = 0; i < n; i++) {
      const k = src[i];
      dst[++h[256 + (k >>> 8 ^ flip)]] = k;
    }
    [src, dst] = [dst, src];
  }
  return src;
}

// 8-bit values are counted, then written back in order.
function sort8(input, aux, h, flip) {
  const n = input.length;
  histogram8(input, h, flip);
  for (let b = 0, i = 0; b < 256; b++) {
    const k = b ^ flip, end = i + h[b];
    if (end - i > 64) input.fill(k, i, i = end);
    else while (i < end) input[i++] = k;
  }
  return input;
}

// Each argsort kernel sorts input like the corresponding sort kernel, moving
// each value's original index with it, and writes the indices to result.  The
// first scatter pass reads input, the last writes the sorted values back to it
// and the indices to result, and the others move keys and indices between two
// pairs of scratch arrays.  If the first pass is skipped, the keys are copied
// instead; if the last is skipped, they are copied back.

function argsortFloat32(input, result, h, flip, scratch) {
  const n = input.length, varying = histogramFloat32(input, h);
  if (!varying) return identity(result);
  let keys = scratch(0, Int32Array, n), keys2 = scratch(1, Int32Array, n);
  let index = scratch(2, Uint32Array, n), index2 = scratch(3, Uint32Array, n);
  if (varying & 0x7ff) {
    accumulate(h, 0, 2048);
    for (let i = 0; i < n; i++) {
      let k = input[i];
      k ^= k >> 31 | 0x80000000;
      const j = ++h[k & 0x7ff];
      keys[j] = k;
      index[j] = i;
    }
  } else {
    for (let i = 0; i < n; i++) {
      const k = input[i];
      keys[i] = k ^ (k >> 31 | 0x80000000);
      index[i] = i;
    }
  }
  if (varying >>> 11 & 0x7ff) {
    accumulate(h, 2048, 4096);
    for (let i = 0; i < n; i++) {
      const k = keys[i], j = ++h[2048 + (k >>> 11 & 0x7ff)];
      keys2[j] = k;
      index2[j] = index[i];
    }
    [keys, keys2, index, index2] = [keys2, keys, index2, index];
  }
  if (varying >>> 22) {
    accumulate(h, 4096, 5120);
    for (let i = 0; i < n; i++) {
      const k = keys[i], j = ++h[4096 + (k >>> 22)];
      input[j] = k ^ (~k >> 31 | 0x80000000);
      result[j] = index[i];
    }
    return result;
  }
  for (let i = 0; i < n; i++) input[i] = keys[i] ^ (~keys[i] >> 31 | 0x80000000);
  result.set(index);
  return result;
}

function argsort32(input, result, h, flip, scratch) {
  const n = input.length, varying = histogram32(input, h, flip);
  if (!varying) return identity(result);
  let keys = scratch(0, Int32Array, n), keys2 = scratch(1, Int32Array, n);
  let index = scratch(2, Uint32Array, n), index2 = scratch(3, Uint32Array, n);
  if (varying & 0x7ff) {
    accumulate(h, 0, 2048);
    for (let i = 0; i < n; i++) {
      const k = input[i], j = ++h[k & 0x7ff];
      keys[j] = k;
      index[j] = i;
    }
  } else {
    keys.set(input);
    identity(index);
  }
  if (varying >>> 11 & 0x7ff) {
    accumulate(h, 2048, 4096);
    for (let i = 0; i < n; i++) {
      const k = keys[i], j = ++h[2048 + (k >>> 11 & 0x7ff)];
      keys2[j] = k;
      index2[j] = index[i];
    }
    [keys, keys2, index, index2] = [keys2, keys, index2, index];
  }
  if (varying >>> 22) {
    accumulate(h, 4096, 5120);
    for (let i = 0; i < n; i++) {
      const k = keys[i], j = ++h[4096 + (k >>> 22 ^ flip)];
      input[j] = k;
      result[j] = index[i];
    }
    return result;
  }
  input.set(keys);
  result.set(index);
  return result;
}

function argsortFloat64(input, result, h, flip, scratch) {
  const n = input.length, m = n >> 1;
  const [varying, varyingh] = histogramFloat64(input, h);
  if (!varying && !varyingh) return identity(result);
  let keys = scratch(0, Int32Array, n), keys2 = scratch(1, Int32Array, n);
  let index = scratch(2, Uint32Array, m), index2 = scratch(3, Uint32Array, m);
  if (varying & 0x7ff) {
    accumulate(h, 0, 2048);
    for (let i = 0; i < n; i += 2) {
      let k = input[i], kh = input[i + 1];
      const x = kh >> 31;
      kh ^= x | 0x80000000;
      k ^= x;
      const j = ++h[k & 0x7ff];
      keys[j << 1] = k;
      keys[(j << 1) + 1] = kh;
      index[j] = i >> 1;
    }
  } else {
    for (let i = 0; i < n; i += 2) {
      const x = input[i + 1] >> 31;
      keys[i] = input[i] ^ x;
      keys[i + 1] = input[i + 1] ^ (x | 0x80000000);
      index[i >> 1] = i >> 1;
    }
  }
  if (varying >>> 11 & 0x7ff) {
    accumulate(h, 2048, 4096);
    for (let i = 0; i < n; i += 2) {
      const k = keys[i], j = ++h[2048 + (k >>> 11 & 0x7ff)];
      keys2[j << 1] = k;
      keys2[(j << 1) + 1] = keys[i + 1];
      index2[j] = index[i >> 1];
    }
    [keys, keys2, index, index2] = [keys2, keys, index2, index];
  }
  if ((varying >>> 22 | varyingh << 10) & 0x7ff) {
    accumulate(h, 4096, 6144);
    for (let i = 0; i < n; i += 2) {
      const k = keys[i], kh = keys[i + 1], j = ++h[4096 + ((k >>> 22 | kh << 10) & 0x7ff)];
      keys2[j << 1] = k;
      keys2[(j << 1) + 1] = kh;
      index2[j] = index[i >> 1];
    }
    [keys, keys2, index, index2] = [keys2, keys, index2, index];
  }
  if (varyingh >>> 1 & 0x7ff) {
    accumulate(h, 6144, 8192);
    for (let i = 0; i < n; i += 2) {
      const kh = keys[i + 1], j = ++h[6144 + (kh >>> 1 & 0x7ff)];
      keys2[j << 1] = keys[i];
      keys2[(j << 1) + 1] = kh;
      index2[j] = index[i >> 1];
    }
    [keys, keys2, index, index2] = [keys2, keys, index2, index];
  }
  if (varyingh >>> 12 & 0x7ff) {
    accumulate(h, 8192, 10240);
    for (let i = 0; i < n; i += 2) {
      const kh = keys[i + 1], j = ++h[8192 + (kh >>> 12 & 0x7ff)];
      keys2[j << 1] = keys[i];
      keys2[(j << 1) + 1] = kh;
      index2[j] = index[i >> 1];
    }
    [keys, keys2, index, index2] = [keys2, keys, index2, index];
  }
  if (varyingh >>> 23) {
    accumulate(h, 10240, 10752);
    for (let i = 0; i < n; i += 2) {
      const kh = keys[i + 1], x = ~kh >> 31, j = ++h[10240 + (kh >>> 23)];
      input[j << 1] = keys[i] ^ x;
      input[(j << 1) + 1] = kh ^ (x | 0x80000000);
      result[j] = index[i >> 1];
    }
    return result;
  }
  for (let i = 0; i < n; i += 2) {
    const x = ~keys[i + 1] >> 31;
    input[i] = keys[i] ^ x;
    input[i + 1] = keys[i + 1] ^ (x | 0x80000000);
  }
  result.set(index);
  return result;
}

function argsort16(input, result, h, flip, scratch) {
  const n = input.length, varying = histogram16(input, h, flip);
  if (!varying) return identity(result);
  const keys = scratch(0, Uint16Array, n), index = scratch(2, Uint32Array, n);
  if (varying & 0xff) {
    accumulate(h, 0, 256);
    for (let i = 0; i < n; i++) {
      const k = input[i], j = ++h[k & 0xff];
      keys[j] = k;
      index[j] = i;
    }
  } else {
    keys.set(input);
    identity(index);
  }
  if (varying >>> 8) {
    accumulate(h, 256, 512);
    for (let i = 0; i < n; i++) {
      const k = keys[i], j = ++h[256 + (k >>> 8 ^ flip)];
      input[j] = k;
      result[j] = index[i];
    }
    return result;
  }
  input.set(keys);
  result.set(index);
  return result;
}

// 8-bit indices are placed by counting values, which are then written back.
function argsort8(input, result, h, flip) {
  const n = input.length, index = result;
  histogram8(input, h, flip);
  accumulate(h, 0, 256);
  for (let i = 0; i < n; i++) index[++h[input[i] ^ flip]] = i;
  // Each bucket now ends at its histogram entry.
  for (let b = 0, i = 0; b < 256; b++) {
    const k = b ^ flip, end = h[b] + 1;
    if (end - i > 64) input.fill(k, i, i = end);
    else while (i < end) input[i++] = k;
  }
  return index;
}

// Stable insertion sorts for short arrays, writing the original indices to index.  For
// 32-bit values, the keys k ^ (k >> 31 & a | b) are compared as unsigned
// integers, where a and b convert floats or signed integers as for the kernels.
function insertion32(input, index, a, b) {
  const n = input.length;
  for (let i = 0; i < n; i++) {
    const k = input[i], key = (k ^ (k >> 31 & a | b)) >>> 0;
    let j = i - 1;
    for (; j >= 0; j--) {
      const x = input[j];
      if ((x ^ (x >> 31 & a | b)) >>> 0 <= key) break;
      input[j + 1] = x;
      index[j + 1] = index[j];
    }
    input[j + 1] = k;
    index[j + 1] = i;
  }
  return index;
}

// Float64 values are pairs of (low, high) words, converted to keys as in
// sortFloat32 and compared high word first.
function insertion64(input, index) {
  const n = input.length >> 1;
  for (let i = 0; i < n; i++) {
    const k = input[2 * i], kh = input[2 * i + 1], x = kh >> 31;
    const high = (kh ^ (x | 0x80000000)) >>> 0, low = (k ^ x) >>> 0;
    let j = i - 1;
    for (; j >= 0; j--) {
      const yl = input[2 * j], yh = input[2 * j + 1], y = yh >> 31;
      const yHigh = (yh ^ (y | 0x80000000)) >>> 0;
      if (yHigh < high || yHigh === high && (yl ^ y) >>> 0 <= low) break;
      input[2 * j + 2] = yl;
      input[2 * j + 3] = yh;
      index[j + 1] = index[j];
    }
    input[2 * j + 2] = k;
    input[2 * j + 3] = kh;
    index[j + 1] = i;
  }
  return index;
}

function insertionFloat32(input, index) {
  return insertion32(input, index, -1, 1 << 31);
}

function insertionInt32(input, index) {
  return insertion32(input, index, 0, 1 << 31);
}

function insertionUint32(input, index) {
  return insertion32(input, index, 0, 0);
}

// Sets index[i] = i.
function identity(index) {
  for (let i = 0; i < index.length; i++) index[i] = i;
  return index;
}

// Returns scratch(i, type, length), which gives a scratch array from slot i,
// reusing its buffer while it's still alive: freshly allocated memory can be
// slow to fault in on some platforms, but holding buffers weakly lets an idle
// sorter's scratch memory be collected.
function createScratch() {
  const refs = [];
  return function scratch(i, type, length) {
    const bytes = length * type.BYTES_PER_ELEMENT;
    let buffer = refs[i]?.deref();
    if (!(buffer?.byteLength >= bytes)) refs[i] = new WeakRef(buffer = new ArrayBuffer(bytes));
    return new type(buffer, 0, length);
  };
}
