import { z } from 'zod';

/**
 * Login identifiers are stricter than the legacy `UserIdSchema`: they become
 * file-store path segments and log fields, so keep them to a safe charset.
 * Existing pre-auth ids (e.g. `web-user`) remain claimable.
 */
export const AuthUserIdSchema = z
  .string()
  .trim()
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/,
    'User id must be 3-64 characters: letters, digits, ".", "_" or "-", starting with a letter or digit.',
  );

export const PasswordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters.')
  .max(256, 'Password must be at most 256 characters.');

export const RegisterRequestSchema = z
  .object({
    user_id: AuthUserIdSchema,
    password: PasswordSchema,
  })
  .strict();

export const LoginRequestSchema = z
  .object({
    user_id: z.string().trim().min(1),
    password: z.string().min(1),
  })
  .strict();

export const RefreshRequestSchema = z
  .object({
    refresh_token: z.string().trim().min(1),
  })
  .strict();

export const LogoutRequestSchema = RefreshRequestSchema;

export const AuthTokensResponseSchema = z
  .object({
    user_id: z.string(),
    token_type: z.literal('Bearer'),
    access_token: z.string(),
    /** Seconds until the access token expires. */
    expires_in: z.number().int().positive(),
    refresh_token: z.string(),
  })
  .strict();

export type AuthTokensResponse = z.infer<typeof AuthTokensResponseSchema>;

export const ConnectTokenResponseSchema = z
  .object({
    connect_token: z.string(),
    /** Seconds until the connect token expires. */
    expires_in: z.number().int().positive(),
  })
  .strict();

export type ConnectTokenResponse = z.infer<typeof ConnectTokenResponseSchema>;
