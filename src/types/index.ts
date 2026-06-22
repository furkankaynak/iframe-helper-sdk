export type LifecycleState =
  | 'created'
  | 'mounting'
  | 'waiting_for_handshake'
  | 'ready'
  | 'handshake_failed'
  | 'destroyed';

export type BootstrapParamLocation = 'query' | 'hash';

export type IframeBridgeSecurityProfile = 'development' | 'strict';

export type IframeBridgeBootstrapSessionConfig = {
  paramName?: string;
  paramValue?: string;
  location?: BootstrapParamLocation;
};

export type IframeBridgeBootstrapParentOriginConfig = {
  enabled?: boolean;
  paramName?: string;
  value?: string;
  location?: BootstrapParamLocation;
};

export type IframeBridgeBootstrapConfig = {
  session?: IframeBridgeBootstrapSessionConfig;
  parentOrigin?: IframeBridgeBootstrapParentOriginConfig;
  handshakeTimeoutMs?: number;
};

export type IframeBridgeIframeAttributes = {
  title?: string;
  className?: string;
  id?: string;
  name?: string;
  allow?: string;
  allowFullscreen?: boolean;
  loading?: 'eager' | 'lazy';
  referrerPolicy?: ReferrerPolicy;
};

export type IframeBridgeQueueConfig = {
  enabled?: boolean;
  maxSize?: number;
};

export type IframeBridgeTimeoutConfig = {
  operationTimeoutMs?: number;
};

export type IframeBridgeResizeAxis = 'width' | 'height' | 'both';

export type IframeBridgeResizeEvent = {
  readonly height?: number;
  readonly requestedHeight?: number;
  readonly requestedWidth?: number;
  readonly width?: number;
};

export type IframeBridgeResizeCallback = (event: IframeBridgeResizeEvent) => void;

export type IframeBridgeResizeConfig = {
  enabled?: boolean;
  axis?: IframeBridgeResizeAxis;
  minWidthPx?: number;
  maxWidthPx?: number;
  minHeightPx?: number;
  maxHeightPx?: number;
  offsetWidthPx?: number;
  offsetHeightPx?: number;
  onResize?: IframeBridgeResizeCallback;
};

export type IframeBridgeResizePayload =
  | {
      width: number;
      height?: number;
    }
  | {
      width?: number;
      height: number;
    };

export type DiagnosticLevel = 'debug' | 'warn' | 'error';

export type DiagnosticEvent = {
  message: string;
  code?: string;
  details?: unknown;
  level?: DiagnosticLevel;
  sessionId?: string;
};

export type IframeBridgeLogger = {
  debug?(event: DiagnosticEvent): void;
  warn?(event: DiagnosticEvent): void;
  error?(event: DiagnosticEvent): void;
};

export type IframeBridgeDiagnosticsConfig = {
  debug?: boolean;
  logger?: IframeBridgeLogger;
};

export type IframeBridgeConfig = {
  container: Element | string;
  src: string | URL;
  iframeAttributes?: IframeBridgeIframeAttributes;
  sandbox?: string | readonly string[];
  replaceContainerContent?: boolean;
  targetOrigin?: string;
  allowedOrigin?: string;
  allowInsecureLocalhost?: boolean;
  bootstrap?: IframeBridgeBootstrapConfig;
  queue?: IframeBridgeQueueConfig;
  securityProfile?: IframeBridgeSecurityProfile;
  timeouts?: IframeBridgeTimeoutConfig;
  diagnostics?: IframeBridgeDiagnosticsConfig;
};

export type BridgePluginContext = {
  readonly iframe: HTMLIFrameElement;
  readonly sessionId: string;
  readonly warn: (event: DiagnosticEvent) => void;
};

export type BridgePluginHandle = {
  readonly events: readonly string[];
  onEvent(envelope: BridgeEventEnvelope, ctx: BridgePluginContext): void;
};

export type BridgePluginSetupContext = {
  readonly securityProfile: IframeBridgeSecurityProfile;
  readonly sessionId: string;
  readonly warn: (event: DiagnosticEvent) => void;
};

export type BridgePlugin = (ctx: BridgePluginSetupContext) => BridgePluginHandle;

export type IframeBridgeOptions = {
  readonly plugins?: readonly BridgePlugin[];
};

