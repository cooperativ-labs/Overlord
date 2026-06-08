process.env.OVERLORD_URL = process.env.OVERLORD_URL ?? 'http://localhost:3000';

const mockAuth = {
  signUp: jest.fn(),
  signInWithOtp: jest.fn(),
  resend: jest.fn()
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
  findAuthUserByEmail: jest.fn(),
  getClientIp: jest.fn(() => '1.2.3.4'),
  isDuplicateSignupError: (error: { code?: string } | null) =>
    Boolean(error) && (error?.code === 'email_exists' || error?.code === 'user_already_exists')
}));

let POST: (request: Request) => Promise<Response>;

beforeAll(async () => {
  ({ POST } = await import('@/app/api/auth/cli-signup/request/route'));
});

function post(body: unknown) {
  return POST(
    new Request('http://localhost/api/auth/cli-signup/request', {
      method: 'POST',
      body: JSON.stringify(body)
    })
  );
}

describe('POST /api/auth/cli-signup/request', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const cliAuth = jest.requireMock('@/lib/overlord/cli-auth');
    cliAuth.enforceCliAuthRateLimit.mockResolvedValue({ limited: false, retryAfterSeconds: 0 });
  });

  it('starts a passwordless OTP signup when no password is supplied', async () => {
    mockAuth.signInWithOtp.mockResolvedValue({ error: null });

    const res = await post({ email: 'agent@example.com', name: 'Build Agent' });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      email: 'agent@example.com',
      status: 'confirmation_required',
      passwordless: true
    });
    expect(mockAuth.signInWithOtp).toHaveBeenCalledTimes(1);
    expect(mockAuth.signUp).not.toHaveBeenCalled();
  });

  it('uses password signup when a password is supplied', async () => {
    mockAuth.signUp.mockResolvedValue({ error: null });

    const res = await post({ email: 'a@b.com', name: 'A', password: 'hunter2hunter2' });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ passwordless: false });
    expect(mockAuth.signUp).toHaveBeenCalledTimes(1);
  });

  it('resends confirmation for an existing unconfirmed account', async () => {
    mockAuth.signUp.mockResolvedValue({ error: { code: 'email_exists', message: 'exists' } });
    mockAuth.resend.mockResolvedValue({ error: null });
    const cliAuth = jest.requireMock('@/lib/overlord/cli-auth');
    cliAuth.findAuthUserByEmail.mockResolvedValue({ email_confirmed_at: null });

    const res = await post({ email: 'a@b.com', name: 'A', password: 'hunter2hunter2' });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ status: 'confirmation_required' });
    expect(mockAuth.resend).toHaveBeenCalledTimes(1);
  });

  it('returns 409 when a confirmed account already exists', async () => {
    mockAuth.signUp.mockResolvedValue({ error: { code: 'email_exists', message: 'exists' } });
    const cliAuth = jest.requireMock('@/lib/overlord/cli-auth');
    cliAuth.findAuthUserByEmail.mockResolvedValue({ email_confirmed_at: '2026-01-01T00:00:00Z' });

    const res = await post({ email: 'a@b.com', name: 'A', password: 'hunter2hunter2' });

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ code: 'account_exists' });
  });

  it('returns 429 when rate limited', async () => {
    const cliAuth = jest.requireMock('@/lib/overlord/cli-auth');
    cliAuth.enforceCliAuthRateLimit.mockResolvedValue({ limited: true, retryAfterSeconds: 600 });

    const res = await post({ email: 'a@b.com', name: 'A' });

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('600');
  });

  it('returns 400 for an invalid payload', async () => {
    const res = await post({ email: 'nope', name: '' });
    expect(res.status).toBe(400);
  });
});
