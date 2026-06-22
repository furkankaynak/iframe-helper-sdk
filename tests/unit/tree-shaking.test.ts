import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

const projectRoot = process.cwd();

describe('resize plugin tree-shakability', () => {
  test('emits standalone resize chunks for both ESM and CJS consumers', async () => {
    const esmBytes = await readFile(join(projectRoot, 'dist', 'resize.js'), 'utf8');
    const cjsBytes = await readFile(join(projectRoot, 'dist', 'resize.cjs'), 'utf8');

    expect(esmBytes.length).toBeGreaterThan(0);
    expect(cjsBytes.length).toBeGreaterThan(0);
    expect(esmBytes).toContain('iframe-bridge:resize');
    expect(cjsBytes).toContain('iframe-bridge:resize');
  });

  test('does not leak the resize reserved event name into the core bundle', async () => {
    const esmBytes = await readFile(join(projectRoot, 'dist', 'index.js'), 'utf8');
    const cjsBytes = await readFile(join(projectRoot, 'dist', 'index.cjs'), 'utf8');

    expect(esmBytes).not.toContain('iframe-bridge:resize');
    expect(cjsBytes).not.toContain('iframe-bridge:resize');
  });

  test('does not leak resize clamping logic into the core bundle', async () => {
    const esmBytes = await readFile(join(projectRoot, 'dist', 'index.js'), 'utf8');
    const cjsBytes = await readFile(join(projectRoot, 'dist', 'index.cjs'), 'utf8');

    expect(esmBytes).not.toContain('RESIZE_INVALID_PAYLOAD');
    expect(esmBytes).not.toContain('RESIZE_CALLBACK_ERROR');
    expect(cjsBytes).not.toContain('RESIZE_INVALID_PAYLOAD');
    expect(cjsBytes).not.toContain('RESIZE_CALLBACK_ERROR');
  });
});
