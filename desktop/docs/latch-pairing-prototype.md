# Desktop Latch pairing prototype

**Contract impact: none.** This prototype exercised existing Latch interfaces in an isolated fixture. Overlord 182.9.0 continues to serve desktop project Git and Files through the registered-runner surface.

## Same-Mac results

On an Apple Silicon Mac, Electron main created a disposable X25519 controller identity, encrypted it with `safeStorage`, and reloaded it from a mode-0600 file. It recovered the same public key and passed the private key to a Swift helper over stdin. The prototype started no renderer.

The Swift helper used Latch’s macOS native transport and typed gateway client. An isolated host fixture used Latch’s grant store and gateway with a disposable checkout and a single shared root. The fixture seeded the grant. Owner-approved enrollment and directory lookup were outside that run.

| Check | Result |
| --- | --- |
| Host identity | Latch rejected the wrong pinned host key. The same endpoint accepted the correct pin. |
| Scoped reads | Exact worktree status and a tracked file diff succeeded. The gateway rejected a nested directory as a worktree root. Directory listing and text preview succeeded through the explicit shared-root ID. |
| Reconnect | A fresh helper process reopened the same checkout with the restored controller identity and repeated the reads. |
| Host revocation | The already-connected helper received zero protected data from its next read. Its request timed out at the probe’s request deadline. Startup of a new host link for that controller failed with `revoked controller`. |
| Relay transport | Nine Latch tests passed separately. They covered native TLS WSS to an authorized gateway, relay loss, replacement, and reconnect with a fresh admission. |

The native LAN client rejects loopback destinations by design. The same-Mac test used the Mac’s private interface and kept the plaintext gateway on loopback. A scratch fixture initially created the host secret in one ad-hoc executable and read it from another. Sampling found the second process waiting in macOS Keychain. The passing run created and used the fixture’s host identity in the same executable.

## Release gate

The installed `latch-remote` executable offers host and gateway commands. Overlord’s desktop bundle has no controller helper. Latch’s reusable Swift controller compiles for macOS after building the native archive, but its enrollment request identifies the client as `ios`. A desktop build needs a versioned, signed macOS controller and owner-approved enrollment that registers a distinct desktop pairing. The current fixture confirms that the carrier can authenticate and read after a grant exists.

Host-local revocation blocked disclosure in the fixture, but the open LAN connection surfaced a timeout. The desktop integration needs to observe the current directory grant and invalidate its read generation on revocation, including while a request is pending. Prove that transition with the packaged controller and owner-approved pairing before adding renderer calls.

The paired bridge should use the current account, project, and resource source revision to resolve a verified host and explicit Files share. Trusted native code should recheck that scope and the live grant before returning each bounded read. ADRs 0109 and 0110 define the project-side binding. ADR 0111 governs the existing runner path.

`yarn contract:check` and `yarn check:conformance-versions` passed. The prototype did not exercise a distributed Overlord build, project permission changes, or the hosted control plane.
