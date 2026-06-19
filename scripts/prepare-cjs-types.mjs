import { readFile, writeFile } from 'node:fs/promises';

const esmTypesPath = 'dist/types/index.d.ts';
const cjsTypesPath = 'dist/types/index.d.cts';

const esmTypes = await readFile(esmTypesPath, 'utf8');

await writeFile(cjsTypesPath, esmTypes);
