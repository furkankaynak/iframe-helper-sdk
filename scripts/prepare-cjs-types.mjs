import { readFile, writeFile } from 'node:fs/promises';

const esmTypesPath = 'dist/types/index.d.ts';
const esmTypesMapPath = 'dist/types/index.d.ts.map';
const cjsTypesPath = 'dist/types/index.d.cts';
const cjsTypesMapPath = 'dist/types/index.d.cts.map';

const esmTypes = await readFile(esmTypesPath, 'utf8');

await writeFile(
  cjsTypesPath,
  esmTypes.replace('//# sourceMappingURL=index.d.ts.map', '//# sourceMappingURL=index.d.cts.map'),
);

const esmTypesMap = JSON.parse(await readFile(esmTypesMapPath, 'utf8'));

await writeFile(cjsTypesMapPath, `${JSON.stringify({ ...esmTypesMap, file: 'index.d.cts' })}\n`);
