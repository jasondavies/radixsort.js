var sort = require("../radixsort").sort();

var X = Float32Array;
var max = 65536;
var ta = new X(max);

for (var i=0; i<max; i++) {
  ta[i] = Math.exp((Math.random() - .5) * 100, (Math.random() - .5) * 100) * (Math.random() < .5 ? 1 : -1);
}

// Copy to normal array.
var a = [];
for (var i=0; i<max; i++) a[i] = ta[i];

var start = +new Date;
for (var i=0; i<100; i++) {
  var tb = new X(sort(ta));
}
console.log(1000 * 100 / (+new Date - start) + " sorts per second.");

var start = +new Date;
for (var i=0; i<100; i++) {
  var b = a.slice();
  b.sort(function(x, y) { return x > y ? 1 : x === y ? 0 : -1; });
}
console.log(1000 * 100 / (+new Date - start) + " sorts per second.");

var correct = 1;
for (var i=1; i<max; i++) correct &= (tb[i] >= tb[i-1]);
console.log("correct?", correct);
