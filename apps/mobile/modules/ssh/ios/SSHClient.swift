import Foundation
import Security
import CryptoKit
import Clibssh2

/// Low-level SSH client wrapping libssh2 for on-device connections.
///
/// Supports:
/// - Password and keyboard-interactive authentication
/// - Tailscale SSH `+password` compatibility fallback
/// - Public-key authentication using Secure Enclave keys (via signing callback)
/// - Remote command execution
/// - Host key fingerprint extraction
final class SSHClient {

  // MARK: - Public Key Installation

  /// Connect to a server with password auth and install an SSH public key
  /// into `~/.ssh/authorized_keys`.
  ///
  /// Tries multiple authentication strategies in order:
  /// 1. Password auth
  /// 2. Keyboard-interactive auth
  /// 3. (Tailscale hosts) `username+password` variants
  ///
  /// - Returns: `{ success, hostKeyFingerprint, message, output }`
  static func installPublicKey(
    host: String,
    port: Int,
    username: String,
    password: String,
    publicKey: String
  ) throws -> [String: Any] {
    let trimmedHost = host.trimmingCharacters(in: .whitespacesAndNewlines)
    let trimmedUsername = username.trimmingCharacters(in: .whitespacesAndNewlines)
    let resolvedPort = port > 0 ? port : 22
    let isTailscale = Self.isLikelyTailscaleHost(trimmedHost)

    guard !trimmedHost.isEmpty else {
      throw SSHError.connection("Invalid host address.", stage: "validate")
    }
    guard !trimmedUsername.isEmpty else {
      throw SSHError.connection("A username is required.", stage: "validate")
    }

    let strategies = Self.authStrategies(
      username: trimmedUsername,
      password: password,
      allowTailscale: isTailscale
    )

    var lastAuthError: SSHError?

    for strategy in strategies {
      do {
        return try Self.connectAndInstall(
          host: trimmedHost,
          port: resolvedPort,
          username: strategy.username,
          password: strategy.password,
          publicKey: publicKey,
          authMethod: strategy.method
        )
      } catch let error as SSHError {
        switch error {
        case .authentication:
          lastAuthError = error
          continue
        default:
          throw error
        }
      }
    }

    throw lastAuthError ?? SSHError.authentication(
      "Authentication failed. Check your username and password.",
      stage: "authenticate"
    )
  }

  // MARK: - Connection Verification

  /// Verify an SSH connection to a server.
  ///
  /// For SSH transport: authenticates with the device key (Secure Enclave signing).
  /// For Tailscale SSH: authenticates with password.
  ///
  /// After authenticating, runs `ovld --version` to confirm CLI presence.
  ///
  /// - Returns: `{ hostKeyFingerprint, ovldVersion }`
  static func verifyConnection(
    host: String,
    port: Int,
    username: String,
    transport: String,
    keyTag: String?,
    password: String?,
    expectedHostKeyFingerprint: String?
  ) throws -> [String: Any] {
    let trimmedHost = host.trimmingCharacters(in: .whitespacesAndNewlines)
    let trimmedUsername = username.trimmingCharacters(in: .whitespacesAndNewlines)
    let resolvedPort = port > 0 ? port : 22

    guard !trimmedHost.isEmpty else {
      throw SSHError.connection("Invalid host address.", stage: "validate")
    }
    guard !trimmedUsername.isEmpty else {
      throw SSHError.connection("A username is required.", stage: "validate")
    }

    // Initialize libssh2
    try Self.initLibssh2()

    // Connect TCP
    let socket = try Self.connectTCP(host: trimmedHost, port: resolvedPort)
    defer { Self.closeSocket(socket) }

    // SSH handshake
    let session = try Self.createSession(socket: socket)
    defer { Self.closeSession(session) }

    // Extract host key fingerprint
    let hostKeyFingerprint = Self.extractHostKeyFingerprint(session: session)

    // Authenticate
    if transport == "ssh", let keyTag = keyTag {
      // Public-key auth using Secure Enclave
      try Self.authenticateWithKey(
        session: session,
        username: trimmedUsername,
        keyTag: keyTag
      )
    } else if let password = password {
      // Password auth (Tailscale SSH or fallback)
      let isTailscale = Self.isLikelyTailscaleHost(trimmedHost)
      let strategies = Self.authStrategies(
        username: trimmedUsername,
        password: password,
        allowTailscale: isTailscale
      )

      var authenticated = false
      for strategy in strategies {
        do {
          try Self.authenticate(
            session: session,
            username: strategy.username,
            password: strategy.password,
            method: strategy.method
          )
          authenticated = true
          break
        } catch {
          continue
        }
      }

      if !authenticated {
        throw SSHError.authentication(
          "Authentication failed. Check your credentials.",
          stage: "authenticate"
        )
      }
    } else {
      throw SSHError.authentication(
        "No authentication method available. Provide a keyTag or password.",
        stage: "authenticate"
      )
    }

    // Run ovld --version
    let ovldVersion: String?
    do {
      let output = try Self.executeCommand(session: session, command: "ovld --version")
      ovldVersion = output.trimmingCharacters(in: .whitespacesAndNewlines)
    } catch {
      ovldVersion = nil
    }

    var result: [String: Any] = [
      "hostKeyFingerprint": hostKeyFingerprint ?? "unknown",
    ]
    if let version = ovldVersion, !version.isEmpty {
      result["ovldVersion"] = version
    }

    return result
  }

