import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

const rootDir = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig(({ mode }) => ({
  build: {
    lib: {
      entry: resolve(rootDir, 'src/index.ts'),
      formats: ['es', 'cjs'],
      fileName: (format) => (format === 'cjs' ? 'index.cjs' : 'index.js'),
    },
    target: 'es2020',
    minify: 'oxc',
    sourcemap: mode === 'development' ? true : 'hidden',
    emptyOutDir: true,
    reportCompressedSize: true,
  },
}));
