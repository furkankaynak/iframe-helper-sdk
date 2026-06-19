import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { ConfigEnv, UserConfig, UserConfigExport } from 'vite';
import { describe, expect, test } from 'vitest';

import viteConfigExport from '../../vite.config';

const projectRoot = process.cwd();

describe('production package configuration', () => {
  test('publishes a dual-format root package contract with declarations in dist/types', async () => {
    const packageJson = await readJson('package.json');
    const exports = getRecord(packageJson.exports, 'exports');
    const rootExport = getRecord(exports['.'], 'exports["."]');
    const importExport = getRecord(rootExport.import, 'exports["."].import');
    const requireExport = getRecord(rootExport.require, 'exports["."].require');
    const scripts = getRecord(packageJson.scripts, 'scripts');
    const engines = getRecord(packageJson.engines, 'engines');

    expect(packageJson.main).toBe('./dist/index.cjs');
    expect(packageJson.module).toBe('./dist/index.js');
    expect(packageJson.types).toBe('./dist/types/index.d.ts');
    expect(packageJson.sideEffects).toBe(false);
    expect(packageJson.files).toEqual(['dist']);
    expect(engines.node).toBe('>=18');
    expect(Object.keys(rootExport)).toEqual(['import', 'require', 'default']);
    expect(Object.keys(importExport)).toEqual(['types', 'default']);
    expect(importExport.types).toBe('./dist/types/index.d.ts');
    expect(importExport.default).toBe('./dist/index.js');
    expect(Object.keys(requireExport)).toEqual(['types', 'default']);
    expect(requireExport.types).toBe('./dist/types/index.d.cts');
    expect(requireExport.default).toBe('./dist/index.cjs');
    expect(rootExport.default).toBe('./dist/index.js');
    expect(scripts.build).toBe('npm run build:prod');
    expect(scripts['build:prod']).toContain('node scripts/prepare-cjs-types.mjs');
  });

  test('builds ESM and CJS runtime artifacts with production library options', async () => {
    const viteConfig = getRecord(await resolveViteConfig(viteConfigExport), 'vite config');
    const build = getRecord(viteConfig.build, 'vite build config');
    const lib = getRecord(build.lib, 'vite library config');
    const fileName = getFileNameFactory(lib.fileName);

    expect(lib.formats).toEqual(['es', 'cjs']);
    expect(fileName('es', 'index')).toBe('index.js');
    expect(fileName('cjs', 'index')).toBe('index.cjs');
    expect(build.target).toBe('es2020');
    expect(build.minify).toBe('oxc');
    expect(build.sourcemap).toBe('hidden');
    expect(build.emptyOutDir).toBe(true);
    expect(build.reportCompressedSize).toBe(true);
  });

  test('emits TypeScript declarations into a dedicated dist/types folder', async () => {
    const tsconfig = await readJson('tsconfig.build.json');
    const compilerOptions = getRecord(tsconfig.compilerOptions, 'compilerOptions');

    expect(compilerOptions.outDir).toBe('dist/types');
    expect(compilerOptions.declarationDir).toBe('dist/types');
    expect(compilerOptions.emitDeclarationOnly).toBe(true);
    expect(compilerOptions.declarationMap).toBe(true);
    expect(compilerOptions.stripInternal).toBe(true);
  });
});

async function readJson(filePath: string): Promise<Record<string, unknown>> {
  const source = await readFile(join(projectRoot, filePath), 'utf8');
  const parsed: unknown = JSON.parse(source);

  return getRecord(parsed, filePath);
}

function getRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new TypeError(`${label} must be an object.`);
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getFileNameFactory(value: unknown): (format: string, entryName: string) => string {
  if (typeof value !== 'function') {
    throw new TypeError('vite library fileName must be a function.');
  }

  return value as (format: string, entryName: string) => string;
}

async function resolveViteConfig(config: UserConfigExport): Promise<UserConfig> {
  const env: ConfigEnv = {
    command: 'build',
    mode: 'production',
    isPreview: false,
    isSsrBuild: false,
  };

  return typeof config === 'function' ? await config(env) : await config;
}
