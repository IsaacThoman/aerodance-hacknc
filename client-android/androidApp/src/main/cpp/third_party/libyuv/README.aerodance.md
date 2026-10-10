# Vendored libyuv

Upstream: https://chromium.googlesource.com/libyuv/libyuv/
Revision: `eeb06a6451ba2e21f8ff272c7b42fc62b9faecc5` (2026-10-08).
License: BSD 3-clause, retained in LICENSE; additional grant in PATENTS; AUTHORS retained.

Unmodified upstream include/, source/, util/, CMakeLists.txt and
CM_linux_packages.cmake are included. SHA256SUMS records every upstream file
in this subset. Verify with `sha256sum -c SHA256SUMS` from this directory.
No network fetch occurs during builds. To update, replace this subset from an
explicit reviewed upstream commit and regenerate the checksums and this record.

The parent CMake project builds only the static yuv dependency and JNI target;
JPEG, upstream tools, and tests are excluded from the APK. ARMv7 NEON kernels
are compiled separately with runtime CPU dispatch. SME is disabled because
NDK r27's C feature probe overstates its C++ SME support. Other upstream
sources and compile definitions are unchanged.
