import { createIframeBridge as createIframeBridgeInternal } from './host/create-iframe-bridge.js';
import type {
  IframeBridge,
  IframeBridgeConfig,
  IframeBridgeContract,
  IframeBridgeOptions,
  TypedIframeBridge,
} from './types/index.js';

export function createIframeBridge(
  config: IframeBridgeConfig,
  options?: IframeBridgeOptions,
): IframeBridge {
  return createIframeBridgeInternal(config, {}, options);
}

export function createTypedIframeBridge<TContract extends IframeBridgeContract>(
  config: IframeBridgeConfig,
  options?: IframeBridgeOptions,
): TypedIframeBridge<TContract> {
  // The runtime bridge is contract-agnostic; this narrows the public method names and payloads at compile time only.
  return createIframeBridgeInternal(config, {}, options) as TypedIframeBridge<TContract>;
}

export { createDiagnosticRecorder } from './diagnostics/diagnostics.js';
export { IframeBridgeError } from './shared/errors.js';
export {
  BRIDGE_MESSAGE_TYPES,
  BRIDGE_PROTOCOL_NAME,
  BRIDGE_PROTOCOL_VERSION,
  isBridgeEnvelope,
  normalizeBridgeRemoteError,
  validateBridgeEnvelope,
} from './protocol/envelope.js';
export type {
  DiagnosticRecorder,
  DiagnosticRecorderEntry,
  DiagnosticRecorderOptions,
} from './diagnostics/diagnostics.js';
export type { IframeBridgeErrorCode, IframeBridgeErrorOptions } from './shared/errors.js';
export type {
  BootstrapParamLocation,
  BridgeConnectedEnvelope,
  BridgeEnvelope,
  BridgeEnvelopeBase,
  BridgeEnvelopeError,
  BridgeEventEnvelope,
  BridgeMessageType,
  BridgePlugin,
  BridgePluginContext,
  BridgePluginHandle,
  BridgePluginSetupContext,
  BridgeProtocolName,
  BridgeProtocolVersion,
  BridgeReadyEnvelope,
  BridgeRequestEnvelope,
  BridgeResponseEnvelope,
  DiagnosticEvent,
  DiagnosticLevel,
  IframeBridgeBootstrapConfig,
  IframeBridgeBootstrapParentOriginConfig,
  IframeBridgeBootstrapSessionConfig,
  IframeBridge,
  IframeBridgeConfig,
  IframeBridgeContract,
  IframeBridgeDiagnosticsConfig,
  IframeBridgeEventHandler,
  IframeBridgeIframeAttributes,
  IframeBridgeLogger,
  IframeBridgeOptions,
  IframeBridgeQueueConfig,
  IframeBridgeResizeCallback,
  IframeBridgeResizeEvent,
  IframeBridgeResizeAxis,
  IframeBridgeResizeConfig,
  IframeBridgeResizePayload,
  IframeBridgeRequestContract,
  IframeBridgeSecurityProfile,
  IframeBridgeTimeoutConfig,
  LifecycleState,
  OperationOptions,
  TypedIframeBridge,
} from './types/index.js';
