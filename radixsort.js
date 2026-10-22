// Based on https://stereopsis.com/radix.html

const TypedArray = Object.getPrototypeOf(Int8Array);
const typedArrayName = Object.getOwnPropertyDescriptor(TypedArray.prototype, Symbol.toStringTag).get;
const typedArraySort = TypedArray.prototype.sort;

// Sorting parameters for each type, by name.  Each kernel only sees one view
// type, so its typed array accesses stay monomorphic.  flip toggles the top bit
// of the most significant digit for signed integers.  Below the threshold
// length, the native sort is faster than the fixed cost of clearing and summing
// the histograms (measured with V8).
const types = new Map([
  [Float32Array, Int32Array, sortFloat32, 0, 320],
  [Float64Array, Int32Array, sortFloat64, 0, 1280],
  [Int32Array, Int32Array, sort32, 0x200, 1152],
  [Uint32Array, Int32Array, sort32, 0, 1152],
  [Int16Array, Uint16Array, sort16, 0x80, 224],
  [Uint16Array, Uint16Array, sort16, 0, 224],
  [Int8Array, Uint8Array, sort8, 0x80, 160],
  [Uint8Array, Uint8Array, sort8, 0, 160],
  [Uint8ClampedArray, Uint8Array, sort8, 0, 160]
].map(([base, view, kernel, flip, threshold]) => [base.name, { base, view, kernel, flip, threshold }]));

// Histogram counts and Float64 scatter indices overflow 32 bits for arrays this
// long, so the native sort is used instead.
const maxLength = 2 ** 30;

export function radixsort() {
  // Large enough for every 11-bit digit of a 64-bit key.
  const histograms = new Int32Array(10752);

  return function sort(array, aux) {
    const name = typedArrayName.call(array);
    const type = types.get(name);
    if (!type) throw new TypeError("unsupported array type");
    const { base, view, kernel, flip, threshold } = type;
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
    if (n < threshold || n >= maxLength) return typedArraySort.call(array);
    const length = bytes / view.BYTES_PER_ELEMENT;
    const input = new view(array.buffer, array.byteOffset, length);
    const output = kernel(input, view === Uint8Array ? null
        : aux != null ? new view(aux.buffer, aux.byteOffset, length)
        : new view(length), histograms, flip);
    const result = output === input ? array : new base(output.buffer, output.byteOffset, n);
    if (kernel === sortFloat32 || kernel === sortFloat64) moveNaNs(new base(result.buffer, result.byteOffset, n));
    return result;
  };
}

// NaNs with the sign bit set sort before everything else; move them to the end
// to match the native sort.
function moveNaNs(array) {
  if (array[0] === array[0]) return;
  let c = 1;
  while (c < array.length && array[c] !== array[c]) c++;
  const nans = array.slice(0, c);
  array.copyWithin(0, c);
  array.set(nans, array.length - c);
}

// Converts counts to the index before each bucket's first element.
function accumulate(h, start, end) {
  for (let i = start, sum = 0; i < end; i++) {
    const x = h[i] + sum;
    h[i] = sum - 1;
    sum = x;
  }
}

// Each kernel builds the histograms for all digits in one pass, tracking which
// bits vary between values, then runs a scatter pass for each digit in turn.
// A digit whose bits never vary is skipped, since it cannot change the order of
// values that tie on the higher digits.  Kernels return whichever of input and
// aux holds the result.

// Floats are viewed as integers and converted to keys that sort as unsigned
// integers, flipping the sign bit of positive values, and all bits of negative
// values.  The first scatter pass converts values to keys, and the last
// converts them back, or this is done in place if those passes are skipped.
function sortFloat32(input, aux, h) {
  const n = input.length;
  let or = 0, and = -1;
  h.fill(0, 0, 5120);
  for (let i = 0; i < n; i++) {
    let k = input[i];
    or |= k;
    and &= k;
    k ^= k >> 31 | 0x80000000;
    h[k & 0x7ff]++;
    h[2048 + (k >>> 11 & 0x7ff)]++;
    h[4096 + (k >>> 22)]++;
  }
  const varying = or ^ and;
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

// Integers are stored as is.
function sort32(input, aux, h, flip) {
  const n = input.length;
  let or = 0, and = -1;
  h.fill(0, 0, 5120);
  for (let i = 0; i < n; i++) {
    const k = input[i];
    or |= k;
    and &= k;
    h[k & 0x7ff]++;
    h[2048 + (k >>> 11 & 0x7ff)]++;
    h[4096 + (k >>> 22 ^ flip)]++;
  }
  const varying = or ^ and;
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
  let or = 0, and = -1, orh = 0, andh = -1;
  h.fill(0, 0, 10752);
  for (let i = 0; i < n; i += 2) {
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
  const varying = or ^ and, varyingh = orh ^ andh;
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
  const n = input.length;
  let or = 0, and = -1;
  h.fill(0, 0, 512);
  for (let i = 0; i < n; i++) {
    const k = input[i];
    or |= k;
    and &= k;
    h[k & 0xff]++;
    h[256 + (k >>> 8 ^ flip)]++;
  }
  const varying = or ^ and;
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
  h.fill(0, 0, 256);
  for (let i = 0; i < n; i++) h[input[i] ^ flip]++;
  for (let b = 0, i = 0; b < 256; b++) {
    const k = b ^ flip, end = i + h[b];
    if (end - i > 64) input.fill(k, i, i = end);
    else while (i < end) input[i++] = k;
  }
  return input;
}
