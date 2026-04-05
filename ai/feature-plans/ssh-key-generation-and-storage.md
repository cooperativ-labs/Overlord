# SSH Key Generation & On-Device Storage — Implementation Plan (Rebuild)

## Overview

Build a new native Expo module from scratch that generates SSH key pairs on-device (private key stays in iOS Secure Enclave or Keychain), and provides SSH connectivity for installing the public key on remote servers and verifying connections.

The previous `secure-enclave-ssh` module was deleted because it was not working. This plan starts fresh.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  apps/mobile/modules/ssh/                               │
│                                                         │
│  ├── expo-module.config.json       (module registration)│
│  ├── index.ts                      (JS re-exports)     │
│  ├── src/index.ts                  (TS bindings + types)│
│  └── ios/                                               │
│      ├── SSHModule.podspec         (CocoaPods spec)     │
│      ├── SSHModule.swift           (Expo module def)    │
│      ├── SSHKeyManager.swift       (key gen/delete)     │
│      ├── SSHClient.swift           (connection logic)   │
│      └── SSHFormats.swift          (OpenSSH encoding)   │
└─────────────────────────────────────────────────────────┘
         │
         │  imports
         ▼
┌─────────────────────────────────────────────────────────┐
│  lib/server-device-credentials.ts  (existing)           │
│  - Stores DeviceServerCredential in expo-secure-store   │
│  - Key: overlord.server-credential.{serverId}           │
│  - Stores: keyTag, publicKey, fingerprint, etc.         │
└─────────────────────────────────────────────────────────┘
         │
         │  used by
         ▼
┌─────────────────────────────────────────────────────────┐
│  app/(tabs)/servers/add.tsx        (add server flow)    │
│  app/(tabs)/servers/[serverId]/    (server detail)      │
└─────────────────────────────────────────────────────────┘
```

---

## Component 1: SSH Key Management (Native Swift)

### File: `ios/SSHKeyManager.swift`

Handles all cryptographic key operations using the iOS Security framework.

### Key Generation

- **Algorithm**: ECDSA P-256 (secp256r1) — widely supported by SSH servers, compatible with Secure Enclave
- **Primary path**: Secure Enclave (`kSecAttrTokenIDSecureEnclave`) — private key is hardware-bound and non-exportable
- **Fallback path**: Software Keychain — for simulators and older devices without Secure Enclave
- **Key storage**: Permanent in Keychain, tagged with `kSecAttrApplicationTag` for lookup
- **Access control**: `kSecAttrAccessibleWhenUnlockedThisDeviceOnly` — key cannot migrate to other devices, only usable when device is unlocked

### API

```swift
// Generate a new ECDSA P-256 key pair
// Prefers Secure Enclave, falls back to software Keychain
func generateKey(tag: String) -> (publicKey: SecKey, isHardwareBacked: Bool)

// Load existing private key from Keychain by tag
func loadKey(tag: String) -> SecKey?

// Delete a key from Keychain by tag
func deleteKey(tag: String) -> Bool

// Sign data with the private key (for SSH auth challenge-response)
func sign(tag: String, data: Data) -> Data
```

### Implementation Notes

- Use `SecKeyCreateRandomKey` with attributes dictionary
- For Secure Enclave: include `kSecAttrTokenID: kSecAttrTokenIDSecureEnclave` and `SecAccessControlCreateWithFlags` with `.privateKeyUsage`
- For software fallback: omit `kSecAttrTokenID`, use `kSecAttrAccessible` instead of access control
- Delete existing key with same tag before generating (idempotent)
- Use `SecKeyCopyPublicKey` to extract the public key from the private key reference
- Use `SecKeyCopyExternalRepresentation` to get raw public key bytes (uncompressed EC point: `0x04 || x || y`, 65 bytes for P-256)
- Use `SecKeyCreateSignature` with `.ecdsaSignatureMessageX962SHA256` for signing

---

## Component 2: SSH Format Conversion (Native Swift)

### File: `ios/SSHFormats.swift`

Converts between iOS Security framework key representations and OpenSSH wire formats.

### Public Key to OpenSSH Format

The SSH wire format for `ecdsa-sha2-nistp256` is:
```
[uint32 len]["ecdsa-sha2-nistp256"][uint32 len]["nistp256"][uint32 len][EC point bytes]
```

Base64-encode the wire data and prepend the key type:
```
ecdsa-sha2-nistp256 AAAA...base64...
```

### Fingerprint Computation

SHA-256 hash of the SSH wire format bytes, base64-encoded with `SHA256:` prefix:
```
SHA256:abc123...
```

Matches the output of `ssh-keygen -l -f key.pub`.

### Implementation

```swift
extension Data {
    mutating func appendSSHString(_ string: String)  // uint32 length + UTF-8 bytes
    mutating func appendSSHBytes(_ bytes: Data)       // uint32 length + raw bytes
}

