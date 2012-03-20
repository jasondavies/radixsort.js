// Based on http://stereopsis.com/radix.html
// Requires typed arrays.
(function(exports) {
  exports.sort = radixsort;

  var radixBits = 8,
      maxRadix = 1 << radixBits,
      msbMask = maxRadix >> 1,
      radixMask = maxRadix - 1,
      histograms = radixsort._histograms = new Int32Array(maxRadix * Math.ceil(64 / radixBits));

  function radixsort() {
    function sort(array, sorted) {
      var f64 = array instanceof Float64Array,
          floating = array instanceof Float32Array || f64,
          signed = !(array instanceof Uint32Array || array instanceof Uint16Array || array instanceof Uint8Array),
          n = array.length,
          input = floating ? new Int32Array(array.buffer) : array,
          passCount = Math.ceil(array.BYTES_PER_ELEMENT * 8 / radixBits),
          tmp,
          i;
      sorted = sorted ? floating ? new Int32Array(sorted.buffer) : sorted
          : new input.constructor(input.length);

      createHistograms(input, passCount, signed, floating, f64);

      var maxPass = (passCount - 1) * radixBits;
      for (var pass = 0, offset = 0; pass <= maxPass; pass += radixBits, offset += maxRadix) {
        for (i = 0; i < n; i++) {
          var x,
              d,
              e;
          if (f64) {
            e = input[d = i << 1];
            d = input[d + 1];
            x = (pass > 31 ? d >> (pass - 32) : e >> pass) & radixMask;
          } else {
            e = 0;
            d = input[i];
            x = (d >> pass) & radixMask;
          }
          if (signed) {
            if (pass === maxPass) {
              if (floating) {
                if (x & msbMask) {
                  d ^= 0x80000000;
                } else {
                  d ^= 0xffffffff;
                  e ^= 0xffffffff;
                }
              } else x ^= msbMask;
            } else if (pass === 0 && floating) {
              if (d >> 31) {
                d ^= 0xffffffff;
                e ^= 0xffffffff;
                x ^= radixMask;
              } else {
                d ^= 0x80000000;
              }
            }
          }
          x = ++histograms[offset + x];
          if (f64) {
            sorted[x <<= 1] = e;
            x++;
          }
          sorted[x] = d;
        }
        tmp = sorted;
        sorted = input;
        input = tmp;
      }
      return input.buffer;
    }

    return sort;
  }

  function createHistograms(input, passCount, signed, floating, f64) {
    var i,
        j,
        k,
        id,
        sum,
        tsum,
        n = input.length,
        maxOffset = maxRadix * (passCount - 1),
        msbShift = radixBits * (passCount - 1),
        d,
        e,
        x,
        mask;
    if (f64) msbShift -= 32;
    for (i = 0; i < maxRadix * passCount; i++) histograms[i] = 0;
    for (i = 0; i < n; i++) {
      // Check sign bit first.
      if (f64) {
        e = input[i];
        d = input[++i];
      } else d = e = input[i];
      x = (d >>> msbShift) & radixMask;
      mask = floating ? x & msbMask ? (x ^= radixMask, radixMask) : (x |= msbMask, 0) : 0;
      if (!floating && signed) x ^= msbMask;
      histograms[maxOffset + x]++;
      for (j = 0, k = 0; j < maxOffset; j += maxRadix, k += radixBits) {
        if (k >= 32) {
          k -= 32;
          e = d;
        }
        histograms[j + (((e >>> k) & radixMask) ^ mask)]++;
      }
    }
    for (j = 0; j <= maxOffset; j += maxRadix) {
      for (id = j, sum = 0; id < j + maxRadix; id++) {
        tsum = histograms[id] + sum;
        histograms[id] = sum - 1;
        sum = tsum;
      }
    }
  }
})(typeof exports !== "undefined" ? exports : this);