export type OperationOptions = {
  timeoutMs?: number;
  signal?: AbortSignal;
};

export type IframeBridgeEventHandler<TPayload = unknown> = (payload: TPayload) => void;

export type IframeBridge = {
  readonly iframe: HTMLIFrameElement;
  readonly state: LifecycleState;
  request<TPayload = unknown, TResponse = unknown>(
    method: string,
    payload: TPayload,
    options?: OperationOptions,
  ): Promise<TResponse>;
  sendEvent<TPayload = unknown>(
    name: string,
    payload: TPayload,
    options?: OperationOptions,
  ): Promise<void>;
  waitForEvent<TPayload = unknown>(name: string, options?: OperationOptions): Promise<TPayload>;
  on<TPayload = unknown>(name: string, handler: IframeBridgeEventHandler<TPayload>): () => void;
  whenReady(): Promise<void>;
  remount(): IframeBridge;
  destroy(): void;
};

export type ChildLifecycleState =
  | 'created'
  | 'connecting'
  | 'connected'
  | 'connection_failed'
  | 'destroyed';

export type IframeChildBootstrapSessionConfig = {
  paramName?: string;
  location?: BootstrapParamLocation;
};

export type IframeChildBootstrapParentOriginConfig = {
  paramName?: string;
  location?: BootstrapParamLocation;
};

export type IframeChildBootstrapConfig = {
  session?: IframeChildBootstrapSessionConfig;
  parentOrigin?: IframeChildBootstrapParentOriginConfig;
  connectionTimeoutMs?: number;
};

export type IframeChildBridgeConfig = {
  allowedParentOrigins?: readonly string[] | null;
  bootstrap?: IframeChildBootstrapConfig;
  diagnostics?: IframeBridgeDiagnosticsConfig;
};

export type IframeChildOperationOptions = {
  signal?: AbortSignal;
};

export type IframeChildBridgeEventHandler<TPayload = unknown> = (payload: TPayload) => void;

export type IframeChildBridgeRequestHandler<TPayload = unknown, TResponse = unknown> = (
  payload: TPayload,
) => TResponse | Promise<TResponse>;

export type IframeChildBridge = {
  readonly parentOrigin: string;
  readonly sessionId: string;
  readonly state: ChildLifecycleState;
  sendEvent<TPayload = unknown>(
    name: string,
    payload: TPayload,
    options?: IframeChildOperationOptions,
  ): Promise<void>;
  on<TPayload = unknown>(
    name: string,
    handler: IframeChildBridgeEventHandler<TPayload>,
  ): () => void;
  handleRequest<TPayload = unknown, TResponse = unknown>(
    name: string,
    handler: IframeChildBridgeRequestHandler<TPayload, TResponse>,
  ): () => void;
  whenConnected(): Promise<void>;
  destroy(): void;
};

export type IframeChildBridgePluginSetupContext = {
  readonly bridge: IframeChildBridge;
  readonly parentOrigin: string;
  readonly sessionId: string;
  readonly warn: (event: DiagnosticEvent) => void;
};

export type IframeChildBridgePluginHandle = {
  onConnected?(): void;
  onEvent?(envelope: BridgeEventEnvelope, bridge: IframeChildBridge): void;
  destroy?(): void;
};

export type IframeChildBridgePlugin = (
  ctx: IframeChildBridgePluginSetupContext,
) => IframeChildBridgePluginHandle | undefined;

export type IframeChildBridgeOptions = {
  readonly plugins?: readonly IframeChildBridgePlugin[];
};

export type IframeBridgeRequestContract = {
  readonly payload: unknown;
  readonly response: unknown;
};

export type IframeBridgeContract = {
  readonly requests?: Record<string, IframeBridgeRequestContract>;
  readonly outboundEvents?: Record<string, unknown>;
  readonly inboundEvents?: Record<string, unknown>;
};

type ContractRequests<TContract extends IframeBridgeContract> = TContract extends {
  readonly requests: infer TRequests;
}
  ? TRequests
  : Record<never, never>;

type ContractOutboundEvents<TContract extends IframeBridgeContract> = TContract extends {
  readonly outboundEvents: infer TEvents;
}
  ? TEvents
  : Record<never, never>;

