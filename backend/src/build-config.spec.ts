import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const BACKEND_ROOT = join(__dirname, '..');
const DIST_DIR = join(BACKEND_ROOT, 'dist');

describe('tsconfig.build.json — source map suppression', () => {
  let buildConfig: { compilerOptions?: { sourceMap?: unknown } };

  beforeAll(() => {
    const raw = readFileSync(join(BACKEND_ROOT, 'tsconfig.build.json'), 'utf-8');
    buildConfig = JSON.parse(raw) as typeof buildConfig;
  });

  it('declares compilerOptions.sourceMap as false to prevent .js.map files from entering the Railway image', () => {
    expect(buildConfig.compilerOptions?.sourceMap).toBe(false);
  });

  it('does not set sourceMap to true (would override the security fix)', () => {
    expect(buildConfig.compilerOptions?.sourceMap).not.toBe(true);
  });
});

describe('backend/dist — no source maps shipped', () => {
  const findMapFiles = (dir: string): string[] => {
    if (!existsSync(dir)) return [];
    const entries = readdirSync(dir, { withFileTypes: true });
    return entries.flatMap((e) => {
      const full = join(dir, e.name);
      if (e.isDirectory()) return findMapFiles(full);
      return e.name.endsWith('.js.map') ? [full] : [];
    });
  };

  it('contains no .js.map files after pnpm build:backend', () => {
    if (!existsSync(DIST_DIR)) {
      console.warn('dist/ not found — run pnpm build:backend first');
      return;
    }
    const maps = findMapFiles(DIST_DIR);
    expect(maps).toHaveLength(0);
  });
});
