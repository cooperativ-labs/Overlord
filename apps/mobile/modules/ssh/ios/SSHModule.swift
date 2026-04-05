import ExpoModulesCore
import Security
import CryptoKit

public class SSHModule: Module {
  public func definition() -> ModuleDefinition {
    Name("SSH")

    // MARK: - Key Management

    Function("isSecureEnclaveAvailable") { () -> Bool in
      return SecureEnclave.isAvailable
    }

    AsyncFunction("generateKey") { (tag: String) -> [String: Any] in
      let (publicKey, isHardwareBacked) = try SSHKeyManager.generateKey(tag: tag)
      let openSSHKey = try SSHFormats.publicKeyToOpenSSH(publicKey: publicKey)
      let fingerprint = SSHFormats.publicKeyFingerprint(publicKey: publicKey)

      return [
        "tag": tag,
        "publicKeyOpenSSH": openSSHKey,
        "fingerprint": fingerprint,
        "isHardwareBacked": isHardwareBacked,
      ]
    }

    Function("deleteKey") { (tag: String) -> Bool in
      return SSHKeyManager.deleteKey(tag: tag)
    }

    // MARK: - SSH Operations

    AsyncFunction("installPublicKey") {
      (host: String, port: Int, username: String, password: String, publicKey: String) -> [String: Any] in

      return try await withCheckedThrowingContinuation { continuation in
        DispatchQueue.global(qos: .userInitiated).async {
          do {
            let result = try SSHClient.installPublicKey(
              host: host,
              port: port,
              username: username,
              password: password,
              publicKey: publicKey
            )
            continuation.resume(returning: result)
          } catch {
            continuation.resume(throwing: error)
          }
        }
      }
    }

    AsyncFunction("verifyConnection") { (params: [String: Any]) -> [String: Any] in
      let host = params["host"] as? String ?? ""
      let port = params["port"] as? Int ?? 22
      let username = params["username"] as? String ?? ""
      let transport = params["transport"] as? String ?? "ssh"
      let keyTag = params["keyTag"] as? String
      let password = params["password"] as? String
      let expectedFingerprint = params["expectedHostKeyFingerprint"] as? String

      return try await withCheckedThrowingContinuation { continuation in
        DispatchQueue.global(qos: .userInitiated).async {
          do {
            let result = try SSHClient.verifyConnection(
              host: host,
              port: port,
              username: username,
              transport: transport,
              keyTag: keyTag,
              password: password,
              expectedHostKeyFingerprint: expectedFingerprint
            )
            continuation.resume(returning: result)
          } catch {
            continuation.resume(throwing: error)
          }
        }
      }
    }

    AsyncFunction("runCommand") { (params: [String: Any]) -> [String: Any] in
      let host = params["host"] as? String ?? ""
      let port = params["port"] as? Int ?? 22
      let username = params["username"] as? String ?? ""
      let transport = params["transport"] as? String ?? "ssh"
      let command = params["command"] as? String ?? ""
      let keyTag = params["keyTag"] as? String
      let password = params["password"] as? String
      let expectedFingerprint = params["expectedHostKeyFingerprint"] as? String

      return try await withCheckedThrowingContinuation { continuation in
        DispatchQueue.global(qos: .userInitiated).async {
          do {
            let result = try SSHClient.runCommand(
              host: host,
              port: port,
              username: username,
              transport: transport,
              command: command,
              keyTag: keyTag,
              password: password,
              expectedHostKeyFingerprint: expectedFingerprint
            )
            continuation.resume(returning: result)
          } catch {
            continuation.resume(throwing: error)
          }
        }
      }
    }
  }
}
