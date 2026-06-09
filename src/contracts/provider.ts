import { z } from 'zod';

export const ProviderFinishReasonSchema = z.enum([
  'stop',
  'length',
  'content-filter',
  'tool-calls',
  'error',
  'unknown',
]);

export type ProviderFinishReason = z.infer<typeof ProviderFinishReasonSchema>;

export const ProviderUsageSchema = z
  .object({
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
    total_tokens: z.number().int().nonnegative(),
  })
  .strict();

export type ProviderUsage = z.infer<typeof ProviderUsageSchema>;
