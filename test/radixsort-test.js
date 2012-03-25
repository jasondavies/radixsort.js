var sort = require("../radixsort").sort;

var vows = require("vows"),
    assert = require("assert");

var suite = vows.describe("radixsort");

suite.addBatch({
  "radix sort": {
    topic: sort,
    "float32": function(sort) {
      var data = randomFloats(1e3),
          sorted = new Float32Array(sort(new Float32Array(data)));
      data.sort(ascending);
      deepEqual(data, sorted, Float32Array);
    },
    "float64": function(sort) {
      var data = randomFloats(1e3),
          sorted = new Float64Array(sort(new Float64Array(data), new Float64Array(data.length)));
      data.sort(ascending);
      deepEqual(data, sorted, Float64Array);
    },
    "uint32": function(sort) {
      var data = randomUints(1e3, 32),
          sorted = new Uint32Array(sort(new Uint32Array(data)));
      data.sort(ascending);
      deepEqual(data, sorted, Uint32Array);
    },
    "uint16": function(sort) {
      var data = randomUints(1e3, 16),
          sorted = new Uint16Array(sort(new Uint16Array(data)));
      data.sort(ascending);
      deepEqual(data, sorted, Uint16Array);
    },
    "uint8": function(sort) {
      var data = randomUints(1e3, 8),
          sorted = new Uint8Array(sort(new Uint8Array(data)));
      data.sort(ascending);
      deepEqual(data, sorted, Uint8Array);
    },
    "int32": function(sort) {
      var data = randomInts(1e3, 32),
          sorted = new Int32Array(sort(new Int32Array(data)));
      data.sort(ascending);
      deepEqual(data, sorted, Int32Array);
    },
    "int16": function(sort) {
      var data = randomInts(1e3, 16),
          sorted = new Int16Array(sort(new Int16Array(data)));
      data.sort(ascending);
      deepEqual(data, sorted, Int16Array);
    },
    "int8": function(sort) {
      var data = randomInts(1e3, 8),
          sorted = new Int8Array(sort(new Int8Array(data)));
      data.sort(ascending);
      deepEqual(data, sorted, Int8Array);
    }
  }
});

suite.export(module);

function randomInts(n, bits) {
  var r = [],
      i = -1,
      max = 1 << --bits;
  while (++i < n) r[i] = Math.floor((Math.random() - .5) * max);
  return r;
}

function randomUints(n, bits) {
  var r = [],
      i = -1,
      max = bits > 31 ? Math.pow(2, bits) : 1 << bits;
  while (++i < n) r[i] = Math.floor(Math.random() * max);
  return r;
}

function randomFloats(n) {
  var a = [],
      i = -1,
      r;
  while (++i < n) {
    r = Math.random();
    a[i] = r < .01 ? Infinity
        : r < .02 ? -Infinity
        : r < .03 ? -0
        : r < .04 ? +0
        : r < .05 ? NaN
        : Math.exp((Math.random() - .5) * 100, (Math.random() - .5) * 100) * (Math.random() < .5 ? 1 : -1);
  }
  return a;
}

function deepEqual(a, b, typedArray) {
  var n = a.length,
      i = -1,
      x = new typedArray(1); // Hack to convert to appropriate data type.
  if (n !== b.length) return false;
  while (++i < n) {
    x[0] = a[i];
    if (isNaN(x[0])) assert.isTrue(isNaN(b[i]));
    else {
      assert.equal(b[i], x[0]);
      // Check sign of zeroes.
      if (x[0] === 0) {
        assert.equal(1 / b[i], 1 / x[0]);
      }
    }
  }
}

function ascending(a, b) {
  return a < b ? -1 :
      a > b ? 1 :
      a === 0 && b === 0 ? 1 / a < 1 / b ? -1 : 1 :
      a >= b ? 0 :
      // Native sort puts NaNs at the end, but we put JavaScript NaNs at the beginning
      a >= a || a <= a ? 1 :
      b >= b || b <= b ? -1 :
      NaN;
}
