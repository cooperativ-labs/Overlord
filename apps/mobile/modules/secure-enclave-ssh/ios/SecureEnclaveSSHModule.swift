import ExpoModulesCore
import Security
import CryptoKit
import Foundation

public class SecureEnclaveSSHModule: Module {
  public func definition() -> ModuleDefinition {
    Name("SecureEnclaveSSH")

    /// Check if the Secure Enclave is available on this device
    Function("isSecureEnclaveAvailable") {
      return SecureEnclave.isAvailable
    }

    /// Generate a new ECDSA P-256 key pair.
    /// Uses the Secure Enclave when available, falls back to software Keychain keys.
    /// Returns { tag, publicKeyOpenSSH, fingerprint, isHardwareBacked }
    AsyncFunction("generateKey") { (tag: String) -> [String: Any] in
      // Remove any existing key with this tag
      Self.deleteKeyFromKeychain(tag: tag)

      let useSecureEnclave = SecureEnclave.isAvailable
      var attributes: [String: Any]

      if useSecureEnclave {
        let accessControl = SecAccessControlCreateWithFlags(
          kCFAllocatorDefault,
          kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
          [.privateKeyUsage],
          nil
        )!

        attributes = [
          kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
          kSecAttrKeySizeInBits as String: 256,
          kSecAttrTokenID as String: kSecAttrTokenIDSecureEnclave,
          kSecPrivateKeyAttrs as String: [
            kSecAttrIsPermanent as String: true,
            kSecAttrApplicationTag as String: tag.data(using: .utf8)!,
            kSecAttrAccessControl as String: accessControl,
          ] as [String: Any]
        ]
      } else {
        // Software-based fallback — key stored in Keychain, not Secure Enclave
        attributes = [
          kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
          kSecAttrKeySizeInBits as String: 256,
          kSecPrivateKeyAttrs as String: [
            kSecAttrIsPermanent as String: true,
            kSecAttrApplicationTag as String: tag.data(using: .utf8)!,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
          ] as [String: Any]
        ]
      }

      var error: Unmanaged<CFError>?
      guard let privateKey = SecKeyCreateRandomKey(attributes as CFDictionary, &error) else {
        let err = error!.takeRetainedValue() as Error
        throw NSError(domain: "SecureEnclaveSSH", code: 1,
                      userInfo: [NSLocalizedDescriptionKey: "Failed to generate key: \(err.localizedDescription)"])
      }

      guard let publicKey = SecKeyCopyPublicKey(privateKey) else {
        throw NSError(domain: "SecureEnclaveSSH", code: 2,
                      userInfo: [NSLocalizedDescriptionKey: "Failed to extract public key"])
      }

      let openSSHKey = try Self.publicKeyToOpenSSH(publicKey: publicKey)
      let fingerprint = Self.publicKeyFingerprint(publicKey: publicKey)

      return [
        "tag": tag,
        "publicKeyOpenSSH": openSSHKey,
        "fingerprint": fingerprint,
        "isHardwareBacked": useSecureEnclave,
      ]
    }

    /// Get the public key for an existing key by tag.
    /// Returns { tag, publicKeyOpenSSH, fingerprint, isHardwareBacked } or null if not found.
    AsyncFunction("getPublicKey") { (tag: String) -> [String: Any]? in
      guard let privateKey = Self.loadKeyFromKeychain(tag: tag) else {
        return nil
      }
      guard let publicKey = SecKeyCopyPublicKey(privateKey) else {
        return nil
      }

      let openSSHKey = try Self.publicKeyToOpenSSH(publicKey: publicKey)
      let fingerprint = Self.publicKeyFingerprint(publicKey: publicKey)

      return [
        "tag": tag,
        "publicKeyOpenSSH": openSSHKey,
        "fingerprint": fingerprint,
        "isHardwareBacked": SecureEnclave.isAvailable,
      ]
    }

    /// Delete a key from the Secure Enclave by tag
    Function("deleteKey") { (tag: String) -> Bool in
      return Self.deleteKeyFromKeychain(tag: tag)
    }

    /// Sign data with a Secure Enclave key (for SSH authentication).
    /// Takes the tag and base64-encoded data to sign.
    /// Returns base64-encoded signature.
    AsyncFunction("signData") { (tag: String, base64Data: String) -> String in
      guard let data = Data(base64Encoded: base64Data) else {
        throw NSError(domain: "SecureEnclaveSSH", code: 3,
                      userInfo: [NSLocalizedDescriptionKey: "Invalid base64 data"])
      }

      guard let privateKey = Self.loadKeyFromKeychain(tag: tag) else {
        throw NSError(domain: "SecureEnclaveSSH", code: 4,
                      userInfo: [NSLocalizedDescriptionKey: "Key not found for tag: \(tag)"])
      }

      var error: Unmanaged<CFError>?
      guard let signature = SecKeyCreateSignature(
        privateKey,
        .ecdsaSignatureMessageX962SHA256,
        data as CFData,
        &error
      ) else {
        let err = error!.takeRetainedValue() as Error
        throw NSError(domain: "SecureEnclaveSSH", code: 5,
                      userInfo: [NSLocalizedDescriptionKey: "Signing failed: \(err.localizedDescription)"])
      }

      return (signature as Data).base64EncodedString()
    }

    /// Install a public key on a remote server via SSH password authentication.
    /// Connects directly from the device, runs the command to append the key to authorized_keys,
    /// then disconnects. The password is never stored.
    AsyncFunction("installPublicKey") { (host: String, port: Int, username: String, password: String, publicKey: String) -> [String: Any] in
      return try await withCheckedThrowingContinuation { continuation in
        DispatchQueue.global(qos: .userInitiated).async {
          let trimmedHost = host.trimmingCharacters(in: .whitespacesAndNewlines)
          let trimmedUsername = username.trimmingCharacters(in: .whitespacesAndNewlines)
          let resolvedPort = port > 0 ? port : 22
          let isTailscaleHost = Self.isLikelyTailscaleHost(trimmedHost)

          guard !trimmedHost.isEmpty else {
            continuation.resume(throwing: NSError(
              domain: "SecureEnclaveSSH",
              code: 10,
              userInfo: [NSLocalizedDescriptionKey: "Invalid host address."]
            ))
            return
          }

          guard !trimmedUsername.isEmpty else {
            continuation.resume(throwing: NSError(
              domain: "SecureEnclaveSSH",
              code: 11,
              userInfo: [NSLocalizedDescriptionKey: "A username is required."]
            ))
            return
          }

          do {
            let installResult = try Self.installPublicKeyViaSSH(
              host: trimmedHost,
              port: resolvedPort,
              username: trimmedUsername,
              password: password,
              publicKey: publicKey,
              allowTailscaleFallback: isTailscaleHost
            )

            continuation.resume(returning: installResult)
          } catch {
            continuation.resume(throwing: error)
          }
        }
      }
    }
  }

