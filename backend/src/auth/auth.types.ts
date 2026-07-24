/**
 * Shared auth types. Kept dependency-free (no Nest/Prisma imports) so both the
 * runtime code and the unit tests can import them without pulling in the DI
 * container.
 */

/** Claims carried inside a signed JWT access token. */
export interface AccessTokenPayload {
  /** Subject — the user's UUID. */
  sub: string;
  /** E.164 mobile, for convenience so `/me`-style reads need no DB hit. */
  mobile: string;
}

/** The authenticated principal attached to a request by JwtAuthGuard. */
export interface AuthenticatedUser {
  id: string;
  mobile: string;
}

/** Device/request metadata stored alongside a refresh token. Best-effort. */
export interface TokenMeta {
  userAgent?: string;
  ip?: string;
}

/** What the client receives when a session is minted or rotated. */
export interface IssuedTokens {
  accessToken: string;
  /** Opaque high-entropy refresh token — returned in plaintext exactly ONCE. */
  refreshToken: string;
  tokenType: 'Bearer';
  /** Access-token lifetime, e.g. "15m" — informational for the client. */
  accessTokenExpiresIn: string;
}

/**
 * The subset of the HTTP request we read. Declared locally (rather than pulling
 * in express types) so guards/decorators stay narrowly typed to what they touch,
 * and so `user` — which the guard sets — is part of the contract.
 */
export interface RequestWithUser {
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
  user?: AuthenticatedUser;
}
