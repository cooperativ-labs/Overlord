import Foundation
import Security
import CryptoKit
import LocalAuthentication

/// Manages ECDSA P-256 SSH key pairs using the Secure Enclave (hardware-backed)
/// with a software Keychain fallback for devices/simulators that lack the enclave.
final class SSHKeyManager {

  // MARK: - Key Generation

  /// Generate a new ECDSA P-256 key pair.
  ///
  /// Prefers the Secure Enclave when available. Falls back to a software-only
  /// Keychain key on simulators and older hardware. Biometric authentication
  /// is required for Secure Enclave keys (`.biometryCurrentSet`).
  ///
  /// - Parameter tag: Unique identifier stored as `kSecAttrApplicationTag`.
  /// - Returns: The public `SecKey` reference and whether the key is hardware-backed.
  static func generateKey(tag: String) throws -> (publicKey: SecKey, isHardwareBacked: Bool) {
    // Remove any pre-existing key with the same tag (idempotent).
    deleteKey(tag: tag)

    let useSecureEnclave = SecureEnclave.isAvailable
    let attributes: [String: Any]

    if useSecureEnclave {
      guard let accessControl = SecAccessControlCreateWithFlags(
        kCFAllocatorDefault,
        kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
        [.privateKeyUsage, .biometryCurrentSet],
        nil
      ) else {
        throw SSHError.keyGeneration("Failed to create access control flags.")
      }

      attributes = [
        kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
        kSecAttrKeySizeInBits as String: 256,
        kSecAttrTokenID as String: kSecAttrTokenIDSecureEnclave,
        kSecPrivateKeyAttrs as String: [
          kSecAttrIsPermanent as String: true,
          kSecAttrApplicationTag as String: tag.data(using: .utf8)!,
          kSecAttrAccessControl as String: accessControl,
        ] as [String: Any],
      ]
    } else {
      // Software fallback — key stored in Keychain, not Secure Enclave.
      attributes = [
        kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
        kSecAttrKeySizeInBits as String: 256,
        kSecPrivateKeyAttrs as String: [
          kSecAttrIsPermanent as String: true,
          kSecAttrApplicationTag as String: tag.data(using: .utf8)!,
          kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
        ] as [String: Any],
      ]
    }

    var error: Unmanaged<CFError>?
    guard let privateKey = SecKeyCreateRandomKey(attributes as CFDictionary, &error) else {
      let message = (error?.takeRetainedValue() as Error?)?.localizedDescription
        ?? "Unknown error"
      throw SSHError.keyGeneration("Failed to generate key: \(message)")
    }

    guard let publicKey = SecKeyCopyPublicKey(privateKey) else {
      throw SSHError.keyGeneration("Failed to extract public key from generated key pair.")
    }

    return (publicKey, useSecureEnclave)
  }

  // MARK: - Key Lookup

  /// Load an existing private key reference from the Keychain by its tag.
  static func loadKey(tag: String) -> SecKey? {
    let query: [String: Any] = [
      kSecClass as String: kSecClassKey,
      kSecAttrApplicationTag as String: tag.data(using: .utf8)!,
      kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
      kSecReturnRef as String: true,
    ]

    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)
    guard status == errSecSuccess else { return nil }
    return (item as! SecKey) // swiftlint:disable:this force_cast
  }

  // MARK: - Key Deletion

  /// Delete a key from the Keychain / Secure Enclave.
  /// Returns `true` if deleted or not found (idempotent).
  @discardableResult
  static func deleteKey(tag: String) -> Bool {
    let query: [String: Any] = [
      kSecClass as String: kSecClassKey,
      kSecAttrApplicationTag as String: tag.data(using: .utf8)!,
      kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
    ]

    let status = SecItemDelete(query as CFDictionary)
    return status == errSecSuccess || status == errSecItemNotFound
  }

  // MARK: - Signing

  /// Sign arbitrary data with the private key identified by `tag`.
  ///
  /// Uses ECDSA with SHA-256 (`.ecdsaSignatureMessageX962SHA256`).
  /// For Secure Enclave keys this will trigger biometric authentication.
  ///
  /// - Returns: The DER-encoded ECDSA signature.
  static func sign(tag: String, data: Data) throws -> Data {
    guard let privateKey = loadKey(tag: tag) else {
      throw SSHError.keyNotFound("No key found for tag: \(tag)")
    }

    return try sign(privateKey: privateKey, data: data)
  }

  /// Sign data with a `SecKey` reference directly.
  static func sign(privateKey: SecKey, data: Data) throws -> Data {
    var error: Unmanaged<CFError>?
    guard let signature = SecKeyCreateSignature(
      privateKey,
      .ecdsaSignatureMessageX962SHA256,
      data as CFData,
      &error
    ) else {
      let message = (error?.takeRetainedValue() as Error?)?.localizedDescription
        ?? "Unknown signing error"
      throw SSHError.signing("Signing failed: \(message)")
    }

    return signature as Data
  }
}