  // MARK: - Keychain Helpers

  private static func loadKeyFromKeychain(tag: String) -> SecKey? {
    let query: [String: Any] = [
      kSecClass as String: kSecClassKey,
      kSecAttrApplicationTag as String: tag.data(using: .utf8)!,
      kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
      kSecReturnRef as String: true,
    ]

    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)
    guard status == errSecSuccess else { return nil }
    return (item as! SecKey)
  }

  @discardableResult
  private static func deleteKeyFromKeychain(tag: String) -> Bool {
    let query: [String: Any] = [
      kSecClass as String: kSecClassKey,
      kSecAttrApplicationTag as String: tag.data(using: .utf8)!,
      kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
    ]

    let status = SecItemDelete(query as CFDictionary)
    return status == errSecSuccess || status == errSecItemNotFound
  }

  // MARK: - SSH Installation

  private static func installPublicKeyViaSSH(
    host: String,
    port: Int,
    username: String,
    password: String,
    publicKey: String,
    allowTailscaleFallback: Bool
  ) throws -> [String: Any] {
    let strategies = authenticationStrategies(
      username: username,
      password: password,
      allowTailscaleFallback: allowTailscaleFallback
    )

    var lastAuthenticationError: NSError?
    var lastAuthenticationDetails: String?
    var sawAuthenticationFailure = false

    for strategy in strategies {
      do {
        return try OVLDSSHKeyInstaller.installPublicKey(
          onHost: host,
          port: port,
          username: strategy.username,
          password: strategy.password,
          publicKey: publicKey,
          authenticationMethod: strategy.method
        )
      } catch {
        let nsError = error as NSError
        let stage = nsError.userInfo["stage"] as? String
        if stage == "authenticate" {
          sawAuthenticationFailure = true
          let supportedMethods = (nsError.userInfo["supportedAuthenticationMethods"] as? [String] ?? [])
            .joined(separator: ", ")
          let methodDetails = supportedMethods.isEmpty ? nil : "Server supports: \(supportedMethods)."
          let strategyDetails = "\(strategy.description) failed. \(nsError.localizedDescription)"
          lastAuthenticationDetails = [strategyDetails, methodDetails].compactMap { $0 }.joined(separator: " ")
          lastAuthenticationError = nsError
          continue
        }

        throw connectionError(
          host: host,
          port: port,
          details: nsError.localizedDescription,
          isTailscaleHost: allowTailscaleFallback
        )
      }
    }

    guard sawAuthenticationFailure else {
      throw connectionError(
        host: host,
        port: port,
        details: lastAuthenticationDetails ?? lastAuthenticationError?.localizedDescription,
        isTailscaleHost: allowTailscaleFallback
      )
    }

    throw authenticationError(
      host: host,
      port: port,
      username: username,
      password: password,
      lastError: lastAuthenticationError,
      details: lastAuthenticationDetails,
      isTailscaleHost: allowTailscaleFallback
    )
  }

  private static func authenticationStrategies(
    username: String,
    password: String,
    allowTailscaleFallback: Bool
  ) -> [(username: String, password: String, description: String, method: OVLDSSHAuthenticationMethod)] {
    var strategies: [(username: String, password: String, description: String, method: OVLDSSHAuthenticationMethod)] = [
      (
        username: username,
        password: password,
        description: "Password authentication",
        method: .password
      ),
      (
        username: username,
        password: password,
        description: "Keyboard-interactive authentication",
        method: .keyboardInteractive
      ),
    ]

    if allowTailscaleFallback && !username.contains("+password") {
      let tailscaleUsername = "\(username)+password"
      strategies.append(
        (
          username: tailscaleUsername,
          password: password.isEmpty ? "tailscale" : password,
          description: "Tailscale password-compatibility authentication",
          method: .password
        )
      )
      strategies.append(
        (
          username: tailscaleUsername,
          password: password.isEmpty ? "tailscale" : password,
          description: "Tailscale keyboard-interactive authentication",
          method: .keyboardInteractive
        )
      )
    }

    return strategies
  }

  private static func connectionError(
    host: String,
    port: Int,
    details: String?,
    isTailscaleHost: Bool
  ) -> NSError {
    let baseMessage = "Could not connect to \(host):\(port)."
    let tailscaleNote = isTailscaleHost
      ? " Tailscale SSH only uses port 22, and the phone must be connected to the same tailnet."
      : ""

    let messageParts = [
      baseMessage,
      details,
      tailscaleNote.isEmpty ? "Check the host address and port." : "Check the host address, make sure Tailscale is connected on this phone, and confirm the host is reachable over the tailnet."
    ]

    return NSError(
      domain: "SecureEnclaveSSH",
      code: 10,
      userInfo: [NSLocalizedDescriptionKey: messageParts.compactMap { $0 }.joined(separator: " ")]
    )
  }

  private static func authenticationError(
    host: String,
    port: Int,
    username: String,
    password: String,
    lastError: NSError?,
    details: String?,
    isTailscaleHost: Bool
  ) -> NSError {
    let baseMessage = isTailscaleHost
      ? "Authentication failed for \(username)@\((host)):\(port). Overlord retried using Tailscale's password-compatibility mode."
      : "Authentication failed. Check your username and password."
    let tailscaleNote = isTailscaleHost
      ? " Tailscale SSH ignores normal server passwords; this flow only works if your tailnet policy allows SSH for this user."
      : ""
    let fallbackHint = isTailscaleHost && password.isEmpty
      ? " Tailscale-compatible clients can use any placeholder password."
      : ""

    let messageParts: [String?] = [
      baseMessage,
      details ?? lastError?.localizedDescription,
      tailscaleNote + fallbackHint
    ]

    let message = messageParts
      .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
      .filter { !$0.isEmpty }
      .joined(separator: " ")

    return NSError(
      domain: "SecureEnclaveSSH",
      code: 11,
      userInfo: [NSLocalizedDescriptionKey: message]
    )
  }

  private static func isLikelyTailscaleHost(_ host: String) -> Bool {
    let trimmedHost = host.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    if trimmedHost.hasSuffix(".ts.net") {
      return true
    }

    let octets = trimmedHost.split(separator: ".").compactMap { Int($0) }
    guard octets.count == 4 else {
      return false
    }

    return octets[0] == 100 && (64...127).contains(octets[1])
  }

  // MARK: - SSH Key Format Conversion

  /// Convert a SecKey public key to OpenSSH authorized_keys format (ecdsa-sha2-nistp256)
  private static func publicKeyToOpenSSH(publicKey: SecKey) throws -> String {
    guard let publicKeyData = SecKeyCopyExternalRepresentation(publicKey, nil) as Data? else {
      throw NSError(domain: "SecureEnclaveSSH", code: 6,
                    userInfo: [NSLocalizedDescriptionKey: "Failed to export public key"])
    }

    // publicKeyData is the uncompressed EC point (0x04 || x || y), 65 bytes for P-256
    let keyType = "ecdsa-sha2-nistp256"
    let curveName = "nistp256"

    // SSH wire format: string keytype, string curvename, string point
    var wireData = Data()
    wireData.appendSSHString(keyType)
    wireData.appendSSHString(curveName)
    wireData.appendSSHBytes(publicKeyData)

    let base64Key = wireData.base64EncodedString()
    return "\(keyType) \(base64Key)"
  }

  /// Compute SHA-256 fingerprint of the public key in SSH format
  private static func publicKeyFingerprint(publicKey: SecKey) -> String {
    guard let publicKeyData = SecKeyCopyExternalRepresentation(publicKey, nil) as Data? else {
      return "unknown"
    }

    let keyType = "ecdsa-sha2-nistp256"
    let curveName = "nistp256"

    var wireData = Data()
    wireData.appendSSHString(keyType)
    wireData.appendSSHString(curveName)
    wireData.appendSSHBytes(publicKeyData)

    let hash = SHA256.hash(data: wireData)
    let base64Hash = Data(hash).base64EncodedString()
    // Remove trailing '=' padding to match ssh-keygen output
    let trimmed = base64Hash.replacingOccurrences(of: "=", with: "")
    return "SHA256:\(trimmed)"
  }
}

// MARK: - SSH Wire Format Helpers

extension Data {
  /// Append a string in SSH wire format (uint32 length + UTF-8 bytes)
  mutating func appendSSHString(_ string: String) {
    let bytes = Data(string.utf8)
    appendSSHBytes(bytes)
  }

  /// Append bytes in SSH wire format (uint32 length + bytes)
  mutating func appendSSHBytes(_ bytes: Data) {
    var length = UInt32(bytes.count).bigEndian
    append(Data(bytes: &length, count: 4))
    append(bytes)
  }
}
