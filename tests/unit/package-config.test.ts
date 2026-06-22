import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { ConfigEnv, UserConfig, UserConfigExport } from 'vite';
import { describe, expect, test } from 'vitest';

import viteConfigExport from '../../vite.config';

const projectRoot = process.cwd();

describe('production package configuration', () => {
  test('publishes npm metadata for discoverability and package page trust', async () => {
    const packageJson = await readJson('package.json');
    const bugs = getRecord(packageJson.bugs, 'bugs');
    const author = getRecord(packageJson.author, 'author');

    expect(packageJson.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(packageJson.description).toBe(
      'TypeScript SDK for secure cross-domain iframe embeds with a strict postMessage bridge, origin validation, handshakes, RPC-style requests, events, and typed contracts.',
    );
    expect(packageJson.keywords).toEqual([
      'iframe',
      'iframe-bridge',
      'postmessage',
      'post-message',
      'window-messaging',
      'cross-domain',
      'cross-origin',
      'bridge',
      'rpc',
      'typescript',
      'type-safe',
      'browser',
      'embed',
      'sandbox',
      'origin-validation',
    ]);
    expect(packageJson.homepage).toBe('https://furkankaynak.github.io/iframe-helper-sdk/');
    expect(bugs.url).toBe('https://github.com/furkankaynak/iframe-helper-sdk/issues');
    expect(author).toEqual({
      name: 'Furkan Kaynak',
      email: 'furkankaynak.74@gmail.com',
      url: 'https://furkankaynak.dev',
    });
  });

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
    expect(scripts.test).toBe('npm run build:prod && vitest run');
    expect(scripts.build).toBe('npm run build:prod');
    expect(scripts['build:prod']).toContain('node scripts/prepare-cjs-types.mjs');
  });

  test('builds ESM and CJS runtime artifacts with production library options', async () => {
    const viteConfig = getRecord(await resolveViteConfig(viteConfigExport), 'vite config');
    const build = getRecord(viteConfig.build, 'vite build config');
    const lib = getRecord(build.lib, 'vite library config');
    const fileName = getFileNameFactory(lib.fileName);
    const entry = getRecord(lib.entry, 'vite library entry map');

    expect(lib.formats).toEqual(['es', 'cjs']);
    expect(Object.keys(entry).sort()).toEqual(['child', 'child/resize', 'index', 'resize']);
    expect(fileName('es', 'child')).toBe('child.js');
    expect(fileName('cjs', 'child')).toBe('child.cjs');
    expect(fileName('es', 'child/resize')).toBe('child/resize.js');
    expect(fileName('cjs', 'child/resize')).toBe('child/resize.cjs');
    expect(fileName('es', 'index')).toBe('index.js');
    expect(fileName('cjs', 'index')).toBe('index.cjs');
    expect(fileName('es', 'resize')).toBe('resize.js');
    expect(fileName('cjs', 'resize')).toBe('resize.cjs');
    expect(build.target).toBe('es2020');
    expect(build.minify).toBe('oxc');
    expect(build.sourcemap).toBe(false);
    expect(build.emptyOutDir).toBe(true);
    expect(build.reportCompressedSize).toBe(true);
  });

  test('exposes the ./resize subpath export with ESM, CJS, and declaration paths', async () => {
    const packageJson = await readJson('package.json');
    const exports = getRecord(packageJson.exports, 'exports');
    const resizeExport = getRecord(exports['./resize'], 'exports["./resize"]');
    const resizeImport = getRecord(resizeExport.import, 'exports["./resize"].import');
    const resizeRequire = getRecord(resizeExport.require, 'exports["./resize"].require');

    expect(Object.keys(resizeExport).sort()).toEqual(['default', 'import', 'require']);
    expect(Object.keys(resizeImport).sort()).toEqual(['default', 'types']);
    expect(resizeImport.types).toBe('./dist/types/resize.d.ts');
    expect(resizeImport.default).toBe('./dist/resize.js');
    expect(Object.keys(resizeRequire).sort()).toEqual(['default', 'types']);
    expect(resizeRequire.types).toBe('./dist/types/resize.d.cts');
    expect(resizeRequire.default).toBe('./dist/resize.cjs');
    expect(resizeExport.default).toBe('./dist/resize.js');
  });

  test('exposes child subpath exports with ESM, CJS, and declaration paths', async () => {
    const packageJson = await readJson('package.json');
    const exports = getRecord(packageJson.exports, 'exports');

    expectSubpathExport(exports, './child', {
      cjs: './dist/child.cjs',
      cjsTypes: './dist/types/child.d.cts',
      esm: './dist/child.js',
      esmTypes: './dist/types/child.d.ts',
    });
    expectSubpathExport(exports, './child/resize', {
      cjs: './dist/child/resize.cjs',
      cjsTypes: './dist/types/child/resize.d.cts',
      esm: './dist/child/resize.js',
      esmTypes: './dist/types/child/resize.d.ts',
    });
  });

  test('prepares CJS type aliases for all library entry points', async () => {
    const prepareCjsTypes = await readFile(
      join(projectRoot, 'scripts', 'prepare-cjs-types.mjs'),
      'utf8',
    );

    expect(prepareCjsTypes).toContain('index');
    expect(prepareCjsTypes).toContain('resize');
    expect(prepareCjsTypes).toContain('child');
    expect(prepareCjsTypes).toContain('child/resize');
  });

  test('emits TypeScript declarations into a dedicated dist/types folder', async () => {
    const tsconfig = await readJson('tsconfig.build.json');
    const compilerOptions = getRecord(tsconfig.compilerOptions, 'compilerOptions');

    expect(compilerOptions.outDir).toBe('dist/types');
    expect(compilerOptions.declarationDir).toBe('dist/types');
    expect(compilerOptions.emitDeclarationOnly).toBe(true);
    expect(compilerOptions.declarationMap).toBe(false);
    expect(compilerOptions.stripInternal).toBe(true);
  });

  test('does not generate source map artifacts for the published package', async () => {
    const prepareCjsTypes = await readFile(
      join(projectRoot, 'scripts', 'prepare-cjs-types.mjs'),
      'utf8',
    );

    expect(prepareCjsTypes).not.toContain('.map');
    expect(prepareCjsTypes).not.toContain('sourceMappingURL');
  });

  test('publishes from version tag pushes using npm trusted publishing', async () => {
    const publishWorkflow = await readFile(
      join(projectRoot, '.github', 'workflows', 'publish.yml'),
      'utf8',
    );

    expect(publishWorkflow).toContain('push:');
    expect(publishWorkflow).toContain('tags:');
    expect(publishWorkflow).toContain("'v*'");
    expect(publishWorkflow).toContain('workflow_dispatch:');
    expect(publishWorkflow).not.toContain('release:');
    expect(publishWorkflow).toContain('id-token: write');
    expect(publishWorkflow).toContain('actions/checkout@v6');
    expect(publishWorkflow).toContain('actions/setup-node@v6');
    expect(publishWorkflow).toContain('node-version: 24');
    expect(publishWorkflow).toContain('package-manager-cache: false');
    expect(publishWorkflow).toContain('npm publish --access public');
    expect(publishWorkflow).not.toContain('--provenance');
  });

  test('configures Docusaurus GA4 tracking through the gtag preset option', async () => {
    const docusaurusConfig = await readFile(
      join(projectRoot, 'documentation', 'docusaurus.config.js'),
      'utf8',
    );

    expect(docusaurusConfig).toContain('gtag:');
    expect(docusaurusConfig).toContain("trackingID: 'G-W874H14NHJ'");
    expect(docusaurusConfig).toContain('anonymizeIP: true');
    expect(docusaurusConfig).not.toContain('googleAnalytics:');
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

function expectSubpathExport(
  exports: Record<string, unknown>,
  subpath: string,
  expected: {
    readonly cjs: string;
    readonly cjsTypes: string;
    readonly esm: string;
    readonly esmTypes: string;
  },
): void {
  const subpathExport = getRecord(exports[subpath], `exports["${subpath}"]`);
  const importExport = getRecord(subpathExport.import, `exports["${subpath}"].import`);
  const requireExport = getRecord(subpathExport.require, `exports["${subpath}"].require`);

  expect(Object.keys(subpathExport).sort()).toEqual(['default', 'import', 'require']);
  expect(Object.keys(importExport).sort()).toEqual(['default', 'types']);
  expect(importExport.types).toBe(expected.esmTypes);
  expect(importExport.default).toBe(expected.esm);
  expect(Object.keys(requireExport).sort()).toEqual(['default', 'types']);
  expect(requireExport.types).toBe(expected.cjsTypes);
  expect(requireExport.default).toBe(expected.cjs);
  expect(subpathExport.default).toBe(expected.esm);
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
