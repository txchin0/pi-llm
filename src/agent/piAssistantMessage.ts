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

/** Narrower view for completion/outcome logic that does not require usage. */
export type AssistantCompletionSlice = Pick<
  AssistantMessageSlice,
  'role' | 'stopReason' | 'errorMessage'
>;

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

/** Returns true when a Pi message has assistant completion fields. */
export function isAssistantCompletionSlice(
  message: { role: string },
): message is AssistantCompletionSlice {
  return message.role === 'assistant' && 'stopReason' in message;
}