  // MARK: - Private: Connect & Install Flow

  private static func connectAndInstall(
    host: String,
    port: Int,
    username: String,
    password: String,
    publicKey: String,
    authMethod: AuthMethod
  ) throws -> [String: Any] {
    try Self.initLibssh2()

    let socket = try Self.connectTCP(host: host, port: port)
    defer { Self.closeSocket(socket) }

    let session = try Self.createSession(socket: socket)
    defer { Self.closeSession(session) }

    let hostKeyFingerprint = Self.extractHostKeyFingerprint(session: session)

    try Self.authenticate(
      session: session,
      username: username,
      password: password,
      method: authMethod
    )

    // Install the public key
    let escapedKey = publicKey.replacingOccurrences(of: "'", with: "'\\''")
    let command = [
      "mkdir -p ~/.ssh",
      "chmod 700 ~/.ssh",
      "touch ~/.ssh/authorized_keys",
      "chmod 600 ~/.ssh/authorized_keys",
      "grep -qxF '\(escapedKey)' ~/.ssh/authorized_keys || echo '\(escapedKey)' >> ~/.ssh/authorized_keys",
    ].joined(separator: " && ")

    let output = try Self.executeCommand(session: session, command: command)

    return [
      "success": true,
      "hostKeyFingerprint": hostKeyFingerprint ?? "unknown",
      "message": "SSH key installed successfully",
      "output": output,
    ]
  }

  // MARK: - Private: libssh2 Initialization

  private static var libssh2Initialized = false

  private static func initLibssh2() throws {
    guard !libssh2Initialized else { return }
    let rc = libssh2_init(0)
    guard rc == 0 else {
      throw SSHError.connection("Failed to initialize SSH library (code \(rc)).", stage: "init")
    }
    libssh2Initialized = true
  }

  // MARK: - Private: TCP Connection

  private static func connectTCP(host: String, port: Int) throws -> Int32 {
    // Resolve host via getaddrinfo (simpler than CFHost)
    var hints = addrinfo()
    hints.ai_family = AF_UNSPEC
    hints.ai_socktype = SOCK_STREAM
    hints.ai_protocol = IPPROTO_TCP

    var result: UnsafeMutablePointer<addrinfo>?
    let portStr = String(port)
    let rc = getaddrinfo(host, portStr, &hints, &result)
    guard rc == 0, let addrList = result else {
      throw SSHError.connection(
        "DNS lookup failed for \(host): \(String(cString: gai_strerror(rc)))",
        stage: "connect"
      )
    }
    defer { freeaddrinfo(addrList) }

    // Collect addresses
    var addresses: [(family: Int32, addr: Data)] = []
    var current: UnsafeMutablePointer<addrinfo>? = addrList
    while let info = current {
      let addrData = Data(bytes: info.pointee.ai_addr, count: Int(info.pointee.ai_addrlen))
      addresses.append((family: info.pointee.ai_family, addr: addrData))
      current = info.pointee.ai_next
    }

    guard !addresses.isEmpty else {
      throw SSHError.connection("Unable to resolve \(host).", stage: "connect")
    }

    // Try each resolved address
    for (family, addrData) in addresses {
      let sock = socket(family, SOCK_STREAM, IPPROTO_TCP)
      guard sock >= 0 else { continue }

      // Disable SIGPIPE
      var set: Int32 = 1
      setsockopt(sock, SOL_SOCKET, SO_NOSIGPIPE, &set, socklen_t(MemoryLayout<Int32>.size))

      // Set timeout (15s)
      var tv = timeval(tv_sec: 15, tv_usec: 0)
      setsockopt(sock, SOL_SOCKET, SO_SNDTIMEO, &tv, socklen_t(MemoryLayout<timeval>.size))
      setsockopt(sock, SOL_SOCKET, SO_RCVTIMEO, &tv, socklen_t(MemoryLayout<timeval>.size))

      let connectResult = addrData.withUnsafeBytes { ptr in
        connect(sock, ptr.baseAddress!.assumingMemoryBound(to: sockaddr.self), socklen_t(addrData.count))
      }

      if connectResult == 0 {
        return sock
      }

      close(sock)
    }

    throw SSHError.connection("Could not connect to \(host):\(port).", stage: "connect")
  }

