import { createDiagnostics } from '../diagnostics/diagnostics.js';
import { BridgeTransport } from '../messaging/post-message-transport.js';
import type { IframeBridge, IframeBridgeConfig } from '../types/index.js';
import {
  createQueue,
  getCurrentDocument,
  getCurrentParentWindow,
  type CreateIframeBridgeDependencies,
} from './bridge-dependencies.js';
import { emitConfigWarnings } from './bridge-diagnostics.js';
import { IframeBridgeLifecycleController } from './bridge-lifecycle-controller.js';
import { normalizeConfig } from './config.js';
import { configureIframe } from './iframe-element.js';

export type {
  BridgeDocumentLike,
  BridgeLifecycleQueue,
  BridgeLifecycleQueueFactoryOptions,
  BridgeLifecycleTransport,
  CreateIframeBridgeDependencies,
} from './bridge-dependencies.js';

export type IframeBridgeLifecycle = IframeBridge;

export function createIframeBridge(
  config: IframeBridgeConfig,
  dependencies: CreateIframeBridgeDependencies = {},
): IframeBridge {
  const normalizedConfig = normalizeConfig(config);
  const diagnostics = createDiagnostics(config.diagnostics);
  const document = dependencies.document ?? getCurrentDocument();
  const parentWindow = dependencies.parentWindow ?? getCurrentParentWindow();
  const iframe = document.createElement('iframe');

  configureIframe(iframe, normalizedConfig);
  emitConfigWarnings(normalizedConfig, diagnostics);

  const bridge = new IframeBridgeLifecycleController({
    clearTimeout: dependencies.clearTimeout ?? ((timer) => clearTimeout(timer)),
    config: normalizedConfig,
    diagnostics,
    iframe,
    parentWindow,
    queue: createQueue(normalizedConfig, dependencies.queueFactory),
    remount: () => createIframeBridge(config, dependencies),
    setTimeout: dependencies.setTimeout ?? ((handler, timeoutMs) => setTimeout(handler, timeoutMs)),
    transportFactory: dependencies.transportFactory ?? ((options) => new BridgeTransport(options)),
  });

  bridge.mount();
  return bridge;
}
