import type {
  DiagnosticEvent,
  DiagnosticLevel,
  IframeBridgeDiagnosticsConfig,
  IframeBridgeLogger,
} from '../types/index.js';
import { IframeBridgeError } from '../shared/errors.js';

export type BridgeDiagnostics = {
  debug(event: DiagnosticEvent): void;
  error(event: DiagnosticEvent): void;
  warn(event: DiagnosticEvent): void;
};

export type DiagnosticRecorderEntry = Readonly<
  DiagnosticEvent & {
    level: DiagnosticLevel;
    sequence: number;
    timestamp: number;
  }
>;

export type DiagnosticRecorderOptions = {
  readonly maxEntries?: number;
  readonly now?: () => number;
};

export type DiagnosticRecorder = {
  readonly entries: readonly DiagnosticRecorderEntry[];
  readonly logger: Required<IframeBridgeLogger>;
  clear(): void;
};

type DiagnosticHookName = keyof IframeBridgeLogger;

export function createDiagnostics(
  config: IframeBridgeDiagnosticsConfig | undefined,
): BridgeDiagnostics {
  const logger = config?.logger;
  const isDebugEnabled = config?.debug === true;

  return {
    debug(event) {
      if (!isDebugEnabled) {
        return;
      }

      emit(logger, 'debug', 'debug', event);
    },
    error(event) {
      emit(logger, 'error', 'error', event);
    },
    warn(event) {
      emit(logger, 'warn', 'warn', event);
    },
  };
}

export function createDiagnosticRecorder(
  options: DiagnosticRecorderOptions = {},
): DiagnosticRecorder {
  validateMaxEntries(options.maxEntries);

  const entries: DiagnosticRecorderEntry[] = [];
  const now = options.now ?? Date.now;
  let sequence = 0;

  const record = (level: DiagnosticLevel, event: DiagnosticEvent): void => {
    entries.push(Object.freeze({ ...event, level, sequence: ++sequence, timestamp: now() }));

    if (options.maxEntries !== undefined && entries.length > options.maxEntries) {
      entries.splice(0, entries.length - options.maxEntries);
    }
  };

  return {
    get entries() {
      return Object.freeze([...entries]);
    },
    logger: {
      debug(event) {
        record('debug', event);
      },
      error(event) {
        record('error', event);
      },
      warn(event) {
        record('warn', event);
      },
    },
    clear() {
      entries.splice(0, entries.length);
    },
  };
}

function validateMaxEntries(maxEntries: number | undefined): void {
  if (maxEntries === undefined) {
    return;
  }

  if (Number.isInteger(maxEntries) && maxEntries >= 0) {
    return;
  }

  throw new IframeBridgeError(
    'DIAGNOSTICS_INVALID_MAX_ENTRIES',
    'Diagnostic recorder maxEntries must be a non-negative integer.',
    { details: { maxEntries } },
  );
}

function emit(
  logger: IframeBridgeLogger | undefined,
  hookName: DiagnosticHookName,
  level: DiagnosticLevel,
  event: DiagnosticEvent,
): void {
  const hook = logger?.[hookName];

  if (hook === undefined) {
    return;
  }

  try {
    hook.call(logger, { ...event, level });
  } catch {
    // Logger hooks are observational and must not affect bridge behavior.
  }
}
