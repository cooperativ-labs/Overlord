#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const sourcePluginDir = path.join(repoRoot, 'plugins', 'overlord');
const homeDir = os.homedir();
const targetPluginDir = path.join(homeDir, '.codex', 'plugins', 'overlord');
const marketplaceDir = path.join(homeDir, '.agents', 'plugins');
const marketplacePath = path.join(marketplaceDir, 'marketplace.json');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function copyDir(source, target) {
  fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(source, target, { recursive: true });
}

function loadMarketplace(filePath) {
  if (!fs.existsSync(filePath)) {
    return {
      name: 'overlord-local',
      interface: {
        displayName: 'Overlord Local Plugins'
      },
      plugins: []
    };
  }

  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function saveMarketplace(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function upsertPluginEntry(marketplace) {
  const entry = {
    name: 'overlord',
    source: {
      source: 'local',
      path: './.codex/plugins/overlord'
    },
    policy: {
      installation: 'AVAILABLE',
      authentication: 'ON_INSTALL'
    },
    category: 'Productivity'
  };

  const existingIndex = Array.isArray(marketplace.plugins)
    ? marketplace.plugins.findIndex(plugin => plugin?.name === 'overlord')
    : -1;

  if (!Array.isArray(marketplace.plugins)) {
    marketplace.plugins = [entry];
    return marketplace;
  }

  if (existingIndex === -1) {
    marketplace.plugins.push(entry);
  } else {
    marketplace.plugins[existingIndex] = entry;
  }

  return marketplace;
}

ensureDir(path.dirname(targetPluginDir));
ensureDir(marketplaceDir);
copyDir(sourcePluginDir, targetPluginDir);

const marketplace = upsertPluginEntry(loadMarketplace(marketplacePath));
saveMarketplace(marketplacePath, marketplace);

process.stdout.write(
  `${JSON.stringify(
    {
      installedPluginDir: targetPluginDir,
      marketplacePath
    },
    null,
    2
  )}\n`
);