func publicKeyToOpenSSH(publicKey: SecKey) throws -> String
func publicKeyFingerprint(publicKey: SecKey) -> String
```

---

## Component 3: SSH Client (Native Swift)

### File: `ios/SSHClient.swift`

Handles SSH connections for two operations: installing a public key on a server, and verifying a connection.

### SSH Library Decision

| Option | Pros | Cons |
|--------|------|------|
| **libssh2** (C, vendored xcframework) | Battle-tested, well-documented, supports all auth methods | Must build/vendor binary for each architecture (arm64, x86_64 simulator) |
| **SwiftNIO SSH** (pure Swift, SPM) | Apple-maintained, pure Swift, no vendored binaries | Requires Swift 6.0+ (project is on 5.0), more complex API, designed as building blocks not a ready-made client |
| **Network.framework + raw SSH protocol** | No dependencies | Enormous effort to implement SSH protocol from scratch |

**Recommendation: libssh2 via a prebuilt xcframework.**

libssh2 is the standard choice for SSH on iOS. The key is getting a properly built xcframework. Options for obtaining it:

1. **Build from source** using a build script (e.g., [libssh2-for-iOS](https://github.com/libssh2/libssh2) with custom build scripts targeting `ios-arm64` and `ios-arm64_x86_64-simulator`)
2. **Use a prebuilt binary** from a trusted source like the [libssh2-apple](https://github.com/pocketssh/libssh2-apple) project
3. **Swift Package Manager** — some SPM packages wrap libssh2 (e.g., `Cityssh2`)

The xcframework should include slices for:
- `ios-arm64` (physical devices)
- `ios-arm64_x86_64-simulator` (simulators)

### SSH Operations

#### `installPublicKey`

1. Resolve host DNS via `CFHostCreateWithName` / `CFHostStartInfoResolution`
2. Open TCP socket via `CFSocketCreate` + `CFSocketConnectToAddress`
3. Initialize libssh2 session: `libssh2_session_init()`, `libssh2_session_handshake()`
4. Extract host key fingerprint: `libssh2_session_hostkey()` → SHA-256 hash
5. Authenticate with password: `libssh2_userauth_password_ex()`
   - Fallback to keyboard-interactive: `libssh2_userauth_keyboard_interactive_ex()`
   - For Tailscale: try `username+password` variant
6. Open channel: `libssh2_channel_open_session()`
7. Execute: `mkdir -p ~/.ssh && chmod 700 ~/.ssh && ... >> ~/.ssh/authorized_keys`
8. Read output, check exit status
9. Cleanup: close channel, disconnect session, close socket

#### `verifyConnection`

1. Same connection setup as install (steps 1-4)
2. Authenticate with public key: `libssh2_userauth_publickey()`
   - Provide a callback that calls `SSHKeyManager.sign(tag:data:)` to sign the challenge using the Secure Enclave key
   - Or for Tailscale SSH: use password auth
3. Open channel, execute `ovld --version`
4. Return `{ hostKeyFingerprint, ovldVersion }`
5. Cleanup

### Key Challenge: Public Key Authentication with Secure Enclave

libssh2's `libssh2_userauth_publickey()` requires a signing callback. The flow:
1. libssh2 sends the public key blob to the server
2. Server sends back a challenge
3. Our callback signs the challenge using the Secure Enclave private key via `SecKeyCreateSignature`
4. libssh2 sends the signature back

This is the critical integration point — the Secure Enclave private key never leaves the hardware, so we must sign in-place via the callback.

```c
// libssh2 signing callback signature:
int sign_callback(LIBSSH2_SESSION *session,
                  unsigned char **sig, size_t *sig_len,
                  const unsigned char *data, size_t data_len,
                  void **abstract);
