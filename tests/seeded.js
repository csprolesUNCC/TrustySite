// A random number generator that always gives the same numbers for the same seed (mulberry32), for tests that
// deal cards or play bots and need the same game every run.
export function seeded(seed = 1) {
  let a = seed;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
