import type { ProviderFinishReason, ProviderUsage } from './provider.js';

/** Shared agent activity events mapped from Pi session events. */
export type AgentActivityEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'thinking_delta'; text: string }
  | {
      type: 'tool_call';
      step: number;
      tool_call_id: string;
      tool_name: string;
      input: unknown;
    }
  | {
      type: 'tool_result';
      step: number;
      tool_call_id: string;
      tool_name: string;
      output: unknown;
      is_error: boolean;
      error_code?: string;
      error_message?: string;
    }
  | { type: 'usage'; usage: ProviderUsage }
  | { type: 'agent_error'; message: string }
  | {
      type: 'agent_finished';
      finish_reason: ProviderFinishReason;
      completed_at: string;
    };
