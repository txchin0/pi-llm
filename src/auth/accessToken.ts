import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Minimal HS256 JWT for access tokens — sign + verify only, no external
 * dependency. Claims: `sub` (user id), `iat`, `exp`, and `typ: "access"` so a
 * refresh token can never be replayed as an access token.
 */

export type AccessTokenClaims = {
  sub: string;
  iat: number;
  exp: number;
  typ: 'access';
};

export type SignAccessTokenInput = {
  userId: string;
  secret: string;
  ttlSeconds: number;
  /** Epoch seconds; defaults to the current time. */
  nowSeconds?: number;
};

const JWT_HEADER = base64UrlJson({ alg: 'HS256', typ: 'JWT' });

/** Encodes an object as base64url JSON. */
function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

/** Computes the HS256 signature over `header.payload`. */
function hmacSignature(signingInput: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(signingInput).digest();
}

/** Signs a short-lived access JWT for the given user. */
export function signAccessToken(input: SignAccessTokenInput): string {
  const iat = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const claims: AccessTokenClaims = {
    sub: input.userId,
    iat,
    exp: iat + input.ttlSeconds,
    typ: 'access',
  };

  const signingInput = `${JWT_HEADER}.${base64UrlJson(claims)}`;
  const signature = hmacSignature(signingInput, input.secret).toString('base64url');
  return `${signingInput}.${signature}`;
}

export type VerifyAccessTokenInput = {
  token: string;
  secret: string;
  /** Epoch seconds; defaults to the current time. */
  nowSeconds?: number;
};

/**
 * Verifies signature, expiry, and token type. Returns the user id, or
 * undefined for any malformed, forged, expired, or wrong-type token.
 */
export function verifyAccessToken(
  input: VerifyAccessTokenInput,
): { userId: string } | undefined {
  const parts = input.token.split('.');
  if (parts.length !== 3) {
    return undefined;
  }

  const signingInput = `${parts[0]}.${parts[1]}`;
  const expected = hmacSignature(signingInput, input.secret);
  const actual = Buffer.from(parts[2]!, 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return undefined;
  }

  let claims: Partial<AccessTokenClaims>;
  try {
    claims = JSON.parse(
      Buffer.from(parts[1]!, 'base64url').toString('utf8'),
    ) as Partial<AccessTokenClaims>;
  } catch {
    return undefined;
  }

  if (claims.typ !== 'access' || typeof claims.sub !== 'string' || claims.sub === '') {
    return undefined;
  }

  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== 'number' || now >= claims.exp) {
    return undefined;
  }

  return { userId: claims.sub };
}
