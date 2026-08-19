import { AuthModule } from '../auth.module';
import { SMS_SENDER } from './sms-sender';
import { smsSenderProvider } from './sms.provider';

/**
 * The gap both adversarial reviews attacked and neither ever verified: is the boot
 * gate actually REACHED?
 *
 * Every test of createSmsSender calls it directly. Nothing asserted that AuthModule
 * binds SMS_SENDER through it — so re-adding `{ provide: SMS_SENDER, useClass:
 * DevSmsSender }` (which is exactly what was there before) would silently restore
 * the console sender, pass every existing test, and produce a process that says
 * "code sent" and sends nothing. This is the regression guard for that.
 */
describe('AuthModule SMS wiring', () => {
  const providers = (Reflect.getMetadata('providers', AuthModule) ?? []) as unknown[];

  const smsBinding = providers.find(
    (p) => typeof p === 'object' && p !== null && (p as { provide?: unknown }).provide === SMS_SENDER,
  ) as Record<string, unknown> | undefined;

  it('binds SMS_SENDER exactly once', () => {
    const all = providers.filter(
      (p) => typeof p === 'object' && p !== null
        && (p as { provide?: unknown }).provide === SMS_SENDER,
    );
    expect(all).toHaveLength(1);
  });

  it('binds it through the env-driven FACTORY, not a fixed class', () => {
    expect(smsBinding).toBeDefined();
    expect(smsBinding).toBe(smsSenderProvider);
    expect(typeof smsBinding!.useFactory).toBe('function');
    // useClass would bypass the boot gate entirely — this is the shape that broke.
    expect(smsBinding!.useClass).toBeUndefined();
  });

  it('injects ConfigService, without which the gate cannot read SMS_PROVIDER', () => {
    expect(Array.isArray(smsBinding!.inject)).toBe(true);
    expect((smsBinding!.inject as unknown[]).length).toBeGreaterThan(0);
  });

  it('does not export the sender, so no other module can rebind it', () => {
    const exported = (Reflect.getMetadata('exports', AuthModule) ?? []) as unknown[];
    expect(exported).not.toContain(SMS_SENDER);
  });
});
