import { Platform, requireOptionalNativeModule } from 'expo-modules-core';

interface SecureEnclaveKeyResult {
  tag: string;
  publicKeyOpenSSH: string;
  fingerprint: string;
  isHardwareBacked: boolean;
}

interface SSHInstallResult {
  success: boolean;
  message: string;
  output: string;
}

interface SecureEnclaveSSHModuleType {
  isSecureEnclaveAvailable(): boolean;
  generateKey(tag: string): Promise<SecureEnclaveKeyResult>;
  getPublicKey(tag: string): Promise<SecureEnclaveKeyResult | null>;
  deleteKey(tag: string): boolean;
  signData(tag: string, base64Data: string): Promise<string>;
  installPublicKey(
    host: string,
    port: number,
    username: string,
    password: string,
    publicKey: string
  ): Promise<SSHInstallResult>;
}

const nativeModule: SecureEnclaveSSHModuleType | null =
  Platform.OS === 'ios' ? requireOptionalNativeModule('SecureEnclaveSSH') : null;

/**
 * Check if the Secure Enclave is available on this device.
 * Always returns false on Android/web.
 */
export function isSecureEnclaveAvailable(): boolean {
  if (!nativeModule) return false;
  return nativeModule.isSecureEnclaveAvailable();
}

/**
 * Generate a new ECDSA P-256 SSH key pair.
 * Uses the Secure Enclave when available, otherwise falls back to Keychain-based software keys.
 *
 * @param tag - Unique identifier for the key (e.g., "com.cooperativ.overlord.ssh.{serverId}")
 * @returns The public key in OpenSSH format, its fingerprint, and whether the key is hardware-backed
 */
export async function generateKey(tag: string): Promise<SecureEnclaveKeyResult> {
  if (!nativeModule) {
    throw new Error(
      'SSH key module is unavailable. Rebuild the iOS app so the native module is included.'
    );
  }
  return nativeModule.generateKey(tag);
}

/**
 * Get the public key for an existing Secure Enclave key.
 *
 * @param tag - The key tag used during generation
 * @returns The public key info, or null if not found
 */
export async function getPublicKey(tag: string): Promise<SecureEnclaveKeyResult | null> {
  if (!nativeModule) {
    throw new Error(
      'Secure Enclave SSH is unavailable. Rebuild the iOS app so the native module is included.'
    );
  }
  return nativeModule.getPublicKey(tag);
}

/**
 * Delete a key from the Secure Enclave.
 *
 * @param tag - The key tag to delete
 * @returns true if deleted or not found
 */
export function deleteKey(tag: string): boolean {
  if (!nativeModule) return false;
  return nativeModule.deleteKey(tag);
}

/**
 * Sign data with a Secure Enclave private key.
 * Used for SSH authentication challenge-response.
 *
 * @param tag - The key tag
 * @param base64Data - Base64-encoded data to sign
 * @returns Base64-encoded ECDSA signature
 */
export async function signData(tag: string, base64Data: string): Promise<string> {
  if (!nativeModule) {
    throw new Error(
      'Secure Enclave SSH is unavailable. Rebuild the iOS app so the native module is included.'
    );
  }
  return nativeModule.signData(tag, base64Data);
}

/**
 * Install an SSH public key on a remote server via password authentication.
 * Connects directly from the device using the native iOS SSH client wrapper, appends the key to authorized_keys,
 * and disconnects. The password is used once and never stored.
 */
export async function installPublicKey(
  host: string,
  port: number,
  username: string,
  password: string,
  publicKey: string
): Promise<SSHInstallResult> {
  if (!nativeModule) {
    throw new Error(
      'SSH module is unavailable. Rebuild the iOS app so the native module is included.'
    );
  }
  return nativeModule.installPublicKey(host, port, username, password, publicKey);
}

export type { SecureEnclaveKeyResult, SSHInstallResult };
