Pod::Spec.new do |s|
  s.name           = 'SSHModule'
  s.version        = '1.0.0'
  s.summary        = 'SSH key generation and connection module for Overlord'
  s.description    = 'Generate ECDSA P-256 SSH keys using the iOS Secure Enclave, install keys on remote servers via libssh2, and verify connections.'
  s.homepage       = 'https://github.com/cooperativ/overlord'
  s.license        = 'MIT'
  s.author         = 'Cooperativ'
  s.platform       = :ios, '15.1'
  s.source         = { git: '' }
  s.source_files   = ['**/*.swift', 'Vendor/libssh2/include/**/*.h']
  s.preserve_paths = ['Vendor/**']
  s.vendored_frameworks = 'Vendor/libssh2/lib/ssh2.xcframework'
  s.swift_version  = '5.4'

  # Link OpenSSL static libraries (required by libssh2) and system libs
  s.libraries = ['z']
  s.frameworks = ['Security', 'CryptoKit']

  s.pod_target_xcconfig = {
    'HEADER_SEARCH_PATHS' => '"$(PODS_TARGET_SRCROOT)/Vendor/libssh2/include"',
    'SWIFT_INCLUDE_PATHS'  => '"$(PODS_TARGET_SRCROOT)/Vendor/libssh2/include"',
  }

  s.dependency 'ExpoModulesCore'
end
