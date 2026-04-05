import { requireNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

// --- Types ---

export interface SSHKeyResult {
  tag: string;
  publicKeyOpenSSH: string;
  fingerprint: string;
  isHardwareBacked: boolean;
}

export interface SSHInstallResult {
  success: boolean;
  hostKeyFingerprint: string;
  message: string;
  output: string;
}

export interface VerifyConnectionParams {
  host: string;
  port: number;
  username: string;
  transport: 'ssh' | 'tailscale_ssh';
  keyTag?: string;
  password?: string;
  expectedHostKeyFingerprint?: string | null;
}

export interface VerifyConnectionResult {
  hostKeyFingerprint: string;
  ovldVersion?: string;
}

// --- Module ---

const SSHNative = requireNativeModule('SSH');

export const isSSHSupported = Platform.OS === 'ios';

export function isSecureEnclaveAvailable(): boolean {
  return SSHNative.isSecureEnclaveAvailable();
}

export async function generateKey(tag: string): Promise<SSHKeyResult> {
  return SSHNative.generateKey(tag);
}

export function deleteKey(tag: string): boolean {
  return SSHNative.deleteKey(tag);
}

export async function installPublicKey(
  host: string,
  port: number,
  username: string,
  password: string,
  publicKey: string
): Promise<SSHInstallResult> {
  return SSHNative.installPublicKey(host, port, username, password, publicKey);
}

export async function verifyConnection(
  params: VerifyConnectionParams
): Promise<VerifyConnectionResult> {
  return SSHNative.verifyConnection(params);
}
