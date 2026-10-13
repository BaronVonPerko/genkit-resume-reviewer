import { appCheckTokenFromExchange } from './recaptcha-enterprise-app-check';

describe('appCheckTokenFromExchange', () => {
  it('converts a protobuf ttl into an expiry timestamp', () => {
    const token = appCheckTokenFromExchange({ token: 'app-check-token', ttl: '3600s' }, 1_000);

    expect(token).toEqual({ token: 'app-check-token', expireTimeMillis: 3_601_000 });
  });

  it('accepts a fractional ttl', () => {
    const token = appCheckTokenFromExchange({ token: 'app-check-token', ttl: '3.5s' }, 0);

    expect(token.expireTimeMillis).toBe(3_500);
  });

  it('rejects a response without a token', () => {
    expect(() => appCheckTokenFromExchange({ ttl: '3600s' })).toThrow(/unusable response/);
  });

  it('rejects a response without a ttl', () => {
    expect(() => appCheckTokenFromExchange({ token: 'app-check-token' })).toThrow(
      /unusable response/,
    );
  });
});
