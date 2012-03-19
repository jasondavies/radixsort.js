// Based on http://stereopsis.com/radix.html
// Requires typed arrays.
(function(exports) {
  exports.sort = radixsort;

  var radixBits = 8,
      maxRadix = 1 << radixBits,
      histograms = radixsort._histograms = new Int32Array(maxRadix * 8);

  function radixsort() {
    function sort(array, sorted) {
      var floating = array instanceof Float32Array || (f64 = array instanceof Float64Array),
          signed = !(array instanceof Uint32Array || array instanceof Uint16Array || array instanceof Uint8Array),
          n = array.length,
          input = floating ? new Uint32Array(array.buffer) : array,
          inputBytes = new Uint8Array(input.buffer),
          sortedBytes = new Uint8Array((sorted = sorted || new input.constructor(input.length)).buffer),
          passCount = array.BYTES_PER_ELEMENT,
          f64,
          tmp,
          i;

      createHistograms(inputBytes, passCount, signed, floating);

      for (var pass = 0; pass < passCount; pass++) {
        for (i = 0; i < n; i++) {
          var x = inputBytes[i * passCount + pass],
              d,
              e;
          if (f64) {
            d = input[e = i << 1];
            e = input[e + 1];
          } else d = input[i];
          if (signed) {
            if (pass === 0 && floating) {
              if (inputBytes[(i + 1) * passCount - 1] >>> 7) {
                d ^= 0xffffffff;
                e ^= 0xffffffff;
                x ^= 0xff;
              } else {
                if (f64) e ^= 0x80000000;
                else d ^= 0x80000000;
              }
            }
            if (pass === passCount - 1) {
              if (floating) {
                if (x >>> 7) {
                  if (f64) e ^= 0x80000000;
                  else d ^= 0x80000000;
                } else {
                  d ^= 0xffffffff;
                  e ^= 0xffffffff;
                }
              } else x ^= 0x80;
            }
          }
          x = ++histograms[(pass << radixBits) + x];
          if (f64) {
            sorted[x <<= 1] = d;
            sorted[x + 1] = e;
          } else sorted[x] = d;
        }
        tmp = sorted;
        sorted = input;
        input = tmp;
        tmp = sortedBytes;
        sortedBytes = inputBytes;
        inputBytes = tmp;
      }
      return input.buffer;
    }

    return sort;
  }

  function createHistograms(inputBytes, passCount, signed, floating) {
    var i,
        j,
        id,
        sum,
        tsum,
        n = inputBytes.length;
    for (i = 0; i < maxRadix * passCount; i++) histograms[i] = 0;
    for (i = 0; i < n;) {
      // Check sign bit first.
      var x = inputBytes[i + passCount - 1],
          mask = floating ? x >>> 7 ? (x ^= 0xff, 0xff) : (x |= 0x80, 0) : 0;
      if (!floating && signed) x ^= 0x80;
      histograms[((passCount - 1) << radixBits) + x]++;
      for (j = 0; j < passCount - 1; j++) {
        x = inputBytes[i++] ^ mask;
        histograms[(j << radixBits) + x]++;
      }
      i++;
    }
    for (j = 0; j < passCount; j++) {
      for (i = 0, id = j << radixBits, sum = 0; i < maxRadix; i++, id++) {
        tsum = histograms[id] + sum;
        histograms[id] = sum - 1;
        sum = tsum;
      }
    }
  }
})(typeof exports !== "undefined" ? exports : this);