  private static func closeSocket(_ sock: Int32) {
    close(sock)
  }

  // MARK: - Private: SSH Session

  private static func createSession(socket: Int32) throws -> OpaquePointer {
    guard let session = libssh2_session_init_ex(nil, nil, nil, nil) else {
      throw SSHError.connection("Failed to create SSH session.", stage: "connect")
    }

    libssh2_session_set_blocking(session, 1)
    libssh2_session_set_timeout(session, 15000)

    let rc = libssh2_session_handshake(session, socket)
    guard rc == 0 else {
      let errorMsg = Self.sessionErrorMessage(session) ?? "Handshake failed (code \(rc))"
      libssh2_session_free(session)
      throw SSHError.connection("SSH handshake failed: \(errorMsg)", stage: "connect")
    }

    return session
  }

  private static func closeSession(_ session: OpaquePointer) {
    libssh2_session_disconnect_ex(session, 11, "Overlord disconnect", "")
    libssh2_session_free(session)
  }

  // MARK: - Private: Host Key Fingerprint

  private static func extractHostKeyFingerprint(session: OpaquePointer) -> String? {
    var keyLen: Int = 0
    var keyType: Int32 = 0
    guard let rawPtr = libssh2_session_hostkey(session, &keyLen, &keyType),
          keyLen > 0 else {
      return nil
    }

    let keyData = Data(bytes: UnsafeRawPointer(rawPtr), count: keyLen)
    let hash = SHA256.hash(data: keyData)
    let base64 = Data(hash).base64EncodedString().replacingOccurrences(of: "=", with: "")
    return "SHA256:\(base64)"
  }

  // MARK: - Private: Authentication

  enum AuthMethod {
    case password
    case keyboardInteractive
    case publicKey(keyTag: String)
  }

  struct AuthStrategy {
    let username: String
    let password: String
    let method: AuthMethod
    let description: String
  }

  private static func authStrategies(
    username: String,
    password: String,
    allowTailscale: Bool
  ) -> [AuthStrategy] {
    var strategies: [AuthStrategy] = [
      AuthStrategy(
        username: username,
        password: password,
        method: .password,
        description: "Password authentication"
      ),
      AuthStrategy(
        username: username,
        password: password,
        method: .keyboardInteractive,
        description: "Keyboard-interactive authentication"
      ),
    ]

    if allowTailscale && !username.contains("+password") {
      let tsUser = "\(username)+password"
      let tsPass = password.isEmpty ? "tailscale" : password

      strategies.append(AuthStrategy(
        username: tsUser, password: tsPass,
        method: .password,
        description: "Tailscale password-compat auth"
      ))
      strategies.append(AuthStrategy(
        username: tsUser, password: tsPass,
        method: .keyboardInteractive,
        description: "Tailscale keyboard-interactive auth"
      ))
    }

    return strategies
  }

  private static func authenticate(
    session: OpaquePointer,
    username: String,
    password: String,
    method: AuthMethod
  ) throws {
    switch method {
    case .password:
      let rc = libssh2_userauth_password_ex(
        session,
        username, UInt32(username.utf8.count),
        password, UInt32(password.utf8.count),
        nil
      )
      guard rc == 0, libssh2_userauth_authenticated(session) == 1 else {
        throw SSHError.authentication(
          Self.sessionErrorMessage(session) ?? "Password authentication failed.",
          stage: "authenticate"
        )
      }

    case .keyboardInteractive:
      // Store password in session abstract for the callback
      let passCopy = strdup(password)
      defer { free(passCopy) }

      let abstract = libssh2_session_abstract(session)
      abstract?.pointee = UnsafeMutableRawPointer(passCopy)

      let rc = libssh2_userauth_keyboard_interactive_ex(
        session,
        username, UInt32(username.utf8.count),
        sshKeyboardInteractiveCallback
      )

      abstract?.pointee = nil

      guard rc == 0, libssh2_userauth_authenticated(session) == 1 else {
        throw SSHError.authentication(
          Self.sessionErrorMessage(session) ?? "Keyboard-interactive authentication failed.",
          stage: "authenticate"
        )
      }

    case .publicKey(let keyTag):
      try authenticateWithKey(session: session, username: username, keyTag: keyTag)
    }
  }

