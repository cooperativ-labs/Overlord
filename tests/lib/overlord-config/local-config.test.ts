import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  removeProjectFromLocalOverlordConfig,
  upsertLocalOverlordConfig
} from '@/lib/overlord-config/local-config';

describe('local Overlord config', () => {
  it('writes project metadata under .overlord and gitignores scratch paths', async () => {
    const directoryPath = await mkdtemp(path.join(tmpdir(), 'overlord-local-config-'));

    const result = await upsertLocalOverlordConfig({
      directoryPath,
      project: { id: 'project-1', name: 'Project One' }
    });

    expect(result).toEqual({
      filePath: path.join(directoryPath, '.overlord', 'project.json'),
      action: 'created'
    });

    await expect(stat(path.join(directoryPath, '.overlord', 'tmp'))).resolves.toBeTruthy();

    const config = JSON.parse(await readFile(result.filePath, 'utf8'));
    expect(config.projects).toEqual([{ id: 'project-1', name: 'Project One' }]);

    const gitignore = await readFile(path.join(directoryPath, '.gitignore'), 'utf8');
    expect(gitignore).toContain('.overlord/tmp/');
    expect(gitignore).toContain('.overlord/logs/');
  });

  it('removes project metadata from .overlord/project.json', async () => {
    const directoryPath = await mkdtemp(path.join(tmpdir(), 'overlord-local-config-'));

    await upsertLocalOverlordConfig({
      directoryPath,
      project: { id: 'project-1', name: 'Project One' }
    });
    await upsertLocalOverlordConfig({
      directoryPath,
      project: { id: 'project-2', name: 'Project Two' }
    });

    const result = await removeProjectFromLocalOverlordConfig({
      directoryPath,
      projectId: 'project-1'
    });

    expect(result).toEqual({
      filePath: path.join(directoryPath, '.overlord', 'project.json'),
      action: 'removed-project'
    });

    const config = JSON.parse(await readFile(result.filePath, 'utf8'));
    expect(config.projects).toEqual([{ id: 'project-2', name: 'Project Two' }]);
  });
});
