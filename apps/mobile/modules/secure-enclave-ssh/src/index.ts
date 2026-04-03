import { requireNativeModule, Platform } from 'expo-modules-core';

interface SecureEnclaveKeyResult {
  tag: string;
  publicKeyOpenSSH: string;
  fingerprint: string;
}

interface SecureEnclaveSSHModuleType {
  isSecureEnclaveAvailable(): boolean;
  generateKey(tag: string): Promise<SecureEnclaveKeyResult>;
  getPublicKey(tag: string): Promise<SecureEnclaveKeyResult | null>;
  deleteKey(tag: string): boolean;
  signData(tag: string, base64Data: string): Promise<string>;
}

const nativeModule: SecureEnclaveSSHModuleType | null =
  Platform.OS === 'ios' ? requireNativeModule('SecureEnclaveSSH') : null;

/**
 * Check if the Secure Enclave is available on this device.
 * Always returns false on Android/web.
 */
export function isSecureEnclaveAvailable(): boolean {
  if (!nativeModule) return false;
  return nativeModule.isSecureEnclaveAvailable();
}

/**
 * Generate a new ECDSA P-256 SSH key pair in the iOS Secure Enclave.
 * The private key never leaves the Secure Enclave hardware.
 *
 * @param tag - Unique identifier for the key (e.g., "com.cooperativ.overlord.ssh.{serverId}")
 * @returns The public key in OpenSSH format and its fingerprint
 */
export async function generateKey(tag: string): Promise<SecureEnclaveKeyResult> {
  if (!nativeModule) {
    throw new Error('Secure Enclave is only available on iOS');
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
    throw new Error('Secure Enclave is only available on iOS');
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
    throw new Error('Secure Enclave is only available on iOS');
  }
  return nativeModule.signData(tag, base64Data);
}

export type { SecureEnclaveKeyResult };