  // MARK: - Private: Public Key Authentication (Secure Enclave)

  private static func authenticateWithKey(
    session: OpaquePointer,
    username: String,
    keyTag: String
  ) throws {
    // Load the private key to get the public key
    guard let privateKey = SSHKeyManager.loadKey(tag: keyTag) else {
      throw SSHError.keyNotFound("No SSH key found for tag: \(keyTag)")
    }
    guard let publicKey = SecKeyCopyPublicKey(privateKey) else {
      throw SSHError.keyNotFound("Failed to extract public key for tag: \(keyTag)")
    }

    // Build the SSH public key blob
    guard let rawPubKey = SecKeyCopyExternalRepresentation(publicKey, nil) as Data? else {
      throw SSHError.formatConversion("Failed to export public key bytes.")
    }

    let keyType = "ecdsa-sha2-nistp256"
    let curveName = "nistp256"

    var pubKeyBlob = Data()
    pubKeyBlob.appendSSHString(keyType)
    pubKeyBlob.appendSSHString(curveName)
    pubKeyBlob.appendSSHBytes(rawPubKey)

    // Store context in session abstract for the signing callback
    let context = PublicKeyAuthContext(keyTag: keyTag, privateKey: privateKey)
    let contextPtr = Unmanaged.passRetained(context).toOpaque()

    let abstract = libssh2_session_abstract(session)
    let previousAbstract = abstract?.pointee
    abstract?.pointee = contextPtr

    // libssh2_userauth_publickey(session, username, pubkeydata, pubkeydata_len, sign_callback, abstract)
    // Note: username is a null-terminated C string (no length param)
    let rc: Int32 = pubKeyBlob.withUnsafeBytes { (rawBuf: UnsafeRawBufferPointer) -> Int32 in
      guard let pubKeyBytes = rawBuf.baseAddress?.assumingMemoryBound(to: UInt8.self) else {
        return -1
      }
      return libssh2_userauth_publickey(
        session,
        username,
        pubKeyBytes,
        pubKeyBlob.count,
        sshSignCallback,
        abstract
      )
    }

    // Restore previous abstract and release context
    abstract?.pointee = previousAbstract
    Unmanaged<PublicKeyAuthContext>.fromOpaque(contextPtr).release()

    guard rc == 0, libssh2_userauth_authenticated(session) == 1 else {
      throw SSHError.authentication(
        Self.sessionErrorMessage(session) ?? "Public key authentication failed.",
        stage: "authenticate"
      )
    }
  }

  // MARK: - Private: Command Execution

  private static func executeCommand(session: OpaquePointer, command: String) throws -> String {
    guard let channel = libssh2_channel_open_ex(
      session, "session", UInt32("session".utf8.count),
      2 * 1024 * 1024,  // LIBSSH2_CHANNEL_WINDOW_DEFAULT
      32768,            // LIBSSH2_CHANNEL_PACKET_DEFAULT
      nil, 0
    ) else {
      throw SSHError.command(
        Self.sessionErrorMessage(session) ?? "Failed to open SSH channel.",
        exitCode: nil
      )
    }
    defer {
      libssh2_channel_send_eof(channel)
      libssh2_channel_wait_eof(channel)
      libssh2_channel_close(channel)
      libssh2_channel_wait_closed(channel)
      libssh2_channel_free(channel)
    }

    // Merge stderr into stdout
    libssh2_channel_handle_extended_data2(channel, 1)  // LIBSSH2_CHANNEL_EXTENDED_DATA_MERGE

    let execResult = libssh2_channel_process_startup(
      channel, "exec", UInt32("exec".utf8.count),
      command, UInt32(command.utf8.count)
    )
    guard execResult == 0 else {
      throw SSHError.command(
        Self.sessionErrorMessage(session) ?? "Failed to execute command.",
        exitCode: nil
      )
    }

    // Read output
    var outputData = Data()
    var buffer = [CChar](repeating: 0, count: 4096)
    while true {
      let bytesRead = libssh2_channel_read_ex(channel, 0, &buffer, buffer.count)
      if bytesRead > 0 {
        buffer.withUnsafeBufferPointer { ptr in
          outputData.append(UnsafeBufferPointer(
            start: UnsafeRawPointer(ptr.baseAddress!).assumingMemoryBound(to: UInt8.self),
            count: Int(bytesRead)
          ))
        }
      } else {
        break
      }
    }

    let exitStatus = libssh2_channel_get_exit_status(channel)
    let output = String(data: outputData, encoding: .utf8) ?? ""

    if exitStatus != 0 {
      throw SSHError.command(
        output.isEmpty ? "Command failed with exit code \(exitStatus)." : output,
        exitCode: Int(exitStatus)
      )
    }

    return output
  }

