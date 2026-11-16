import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import YAML from 'yaml';

import { runProtocolCommand } from '../src/commands.ts';
import { printProtocolHelp, SUPPORTED_PROTOCOL_SUBCOMMANDS } from '../src/protocol-help.ts';

function help(subcommand?: string): string {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => void lines.push(args.join(' '));
  try {
    printProtocolHelp({ primaryCommand: 'ovld', subcommand });
  } finally {
    console.log = original;
  }
  return lines.join('\n');
}

// Read the real dispatch tables without booting a backend/database in a CLI help test.
const backendCommands = new Map<string, ts.ObjectLiteralExpression>();
for (const group of ['session', 'missions', 'projects', 'artifacts', 'run-queue']) {
  const source = readFileSync(
    new URL(`../../backend/protocol/${group}.ts`, import.meta.url),
    'utf8'
  );
  const ast = ts.createSourceFile(`${group}.ts`, source, ts.ScriptTarget.Latest, true);
  for (const statement of ast.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.name.text.endsWith('Subcommands'))
        continue;
      assert.ok(declaration.initializer && ts.isObjectLiteralExpression(declaration.initializer));
      for (const property of declaration.initializer.properties) {
        assert.ok(ts.isPropertyAssignment(property));
        assert.ok(ts.isIdentifier(property.name) || ts.isStringLiteral(property.name));
        assert.ok(ts.isObjectLiteralExpression(property.initializer));
        backendCommands.set(property.name.text, property.initializer);
      }
    }
  }
}

test('help covers exactly the backend commands plus the two CLI-local commands', () => {
  assert.ok(backendCommands.size > 40);
  assert.deepEqual(
    [...SUPPORTED_PROTOCOL_SUBCOMMANDS].sort(),
    [...backendCommands.keys(), 'capture-change', 'changes'].sort()
  );
  const full = help();
  for (const command of SUPPORTED_PROTOCOL_SUBCOMMANDS) {
    assert.match(full, new RegExp(`^  ${command}\\s`, 'm'), `${command} is in the overview`);
    const scoped = help(command);
    assert.match(scoped, new RegExp(`^${command}:$`, 'm'));
    assert.match(scoped, /Purpose:/);
    assert.match(scoped, /Common flags:/);
    assert.match(scoped, /At most one may use - for stdin/);
    for (const other of SUPPORTED_PROTOCOL_SUBCOMMANDS.filter(name => name !== command)) {
      assert.doesNotMatch(scoped, new RegExp(`^${other}:$`, 'm'));
    }
  }
});

test('help documents every contract flag, including explicit notes for reserved inputs', () => {
  const contract = YAML.parse(
    readFileSync(new URL('../../contract/protocol-commands.yaml', import.meta.url), 'utf8')
  );
  function visit(value: Record<string, unknown>): void {
    for (const [name, spec] of Object.entries(value)) {
      if (!spec || typeof spec !== 'object' || Array.isArray(spec)) continue;
      const entry = spec as Record<string, unknown>;
      if (!('requiredFlags' in entry)) {
        visit(entry);
        continue;
      }
      const command = name.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);
      const output = help(command);
      for (const flag of [
        ...(entry.requiredFlags as string[]),
        ...((entry.optionalFlags ?? []) as string[])
      ]) {
        for (const token of flag.match(/--[a-z-]+/g) ?? []) {
          assert.ok(
            output.match(/--[a-z-]+/g)?.includes(token),
            `${command} must document ${token}`
          );
        }
      }
    }
  }
  visit(contract);
});

test('help covers flags read directly by each backend handler', () => {
  for (const [command, node] of backendCommands) {
    const outputFlags = new Set(help(command).match(/--[a-z-]+/g));
    function visit(child: ts.Node): void {
      if (ts.isStringLiteral(child) && /^--[a-z-]+$/.test(child.text)) {
        // Explicitly rejected compatibility alias, not a supported creation input.
        if (command === 'create' && child.text === '--inbox') return;
        assert.ok(outputFlags.has(child.text), `${command} must document ${child.text}`);
      }
      ts.forEachChild(child, visit);
    }
    visit(node);
  }
});

test('help states current project routing, artifact syntax, queue defaults and readiness output', () => {
  assert.match(help(), /require an explicit --project-id/);
  assert.doesNotMatch(help(), /--timeout|--artifacts-json|returns ok=true\|false/);
  assert.match(help('auth-status'), /ready, workspaceId/);
  assert.match(help('queue-objective'), /mission queue, falling back to the project default/);
  for (const command of ['deliver', 'record-work'])
    assert.match(help(command), /--artifacts <json>/);
  assert.match(help('attach'), /--capture-binding is transport metadata computed by the CLI/);
});

test('both scoped help forms are offline and agree for every command', async () => {
  const runtime = new Proxy(
    {},
    {
      get() {
        throw new Error('help accessed the runtime');
      }
    }
  ) as Parameters<typeof runProtocolCommand>[0]['runtime'];
  for (const command of SUPPORTED_PROTOCOL_SUBCOMMANDS) {
    for (const [subcommand, args] of [
      ['help', [command]],
      [command, ['--help']],
      [command, ['-h']]
    ] as const) {
      const lines: string[] = [];
      const original = console.log;
      console.log = (...values: unknown[]) => void lines.push(values.join(' '));
      try {
        await runProtocolCommand({ runtime, subcommand, args: [...args] });
      } finally {
        console.log = original;
      }
      assert.equal(lines.join('\n'), help(command));
    }
  }
});
