import { buildInvitationEmailContent } from '@/lib/actions/invitations';

describe('buildInvitationEmailContent', () => {
  it('renders branded invite email content with escaped org details', async () => {
    const content = await buildInvitationEmailContent({
      to: 'new.user@example.com',
      inviterName: 'Jane & Co <Admin>',
      orgName: 'R&D "Skunkworks" > Alpha',
      role: 'MANAGER',
      token: 'invite-token-123'
    });

    expect(content.subject).toBe(
      'You\'ve been invited to join R&D "Skunkworks" > Alpha on Overlord'
    );
    expect(content.text).toContain(
      'Jane & Co <Admin> has invited you to join R&D "Skunkworks" > Alpha on Overlord as MANAGER.'
    );
    expect(content.text).toContain('Can manage projects, members, and agent sessions.');
    expect(content.text).toContain('/invite/invite-token-123');

    expect(content.html).toContain('WORKSPACE INVITE');
    expect(content.html).toContain('Join R&amp;D &quot;Skunkworks&quot; &gt; Alpha on Overlord.');
    expect(content.html).toContain('Jane &amp; Co &lt;Admin&gt;');
    expect(content.html).toContain('>MANAGER</span');
    expect(content.html).toContain('Accept Invite&nbsp;&rarr;');
    expect(content.html).toContain('https://');
    expect(content.html).toContain('/invite/invite-token-123');
  });

  it('includes a CLI self-onboarding block with the install + onboard commands and code', async () => {
    const content = await buildInvitationEmailContent({
      to: 'agent@example.com',
      inviterName: 'Jane',
      orgName: 'Acme',
      role: 'AGENT',
      token: 'invite-token-123'
    });

    // text/plain part — agents extract the token deterministically from here.
    expect(content.text).toContain('npm install -g overlord-cli');
    expect(content.text).toContain('ovld onboard --invite invite-token-123');
    expect(content.text).toContain('Invitation code: invite-token-123');

    // html part — labeled block + copyable command/code.
    expect(content.html).toContain('For AI Agents');
    expect(content.html).toContain('npm install -g overlord-cli');
    expect(content.html).toContain('ovld onboard --invite invite-token-123');
  });

  it('escapes the invitation token in the HTML block', async () => {
    const content = await buildInvitationEmailContent({
      to: 'agent@example.com',
      inviterName: 'Jane',
      orgName: 'Acme',
      role: 'AGENT',
      token: 'a&b<c>'
    });

    expect(content.html).toContain('a&amp;b&lt;c&gt;');
    expect(content.html).not.toContain('a&b<c>');
  });
});
