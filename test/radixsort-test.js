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
      data.sort(function(a, b) { return a < b ? -1 : a === b ? 0 : 1; });
      deepEqual(data, sorted, Float32Array);
    },
    /* TODO: 64-bit floats
    "float64": function(sort) {
      var data = randomFloats(1e3),
          sorted = new Float64Array(sort(new Float64Array(data)));
      data.sort(function(a, b) { return a < b ? -1 : a === b ? 0 : 1; });
      deepEqual(data, sorted, Float64Array);
    },
    */
    "uint32": function(sort) {
      var data = randomUints(1e3, 32),
          sorted = new Uint32Array(sort(new Uint32Array(data)));
      data.sort(function(a, b) { return a < b ? -1 : a === b ? 0 : 1; });
      deepEqual(data, sorted, Uint32Array);
    },
    "uint16": function(sort) {
      var data = randomUints(1e3, 16),
          sorted = new Uint16Array(sort(new Uint16Array(data)));
      data.sort(function(a, b) { return a < b ? -1 : a === b ? 0 : 1; });
      deepEqual(data, sorted, Uint16Array);
    },
    "uint8": function(sort) {
      var data = randomUints(1e3, 8),
          sorted = new Uint8Array(sort(new Uint8Array(data)));
      data.sort(function(a, b) { return a < b ? -1 : a === b ? 0 : 1; });
      deepEqual(data, sorted, Uint8Array);
    }
  }
});

suite.export(module);

function randomUints(n, bits) {
  var r = [],
      i = -1,
      max = bits > 31 ? Math.pow(2, bits) : 1 << bits;
  while (++i < n) r[i] = Math.floor(Math.random() * max);
  return r;
}

function randomFloats(n) {
  var r = [],
      i = -1;
  while (++i < n) {
    r[i] = Math.exp((Math.random() - .5) * 100, (Math.random() - .5) * 100) * (Math.random() < .5 ? 1 : -1);
  }
  return r;
}

function deepEqual(a, b, typedArray) {
  var n = a.length,
      i = -1,
      x = new typedArray(1); // Hack to convert to appropriate data type.
  if (n !== b.length) return false;
  while (++i < n) {
    x[0] = a[i];
    assert.equal(x[0], b[i]);
  }
}
