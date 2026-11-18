import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

/**
 * Replay-safe finalization through the protocol transport (coo:1297.hk2v,
 * ADR 0075): the operation id from a flag or the payload envelope, its
 * absence from the stored delivery payload, the replay and conflict answers,
 * and the delivery-receipt subcommand.
 */

const tempDir = mkdtempSync(path.join(tmpdir(), 'overlord-protocol-finalization-'));
const { bootstrapIntegrationTestDb } = await import('./test-helpers.ts');
await bootstrapIntegrationTestDb({ sqlitePath: path.join(tempDir, 'webapp.sqlite') });

const { requireDatabaseClient } = await import('./db.ts');
const { createMission, createProject } = await import('./repository.ts');
const { runProtocolSubcommand } = await import('./protocol.ts');

after(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

type DeliverResult = { deliveryId: string; operationId?: string; replayed?: true };
type ReceiptResult = {
  receipt: { deliveryId: string; operationId: string | null; result: DeliverResult };
};

async function attachedObjective(name: string) {
  const project = await createProject({ name: `${name} ${Date.now()}`, color: '#123456' });
  const mission = await createMission({ projectId: project.id, firstObjective: `${name} work` });
  const objective = mission.objectives[0]!;
  const attached = (await runProtocolSubcommand('attach', {
    flags: { '--objective-id': objective.displayId }
  })) as { sessionKey: string };
  return { project, mission, objective, sessionKey: attached.sessionKey };
}

function codeOf(error: unknown): string | undefined {
  return (error as { code?: string }).code;
}

test('deliver replays a flag operation id and keeps it out of the stored payload', async () => {
  const { objective, sessionKey } = await attachedObjective('Flag op');
  const body = {
    flags: {
      '--objective-id': objective.displayId,
      '--session-key': sessionKey,
      '--summary': 'Delivered.',
      '--operation-id': 'flag-op-00001',
      '--payload-json': JSON.stringify({
        operationId: 'ignored-by-flag',
        verificationSummary: 'ok'
      })
    }
  };
  const first = (await runProtocolSubcommand('deliver', body)) as DeliverResult;
  assert.equal(first.operationId, 'flag-op-00001', 'the flag wins over the envelope field');
  const replay = (await runProtocolSubcommand('deliver', body)) as DeliverResult;
  assert.equal(replay.deliveryId, first.deliveryId);
  assert.equal(replay.replayed, true);

  const stored = await requireDatabaseClient().get<{ payload_json: string }>(
    `SELECT payload_json FROM deliveries WHERE id = ?`,
    [first.deliveryId]
  );
  const payload = JSON.parse(stored!.payload_json) as Record<string, unknown>;
  assert.equal('operationId' in payload, false);

  const receipt = (await runProtocolSubcommand('delivery-receipt', {
    flags: { '--operation-id': 'flag-op-00001' }
  })) as ReceiptResult;
  assert.equal(receipt.receipt.deliveryId, first.deliveryId);
  assert.equal(receipt.receipt.result.deliveryId, first.deliveryId);

  await assert.rejects(
    runProtocolSubcommand('deliver', {
      flags: { ...body.flags, '--summary': 'A different summary.' }
    }),
    (error: unknown) => codeOf(error) === 'delivery_operation_conflict'
  );
  await assert.rejects(
    runProtocolSubcommand('deliver', {
      flags: { ...body.flags, '--operation-id': 'flag-op-00002' }
    }),
    (error: unknown) =>
      codeOf(error) === 'delivery_already_accepted' &&
      (error as { details?: { deliveryId?: string } }).details?.deliveryId === first.deliveryId
  );
});

test('record-work replays an envelope operation id and the receipt read needs exactly one key', async () => {
  const project = await createProject({ name: `Envelope op ${Date.now()}`, color: '#123456' });
  const body = {
    flags: { '--project-id': project.id, '--payload-file': true as const },
    fileInputs: {
      '--payload-file': JSON.stringify({
        objective: 'Wrote the retry note.',
        summary: 'Wrote the retry note.',
        operationId: 'envelope-op-001'
      })
    }
  };
  const first = (await runProtocolSubcommand('record-work', body)) as {
    mission: { id: string };
    deliveryId: string;
  };
  const replay = (await runProtocolSubcommand('record-work', body)) as {
    mission: { id: string };
    deliveryId: string;
    replayed?: true;
  };
  assert.equal(replay.mission.id, first.mission.id);
  assert.equal(replay.replayed, true);

  const receipt = (await runProtocolSubcommand('delivery-receipt', {
    flags: { '--operation-id': 'envelope-op-001', '--operation-kind': 'record_work' }
  })) as ReceiptResult;
  assert.equal(receipt.receipt.deliveryId, first.deliveryId);

  await assert.rejects(
    runProtocolSubcommand('delivery-receipt', { flags: {} }),
    (error: unknown) => codeOf(error) === 'invalid_input'
  );
  await assert.rejects(
    runProtocolSubcommand('delivery-receipt', { flags: { '--operation-id': 'unknown-op-0001' } }),
    (error: unknown) => codeOf(error) === 'delivery_receipt_not_found'
  );
});
