package expo.modules.ssh

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.exception.CodedException

class SSHModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("SSH")

    Function("isSecureEnclaveAvailable") {
      false
    }

    AsyncFunction("generateKey") { _: String ->
      throw CodedException("SSH_UNSUPPORTED", "SSH key generation is only available on iOS.", null)
    }

    Function("deleteKey") { _: String ->
      false
    }

    AsyncFunction("installPublicKey") { _: String, _: Int, _: String, _: String, _: String ->
      throw CodedException("SSH_UNSUPPORTED", "SSH key installation is only available on iOS.", null)
    }

    AsyncFunction("verifyConnection") { _: Map<String, Any> ->
      throw CodedException("SSH_UNSUPPORTED", "SSH connection verification is only available on iOS.", null)
    }
  }
}
