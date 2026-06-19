/** Resolve the package version at runtime (works from dist/ and src/). */
import fs from 'fs';
import path from 'path';

export function bscVersion(): string {
  for (const rel of ['..', '../..']) {
    try {
      const pkgPath = path.join(__dirname, rel, 'package.json');
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version?: string };
      if (typeof pkg.version === 'string') return pkg.version;
    } catch {
      /* try next location */
    }
  }
  return '0.0.0';
}
