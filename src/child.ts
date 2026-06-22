import { createIframeChildBridge as createIframeChildBridgeInternal } from './child/create-iframe-child-bridge.js';
import type {
  IframeChildBridge,
  IframeChildBridgeConfig,
  IframeChildBridgeOptions,
} from './types/index.js';

export function createIframeChildBridge(
  config: IframeChildBridgeConfig = {},
  options?: IframeChildBridgeOptions,
): IframeChildBridge {
  return createIframeChildBridgeInternal(config, {}, options);
}

export type {
  ChildLifecycleState,
  IframeChildBootstrapConfig,
  IframeChildBootstrapParentOriginConfig,
  IframeChildBootstrapSessionConfig,
  IframeChildBridge,
  IframeChildBridgeConfig,
  IframeChildBridgeEventHandler,
  IframeChildBridgeOptions,
  IframeChildBridgePlugin,
  IframeChildBridgePluginHandle,
  IframeChildBridgePluginSetupContext,
  IframeChildBridgeRequestHandler,
  IframeChildOperationOptions,
} from './types/index.js';
