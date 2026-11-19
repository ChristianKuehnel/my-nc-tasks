/**
 * Guard for the pinned toolchain: .node-version, .mise.toml and the
 * packageManager field in package.json must stay consistent, and the
 * pnpm pin must be a version that Corepack >= 0.36 can run (pnpm >= 10).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../..');

function read(rootFile: string): string {
  return readFileSync(resolve(root, rootFile), 'utf8').trim();
}

describe('toolchain pinning', () => {
  it('pins a Node 22.x version in .node-version and .mise.toml', () => {
    const nodeVersion = read('.node-version');
    expect(nodeVersion).toMatch(/^22\.\d+\.\d+$/);
    expect(read('.mise.toml')).toContain(`node = "${nodeVersion}"`);
  });

  it('pins pnpm >= 10 via the packageManager field and .mise.toml', () => {
    const pkg = JSON.parse(read('package.json')) as { packageManager?: string };
    const match = pkg.packageManager?.match(/^pnpm@(\d+)\.(\d+)\.(\d+)$/);
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBeGreaterThanOrEqual(10);
    expect(read('.mise.toml')).toContain(`pnpm = "${match![1]}.${match![2]}.${match![3]}"`);
  });
});