```

The callback must:
1. Get the `SecKey` reference from the `abstract` context
2. Call `SecKeyCreateSignature(.ecdsaSignatureMessageX962SHA256, data)`
3. Convert the DER-encoded signature to SSH wire format (two MPINTs: r, s)
4. Return the signature via `sig` and `sig_len`

**Note**: SSH expects the signature in a specific format (`ecdsa-sha2-nistp256` signature blob), not raw DER. The conversion is:
```
[uint32 len]["ecdsa-sha2-nistp256"][uint32 len][uint32 len][r bytes][uint32 len][s bytes]
```

---

## Component 4: Expo Module Definition (Native Swift)

### File: `ios/SSHModule.swift`

```swift
import ExpoModulesCore

public class SSHModule: Module {
  public func definition() -> ModuleDefinition {
    Name("SSH")

    Function("isSecureEnclaveAvailable") { () -> Bool in
      SecureEnclave.isAvailable
    }

    AsyncFunction("generateKey") { (tag: String) -> [String: Any] in
      // Generate key, return { tag, publicKeyOpenSSH, fingerprint, isHardwareBacked }
    }

    Function("deleteKey") { (tag: String) -> Bool in
      // Delete key from Keychain
    }

    AsyncFunction("installPublicKey") {
      (host: String, port: Int, username: String, password: String, publicKey: String)
      -> [String: Any] in
      // SSH connect with password, install key, return { success, hostKeyFingerprint }
    }

    AsyncFunction("verifyConnection") {
      (params: [String: Any]) -> [String: Any] in
      // SSH connect (key or password), run ovld --version
      // return { hostKeyFingerprint, ovldVersion }
    }
  }
}
```

---

## Component 5: TypeScript Bindings

### File: `src/index.ts`

```typescript
import { requireNativeModule } from 'expo-modules-core';

export interface SSHKeyResult {
  tag: string;
  publicKeyOpenSSH: string;
  fingerprint: string;
  isHardwareBacked: boolean;
}

export interface SSHInstallResult {
  success: boolean;
  hostKeyFingerprint: string;
}

export interface VerifyConnectionParams {
  host: string;
  port: number;
  username: string;
  transport: 'ssh' | 'tailscale_ssh';
  keyTag?: string;
  password?: string;
  expectedHostKeyFingerprint?: string | null;
}

export interface VerifyConnectionResult {
  hostKeyFingerprint: string;
  ovldVersion?: string;
}

const SSHNative = requireNativeModule('SSH');

export function isSecureEnclaveAvailable(): boolean {
  return SSHNative.isSecureEnclaveAvailable();
}

export async function generateKey(tag: string): Promise<SSHKeyResult> {
  return SSHNative.generateKey(tag);
}

export function deleteKey(tag: string): boolean {
  return SSHNative.deleteKey(tag);
}

export async function installPublicKey(
  host: string,
  port: number,
  username: string,
  password: string,
  publicKey: string
): Promise<SSHInstallResult> {
  return SSHNative.installPublicKey(host, port, username, password, publicKey);
}

export async function verifyConnection(
  params: VerifyConnectionParams
): Promise<VerifyConnectionResult> {
  return SSHNative.verifyConnection(params);
}
```

### File: `index.ts`

```typescript
export {
  isSecureEnclaveAvailable,
  generateKey,
  deleteKey,
  installPublicKey,
  verifyConnection,
} from './src/index';

