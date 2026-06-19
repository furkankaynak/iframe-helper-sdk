import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';

import { describe, expect, test } from 'vitest';

const projectRoot = process.cwd();
const allowedSrcRootEntries = new Set([
  'diagnostics',
  'host',
  'index.ts',
  'messaging',
  'protocol',
  'shared',
  'types',
]);

describe('project folder structure', () => {
  test('keeps source files grouped by production library domains', async () => {
    const srcEntries = await readdir(join(projectRoot, 'src'), { withFileTypes: true });
    const rootEntryNames = srcEntries.map((entry) => entry.name).sort();

    expect(rootEntryNames).toEqual(Array.from(allowedSrcRootEntries).sort());
  });

  test('keeps tests outside src and mirrors production domains under tests/unit', async () => {
    const srcTestFiles = (await listFiles(join(projectRoot, 'src'))).filter((filePath) =>
      filePath.endsWith('.test.ts'),
    );
    const unitTestDomains = (
      await readdir(join(projectRoot, 'tests', 'unit'), {
        withFileTypes: true,
      })
    ).map((entry) => entry.name);

    expect(srcTestFiles).toEqual([]);
    expect(unitTestDomains.sort()).toEqual([
      'diagnostics',
      'host',
      'messaging',
      'package-config.test.ts',
      'project-structure.test.ts',
      'protocol',
      'public-api.test.ts',
      'shared',
    ]);
  });

  test('uses playground for manual runnable examples', async () => {
    const rootEntries = await readdir(projectRoot);
    const manualPlaygroundEntries = await readdir(join(projectRoot, 'playground', 'manual'));

    expect(rootEntries).not.toContain('examples');
    expect(manualPlaygroundEntries.sort()).toEqual(['iframe', 'parent']);
  });

  test('keeps the host bridge factory as a thin composition module', async () => {
    const hostEntries = await readdir(join(projectRoot, 'src', 'host'));
    const createIframeBridge = await readFile(
      join(projectRoot, 'src', 'host', 'create-iframe-bridge.ts'),
      'utf8',
    );

    expect(hostEntries).toEqual(
      expect.arrayContaining([
        'bridge-dependencies.ts',
        'bridge-diagnostics.ts',
        'bridge-events.ts',
        'bridge-lifecycle-controller.ts',
      ]),
    );
    expect(lineCount(createIframeBridge)).toBeLessThanOrEqual(200);
  });
});

async function listFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = join(directory, entry.name);

      if (entry.isDirectory()) {
        return listFiles(entryPath);
      }

      return [relative(projectRoot, entryPath)];
    }),
  );

  return files.flat();
}

function lineCount(source: string): number {
  return source.split('\n').length;
}
