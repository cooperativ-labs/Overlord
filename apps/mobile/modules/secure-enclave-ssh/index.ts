export {
  isSecureEnclaveAvailable,
  generateKey,
  getPublicKey,
  deleteKey,
  signData,
  installPublicKey,
} from './src/index';

export type { SecureEnclaveKeyResult, SSHInstallResult } from './src/index';