export type {
  SSHKeyResult,
  SSHInstallResult,
  VerifyConnectionParams,
  VerifyConnectionResult,
} from './src/index';
```

---

## Component 6: Module Configuration

### File: `expo-module.config.json`

```json
{
  "platforms": ["ios"],
  "ios": {
    "modules": ["SSHModule"]
  }
}
```

### File: `ios/SSHModule.podspec`

```ruby
Pod::Spec.new do |s|
  s.name           = 'SSHModule'
  s.version        = '1.0.0'
  s.summary        = 'SSH key generation and connection module for Overlord'
  s.homepage       = 'https://github.com/cooperativ/overlord'
  s.license        = 'MIT'
  s.author         = 'Cooperativ'
  s.platform       = :ios, '15.1'
  s.source         = { git: '' }
  s.source_files   = '**/*.swift'
  s.swift_version  = '5.4'
  s.dependency 'ExpoModulesCore'

  # libssh2 — for SSH connections
  # Option A: Vendored xcframework
  s.vendored_frameworks = 'Vendor/ssh2.xcframework'
  s.preserve_paths      = 'Vendor/**'

  # Option B: If using a CocoaPods-distributed libssh2:
  # s.dependency 'libssh2'
end
```

---

## File Structure

```
apps/mobile/modules/ssh/
├── expo-module.config.json
├── index.ts
├── src/
│   └── index.ts
└── ios/
    ├── SSHModule.podspec
    ├── SSHModule.swift          # Expo module definition (Name, Functions)
    ├── SSHKeyManager.swift      # Secure Enclave/Keychain key operations
    ├── SSHFormats.swift          # OpenSSH wire format + fingerprints
    ├── SSHClient.swift           # libssh2 wrapper (connect, auth, exec)
    └── Vendor/
        └── ssh2.xcframework/     # Prebuilt libssh2
            ├── Info.plist
            ├── ios-arm64/
            │   └── libssh2.a
            └── ios-arm64_x86_64-simulator/
                └── libssh2.a
