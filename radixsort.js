// Based on http://stereopsis.com/radix.html
// Requires typed arrays.
(function(exports) {
  exports.sort = radixsort;

  var radixBits,
      maxRadix,
      radixMask,
      histograms;

  function radixsort() {
    function sort(array, sorted) {
      var floating = array instanceof Float32Array || array instanceof Float64Array,
          signed = !(array instanceof Uint32Array || array instanceof Uint16Array || array instanceof Uint8Array),
          input = floating ? new Int32Array(array.buffer) : array,
          n = input.length,
          passCount = Math.ceil(array.BYTES_PER_ELEMENT * 8 / radixBits),
          maxOffset = maxRadix * (passCount - 1),
          msbMask = 1 << ((array.BYTES_PER_ELEMENT * 8 - 1) % radixBits),
          lastMask = (msbMask << 1) - 1,
          tmp,
          start,
          inner,
          end,
          histogram;

      if (array instanceof Float32Array) {
        start = startFloat32;
        inner = innerFloat32;
        end = endFloat32;
        histogram = histogramFloat32;
      } else if (array instanceof Float64Array) {
        start = startFloat64;
        inner = innerFloat64;
        end = endFloat64;
        histogram = histogramFloat64;
      } else if (array instanceof Uint32Array || array instanceof Uint16Array || array instanceof Uint8Array) {
        start = startUint;
        inner = end = innerUint;
        histogram = histogramUint;
      } else {
        start = startInt;
        inner = innerInt;
        end = endInt;
        histogram = histogramInt;
      }

      sorted = sorted ? floating ? new Int32Array(sorted.buffer) : sorted
          : new input.constructor(input.length);

      for (var i = 0, n = maxRadix * passCount; i < n; i++) histograms[i] = 0;
      histogram(input, maxOffset, lastMask);
      for (var j = 0; j <= maxOffset; j += maxRadix) {
        for (var id = j, sum = 0; id < j + maxRadix; id++) {
          var tsum = histograms[id] + sum;
          histograms[id] = sum - 1;
          sum = tsum;
        }
      }

      var pass = 0;
      passCount--;
      if (passCount) {
        start(input, sorted);
        tmp = sorted;
        sorted = input;
        input = tmp;
        while (++pass < passCount) {
          inner(input, sorted, pass);
          tmp = sorted;
          sorted = input;
          input = tmp;
        }
      }
      end(input, sorted, pass, msbMask);
      return sorted.buffer;
    }

    sort.radix = function(_) {
      maxRadix = 1 << (radixBits = +_);
      radixMask = maxRadix - 1;
      histograms = radixsort._histograms = new Int32Array(maxRadix * Math.ceil(64 / radixBits));
      return sort;
    };

    return sort.radix(11);
  }

  function startInt(input, sorted) {
    for (var i = 0, n = input.length; i < n; i++) {
      var d = input[i];
      sorted[++histograms[d & radixMask]] = d;
    }
  }

  function innerInt(input, sorted, pass) {
    for (var i = 0, n = input.length, offset = pass * maxRadix, s = pass * radixBits; i < n; i++) {
      var d = input[i];
      sorted[++histograms[offset + (d >>> s & radixMask)]] = d;
    }
  }

  function endInt(input, sorted, pass, msbMask) {
    var lastMask = (msbMask << 1) - 1;
    for (var i = 0, n = input.length, offset = pass * maxRadix, s = pass * radixBits; i < n; i++) {
      var d = input[i];
      sorted[++histograms[offset + (d >>> s & lastMask ^ msbMask)]] = d;
    }
  }

  function startUint(input, sorted) {
    for (var i = 0, n = input.length; i < n; i++) {
      var d = input[i];
      sorted[++histograms[d & radixMask]] = d;
    }
  }

  function innerUint(input, sorted, pass) {
    for (var i = 0, n = input.length, offset = pass * maxRadix, s = pass * radixBits; i < n; i++) {
      var d = input[i],
          x = d >>> s & radixMask;
      sorted[++histograms[offset + x]] = d;
    }
  }

  function startFloat32(input, sorted) {
    for (var i = 0, n = input.length; i < n; i++) {
      var d = input[i];
      // Fast check for most-significant bit: signed-shift of a negative value results in 0xffffffff.
      d ^= (d >> 31) | 0x80000000;
      sorted[++histograms[d & radixMask]] = d;
    }
  }

  function innerFloat32(input, sorted, pass) {
    for (var i = 0, n = input.length, offset = pass * maxRadix, s = pass * radixBits; i < n; i++) {
      var d = input[i];
      sorted[++histograms[offset + (d >>> s & radixMask)]] = d;
    }
  }

  function endFloat32(input, sorted, pass, msbMask) {
    var lastMask = (msbMask << 1) - 1;
    for (var i = 0, n = input.length, offset = pass * maxRadix, s = pass * radixBits; i < n; i++) {
      var d = input[i],
          x = (d >>> s) & lastMask;
      sorted[++histograms[offset + x]] = d ^ (x & msbMask ? 0x80000000 : 0xffffffff);
    }
  }

  function startFloat64(input, sorted) {
    for (var i = 0, n = input.length; i < n; i++) {
      var e = input[i],
          d = input[++i],
          x = (d >> 31);
      d ^= x | 0x80000000;
      e ^= x;
      x = ++histograms[e & radixMask] << 1;
      sorted[x++] = e;
      sorted[x] = d;
    }
  }

  function innerFloat64(input, sorted, pass) {
    for (var i = 0, n = input.length, offset = pass * maxRadix, s = pass * radixBits; i < n; i++) {
      var e = input[i],
          d = input[++i],
          x = (s <= 32 - radixBits ? e >>> s
              : s >= 32 ? d >>> (s - 32)
              : (d << (32 - s)) | (e >>> s)) & radixMask;
      x = ++histograms[offset + x] << 1;
      sorted[x++] = e;
      sorted[x] = d;
    }
  }

  function endFloat64(input, sorted, pass, msbMask) {
    var lastMask = (msbMask << 1) - 1;
    for (var i = 0, n = input.length, offset = pass * maxRadix, s = pass * radixBits - 32; i < n; i++) {
      var e = input[i],
          d = input[++i],
          x = d >>> s & lastMask;
      if (x & msbMask) {
        d ^= 0x80000000;
      } else {
        d ^= 0xffffffff;
        e ^= 0xffffffff;
      }
      x = ++histograms[offset + x] << 1;
      sorted[x++] = e;
      sorted[x] = d;
    }
  }

  function histogramInt(input, maxOffset, lastMask) {
    var msbMask = (lastMask + 1) >>> 1;
    for (var i = 0, n = input.length; i < n; i++) {
      var d = input[i];
      for (var j = 0, k = 0; j < maxOffset; j += maxRadix, k += radixBits) {
        histograms[j + (d >>> k & radixMask)]++;
      }
      histograms[j + (d >>> k & lastMask ^ msbMask)]++;
    }
  }

  function histogramUint(input, maxOffset) {
    for (var i = 0, n = input.length; i < n; i++) {
      var d = input[i];
      for (var j = 0, k = 0; j <= maxOffset; j += maxRadix, k += radixBits) {
        histograms[j + (d >>> k & radixMask)]++;
      }
    }
  }

  function histogramFloat32(input, maxOffset, lastMask) {
    for (var i = 0, n = input.length; i < n; i++) {
      var d = input[i];
      d ^= (d >> 31) | 0x80000000;
      for (var j = 0, k = 0; j < maxOffset; j += maxRadix, k += radixBits) {
        histograms[j + (d >>> k & radixMask)]++;
      }
      histograms[j + (d >>> k & lastMask)]++;
    }
  }

  function histogramFloat64(input, maxOffset, lastMask) {
    for (var i = 0, n = input.length; i < n; i++) {
      var e = input[i],
          d = input[++i],
          x = d >> 31;
      d ^= x | 0x80000000;
      e ^= x;
      for (var j = 0, k = 0; k <= 32 - radixBits; j += maxRadix, k += radixBits) {
        histograms[j + (e >>> k & radixMask)]++;
      }
      histograms[j + (((d << (32 - k)) | (e >>> k)) & radixMask)]++;
      for (k += radixBits - 32, j += maxRadix; j < maxOffset; j += maxRadix, k += radixBits) {
        histograms[j + (d >>> k & radixMask)]++;
      }
      histograms[j + (d >>> k & lastMask)]++;
    }
  }
})(typeof exports !== "undefined" ? exports : this);
