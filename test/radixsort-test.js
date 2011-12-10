var sort = require("../radixsort").sort;

var vows = require("vows"),
    assert = require("assert");

var suite = vows.describe("radixsort");

suite.addBatch({
  "radix sort": {
    topic: sort,
    "random": function(sort) {
      var data = random(1e2),
          sorted = new Float32Array(sort(new Float32Array(data)));
      data.sort(function(a, b) { return a < b ? -1 : a === b ? 0 : 1; });
      deepEqual(data, sorted);
    }
  }
});

suite.export(module);

function random(n) {
  var r = [],
      i = -1;
  while (++i < n) {
    r[i] = Math.exp((Math.random() - .5) * 100, (Math.random() - .5) * 100);
  }
  return r;
}

function deepEqual(a, b) {
  var n = a.length,
      i = -1,
      f32 = new Float32Array(1); // Hack to convert to 32-bit floats.
  if (n !== b.length) return false;
  while (++i < n) {
    f32[0] = a[i];
    assert.equal(f32[0], b[i]);
  }
}
