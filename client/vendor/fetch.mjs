// Builds the packages this client installs from `vendor/*.tgz`: the
// dtaas-sdk contract and the bim extension. The tarballs are gitignored, so
// the commit pinned in `dtaas-sdk.json` is what makes a build reproducible.
// Run before `yarn install`; it does nothing when the tarballs already exist.
// A failed build keeps its work folder, so running it again resumes.
//
// `yarn pack` output differs byte for byte between builds of the same commit,
// and yarn.lock records each `file:` tarball with the SHA-1 of its bytes. So:
// - each tarball is named after the pinned commit, because yarn caches a
//   tarball under that hash and a name reused across two commits would let a
//   stale cache serve the old code without a warning;
// - the two hashes in yarn.lock are set to the tarballs actually present,
//   because otherwise every fresh build fails yarn's integrity check.
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { delimiter, join } from 'node:path';

const here = import.meta.dirname;
const pin = JSON.parse(readFileSync(join(here, 'dtaas-sdk.json'), 'utf8'));
const short = pin.commit.slice(0, 7);
const work = join(here, '.build', pin.commit);
const PACKAGES = [
  { name: 'dtaas-sdk', dir: '.' },
  { name: 'bim-example', dir: 'examples/bim', prepare: 'yarn sdk' },
].map((entry) => ({ ...entry, tarball: `${entry.name}-${short}.tgz` }));

// The bim build unpacks with `tar`. Under Git for Windows that name finds GNU
// tar, which reads `C:\...` as a remote host; Windows' own tar does not.
const env =
  process.platform === 'win32'
    ? {
        ...process.env,
        PATH: `${join(process.env.SystemRoot ?? 'C:\\Windows', 'System32')}${delimiter}${process.env.PATH}`,
      }
    : process.env;

const run = (cwd, command) => execSync(command, { cwd, env, stdio: 'inherit' });

/** package.json must install exactly the tarballs of the pinned commit. */
const checkManifest = () => {
  const manifest = JSON.parse(
    readFileSync(join(here, '..', 'package.json'), 'utf8'),
  );
  const wrong = PACKAGES.filter(
    ({ name, tarball }) =>
      manifest.dependencies[`@into-cps-association/${name}`] !==
      `file:vendor/${tarball}`,
  );
  if (wrong.length > 0) {
    const expected = wrong.map(({ tarball }) => `file:vendor/${tarball}`);
    throw new Error(`package.json must depend on ${expected.join(' and ')}`);
  }
};

const checkout = () => {
  if (existsSync(join(work, '.git'))) return;
  mkdirSync(work, { recursive: true });
  run(work, 'git init --quiet');
  run(work, `git fetch --quiet --depth 1 ${pin.repository} ${pin.commit}`);
  run(work, 'git checkout --quiet FETCH_HEAD');
};

const pack = ({ tarball, dir, prepare }) => {
  const cwd = join(work, dir);
  const packed = join(work, tarball);
  run(
    cwd,
    'yarn install --frozen-lockfile --ignore-engines --network-timeout 1000000',
  );
  if (prepare) run(cwd, prepare);
  run(cwd, 'yarn build');
  run(cwd, `yarn pack --filename ${JSON.stringify(packed)}`);
  copyFileSync(packed, join(here, tarball));
};

/** Tarballs of earlier pins are dead weight once the new ones exist. */
const removeStale = () => {
  const current = new Set(PACKAGES.map(({ tarball }) => tarball));
  readdirSync(here)
    .filter((file) => file.endsWith('.tgz') && !current.has(file))
    .forEach((file) => rmSync(join(here, file)));
  rmSync(join(here, '.build'), { recursive: true, force: true });
};

/**
 * Point yarn.lock's `resolved "file:vendor/<tarball>#<sha1>"` at these bytes.
 * An entry that is not there yet (just after a pin bump) is left for
 * `yarn install` to add.
 */
const syncLockfile = () => {
  const lockfile = join(here, '..', 'yarn.lock');
  let lock = readFileSync(lockfile, 'utf8');
  PACKAGES.forEach(({ tarball }) => {
    const marker = `resolved "file:vendor/${tarball}#`;
    const at = lock.indexOf(marker);
    if (at === -1) return;
    const start = at + marker.length;
    const sha1 = createHash('sha1')
      .update(readFileSync(join(here, tarball)))
      .digest('hex');
    lock = lock.slice(0, start) + sha1 + lock.slice(start + sha1.length);
  });
  writeFileSync(lockfile, lock);
};

checkManifest();
if (PACKAGES.every(({ tarball }) => existsSync(join(here, tarball)))) {
  // eslint-disable-next-line no-console
  console.log(`vendor: dtaas-sdk ${short} already built`);
} else {
  checkout();
  PACKAGES.forEach(pack);
  removeStale();
}
syncLockfile();
