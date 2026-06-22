import { copyFile } from 'node:fs/promises';

const entryNames = ['index', 'resize'];

for (const entryName of entryNames) {
  const esmTypesPath = `dist/types/${entryName}.d.ts`;
  const cjsTypesPath = `dist/types/${entryName}.d.cts`;

  await copyFile(esmTypesPath, cjsTypesPath);
}
