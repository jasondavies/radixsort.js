var sort = require("../radixsort").sort();

var X = Uint32Array;
var a = [];
var max = 65536;
for (var i=0; i<max; i++) a[i] = Math.floor(0xffffffff * Math.random());

var start = +new Date;
for (var i=0; i<100; i++) {
  var ta = new X(a);
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
for (var i=1; i<max; i++) { correct &= (tb[i] >= tb[i-1]); }
console.log(correct);
