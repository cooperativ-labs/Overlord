# SSH Key Generation and Management

This document explains how Overlord currently generates, stores, installs, verifies, and reuses SSH credentials for remote server access.

The implementation described here is the current behavior in the mobile app and iOS native SSH module. It is not a generic SSH design doc. It reflects what the code does today.

## Scope

This flow is used by the mobile app when a user:

- adds a server in `SSH` mode
- verifies an existing server connection
- launches a ticket on a connected server
- installs a missing device key during ticket launch
- deletes a server from the device

This flow does not apply to the desktop app's project-level SSH workspace support. That path uses shell-wrapped system SSH commands instead of the mobile device key flow described here.

## High-Level Model

Overlord uses two different remote transports in the mobile app:

- `ssh`: standard SSH with a device-local keypair
- `tailscale_ssh`: password / compatibility-mode authentication without a device-local SSH key

For standard `ssh`, Overlord creates a device-specific P-256 keypair on iOS, installs the public key into the server's `~/.ssh/authorized_keys`, and stores only metadata needed to reuse that key later.

For `tailscale_ssh`, Overlord skips key generation and installation entirely. It verifies and launches by password-based authentication only.

## Where the Logic Lives

The end-to-end flow is split across these files:

- [apps/mobile/app/(tabs)/servers/add.tsx](/home/jchaselubitz/Development/Overlord/apps/mobile/app/(tabs)/servers/add.tsx)
- [apps/mobile/app/(tabs)/servers/[serverId]/index.tsx](/home/jchaselubitz/Development/Overlord/apps/mobile/app/(tabs)/servers/[serverId]/index.tsx)
- [apps/mobile/app/(tabs)/tickets/[ticketId]/index.tsx](/home/jchaselubitz/Development/Overlord/apps/mobile/app/(tabs)/tickets/[ticketId]/index.tsx)
- [apps/mobile/lib/server-device-credentials.ts](/home/jchaselubitz/Development/Overlord/apps/mobile/lib/server-device-credentials.ts)
- [apps/mobile/lib/remote-ticket-launch.ts](/home/jchaselubitz/Development/Overlord/apps/mobile/lib/remote-ticket-launch.ts)
- [apps/mobile/modules/ssh/src/index.ts](/home/jchaselubitz/Development/Overlord/apps/mobile/modules/ssh/src/index.ts)
- [apps/mobile/modules/ssh/ios/SSHKeyManager.swift](/home/jchaselubitz/Development/Overlord/apps/mobile/modules/ssh/ios/SSHKeyManager.swift)
- [apps/mobile/modules/ssh/ios/SSHClient.swift](/home/jchaselubitz/Development/Overlord/apps/mobile/modules/ssh/ios/SSHClient.swift)
- [apps/mobile/modules/ssh/ios/SSHFormats.swift](/home/jchaselubitz/Development/Overlord/apps/mobile/modules/ssh/ios/SSHFormats.swift)
- [apps/mobile/lib/types.ts](/home/jchaselubitz/Development/Overlord/apps/mobile/lib/types.ts)

## Platform Support

SSH key generation and installation are currently iOS-only in the mobile app.

- iOS exposes the native `SSH` Expo module.
- Android explicitly throws `SSH_UNSUPPORTED` for key generation, installation, verification, and remote command execution.
- The React Native wrapper exposes `isSSHSupported = Platform.OS === 'ios'`.

As a result, remote launch from the mobile ticket screen is currently limited to iOS.

## Key Type and Formatting

When Overlord generates a device key in `ssh` mode:

- the key type is ECDSA P-256
- the SSH algorithm string is `ecdsa-sha2-nistp256`
- the curve name is `nistp256`
- the displayed fingerprint is SHA-256 over the SSH wire-format public key blob

The public key is converted into OpenSSH `authorized_keys` format before it is shown in the UI or sent to the server for installation.

## Key Generation

Key generation starts in the add-server screen when the user selects `SSH` mode and taps the continue button.

The flow is:

1. The app creates a tag like `com.cooperativ.overlord.ssh.<timestamp>`.
2. The app calls `generateKey(tag)` in the native module.
3. The native iOS code deletes any existing key with the same tag first.
4. It attempts to create a permanent P-256 private key in the Secure Enclave.
5. If Secure Enclave is unavailable, it falls back to a software-backed Keychain key.
6. It extracts the public key, converts it to OpenSSH format, and computes a fingerprint.
7. The JS layer stores the returned values in component state until the server is saved.

## Secure Enclave vs Software Fallback

When Secure Enclave is available:

- the private key is created with `kSecAttrTokenIDSecureEnclave`
- the key is permanent
- the key is marked `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`
- access control includes `.privateKeyUsage`
- access control includes `.biometryCurrentSet`

That means the private key is hardware-backed and tied to the current biometric set on the device.

When Secure Enclave is not available:

- the same P-256 key is generated in the normal Keychain
- it is still stored as `WhenUnlockedThisDeviceOnly`
- it is not hardware-backed

The UI surfaces this difference through `isHardwareBacked`.

## What Is Stored Locally on the Device

Overlord stores two different local things for a server in `ssh` mode.

### 1. The private key

The private key itself stays in the iOS Security subsystem, referenced by its application tag.

Overlord does not export or persist the private key material into app-managed storage.

### 2. Server credential metadata

After a server record is saved, Overlord stores a `DeviceServerCredential` object in Expo SecureStore:

- `serverId`
- `keyTag`
- `publicKey`
- `publicKeyFingerprint`
- `isHardwareBacked`
- `createdAt`

SecureStore is configured with:

- `requireAuthentication: true`
- `keychainAccessible: WHEN_UNLOCKED_THIS_DEVICE_ONLY`

Reading or writing this metadata requires device authentication.

This metadata is what lets the app map a server record back to the correct Keychain / Secure Enclave key on that specific phone.

## What Is Stored in Supabase

The `servers` table stores connection state, not private key material.

The relevant fields are:

- `label`
- `host`
- `port`
- `username`
- `transport`
- `host_key_fingerprint`
- `status`
- `last_error`
- `last_connected_at`
- `last_verified_at`

No private key bytes are stored in Supabase.

## Server Add Flow in `ssh` Mode

When a user adds a server in standard SSH mode, the flow is:

1. Generate a device-specific keypair.
2. Show the generated public key and fingerprint in the UI.
3. Ask for the server password once.
4. Use password-based SSH to connect to the server.
5. Ensure `~/.ssh` exists and has the right permissions.
6. Ensure `~/.ssh/authorized_keys` exists and has the right permissions.
7. Append the public key to `authorized_keys` only if it is not already present.
8. Attempt a second connection using the device key.
9. Run `ovld --version` on the server as the verification check.
10. Save the server record and device credential metadata.

The install command run on the server is effectively:

```sh
mkdir -p ~/.ssh &&
chmod 700 ~/.ssh &&
touch ~/.ssh/authorized_keys &&
chmod 600 ~/.ssh/authorized_keys &&
grep -qxF '<public-key>' ~/.ssh/authorized_keys || echo '<public-key>' >> ~/.ssh/authorized_keys
```

The password is used only for the installation / verification step in memory. The add-server flow does not persist it.

## Verification During Server Add

After installation, the app calls `verifyConnection(...)`.

For `ssh` transport, verification:

- connects to the host
- performs SSH handshake
- extracts the host key fingerprint
- authenticates with the generated device key
- runs `ovld --version`
- returns the host key fingerprint and, when available, the CLI version string

If verification succeeds, the server is stored as:

- `status = connected`
- `host_key_fingerprint = <returned fingerprint>`
- `last_connected_at = now`
- `last_verified_at = now`
- `last_error = null`

If public-key verification fails after installation, the server may still be saved in an error state with the returned installation fingerprint and a stored error message.

The user can also save the server without installing or verifying anything. In that case, the server is stored as `pending`.

## `tailscale_ssh` Flow

`tailscale_ssh` behaves differently by design:

- no device key is generated
- no public key is installed
- no SecureStore device credential is saved
- verification uses password-based authentication only

The app accepts either:

- the server password
- or a placeholder value for Tailscale's `username+password` compatibility mode

The iOS SSH client tries multiple authentication strategies:

- normal password auth
- keyboard-interactive auth
- if the host looks like a Tailscale host, `username+password` variants for both methods

Tailscale-like hosts are detected by:

- `*.ts.net`
- `100.64.0.0/10` tailnet IPv4 addresses

## Remote Ticket Launch with an Existing Device Key

When the ticket detail screen launches work on a connected server:

1. The app loads the saved `DeviceServerCredential` from SecureStore.
2. It uses the stored `keyTag` to find the private key in the Keychain / Secure Enclave.
3. It creates or reuses an Overlord agent token.
4. It builds a remote shell command that exports:
   - `OVERLORD_URL`
   - `AGENT_TOKEN`
   - `TICKET_ID`
5. It starts the agent inside `tmux` by running `ovld connect <agent> --ticket-id <ticket-id>`.

The remote launcher also sources common shell profiles so that `node`, `nvm`, and `ovld` are more likely to exist on the remote PATH.

