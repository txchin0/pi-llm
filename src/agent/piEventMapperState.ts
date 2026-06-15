import type { ProviderFinishReason, ProviderUsage } from '../contracts/provider.js';

export type ProviderStopReason =
  | 'stop'
  | 'length'
  | 'toolUse'
  | 'error'
  | 'aborted';

export type AssistantUsageSlice = {
  input: number;
  output: number;
  totalTokens: number;
};

export type AssistantMessageSlice = {
  role: 'assistant';
  usage: AssistantUsageSlice;
  stopReason: ProviderStopReason;
  errorMessage?: string;
};

export type PiEventMapperState = {
  step: number;
  toolSteps: Map<string, number>;
};

export type PiActivityMapperContext = {
  completedAt: () => string;
};

/** Creates mutable mapper state for one agent prompt run. */
export function createPiEventMapperState(): PiEventMapperState {
  return {
    step: 0,
    toolSteps: new Map(),
  };
}

/** Maps Pi `StopReason` values to the provider finish reason contract. */
export function mapStopReason(stopReason: ProviderStopReason): ProviderFinishReason {
  switch (stopReason) {
    case 'stop':
      return 'stop';
    case 'length':
      return 'length';
    case 'toolUse':
      return 'tool-calls';
    case 'error':
    case 'aborted':
      return 'error';
    default: {
      const _exhaustive: never = stopReason;
      return _exhaustive;
    }
  }
}

/** Maps Pi usage fields to the provider usage contract. */
export function mapUsage(usage: AssistantUsageSlice): ProviderUsage {
  return {
    input_tokens: usage.input,
    output_tokens: usage.output,
    total_tokens: usage.totalTokens,
  };
}

/** Returns true when a Pi message has assistant fields needed for usage mapping. */
export function isAssistantMessageSlice(
  message: { role: string },
): message is AssistantMessageSlice {
  return (
    message.role === 'assistant' &&
    'usage' in message &&
    'stopReason' in message
  );
}
