import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  formatAgentHarnessText,
  parseTaskNotifications,
  presentAgentHarnessText
} from './agent-harness-text.ts';
import { resolveEventPresentation } from './mission-feed.ts';

const FAILED_NOTIFICATION = `<task-notification>
<task-id>bkyymj8kz</task-id>
<tool-use-id>toolu_011oumgp8dmrJSCnqnhgKaH7</tool-use-id>
<output-file>/private/tmp/claude-501/tasks/bkyymj8kz.output</output-file>
<status>failed</status>
<summary>Background command "Probe Codex MCP config discovery variants" failed with exit code 144</summary>
</task-notification>`;

describe('parseTaskNotifications', () => {
  it('extracts every field of a notification block', () => {
    assert.deepEqual(parseTaskNotifications(FAILED_NOTIFICATION), [
      {
        taskId: 'bkyymj8kz',
        toolUseId: 'toolu_011oumgp8dmrJSCnqnhgKaH7',
        outputFile: '/private/tmp/claude-501/tasks/bkyymj8kz.output',
        status: 'failed',
        summary:
          'Background command "Probe Codex MCP config discovery variants" failed with exit code 144'
      }
    ]);
  });
});

describe('presentAgentHarnessText', () => {
  it('replaces a lone notification with its summary and flags it as a harness message', () => {
    const result = presentAgentHarnessText(FAILED_NOTIFICATION);
    assert.equal(
      result.text,
      'Background command "Probe Codex MCP config discovery variants" failed with exit code 144'
    );
    assert.equal(result.notification?.label, 'Background task failed');
    assert.equal(result.notification?.tone, 'failure');
  });

  it('falls back to the task id and status when the harness wrote no summary', () => {
    const result = presentAgentHarnessText(
      '<task-notification><task-id>abc</task-id><status>completed</status></task-notification>'
    );
    assert.equal(result.text, 'Background task abc completed');
    assert.equal(result.notification?.label, 'Background task completed');
    assert.equal(result.notification?.tone, 'success');
  });

  it('summarizes several notifications and lists each on its own line', () => {
    const second =
      '<task-notification><status>completed</status><summary>Build finished</summary></task-notification>';
    const result = presentAgentHarnessText(`${FAILED_NOTIFICATION}\n${second}`);
    assert.equal(result.notification?.label, '2 background task updates');
    assert.equal(result.notification?.tone, 'failure');
    assert.equal(result.text.split('\n').length, 2);
  });

  it('keeps user text around a notification and does not flag it as harness-only', () => {
    const result = presentAgentHarnessText(`please retry that\n${FAILED_NOTIFICATION}`);
    assert.equal(result.notification, null);
    assert.match(result.text, /^please retry that\nBackground command/);
  });

  it('drops system reminders and collapses slash-command tags', () => {
    const raw =
      '<command-message>review</command-message>\n<command-name>/review</command-name>\n<command-args>PR 12</command-args>\n<system-reminder>ignore me</system-reminder>';
    assert.deepEqual(presentAgentHarnessText(raw), { text: '/review PR 12', notification: null });
  });

  it('leaves ordinary text untouched', () => {
    assert.equal(formatAgentHarnessText('Use a < b comparison'), 'Use a < b comparison');
    assert.equal(formatAgentHarnessText('Ran the suite.'), 'Ran the suite.');
  });
});

describe('resolveEventPresentation', () => {
  it('never presents a relayed task notification as a user follow-up', () => {
    const result = resolveEventPresentation({
      type: 'user_follow_up',
      summary: FAILED_NOTIFICATION
    });
    assert.equal(result.isFollowUp, false);
    assert.equal(result.notification?.label, 'Background task failed');
  });

  it('still presents real follow-ups as follow-ups', () => {
    assert.deepEqual(resolveEventPresentation({ type: 'user_follow_up', summary: 'ship it' }), {
      isFollowUp: true,
      summary: 'ship it',
      notification: null
    });
  });
});

describe('presentAgentHarnessText with a truncated preview', () => {
  it('falls back to a readable line when the block is cut off before its summary', () => {
    const cut =
      '<task-notification> <task-id>b8qbnfmj5</task-id> <tool-use-id>toolu_014V9hT1kXJ8R8HG4cZgz4a5</tool-use-id> <output-…';
    const result = presentAgentHarnessText(cut);
    assert.equal(result.text, 'Background task updated');
    assert.equal(result.notification?.label, 'Background task updated');
  });
});