  // MARK: - Private: Helpers

  private static func sessionErrorMessage(_ session: OpaquePointer) -> String? {
    var msgPtr: UnsafeMutablePointer<CChar>?
    var msgLen: Int32 = 0
    libssh2_session_last_error(session, &msgPtr, &msgLen, 0)
    guard let ptr = msgPtr, msgLen > 0 else { return nil }
    return String(cString: ptr)
  }

  static func isLikelyTailscaleHost(_ host: String) -> Bool {
    let h = host.lowercased()
    if h.hasSuffix(".ts.net") { return true }

    let parts = h.split(separator: ".").compactMap { Int($0) }
    guard parts.count == 4 else { return false }
    return parts[0] == 100 && (64...127).contains(parts[1])
  }
}

// MARK: - Public Key Auth Context

private final class PublicKeyAuthContext {
  let keyTag: String
  let privateKey: SecKey

  init(keyTag: String, privateKey: SecKey) {
    self.keyTag = keyTag
    self.privateKey = privateKey
  }
}

// MARK: - libssh2 C Callbacks

/// Keyboard-interactive callback: responds to all prompts with the stored password.
private func sshKeyboardInteractiveCallback(
  _ name: UnsafePointer<CChar>?,
  _ nameLen: Int32,
  _ instruction: UnsafePointer<CChar>?,
  _ instructionLen: Int32,
  _ numPrompts: Int32,
  _ prompts: UnsafePointer<LIBSSH2_USERAUTH_KBDINT_PROMPT>?,
  _ responses: UnsafeMutablePointer<LIBSSH2_USERAUTH_KBDINT_RESPONSE>?,
  _ abstract: UnsafeMutablePointer<UnsafeMutableRawPointer?>?
) {
  guard let abstract = abstract,
        let passwordPtr = abstract.pointee?.assumingMemoryBound(to: CChar.self) else {
    return
  }

  let password = String(cString: passwordPtr)

  for i in 0..<Int(numPrompts) {
    responses?[i].text = strdup(password)
    responses?[i].length = UInt32(password.utf8.count)
  }
}

/// Public-key signing callback for libssh2_userauth_publickey.
///
/// Signs the authentication challenge using the Secure Enclave private key.
/// The `abstract` parameter points to the session's abstract storage,
/// which we set to a `PublicKeyAuthContext` before calling `libssh2_userauth_publickey`.
private func sshSignCallback(
  _ session: OpaquePointer?,
  _ sig: UnsafeMutablePointer<UnsafeMutablePointer<UInt8>?>?,
  _ sigLen: UnsafeMutablePointer<Int>?,
  _ data: UnsafePointer<UInt8>?,
  _ dataLen: Int,
  _ abstract: UnsafeMutablePointer<UnsafeMutableRawPointer?>?
) -> Int32 {
  guard let abstract = abstract,
        let contextPtr = abstract.pointee,
        let data = data else {
    return -1
  }

  let context = Unmanaged<PublicKeyAuthContext>.fromOpaque(contextPtr)
    .takeUnretainedValue()

  let dataToSign = Data(bytes: data, count: dataLen)

  do {
    // Sign with Secure Enclave private key
    let derSignature = try SSHKeyManager.sign(privateKey: context.privateKey, data: dataToSign)

    // Convert DER signature to SSH wire format
    let sshSignature = try SSHFormats.ecdsaSignatureToSSH(derSignature: derSignature)

    // Allocate memory that libssh2 will free via its allocator
    let sigBuffer = UnsafeMutablePointer<UInt8>.allocate(capacity: sshSignature.count)
    sshSignature.copyBytes(to: sigBuffer, count: sshSignature.count)

    sig?.pointee = sigBuffer
    sigLen?.pointee = sshSignature.count

    return 0
  } catch {
    return -1
  }
}
