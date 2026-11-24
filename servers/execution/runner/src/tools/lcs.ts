// The pairs of indexes of a longest common subsequence of two lists,
// by the test of sameness given, in order
export function commonPairs<T>(
  a: T[],
  b: T[],
  same: (x: T, y: T) => boolean,
): [number, number][] {
  // longest[i][j]: the length for a from i and b from j
  const longest = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      longest[i][j] = same(a[i], b[j])
        ? longest[i + 1][j + 1] + 1
        : Math.max(longest[i + 1][j], longest[i][j + 1]);
    }
  }
  return walk(longest, (i, j) => same(a[i], b[j]));
}

// Down the side of the longer rest
const move = (longest: number[][], i: number, j: number): [number, number] =>
  longest[i + 1][j] >= longest[i][j + 1] ? [i + 1, j] : [i, j + 1];

// Follows the table from its start, taking each pair that is the same
function walk(
  longest: number[][],
  same: (i: number, j: number) => boolean,
): [number, number][] {
  const pairs: [number, number][] = [];
  let [i, j] = [0, 0];
  while (longest[i][j] > 0) {
    if (same(i, j) && longest[i][j] === longest[i + 1][j + 1] + 1) {
      pairs.push([i, j]);
      [i, j] = [i + 1, j + 1];
    } else {
      [i, j] = move(longest, i, j);
    }
  }
  return pairs;
}