## Installing a Missing Key During Ticket Launch

If the user tries to launch from a ticket screen and this device has no saved credential for that server:

1. The app prompts for the server password.
2. It generates a new device key.
3. It installs the public key into `authorized_keys`.
4. It tries public-key verification.
5. It saves the device credential metadata even if public-key verification fails.
6. It updates the server record to `connected`.
7. It launches with key-based auth if that verification succeeded.
8. Otherwise it falls back to password-based launch.

This fallback exists because some Tailscale-backed environments may allow password / compatibility-based launch even when the newly installed public key is not accepted immediately or at all.

## How Public-Key Authentication Works on iOS

Overlord does not export the private key and hand it to libssh2 as a file.

Instead:

1. The app loads the `SecKey` private key by tag.
2. It builds the SSH public-key blob for `ecdsa-sha2-nistp256`.
3. It gives libssh2 a signing callback.
4. When libssh2 needs a signature during auth, the callback asks `SecKeyCreateSignature(...)` to sign the challenge.
5. The DER-encoded ECDSA signature is converted into SSH wire format before returning it to libssh2.

For Secure Enclave keys, signing can require biometric authentication because of the access control flags used at key creation time.

## Host Key Fingerprints and Pinning

The SSH client computes the server host key fingerprint as:

- raw server host key from `libssh2_session_hostkey(...)`
- SHA-256 hash of those bytes
- OpenSSH-style `SHA256:<base64-without-padding>`

That fingerprint is stored in `servers.host_key_fingerprint`.

### Important current behavior

The code does not enforce host-key matching uniformly across all flows.

Current behavior is:

- `runCommand(...)` does enforce `expectedHostKeyFingerprint` and throws on mismatch
- `verifyConnection(...)` currently accepts `expectedHostKeyFingerprint` as a parameter but does not compare it before proceeding
- server verification screens therefore refresh and persist the latest observed host fingerprint rather than rejecting a changed host key

So the practical model today is:

- first successful verify / install records the host fingerprint
- remote command execution enforces that pinned fingerprint
- explicit re-verification can overwrite the stored fingerprint instead of treating a change as a hard failure

That behavior matters when reasoning about trust-on-first-use versus strict pinning.

## Verification Semantics

Verification is not just "can TCP connect".

A successful verification means:

- TCP connection succeeded
- SSH handshake succeeded
- authentication succeeded
- `ovld --version` could be executed

If `ovld --version` fails, the native code currently returns the connection result without a version string instead of failing the entire verification call.

That means:

- transport and authentication can be marked as working
- but the remote server may still have an incomplete or missing Overlord CLI install

The UI copy describes verification as checking that `ovld` is installed, but the implementation is slightly softer than that because missing version output does not automatically make the whole verification call fail.

## Deletion and Cleanup

When a server is deleted from the server detail screen in `ssh` mode:

- the app deletes the private key from the Keychain / Secure Enclave using the stored `keyTag`
- it deletes the SecureStore `DeviceServerCredential`
- it deletes the server row from Supabase

This does not remove the public key from the remote server's `authorized_keys`.

Server deletion is therefore local cleanup plus record deletion, not remote key revocation.

## Failure Modes to Expect

Common failure cases based on the current implementation:

- key generation fails because the iOS Security API returns an error
- the server password is wrong
- the server requires a different auth method
- the host is reachable but `ovld` is not on PATH
- the host key changes between verification and launch, causing remote command execution to fail on fingerprint mismatch
- a server is re-added from a different phone, but the original phone's device-local key is still the only key it can use
- a server exists in Supabase but this device has no matching local credential, so launch requires reinstallation

## Device-Local Nature of the Credential Model

The credential model is intentionally device-local.

That means:

- each phone generates its own SSH key
- the private key never leaves that device
- another phone cannot reuse the same `keyTag`
- syncing the server record through Supabase does not sync the private key

This is why the UI tells the user to re-add the server from the current phone if the device key is missing.

## Summary

For standard SSH mode, Overlord's current design is:

- generate a device-specific P-256 key on iOS
- prefer Secure Enclave and fall back to software Keychain storage
- install only the public key on the server
- store server metadata in Supabase
- store device credential metadata in SecureStore
- keep private key material inside iOS key storage
- reuse the key for future verification and remote command execution

For Tailscale SSH mode, the design is:

- skip device-key lifecycle entirely
- use password / compatibility authentication
- store only server-level connection state

If you are changing this system, review the files listed above together. The user-visible behavior is spread across the React Native screens, the SecureStore credential layer, and the iOS native SSH implementation.
