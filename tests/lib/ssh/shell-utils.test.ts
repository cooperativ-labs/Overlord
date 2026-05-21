import {
  buildRemoteTmuxCommand,
  parseShellCommand,
  parseSshCommand,
  shellEscape
} from '@/lib/ssh/shell-utils';

describe('ssh shell utilities', () => {
  describe('parseShellCommand', () => {
    it('splits shell-like commands while preserving quoted values', () => {
      expect(parseShellCommand("ssh -i '~/.ssh/key file' user@example.com")).toEqual([
        'ssh',
        '-i',
        '~/.ssh/key file',
        'user@example.com'
      ]);
      expect(parseShellCommand('ssh -o "ProxyCommand ssh jump nc %h %p" host')).toEqual([
        'ssh',
        '-o',
        'ProxyCommand ssh jump nc %h %p',
        'host'
      ]);
    });

    it('handles escaped spaces and rejects malformed quoting', () => {
      expect(parseShellCommand('ssh user@my\\ host')).toEqual(['ssh', 'user@my host']);
      expect(() => parseShellCommand("ssh 'unterminated")).toThrow('Unterminated quoted string');
    });
  });

  it('injects forced TTY allocation only when no tty flag exists', () => {
    expect(parseSshCommand('ssh host', { forceTty: true })).toEqual(['ssh', '-tt', 'host']);
    expect(parseSshCommand('ssh -t host', { forceTty: true })).toEqual(['ssh', '-t', 'host']);
    expect(parseSshCommand('ssh -tt -p 2222 host', { forceTty: true })).toEqual([
      'ssh',
      '-tt',
      '-p',
      '2222',
      'host'
    ]);
  });

  it('escapes shell values and wraps remote tmux templates', () => {
    expect(shellEscape("it's fine")).toBe("'it'\\''s fine'");
    expect(buildRemoteTmuxCommand('echo ok', 'tmux new-session {script}')).toBe(
      "tmux new-session 'bash -lc '\\''echo ok'\\'''"
    );
    expect(buildRemoteTmuxCommand('echo ok', 'tmux new-session bash {script}')).toBe(
      "tmux new-session bash -lc 'echo ok'"
    );
  });
});
