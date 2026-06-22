import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, expectTypeOf, test } from 'vitest';

import { createIframeChildBridge } from '../../../src/child';
import type {
  IframeChildBridge,
  IframeChildBridgeConfig,
  IframeChildBridgeOptions,
  IframeChildBridgePlugin,
} from '../../../src/child';

const typesSource = readFileSync(join(process.cwd(), 'src', 'types', 'index.ts'), 'utf8');

describe('child public types', () => {
  test('declares public child type exports', () => {
    expect(typesSource).toContain('export type ChildLifecycleState');
    expect(typesSource).toContain('export type IframeChildBridgeConfig');
    expect(typesSource).toContain('export type IframeChildBridge');
    expect(typesSource).toContain('export type IframeChildBridgePlugin');
  });

  test('allows omitted, null, and exact parent origin allowlists', () => {
    const omitted = {} satisfies IframeChildBridgeConfig;
    const explicitNull = { allowedParentOrigins: null } satisfies IframeChildBridgeConfig;
    const exactOrigins = {
      allowedParentOrigins: ['https://parent.example'] as const,
    } satisfies IframeChildBridgeConfig;

    expectTypeOf(omitted).toMatchTypeOf<IframeChildBridgeConfig>();
    expectTypeOf(explicitNull.allowedParentOrigins).toEqualTypeOf<null>();
    expectTypeOf(exactOrigins.allowedParentOrigins).toEqualTypeOf<
      readonly ['https://parent.example']
    >();
  });

  test('does not expose child-to-parent request on the child bridge', () => {
    type ChildBridgeKeys = keyof IframeChildBridge;
    type HasRequest = 'request' extends ChildBridgeKeys ? true : false;

    expectTypeOf<HasRequest>().toEqualTypeOf<false>();
  });

  test('models child plugins as setup hooks', () => {
    const plugin = (() => ({ destroy: () => undefined })) satisfies IframeChildBridgePlugin;

    expectTypeOf(plugin).toMatchTypeOf<IframeChildBridgePlugin>();
  });

  test('exposes a public child factory without dependency injection arguments', () => {
    expectTypeOf<Parameters<typeof createIframeChildBridge>[0]>().toEqualTypeOf<
      IframeChildBridgeConfig | undefined
    >();
    expectTypeOf<Parameters<typeof createIframeChildBridge>[1]>().toEqualTypeOf<
      IframeChildBridgeOptions | undefined
    >();
  });
});
