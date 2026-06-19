// Ensure node-pty's prebuilt `spawn-helper` is executable.
//
// Some prebuild-install versions drop the executable bit when extracting the
// prebuilt binary, which makes posix_spawnp fail at runtime (`bsc rec` cannot
// fork a shell). Re-apply the bit defensively after install. No-op when the
// binary is absent (e.g. node-pty built from source) or already executable.
'use strict';
const fs = require('fs');
const path = require('path');

function chmodHelpers(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      chmodHelpers(full);
    } else if (entry.name === 'spawn-helper') {
      try {
        fs.chmodSync(full, 0o755);
      } catch {
        /* best effort */
      }
    }
  }
}

let ptyDir;
try {
  ptyDir = path.dirname(require.resolve('node-pty/package.json'));
} catch {
  process.exit(0); // node-pty not installed (or not resolvable) — nothing to do
}

chmodHelpers(path.join(ptyDir, 'prebuilds'));
chmodHelpers(path.join(ptyDir, 'build'));
