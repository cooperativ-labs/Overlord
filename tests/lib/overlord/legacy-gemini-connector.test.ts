import fs from 'fs';
import os from 'os';
import path from 'path';

import legacyGeminiConnector from '@/lib/overlord/legacy-gemini-connector.cjs';

const {
  contentMatchesManagedGeminiCommand,
  geminiLegacyCommandFiles,
  isRemovableLegacyGeminiCommandFile,
  removeLegacyGeminiConnector
} = legacyGeminiConnector;

describe('legacy-gemini-connector', () => {
  let tempHome = '';

  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-gemini-'));
    jest.spyOn(os, 'homedir').mockReturnValue(tempHome);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  it('lists the legacy managed Gemini slash command files', () => {
    const files = geminiLegacyCommandFiles();
    const names = files.map(file => path.basename(file.path)).sort();

    expect(names).toEqual([
      'add-objectives.toml',
      'attach.toml',
      'connect.toml',
      'create.toml',
      'discuss-objective.toml',
      'load.toml',
      'prompt.toml',
      'record-work.toml'
    ]);
  });

  it('removes only Overlord-managed command files during migration', () => {
    const managed = geminiLegacyCommandFiles();
    const commandsDir = path.join(tempHome, '.gemini', 'commands');
    fs.mkdirSync(commandsDir, { recursive: true });

    for (const file of managed) {
      fs.writeFileSync(file.path, `${file.content.trim()}\n`, 'utf8');
    }

    const customPath = path.join(commandsDir, 'my-custom.toml');
    fs.writeFileSync(customPath, 'description = "custom"\nprompt = "stay"\n', 'utf8');

    const manifestPath = path.join(tempHome, '.ovld', 'bundle-manifest.json');
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({
        gemini: {
          version: '1.0.0',
          contentHash: 'abc',
          installedAt: '2020-01-01T00:00:00.000Z',
          files: managed.map(file => file.path)
        }
      }),
      'utf8'
    );

    const removed = removeLegacyGeminiConnector({
      readManifest: () => JSON.parse(fs.readFileSync(manifestPath, 'utf8')),
      writeManifest: (manifest: Record<string, unknown>) =>
        fs.writeFileSync(manifestPath, JSON.stringify(manifest), 'utf8'),
      readTextFile: (filePath: string) => fs.readFileSync(filePath, 'utf8')
    });

    expect(removed).toHaveLength(managed.length);
    expect(fs.existsSync(customPath)).toBe(true);
    expect(JSON.parse(fs.readFileSync(manifestPath, 'utf8')).gemini).toBeUndefined();
  });

  it('does not remove modified managed files unless listed in the manifest', () => {
    const managed = geminiLegacyCommandFiles();
    const connectPath = managed[0].path;
    fs.mkdirSync(path.dirname(connectPath), { recursive: true });
    fs.writeFileSync(connectPath, 'description = "edited"\nprompt = "edited"\n', 'utf8');

    const removable = isRemovableLegacyGeminiCommandFile({
      filePath: connectPath,
      content: fs.readFileSync(connectPath, 'utf8'),
      manifestFiles: new Set()
    });

    expect(removable).toBe(false);
    expect(contentMatchesManagedGeminiCommand(' edited \n', 'edited')).toBe(true);
  });

  it('removes manifest-listed files even when content no longer matches', () => {
    const managed = geminiLegacyCommandFiles();
    const connectPath = managed[0].path;
    fs.mkdirSync(path.dirname(connectPath), { recursive: true });
    fs.writeFileSync(connectPath, 'description = "edited"\nprompt = "edited"\n', 'utf8');

    const removable = isRemovableLegacyGeminiCommandFile({
      filePath: connectPath,
      content: fs.readFileSync(connectPath, 'utf8'),
      manifestFiles: new Set([connectPath])
    });

    expect(removable).toBe(true);
  });
});
