#!/bin/bash
#
# Build OpenSSL + libssh2 as an xcframework for iOS (device + simulator).
#
# Usage:
#   cd apps/mobile/modules/ssh
#   bash scripts/build-libssh2.sh
#
# Output:
#   ios/Vendor/libssh2/         (xcframework, headers, module map, OpenSSL libs)
#
set -euo pipefail

OPENSSL_VERSION="3.4.1"
LIBSSH2_VERSION="1.11.1"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MODULE_DIR="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="${MODULE_DIR}/.build-libssh2"
VENDOR_DIR="${MODULE_DIR}/ios/Vendor/libssh2"
IOS_MIN_VERSION="15.1"
NCPU="$(sysctl -n hw.ncpu)"

echo "==> Building OpenSSL ${OPENSSL_VERSION} + libssh2 ${LIBSSH2_VERSION} for iOS"

rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"

# Download
echo "==> Downloading sources..."
curl -sSL "https://github.com/openssl/openssl/releases/download/openssl-${OPENSSL_VERSION}/openssl-${OPENSSL_VERSION}.tar.gz" -o "${BUILD_DIR}/openssl.tar.gz"
curl -sSL "https://github.com/libssh2/libssh2/releases/download/libssh2-${LIBSSH2_VERSION}/libssh2-${LIBSSH2_VERSION}.tar.gz" -o "${BUILD_DIR}/libssh2.tar.gz"
tar xzf "${BUILD_DIR}/openssl.tar.gz" -C "$BUILD_DIR"
tar xzf "${BUILD_DIR}/libssh2.tar.gz" -C "$BUILD_DIR"

OPENSSL_SRC="${BUILD_DIR}/openssl-${OPENSSL_VERSION}"
LIBSSH2_SRC="${BUILD_DIR}/libssh2-${LIBSSH2_VERSION}"

build_openssl() {
  local PLATFORM="$1"   # iphoneos | iphonesimulator
  local PREFIX="${BUILD_DIR}/openssl-${PLATFORM}"
  local BUILD="${BUILD_DIR}/openssl-build-${PLATFORM}"

  echo "  -> OpenSSL for ${PLATFORM}..."
  cp -R "$OPENSSL_SRC" "$BUILD"
  cd "$BUILD"

  local TARGET TARGET_TRIPLE
  if [ "$PLATFORM" = "iphoneos" ]; then
    TARGET="ios64-xcrun"
    TARGET_TRIPLE="arm64-apple-ios${IOS_MIN_VERSION}"
  else
    TARGET="iossimulator-xcrun"
    TARGET_TRIPLE="arm64-apple-ios${IOS_MIN_VERSION}-simulator"
  fi

  ./Configure "$TARGET" \
    --prefix="$PREFIX" \
    no-shared no-tests no-ui-console no-apps no-docs \
    "-target ${TARGET_TRIPLE}" \
    > /dev/null 2>&1

  make -j"$NCPU" > /dev/null 2>&1
  make install_sw > /dev/null 2>&1
  cd "$MODULE_DIR"
}

build_libssh2() {
  local PLATFORM="$1"   # iphoneos | iphonesimulator
  local OPENSSL_PREFIX="${BUILD_DIR}/openssl-${PLATFORM}"
  local PREFIX="${BUILD_DIR}/libssh2-${PLATFORM}"
  local BUILD="${BUILD_DIR}/libssh2-build-${PLATFORM}"

  echo "  -> libssh2 for ${PLATFORM}..."

  local SDK_PATH
  SDK_PATH=$(xcrun --sdk "$PLATFORM" --show-sdk-path)
  local CC
  CC=$(xcrun --sdk "$PLATFORM" --find clang)

  # Use -target to embed correct platform info (critical for xcframework)
  local TARGET_TRIPLE
  if [ "$PLATFORM" = "iphoneos" ]; then
    TARGET_TRIPLE="arm64-apple-ios${IOS_MIN_VERSION}"
  else
    TARGET_TRIPLE="arm64-apple-ios${IOS_MIN_VERSION}-simulator"
  fi

  cp -R "$LIBSSH2_SRC" "$BUILD"
  cd "$BUILD"

  CFLAGS="-target ${TARGET_TRIPLE} -isysroot ${SDK_PATH} -O2 -I${OPENSSL_PREFIX}/include" \
  LDFLAGS="-target ${TARGET_TRIPLE} -isysroot ${SDK_PATH} -L${OPENSSL_PREFIX}/lib" \
  LIBS="-lssl -lcrypto" \
  CC="$CC" \
  ./configure \
    --host=aarch64-apple-darwin \
    --prefix="$PREFIX" \
    --disable-shared \
    --enable-static \
    --disable-examples-build \
    --with-crypto=openssl \
    --with-libssl-prefix="$OPENSSL_PREFIX" \
    > /dev/null 2>&1

  make -j"$NCPU" > /dev/null 2>&1
  make install > /dev/null 2>&1
  cd "$MODULE_DIR"
}

# Build
echo "==> Building OpenSSL..."
build_openssl "iphoneos"
build_openssl "iphonesimulator"

echo "==> Building libssh2..."
build_libssh2 "iphoneos"
build_libssh2 "iphonesimulator"

# Merge OpenSSL into libssh2 so the xcframework is self-contained
echo "==> Merging OpenSSL into libssh2 archives..."
for PLATFORM in iphoneos iphonesimulator; do
  MERGED="${BUILD_DIR}/merged-${PLATFORM}"
  mkdir -p "$MERGED"

  libtool -static -o "${MERGED}/libssh2.a" \
    "${BUILD_DIR}/libssh2-${PLATFORM}/lib/libssh2.a" \
    "${BUILD_DIR}/openssl-${PLATFORM}/lib/libssl.a" \
    "${BUILD_DIR}/openssl-${PLATFORM}/lib/libcrypto.a" \
    2>/dev/null
done

# Create xcframework
echo "==> Creating xcframework..."
rm -rf "${VENDOR_DIR}"
mkdir -p "${VENDOR_DIR}/lib"

xcodebuild -create-xcframework \
  -library "${BUILD_DIR}/merged-iphoneos/libssh2.a" \
  -headers "${BUILD_DIR}/libssh2-iphoneos/include" \
  -library "${BUILD_DIR}/merged-iphonesimulator/libssh2.a" \
  -headers "${BUILD_DIR}/libssh2-iphonesimulator/include" \
  -output "${VENDOR_DIR}/lib/ssh2.xcframework" \
  2>/dev/null

# Headers + module map
echo "==> Setting up headers..."
mkdir -p "${VENDOR_DIR}/include"
cp "${BUILD_DIR}/libssh2-iphoneos/include/"*.h "${VENDOR_DIR}/include/"

cat > "${VENDOR_DIR}/include/module.modulemap" <<'MODULEMAP'
module Clibssh2 [system] {
  header "libssh2.h"
  header "libssh2_publickey.h"
  header "libssh2_sftp.h"
  link "ssh2"
  export *
}
MODULEMAP

# Cleanup
echo "==> Cleaning up..."
rm -rf "$BUILD_DIR"

echo ""
echo "==> Done!"
echo "    xcframework: ${VENDOR_DIR}/lib/ssh2.xcframework"
echo "    headers:     ${VENDOR_DIR}/include/"