```

---

## Changes to Existing Files

### `app/(tabs)/servers/add.tsx`

Update import path:
```diff
- import { generateKey, installPublicKey, verifyConnection } from '@/modules/secure-enclave-ssh';
+ import { generateKey, installPublicKey, verifyConnection } from '@/modules/ssh';
```

### `app/(tabs)/servers/[serverId]/index.tsx`

Update import path:
```diff
- import { deleteKey, verifyConnection } from '@/modules/secure-enclave-ssh';
+ import { deleteKey, verifyConnection } from '@/modules/ssh';
```

### `lib/server-device-credentials.ts`

No changes needed — already uses `expo-secure-store` correctly.

### `lib/types.ts`

No changes needed — `DeviceServerCredential` interface already has the right shape.

---

## Implementation Order

| Phase | Task | Estimated Complexity |
|-------|------|---------------------|
| 1 | Scaffold module (`expo-module.config.json`, podspec, TS bindings) | Low |
| 2 | `SSHKeyManager.swift` — key generation with Secure Enclave + fallback | Medium |
| 3 | `SSHFormats.swift` — OpenSSH format conversion + fingerprint | Medium |
| 4 | Obtain/build `libssh2.xcframework` for iOS | Medium (build script) |
| 5 | `SSHClient.swift` — password auth, key installation, host key extraction | High |
| 6 | `SSHClient.swift` — public key auth with Secure Enclave signing callback | High |
| 7 | `SSHClient.swift` — `verifyConnection` (key-based or password + `ovld --version`) | Medium |
| 8 | `SSHModule.swift` — wire everything into Expo module definition | Low |
| 9 | Update import paths in server screens | Low |
| 10 | `pod install`, build, test on simulator (software keys) | Low |
| 11 | Test on physical device (Secure Enclave) | Low |

---

## Key Differences from Previous Module

| Aspect | Previous Module | New Module |
|--------|----------------|------------|
| Module name | `SecureEnclaveSSH` | `SSH` |
| Directory | `modules/secure-enclave-ssh/` | `modules/ssh/` |
| SSH client | ObjC wrapper (`OVLDSSHKeyInstaller`) around libssh2 | Pure Swift wrapper around libssh2 |
| `verifyConnection` | Not implemented (imported but missing) | Implemented from the start |
| Host key fingerprint | Not extracted during install | Extracted via `libssh2_session_hostkey()` |
| Public key auth | Not implemented | Implemented with Secure Enclave signing callback |
| File organization | All in one Swift file + ObjC wrapper | Split into focused files (KeyManager, Client, Formats) |
| Error handling | Generic NSError | Structured errors with stage/context |

---

## Security Properties

1. **Private key never leaves the device** — Secure Enclave keys are non-exportable by hardware design
2. **Private key is hardware-backed when possible** — uses Secure Enclave on supported devices, Keychain fallback on simulator/older devices
3. **Password is ephemeral** — used once for key installation, never stored anywhere
4. **Credential metadata encrypted at rest** — `expo-secure-store` uses iOS Keychain services
5. **Per-device isolation** — `kSecAttrAccessibleWhenUnlockedThisDeviceOnly` prevents key migration
6. **Host key pinning** — fingerprint stored after first connection, verified on subsequent connections

---

## Decisions (Resolved)

### 1. SSH Library: Custom libssh2 module (vendored xcframework)

**Investigated alternatives:**

| Library | Status | Why not |
|---------|--------|---------|
| `@marcomueglich/react-native-ssh-client` | **Android-only** — iOS marked "not yet supported" | Cannot use for iOS at all |
| `react-native-ssh-sftp` (dylankenneally) | iOS via NMSSH (forked CocoaPod) | Old architecture, uses abandoned NMSSH fork, cannot integrate Secure Enclave signing callback for public key auth |
| SwiftNIO SSH | Requires Swift 6.0+ | Project is on Swift 5.0, complex API designed as building blocks |

**Decision**: Build a custom Swift module wrapping libssh2 directly. This is the only approach that supports:
- Secure Enclave private key signing via `libssh2_userauth_publickey()` callback
- Full control over authentication strategies (password, keyboard-interactive, Tailscale fallback)
- Modern Expo module architecture
- No dependency on abandoned/forked third-party libraries

**libssh2 source**: Vendor a prebuilt xcframework (arm64 device + arm64/x86_64 simulator). Build from source using a reproducible build script stored in the repo at `modules/ssh/scripts/build-libssh2.sh`.

### 2. Tailscale SSH: Replicate `+password` fallback

Replicate the full authentication strategy cascade from the previous module:
1. Password auth with provided credentials
2. Keyboard-interactive auth with provided credentials
3. (If Tailscale host) Password auth with `username+password` and fallback password
4. (If Tailscale host) Keyboard-interactive with `username+password` and fallback password

### 3. Biometric Gating: Yes

Use `SecAccessControlCreateWithFlags` with `.biometryCurrentSet` on Secure Enclave keys. This means:
- Face ID / Touch ID required when the key is used for signing (SSH auth)
- Keys are invalidated if biometric settings change (e.g., new fingerprint added)
- Add `NSFaceIDUsageDescription` to Info.plist

For the credential metadata in `expo-secure-store`, add `requireAuthentication: true`:
```ts
await SecureStore.setItemAsync(key, JSON.stringify(credential), {
  requireAuthentication: true,
  authenticationPrompt: 'Authenticate to access server credentials',
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
});
```

### 4. Android: Stub module

Create an Android stub that throws descriptive errors:
```kotlin
// modules/ssh/android/src/main/java/expo/modules/ssh/SSHModule.kt
class SSHModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("SSH")

    Function("isSecureEnclaveAvailable") { false }

    AsyncFunction("generateKey") { _: String ->
      throw CodedException("SSH_UNSUPPORTED", "SSH key generation is only available on iOS.")
    }

    // ... same pattern for other functions
  }
}
```

And in the TS layer, gate the UI:
```ts
import { Platform } from 'react-native';
export const isSSHSupported = Platform.OS === 'ios';
```
