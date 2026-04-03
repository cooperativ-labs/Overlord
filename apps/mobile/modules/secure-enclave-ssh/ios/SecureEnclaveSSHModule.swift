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

    /// Generate a new ECDSA P-256 key pair in the Secure Enclave.
    /// Returns { tag, publicKeyOpenSSH, fingerprint }
    AsyncFunction("generateKey") { (tag: String) -> [String: String] in
      // Remove any existing key with this tag
      Self.deleteKeyFromKeychain(tag: tag)

      let accessControl = SecAccessControlCreateWithFlags(
        kCFAllocatorDefault,
        kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
        [.privateKeyUsage],
        nil
      )!

      let attributes: [String: Any] = [
        kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
        kSecAttrKeySizeInBits as String: 256,
        kSecAttrTokenID as String: kSecAttrTokenIDSecureEnclave,
        kSecPrivateKeyAttrs as String: [
          kSecAttrIsPermanent as String: true,
          kSecAttrApplicationTag as String: tag.data(using: .utf8)!,
          kSecAttrAccessControl as String: accessControl,
        ] as [String: Any]
      ]

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
      ]
    }

    /// Get the public key for an existing Secure Enclave key by tag.
    /// Returns { tag, publicKeyOpenSSH, fingerprint } or null if not found.
    AsyncFunction("getPublicKey") { (tag: String) -> [String: String]? in
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
