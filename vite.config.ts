import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

const rootDir = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  build: {
    lib: {
      entry: {
        index: resolve(rootDir, 'src/index.ts'),
        resize: resolve(rootDir, 'src/resize.ts'),
      },
      formats: ['es', 'cjs'],
      fileName: (format, entryName) => (format === 'cjs' ? `${entryName}.cjs` : `${entryName}.js`),
    },
    target: 'es2020',
    minify: 'oxc',
    sourcemap: false,
    emptyOutDir: true,
    reportCompressedSize: true,
  },
});
