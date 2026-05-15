import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const safeStorageMock = {
  decryptStringAsync: jest.fn(),
  encryptStringAsync: jest.fn(),
  isAsyncEncryptionAvailable: jest.fn()
};

const mockState = {
  homeDir: ''
};

jest.mock('electron', () => ({
  safeStorage: safeStorageMock
}));

jest.mock('node:os', () => {
  const actual = jest.requireActual('node:os') as typeof import('node:os');
  return {
    ...actual,
    homedir: jest.fn(() => mockState.homeDir)
  };
});

describe('electron credential async migration', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    mockState.homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ovld-electron-creds-'));
  });

  afterEach(() => {
    fs.rmSync(mockState.homeDir, { recursive: true, force: true });
  });

  test('re-encrypts stored credentials when Electron marks decrypted values stale', async () => {
    const credentialsModule =
      await import('../apps/desktop/electron/services/electron-credentials');
    const credentialsDir = path.join(mockState.homeDir, '.ovld');
    const credentialsFile = path.join(credentialsDir, 'credentials.desktop.json');

    fs.mkdirSync(credentialsDir, { recursive: true });
    fs.writeFileSync(
      credentialsFile,
      JSON.stringify(
        {
          platform_url: 'https://example.com',
          encrypted_access_token: Buffer.from('access-old').toString('base64'),
          encrypted_refresh_token: Buffer.from('refresh-old').toString('base64')
        },
        null,
        2
      )
    );

    safeStorageMock.isAsyncEncryptionAvailable.mockResolvedValue(true);
    safeStorageMock.decryptStringAsync
      .mockResolvedValueOnce({ result: 'access-token', shouldReEncrypt: true })
      .mockResolvedValueOnce({ result: 'refresh-token', shouldReEncrypt: false });
    safeStorageMock.encryptStringAsync
      .mockResolvedValueOnce(Buffer.from('access-new'))
      .mockResolvedValueOnce(Buffer.from('refresh-new'));

    const credentials = await credentialsModule.loadElectronCredentials();

    expect(credentials).toEqual({
      access_token: 'access-token',
      platform_url: 'https://example.com',
      refresh_token: 'refresh-token'
    });
    expect(safeStorageMock.encryptStringAsync).toHaveBeenCalledWith('access-token');
    expect(safeStorageMock.encryptStringAsync).toHaveBeenCalledWith('refresh-token');

    const rewritten = JSON.parse(fs.readFileSync(credentialsFile, 'utf8')) as {
      encrypted_access_token: string;
      encrypted_refresh_token: string;
    };
    expect(rewritten.encrypted_access_token).toBe(Buffer.from('access-new').toString('base64'));
    expect(rewritten.encrypted_refresh_token).toBe(Buffer.from('refresh-new').toString('base64'));
  });

  test('initializes session store from async persistence and awaits updates', async () => {
    const sessionStoreModule = await import('../apps/desktop/electron/services/session-store');
    const save = jest.fn(async () => undefined);
    const clear = jest.fn();

    const store = await sessionStoreModule.createElectronSessionStore({
      load: async () => ({
        platform_url: 'https://example.com',
        refresh_token: 'refresh-token',
        access_token: 'access-token'
      }),
      save,
      clear
    });

    expect(store.getSession()).toEqual({
      accessToken: 'access-token',
      platformUrl: 'https://example.com',
      refreshToken: 'refresh-token'
    });

    const updated = await store.updateSession({
      accessToken: 'access-token-2',
      accessTokenExpiresAt: '2026-05-15T12:00:00.000Z'
    });

    expect(updated).toEqual({
      accessToken: 'access-token-2',
      accessTokenExpiresAt: '2026-05-15T12:00:00.000Z',
      platformUrl: 'https://example.com',
      refreshToken: 'refresh-token'
    });
    expect(save).toHaveBeenCalledWith({
      access_token: 'access-token-2',
      access_token_expires_at: '2026-05-15T12:00:00.000Z',
      platform_url: 'https://example.com',
      refresh_token: 'refresh-token'
    });

    store.clear();
    expect(clear).toHaveBeenCalledTimes(1);
  });
});
