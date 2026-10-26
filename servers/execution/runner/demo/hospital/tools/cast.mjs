// An asciicast v2 recording with its own clock: typing and pauses move
// the clock by set amounts, real waits by what they took, and no gap
// between two events is longer than MAX_GAP seconds
import { writeFileSync } from 'node:fs';

const MAX_GAP = 2;
const PROMPT = '\x1b[32mmanager\x1b[0m:\x1b[34m~/hospital\x1b[0m$ ';

export default class Cast {
  events = [];

  clock = 0;

  constructor(width, height, title) {
    this.header = { version: 2, width, height, title };
  }

  pause(seconds) {
    this.clock += seconds;
  }

  // Moves the clock by a real wait that started at the given time
  since(started) {
    this.pause((Date.now() - started) / 1000);
  }

  event(type, data) {
    const last = this.events.at(-1)?.[0] ?? 0;
    this.clock = Math.min(this.clock, last + MAX_GAP);
    this.events.push([Number(this.clock.toFixed(3)), type, data]);
  }

  output(text) {
    this.event('o', text.replace(/\r?\n/g, '\r\n'));
  }

  marker(label) {
    this.event('m', label);
  }

  // A command typed at the prompt, one character at a time
  type(command) {
    this.output(PROMPT);
    this.pause(0.4);
    [...command].forEach((character, index) => {
      this.output(character);
      this.pause(0.025 + (index % 4) * 0.008);
    });
    this.pause(0.3);
    this.output('\n');
  }

  // A narration line, a word at a time
  say(text) {
    this.output('\x1b[33m#');
    text.split(' ').forEach((word) => {
      this.output(` ${word}`);
      this.pause(0.05);
    });
    this.output('\x1b[0m\n');
    this.pause(0.5);
  }

  save(file, timestamp) {
    const header = { ...this.header, timestamp };
    const lines = [header, ...this.events].map((line) => JSON.stringify(line));
    writeFileSync(file, `${lines.join('\n')}\n`);
  }
}
