radixsort.js
============

Radix sort has linear time complexity, *O(kN)*, where *k* is the number of
radices per value, and *N* is the number of values.

How is this possible?  The theoretical lower bound of *O(N log N)* only applies
to comparison-based sorting algorithms, whereas radix sort doesn't actually
perform any *comparisons* on the input data.

Usage
-----

    var sort = radixsort(),
        data = new Float32Array([…]);

    var sorted = new Float32Array(sort(data));

    // You can also preallocate the auxiliary array…
    sorted = sort(data, new Float32Array(data.length));

Note that radix sort modifies the input array, even though it uses an auxiliary
array too.  In fact, the sorted result will be the input array when an even
number of radixes are in use, which is currently always the case.

The sorter always returns a buffer representing the sorted result, so you can
pass this to the appropriate typed array constructor, as in the example above.

Informal Benchmark
------------------

The most common usage scenario for this will probably be sorting 32-bit floats
e.g. for geometry algorithms.  My informal benchmark repeatedly sorts an array
of 65,536 random 32-bit floats.

Of course, the comparison is not entirely fair as JavaScript's native sort will
be sorting double-precision (64-bit) numbers, as this is all JavaScript
supports.  But 32 bits is sufficient for most geometry algorithms, so the
comparison is reasonable.

 * Radixsort.js: ~**67** sorts per second.
 * JavaScript native sort: ~**26** sorts per second.

Radixsort.js is roughly **2.5x** faster!  The speed difference gets even larger
as you increase the input size.
