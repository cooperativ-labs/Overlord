require 'json'

Pod::Spec.new do |s|
  s.name           = 'SecureEnclaveSSH'
  s.version        = '0.1.0'
  s.summary        = 'Expo module for Secure Enclave SSH key generation'
  s.description    = 'Generate ECDSA P-256 SSH keys using the iOS Secure Enclave or Keychain fallback'
  s.homepage       = 'https://github.com/cooperativ/overlord'
  s.license        = 'MIT'
  s.author         = 'Cooperativ'
  s.platform       = :ios, '15.1'
  s.source         = { git: '' }
  s.source_files   = ['**/*.{swift,h,m}', 'Vendor/libssh2-iosx/include/*.{h,c}']
  s.public_header_files = ['OVLDSSHKeyInstaller.h', 'Vendor/libssh2-iosx/include/*.h']
  s.header_mappings_dir = 'Vendor/libssh2-iosx/include'
  s.preserve_paths = ['Vendor/libssh2-iosx/ssh2.xcframework', 'Vendor/libssh2-iosx/include/*.h']
  s.vendored_frameworks = 'Vendor/libssh2-iosx/ssh2.xcframework'
  s.pod_target_xcconfig = {
    'HEADER_SEARCH_PATHS' => '"$(PODS_TARGET_SRCROOT)/Vendor/libssh2-iosx/include"'
  }
  s.swift_version  = '5.4'

  s.dependency 'ExpoModulesCore'
end
