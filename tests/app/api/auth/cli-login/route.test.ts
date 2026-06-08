process.env.OVERLORD_URL = process.env.OVERLORD_URL ?? 'http://localhost:3000';

const mockAuth = {
  signInWithOtp: jest.fn()
};

jest.mock('@/app/api/protocol/_lib', () => ({
  internalErrorResponse: () =>
    new Response(JSON.stringify({ error: 'An internal server error occurred.' }), {
      status: 500,
      headers: { 'content-type': 'application/json' }
    })
}));

jest.mock('@/lib/overlord/cli-auth', () => ({
  createAnonAuthClient: jest.fn(() => ({ auth: mockAuth })),
  enforceCliAuthRateLimit: jest.fn(async () => ({ limited: false, retryAfterSeconds: 0 })),
  getClientIp: jest.fn(() => '1.2.3.4'),
  verifyEmailOtp: jest.fn()
}));

let requestPOST: (request: Request) => Promise<Response>;
let verifyPOST: (request: Request) => Promise<Response>;

beforeAll(async () => {
  requestPOST = (await import('@/app/api/auth/cli-login/request/route')).POST;
  verifyPOST = (await import('@/app/api/auth/cli-login/verify/route')).POST;
});

function call(handler: (r: Request) => Promise<Response>, path: string, body: unknown) {
  return handler(
    new Request(`http://localhost${path}`, { method: 'POST', body: JSON.stringify(body) })
  );
}

describe('POST /api/auth/cli-login/request', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const cliAuth = jest.requireMock('@/lib/overlord/cli-auth');
    cliAuth.enforceCliAuthRateLimit.mockResolvedValue({ limited: false, retryAfterSeconds: 0 });
  });

  it('sends a login code for an existing account', async () => {
    mockAuth.signInWithOtp.mockResolvedValue({ error: null });

    const res = await call(requestPOST, '/api/auth/cli-login/request', { email: 'a@b.com' });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      email: 'a@b.com',
      status: 'confirmation_required'
    });
    expect(mockAuth.signInWithOtp).toHaveBeenCalledWith({
      email: 'a@b.com',
      options: { shouldCreateUser: false }
    });
  });

  it('does not disclose unknown accounts (still returns confirmation_required)', async () => {
    mockAuth.signInWithOtp.mockResolvedValue({
      error: { status: 400, message: 'Signups not allowed for otp' }
    });

    const res = await call(requestPOST, '/api/auth/cli-login/request', { email: 'ghost@b.com' });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ status: 'confirmation_required' });
  });
});

describe('POST /api/auth/cli-login/verify', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const cliAuth = jest.requireMock('@/lib/overlord/cli-auth');
    cliAuth.enforceCliAuthRateLimit.mockResolvedValue({ limited: false, retryAfterSeconds: 0 });
  });

  it('returns the session on a valid code', async () => {
    const cliAuth = jest.requireMock('@/lib/overlord/cli-auth');
    cliAuth.verifyEmailOtp.mockResolvedValue({
      session: {
        access_token: 'a',
        refresh_token: 'r',
        access_token_expires_at: null,
        platform_url: 'http://localhost:3000'
      },
      error: null
    });

    const res = await call(verifyPOST, '/api/auth/cli-login/verify', {
      email: 'a@b.com',
      token: '12345678'
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ access_token: 'a', email: 'a@b.com' });
    expect(cliAuth.verifyEmailOtp).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ types: ['email'] })
    );
  });

  it('returns 400 for an unknown account / invalid code', async () => {
    const cliAuth = jest.requireMock('@/lib/overlord/cli-auth');
    cliAuth.verifyEmailOtp.mockResolvedValue({
      session: null,
      error: { message: 'Invalid', code: 'otp_expired' }
    });

    const res = await call(verifyPOST, '/api/auth/cli-login/verify', {
      email: 'a@b.com',
      token: '99999999'
    });

    expect(res.status).toBe(400);
  });
});
