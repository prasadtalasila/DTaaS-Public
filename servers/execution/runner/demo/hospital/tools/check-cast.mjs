// node tools/check-cast.mjs: checks that hospital.cast is valid
// asciicast v2 and replays its timings: a JSON header, then one JSON
// event per line with a time that never goes back, a known type and a
// string
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const file = fileURLToPath(new URL('../hospital.cast', import.meta.url));
const [first, ...lines] = readFileSync(file, 'utf8').trimEnd().split('\n');
const header = JSON.parse(first);
const problems = [];
if (header.version !== 2 || !header.width || !header.height) {
  problems.push('the header is not that of asciicast v2');
}

let clock = 0;
let longestGap = 0;
const counts = {};
lines.forEach((line, index) => {
  const [time, type, data] = JSON.parse(line);
  if (typeof time !== 'number' || time < clock) {
    problems.push(`line ${index + 2}: time ${time} goes back`);
  }
  if (!['o', 'm'].includes(type) || typeof data !== 'string') {
    problems.push(`line ${index + 2}: not an output or marker event`);
  }
  longestGap = Math.max(longestGap, time - clock);
  clock = time;
  counts[type] = (counts[type] ?? 0) + 1;
});

console.log(
  `hospital.cast: ${statSync(file).size} bytes, ${header.width}x${header.height},` +
    ` ${clock.toFixed(1)} s, events ${JSON.stringify(counts)},` +
    ` longest gap ${longestGap.toFixed(2)} s`,
);
problems.forEach((problem) => console.error(problem));
process.exitCode = problems.length === 0 ? 0 : 1;
