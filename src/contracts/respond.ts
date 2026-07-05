import { z } from 'zod';

import {
  ProviderFinishReasonSchema,
  ProviderUsageSchema,
} from './provider.js';

export const UserIdSchema = z.string().trim().min(1);
export const SessionIdSchema = z.string().regex(/^sess_[A-Za-z0-9]{12,}$/);
export const RequestIdSchema = z.string().regex(/^req_[A-Za-z0-9]{12,}$/);
export const TimestampSchema = z.string().trim().min(1);
export const ToolCallIdSchema = z.string().trim().min(1);
export const ToolNameSchema = z.string().trim().min(1);
export const ToolStepSchema = z.number().int().nonnegative();

export const RespondRequestSchema = z
  .object({
    /** Ignored: identity comes from the access token. Accepted so pre-auth clients don't 400. */
    user_id: z.string().optional(),
    session_id: SessionIdSchema.optional(),
    message: z.string().trim().min(1),
    show_thinking: z.boolean().optional(),
  })
  .strict();

/** A validated turn with the server-derived (authenticated) user id attached. */
export type RespondRequest = Omit<z.infer<typeof RespondRequestSchema>, 'user_id'> & {
  user_id: UserId;
};
export type UserId = z.infer<typeof UserIdSchema>;
export type SessionId = z.infer<typeof SessionIdSchema>;
export type RequestId = z.infer<typeof RequestIdSchema>;

export const RespondStartEventSchema = z
  .object({
    type: z.literal('start'),
    request_id: RequestIdSchema,
    user_id: UserIdSchema,
    session_id: SessionIdSchema,
    started_at: TimestampSchema,
  })
  .strict();

export const RespondDeltaEventSchema = z
  .object({
    type: z.literal('delta'),
    text: z.string(),
  })
  .strict();

export const RespondThinkingDeltaEventSchema = z
  .object({
    type: z.literal('thinking_delta'),
    text: z.string(),
  })
  .strict();

export const RespondFinalEventSchema = z
  .object({
    type: z.literal('final'),
    request_id: RequestIdSchema,
    finish_reason: ProviderFinishReasonSchema,
    completed_at: TimestampSchema,
  })
  .strict();

export const RespondUsageEventSchema = z
  .object({
    type: z.literal('usage'),
    request_id: RequestIdSchema,
    usage: ProviderUsageSchema,
  })
  .strict();

export const RespondToolCallEventSchema = z
  .object({
    type: z.literal('tool_call'),
    request_id: RequestIdSchema,
    session_id: SessionIdSchema,
    step: ToolStepSchema,
    tool_call_id: ToolCallIdSchema,
    tool_name: ToolNameSchema,
    input: z.unknown(),
  })
  .strict();

export const RespondToolResultEventSchema = z
  .object({
    type: z.literal('tool_result'),
    request_id: RequestIdSchema,
    session_id: SessionIdSchema,
    step: ToolStepSchema,
    tool_call_id: ToolCallIdSchema,
    tool_name: ToolNameSchema,
    output: z.unknown(),
    is_error: z.boolean(),
    error_code: z.string().trim().min(1).optional(),
    error_message: z.string().trim().min(1).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.is_error && !value.error_code) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['error_code'],
        message: 'error_code is required when is_error is true',
      });
    }

    if (value.is_error && !value.error_message) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['error_message'],
        message: 'error_message is required when is_error is true',
      });
    }
  });

export const RespondErrorEventSchema = z
  .object({
    type: z.literal('error'),
    request_id: RequestIdSchema,
    code: z.string().trim().min(1),
    message: z.string().trim().min(1),
  })
  .strict();

export const RespondSseEventSchema = z.discriminatedUnion('type', [
  RespondStartEventSchema,
  RespondDeltaEventSchema,
  RespondThinkingDeltaEventSchema,
  RespondFinalEventSchema,
  RespondUsageEventSchema,
  RespondToolCallEventSchema,
  RespondToolResultEventSchema,
  RespondErrorEventSchema,
]);

export type RespondStartEvent = z.infer<typeof RespondStartEventSchema>;
export type RespondDeltaEvent = z.infer<typeof RespondDeltaEventSchema>;
export type RespondThinkingDeltaEvent = z.infer<
  typeof RespondThinkingDeltaEventSchema
>;
export type RespondFinalEvent = z.infer<typeof RespondFinalEventSchema>;
export type RespondUsageEvent = z.infer<typeof RespondUsageEventSchema>;
export type RespondToolCallEvent = z.infer<typeof RespondToolCallEventSchema>;
export type RespondToolResultEvent = z.infer<typeof RespondToolResultEventSchema>;
export type RespondErrorEvent = z.infer<typeof RespondErrorEventSchema>;
export type RespondSseEvent = z.infer<typeof RespondSseEventSchema>;
