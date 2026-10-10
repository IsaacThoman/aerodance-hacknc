/*
 *  Copyright 2026 The LibYuv Project Authors. All rights reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree. An additional intellectual property rights grant can be found
 *  in the file PATENTS. All contributing project authors may
 *  be found in the AUTHORS file in the root of the source tree.
 */

#include "libyuv/rotate_row.h"
#include "libyuv/row.h"

#ifdef __cplusplus
namespace libyuv {
extern "C" {
#endif

#if !defined(LIBYUV_DISABLE_SVE) && defined(__aarch64__)

// Transpose 32 bit values (ARGB) in Nx4 tiles using SVE2 with predication
// for tail widths.
void TransposeNx4_32_SVE2(const uint8_t* src,
                          int src_stride,
                          uint8_t* dst,
                          int dst_stride,
                          int width) {
  const ptrdiff_t s = src_stride;
  const ptrdiff_t s4 = s * 4;
  const ptrdiff_t d = dst_stride;
  const uint8_t* src1 = src + s;
  const uint8_t* src2 = src1 + s;
  const uint8_t* src3 = src2 + s;
  uint8_t* dst1 = dst + d;
  uint8_t* dst2 = dst1 + d;
  uint8_t* dst3 = dst2 + d;
  asm volatile(
      "ptrue       p0.s, vl4                     \n"
      "subs        %w[width], %w[width], #4      \n"
      "b.lt        2f                            \n"

      // Main loop: full 4x4 blocks.
      "1:                                        \n"
      "ld1w        {z0.s}, p0/z, [%[src0]]       \n"
      "ld1w        {z1.s}, p0/z, [%[src1]]       \n"
      "ld1w        {z2.s}, p0/z, [%[src2]]       \n"
      "ld1w        {z3.s}, p0/z, [%[src3]]       \n"
      "add         %[src0], %[src0], %[s4]       \n"
      "add         %[src1], %[src1], %[s4]       \n"
      "add         %[src2], %[src2], %[s4]       \n"
      "add         %[src3], %[src3], %[s4]       \n"
      "trn1        z4.s, z0.s, z1.s              \n"
      "trn2        z5.s, z0.s, z1.s              \n"
      "trn1        z6.s, z2.s, z3.s              \n"
      "trn2        z7.s, z2.s, z3.s              \n"
      "trn1        z0.d, z4.d, z6.d              \n"
      "trn2        z1.d, z4.d, z6.d              \n"
      "trn1        z2.d, z5.d, z7.d              \n"
      "trn2        z3.d, z5.d, z7.d              \n"
      "subs        %w[width], %w[width], #4      \n"
      "st1w        {z0.s}, p0, [%[dst0]]         \n"
      "st1w        {z1.s}, p0, [%[dst1]]         \n"
      "st1w        {z2.s}, p0, [%[dst2]]         \n"
      "st1w        {z3.s}, p0, [%[dst3]]         \n"
      "add         %[dst0], %[dst0], #16         \n"
      "add         %[dst1], %[dst1], #16         \n"
      "add         %[dst2], %[dst2], #16         \n"
      "add         %[dst3], %[dst3], #16         \n"
      "b.ge        1b                            \n"

      "2:                                        \n"
      "adds        %w[width], %w[width], #4      \n"
      "b.eq        3f                            \n"

      // Tail loop: 1..3 remaining source rows / destination columns.
      "cmp         %w[width], #1                 \n"
      "csel        %[src1], %[src0], %[src1], eq \n"
      "cmp         %w[width], #2                 \n"
      "csel        %[src2], %[src1], %[src2], le \n"
      "mov         %[src3], %[src2]              \n"
      "ld1w        {z0.s}, p0/z, [%[src0]]       \n"
      "ld1w        {z1.s}, p0/z, [%[src1]]       \n"
      "ld1w        {z2.s}, p0/z, [%[src2]]       \n"
      "ld1w        {z3.s}, p0/z, [%[src3]]       \n"
      "trn1        z4.s, z0.s, z1.s              \n"
      "trn2        z5.s, z0.s, z1.s              \n"
      "trn1        z6.s, z2.s, z3.s              \n"
      "trn2        z7.s, z2.s, z3.s              \n"
      "trn1        z0.d, z4.d, z6.d              \n"
      "trn2        z1.d, z4.d, z6.d              \n"
      "trn1        z2.d, z5.d, z7.d              \n"
      "trn2        z3.d, z5.d, z7.d              \n"
      "whilelt     p0.s, wzr, %w[width]          \n"
      "st1w        {z0.s}, p0, [%[dst0]]         \n"
      "st1w        {z1.s}, p0, [%[dst1]]         \n"
      "st1w        {z2.s}, p0, [%[dst2]]         \n"
      "st1w        {z3.s}, p0, [%[dst3]]         \n"
      "3:                                        \n"
      : [src0] "+r"(src),    // %[src0]
        [src1] "+r"(src1),   // %[src1]
        [src2] "+r"(src2),   // %[src2]
        [src3] "+r"(src3),   // %[src3]
        [dst0] "+r"(dst),    // %[dst0]
        [dst1] "+r"(dst1),   // %[dst1]
        [dst2] "+r"(dst2),   // %[dst2]
        [dst3] "+r"(dst3),   // %[dst3]
        [width] "+r"(width)  // %[width]
      : [s4] "r"(s4)         // %[s4]
      : "cc", "memory", "z0", "z1", "z2", "z3", "z4", "z5", "z6", "z7", "p0");
}

#endif  // !defined(LIBYUV_DISABLE_SVE) && defined(__aarch64__)

#ifdef __cplusplus
}  // extern "C"
}  // namespace libyuv
#endif