type ContractInboundEvents<TContract extends IframeBridgeContract> = TContract extends {
  readonly inboundEvents: infer TEvents;
}
  ? TEvents
  : Record<never, never>;

type ContractRequestName<TContract extends IframeBridgeContract> = Extract<
  keyof ContractRequests<TContract>,
  string
>;

type ContractOutboundEventName<TContract extends IframeBridgeContract> = Extract<
  keyof ContractOutboundEvents<TContract>,
  string
>;

type ContractInboundEventName<TContract extends IframeBridgeContract> = Extract<
  keyof ContractInboundEvents<TContract>,
  string
>;

type ContractRequestPayload<
  TContract extends IframeBridgeContract,
  TName extends ContractRequestName<TContract>,
> = ContractRequests<TContract>[TName] extends { readonly payload: infer TPayload }
  ? TPayload
  : never;

type ContractRequestResponse<
  TContract extends IframeBridgeContract,
  TName extends ContractRequestName<TContract>,
> = ContractRequests<TContract>[TName] extends { readonly response: infer TResponse }
  ? TResponse
  : never;

type ContractOutboundEventPayload<
  TContract extends IframeBridgeContract,
  TName extends ContractOutboundEventName<TContract>,
> = ContractOutboundEvents<TContract>[TName];

type ContractInboundEventPayload<
  TContract extends IframeBridgeContract,
  TName extends ContractInboundEventName<TContract>,
> = ContractInboundEvents<TContract>[TName];

export type TypedIframeBridge<TContract extends IframeBridgeContract> = Omit<
  IframeBridge,
  'on' | 'remount' | 'request' | 'sendEvent' | 'waitForEvent'
> & {
  request<TName extends ContractRequestName<TContract>>(
    method: TName,
    payload: ContractRequestPayload<TContract, TName>,
    options?: OperationOptions,
  ): Promise<ContractRequestResponse<TContract, TName>>;
  sendEvent<TName extends ContractOutboundEventName<TContract>>(
    name: TName,
    payload: ContractOutboundEventPayload<TContract, TName>,
    options?: OperationOptions,
  ): Promise<void>;
  waitForEvent<TName extends ContractInboundEventName<TContract>>(
    name: TName,
    options?: OperationOptions,
  ): Promise<ContractInboundEventPayload<TContract, TName>>;
  on<TName extends ContractInboundEventName<TContract>>(
    name: TName,
    handler: (payload: ContractInboundEventPayload<TContract, TName>) => void,
  ): () => void;
  remount(): TypedIframeBridge<TContract>;
};

export type BridgeProtocolName = 'iframe-bridge';

export type BridgeProtocolVersion = 1;

export type BridgeMessageType =
  | 'bridge:ready'
  | 'bridge:connected'
  | 'bridge:event'
  | 'bridge:request'
  | 'bridge:response';

export type BridgeEnvelopeError = {
  code: string;
  message: string;
  data?: unknown;
};

export type BridgeEnvelopeBase<TType extends BridgeMessageType = BridgeMessageType> = {
  protocol: BridgeProtocolName;
  version: BridgeProtocolVersion;
  sessionId: string;
  type: TType;
};

export type BridgeReadyEnvelope = BridgeEnvelopeBase<'bridge:ready'>;

export type BridgeConnectedEnvelope = BridgeEnvelopeBase<'bridge:connected'>;

export type BridgeEventEnvelope<TPayload = unknown> = BridgeEnvelopeBase<'bridge:event'> & {
  name: string;
  payload?: TPayload;
};

export type BridgeRequestEnvelope<TPayload = unknown> = BridgeEnvelopeBase<'bridge:request'> & {
  requestId: string;
  name: string;
  payload?: TPayload;
};

export type BridgeResponseEnvelope<TPayload = unknown> = BridgeEnvelopeBase<'bridge:response'> & {
  requestId: string;
  payload?: TPayload;
  error?: BridgeEnvelopeError;
};

export type BridgeEnvelope<TPayload = unknown> =
  | BridgeReadyEnvelope
  | BridgeConnectedEnvelope
  | BridgeEventEnvelope<TPayload>
  | BridgeRequestEnvelope<TPayload>
  | BridgeResponseEnvelope<TPayload>;
