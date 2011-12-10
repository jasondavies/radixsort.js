radixsort.js
============

Radix sort has linear time complexity `O(kN)`, where `k` is the number of
radices per value, and `N` is the number of values.

How is this possible?  The theoretical lower bound of `O(N log N)` only applies
to comparison-based sorting algorithms, whereas radix sort doesn't actually
perform any *comparisons* on the input data.

Usage
-----

    var sort = radixsort(),
        data = new Float32Array([…]);

    var sorted = new Float32Array(sort(data));

    // Also…
    var output = new Float32Array(data.length);
    sort(data, output);

To Do
-----

 * Support negative integers.
 * Support Float64Array.
