#!/usr/bin/env node

// `ovld add-cwd` — interactively add the current working directory as a
// project resource. Lists the user's projects, prompts for a selection,
// registers cwd as a primary resource for this device, and writes the
// project entry into the directory's overlord.json file.

import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { stdin as input, stdout as output } from 'node:process';

import { buildAuthHeaders, resolveAuth } from './credentials.mjs';
import { upsertLocalOverlordConfig } from './local-config.mjs';
import { parseNumberedSelection, sortProjects } from './new-ticket.mjs';
import { readOrCreateDeviceFingerprint } from './runner.mjs';

function parseFlags(args) {
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith('--')) continue;
    const eqIdx = arg.indexOf('=');
    if (eqIdx !== -1) {
      flags[arg.slice(2, eqIdx)] = arg.slice(eqIdx + 1);
      continue;
    }
    const key = arg.slice(2);
    if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
      flags[key] = args[i + 1];
      i++;
    } else {
      flags[key] = true;
    }
  }
  return flags;
}

function projectLabel(project) {
  const organizationName = String(project.organizationName ?? '').trim();
  return organizationName ? `${project.name} — ${organizationName}` : project.name;
}

async function fetchProjects(platformUrl, bearerToken, localSecret, organizationId) {
  const res = await fetch(`${platformUrl}/api/protocol/projects`, {
    headers: buildAuthHeaders(bearerToken, localSecret, organizationId)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      `Failed to list projects (${res.status}): ${data.error ?? JSON.stringify(data)}`
    );
  }
  return Array.isArray(data.projects) ? sortProjects(data.projects) : [];
}

async function promptForProject(projects, cwd) {
  if (!projects.length) {
    throw new Error('No projects available. Create a project in Overlord first.');
  }

  const rl = readline.createInterface({ input, output });
  const ask = q =>
    new Promise((resolve, reject) => {
      const onError = error => {
        rl.off('error', onError);
        reject(error);
      };
      rl.once('error', onError);
      rl.question(q, answer => {
        rl.off('error', onError);
        resolve(answer);
      });
    });

  try {
    while (true) {
      output.write(`\nCurrent directory:\n  ${cwd}\n\nProjects:\n`);
      projects.forEach((p, i) => {
        output.write(`  ${i + 1}. ${projectLabel(p)}\n`);
      });
      const answer = await ask(`\nSelect a project to register this directory with (1-${projects.length}, or 'q' to cancel): `);
      if (answer.trim().toLowerCase() === 'q') {
        return null;
      }
      const idx = parseNumberedSelection(answer, projects.length);
      if (idx !== null) return projects[idx];
      output.write(`Enter a number between 1 and ${projects.length}.\n`);
    }
  } finally {
    rl.close();
  }
}

export async function runAddCwdCommand(args) {
  const flags = parseFlags(args);

  if (flags.help === true || flags.h === true) {
    console.log(`Usage: ovld add-cwd [--directory <path>] [--project-id <id>] [--primary]

Registers a directory (defaulting to the current working directory) as a
project resource for this device, and writes the project entry into the
directory's overlord.json file.

When --project-id is omitted, the command lists your projects and prompts
you to pick one.

By default the registered resource is marked primary for this device. Pass
--primary=false to skip that behaviour.`);
    return;
  }

  const directoryPath = path.resolve(
    typeof flags.directory === 'string' && flags.directory.trim()
      ? flags.directory.trim()
      : process.cwd()
  );

  const isPrimary = !(flags.primary === 'false' || flags.primary === false);

  const { platformUrl, bearerToken, localSecret, organizationId } = await resolveAuth({});

  const projects = await fetchProjects(platformUrl, bearerToken, localSecret, organizationId);
  let project = null;
  if (typeof flags['project-id'] === 'string' && flags['project-id'].trim()) {
    const wanted = flags['project-id'].trim();
    project = projects.find(p => p.id === wanted) ?? null;
    if (!project) {
      console.error(`Error: project ${wanted} not found among your projects.`);
      process.exit(1);
    }
  } else {
    project = await promptForProject(projects, directoryPath);
    if (!project) {
      output.write('Cancelled. No changes made.\n');
      return;
    }
  }

  const deviceFingerprint = readOrCreateDeviceFingerprint(flags);

  const body = {
    projectId: project.id,
    directoryPath,
    deviceFingerprint,
    isPrimary,
    deviceHostname: os.hostname(),
    devicePlatform: process.platform
  };

  const res = await fetch(`${platformUrl}/api/protocol/add-project-resource`, {
    method: 'POST',
    headers: {
      ...buildAuthHeaders(bearerToken, localSecret, organizationId),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 409) {
      output.write(
        `\nDirectory is already registered for "${project.name}" on this device. Updating overlord.json only.\n`
      );
    } else {
      console.error(
        `Failed to register resource (${res.status}): ${data.error ?? JSON.stringify(data)}`
      );
      process.exit(1);
    }
  }

  try {
    const result = await upsertLocalOverlordConfig({
      directoryPath,
      project: { id: project.id, name: project.name }
    });
    output.write(`\nWrote ${result.filePath} (${result.action}).\n`);
  } catch (err) {
    output.write(
      `\nWarning: could not update overlord.json: ${err instanceof Error ? err.message : err}\n`
    );
  }

  if (data.resource?.id) {
    output.write(`Registered resource ${data.resource.id} (primary=${data.resource.isPrimary}).\n`);
  } else if (res.ok) {
    output.write(`Registered ${directoryPath} for project "${project.name}".\n`);
  }
}
