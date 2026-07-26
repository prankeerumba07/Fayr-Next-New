import { JwtService } from '@nestjs/jwt';
import { StaffTokenService } from './staff-token.service';

/**
 * Uses a REAL JwtService (no DB) so these exercise actual signing + verification.
 * The important property is trust-domain isolation: a token minted with a
 * different secret — standing in for a user access token — must NOT verify as a
 * staff token, and a staff-signed token without the `typ` tag is rejected too.
 */

const STAFF_SECRET = 'staff-secret-at-least-32-characters-long!!';
const OTHER_SECRET = 'a-totally-different-secret-32-chars-min!!';

const CONFIG: Record<string, unknown> = {
  STAFF_JWT_SECRET: STAFF_SECRET,
  STAFF_JWT_TTL: '8h',
};

function build() {
  const jwt = new JwtService({});
  const config = { get: (key: string) => CONFIG[key] };
  const service = new StaffTokenService(jwt, config as never);
  return { service, jwt };
}

const staff = { id: 's1', email: 'admin@fayr.local', role: 'ADMIN' as const };

describe('StaffTokenService', () => {
  it('issues a session whose token round-trips through verify()', async () => {
    const { service } = build();
    const session = await service.issueSession(staff);

    expect(session.tokenType).toBe('Bearer');
    expect(session.accessTokenExpiresIn).toBe('8h');
    expect(session.staff).toEqual(staff);

    const payload = await service.verify(session.accessToken);
    expect(payload.sub).toBe('s1');
    expect(payload.email).toBe('admin@fayr.local');
    expect(payload.role).toBe('ADMIN');
    expect(payload.typ).toBe('staff');
  });

  it('rejects a token signed with a different secret (a user token)', async () => {
    const { service, jwt } = build();
    // A token from another trust domain — right shape, wrong secret.
    const foreign = await jwt.signAsync(
      { sub: 'u1', typ: 'staff' },
      { secret: OTHER_SECRET },
    );
    await expect(service.verify(foreign)).rejects.toBeDefined();
  });

  it('rejects a staff-signed token that lacks the staff typ tag', async () => {
    const { service, jwt } = build();
    const untagged = await jwt.signAsync(
      { sub: 's1', email: 'x', role: 'ADMIN' },
      { secret: STAFF_SECRET },
    );
    await expect(service.verify(untagged)).rejects.toThrow('not a staff token');
  });
});
