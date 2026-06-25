import type { ProviderFinishReason, ProviderUsage } from '../contracts/provider.js';
import type {
  AssistantUsageSlice,
  ProviderStopReason,
} from './piAssistantMessage.js';

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
