import Foundation
import CryptoKit
import Security

// MARK: - Error Types

/// Structured error type for all SSH module operations.
enum SSHError: LocalizedError {
  case keyGeneration(String)
  case keyNotFound(String)
  case signing(String)
  case formatConversion(String)
  case connection(String, stage: String? = nil)
  case authentication(String, stage: String? = nil, supportedMethods: [String]? = nil)
  case command(String, exitCode: Int? = nil)

  var errorDescription: String? {
    switch self {
    case .keyGeneration(let msg),
         .keyNotFound(let msg),
         .signing(let msg),
         .formatConversion(let msg),
         .connection(let msg, _),
         .authentication(let msg, _, _),
         .command(let msg, _):
      return msg
    }
  }
}

// MARK: - OpenSSH Format Conversion

/// Converts iOS Security framework key representations to OpenSSH wire formats.
enum SSHFormats {

  /// Convert a `SecKey` public key to the OpenSSH `authorized_keys` format.
  ///
  /// Output: `ecdsa-sha2-nistp256 AAAA...base64...`
  ///
  /// The SSH wire blob is: `string("ecdsa-sha2-nistp256") || string("nistp256") || string(EC point)`.
  static func publicKeyToOpenSSH(publicKey: SecKey) throws -> String {
    guard let rawData = SecKeyCopyExternalRepresentation(publicKey, nil) as Data? else {
      throw SSHError.formatConversion("Failed to export public key bytes.")
    }

    // rawData is the uncompressed EC point: 0x04 || x (32 bytes) || y (32 bytes) = 65 bytes
    let keyType = "ecdsa-sha2-nistp256"
    let curveName = "nistp256"

    var wireData = Data()
    wireData.appendSSHString(keyType)
    wireData.appendSSHString(curveName)
    wireData.appendSSHBytes(rawData)

    return "\(keyType) \(wireData.base64EncodedString())"
  }

  /// Compute the SHA-256 fingerprint of a public key in SSH format.
  ///
  /// Output: `SHA256:abc123...` (matches `ssh-keygen -l -f key.pub`)
  static func publicKeyFingerprint(publicKey: SecKey) -> String {
    guard let rawData = SecKeyCopyExternalRepresentation(publicKey, nil) as Data? else {
      return "unknown"
    }

    let keyType = "ecdsa-sha2-nistp256"
    let curveName = "nistp256"

    var wireData = Data()
    wireData.appendSSHString(keyType)
    wireData.appendSSHString(curveName)
    wireData.appendSSHBytes(rawData)

    let hash = SHA256.hash(data: wireData)
    let base64Hash = Data(hash).base64EncodedString()
    // Remove trailing '=' padding to match ssh-keygen output
    let trimmed = base64Hash.replacingOccurrences(of: "=", with: "")
    return "SHA256:\(trimmed)"
  }

  /// Convert a DER-encoded ECDSA signature to SSH wire format.
  ///
  /// SSH expects: `string("ecdsa-sha2-nistp256") || string(mpint(r) || mpint(s))`
  ///
  /// The input DER is: `SEQUENCE { INTEGER r, INTEGER s }`.
  static func ecdsaSignatureToSSH(derSignature: Data) throws -> Data {
    let (r, s) = try parseDERSignature(derSignature)

    // Inner blob: mpint(r) || mpint(s)
    var innerBlob = Data()
    innerBlob.appendSSHMPInt(r)
    innerBlob.appendSSHMPInt(s)

    // Outer blob: string("ecdsa-sha2-nistp256") || string(inner)
    var sshSig = Data()
    sshSig.appendSSHString("ecdsa-sha2-nistp256")
    sshSig.appendSSHBytes(innerBlob)

    return sshSig
  }

  /// Parse a DER-encoded ECDSA signature into (r, s) integer byte arrays.
  private static func parseDERSignature(_ der: Data) throws -> (Data, Data) {
    let bytes = [UInt8](der)
    guard bytes.count > 6, bytes[0] == 0x30 else {
      throw SSHError.formatConversion("Invalid DER signature: bad header.")
    }

    var offset = 2 // skip SEQUENCE tag + length

    // Parse first INTEGER (r)
    guard offset < bytes.count, bytes[offset] == 0x02 else {
      throw SSHError.formatConversion("Invalid DER signature: expected INTEGER tag for r.")
    }
    offset += 1
    let rLen = Int(bytes[offset])
    offset += 1
    guard offset + rLen <= bytes.count else {
      throw SSHError.formatConversion("Invalid DER signature: r length overflow.")
    }
    let r = Data(bytes[offset..<(offset + rLen)])
    offset += rLen

    // Parse second INTEGER (s)
    guard offset < bytes.count, bytes[offset] == 0x02 else {
      throw SSHError.formatConversion("Invalid DER signature: expected INTEGER tag for s.")
    }
    offset += 1
    let sLen = Int(bytes[offset])
    offset += 1
    guard offset + sLen <= bytes.count else {
      throw SSHError.formatConversion("Invalid DER signature: s length overflow.")
    }
    let s = Data(bytes[offset..<(offset + sLen)])

    return (r, s)
  }
}

// MARK: - SSH Wire Format Helpers

extension Data {
  /// Append a string in SSH wire format: `uint32(length) || UTF-8 bytes`.
  mutating func appendSSHString(_ string: String) {
    let bytes = Data(string.utf8)
    appendSSHBytes(bytes)
  }

  /// Append raw bytes in SSH wire format: `uint32(length) || bytes`.
  mutating func appendSSHBytes(_ bytes: Data) {
    var length = UInt32(bytes.count).bigEndian
    append(Data(bytes: &length, count: 4))
    append(bytes)
  }

  /// Append an integer as an SSH mpint (signed big-endian, minimal length).
  ///
  /// If the high bit is set, a leading 0x00 byte is prepended (positive sign).
  mutating func appendSSHMPInt(_ value: Data) {
    // Strip leading zeros (but keep at least one byte)
    var trimmed = value
    while trimmed.count > 1 && trimmed[trimmed.startIndex] == 0x00 {
      trimmed = trimmed.dropFirst()
    }

    // If high bit is set, prepend 0x00 so it's interpreted as positive
    if let first = trimmed.first, first & 0x80 != 0 {
      var padded = Data([0x00])
      padded.append(trimmed)
      appendSSHBytes(padded)
    } else {
      appendSSHBytes(trimmed)
    }
  }
}
