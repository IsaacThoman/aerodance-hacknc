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

#if !defined(LIBYUV_DISABLE_LASX) && defined(__loongarch_asx)
#include "libyuv/loongson_intrinsics.h"

#ifdef __cplusplus
namespace libyuv {
extern "C" {
#endif

// Transpose 32 bit values (ARGB) in 2x 4x4 tiles per step (4 cols x 8 rows ->
// 4 rows x 8 cols), matching Transpose4x4_32_AVX2. Width is a multiple of 8.
void Transpose4x4_32_LASX(const uint8_t* src,
                          int src_stride,
                          uint8_t* dst,
                          int dst_stride,
                          int width) {
  ptrdiff_t s = src_stride;
  ptrdiff_t s2 = s * 2;
  ptrdiff_t s3 = s + s2;
  ptrdiff_t s4 = s * 4;
  uint8_t* dst0 = dst;
  uint8_t* dst1 = dst0 + dst_stride;
  uint8_t* dst2 = dst1 + dst_stride;
  uint8_t* dst3 = dst2 + dst_stride;
  const uint8_t* src4;

  asm volatile(
      "srli.w     %[w], %[w], 3                        \n"
      "beqz       %[w], 2f                             \n"
      "1:                                              \n"
      "vld        $vr0, %[src], 0                      \n"
      "vldx       $vr1, %[src], %[s]                   \n"
      "vldx       $vr2, %[src], %[s2]                  \n"
      "vldx       $vr3, %[src], %[s3]                  \n"
      "add.d      %[src4], %[src], %[s4]               \n"
      "vld        $vr4, %[src4], 0                     \n"
      "vldx       $vr5, %[src4], %[s]                  \n"
      "vldx       $vr6, %[src4], %[s2]                 \n"
      "vldx       $vr7, %[src4], %[s3]                 \n"
      "add.d      %[src], %[src4], %[s4]               \n"

      // Combine rows (0,4), (1,5), (2,6), (3,7) into 256-bit xr0..xr3
      "xvpermi.q  $xr0, $xr4, 0x02                     \n"
      "xvpermi.q  $xr1, $xr5, 0x02                     \n"
      "xvpermi.q  $xr2, $xr6, 0x02                     \n"
      "xvpermi.q  $xr3, $xr7, 0x02                     \n"

      // Transpose 2x2 across both 128-bit lanes
      "xvilvl.w   $xr4, $xr1, $xr0                     \n"
      "xvilvh.w   $xr5, $xr1, $xr0                     \n"
      "xvilvl.w   $xr6, $xr3, $xr2                     \n"
      "xvilvh.w   $xr7, $xr3, $xr2                     \n"

      // Transpose 4x4 across both 128-bit lanes
      "xvilvl.d   $xr0, $xr6, $xr4                     \n"
      "xvilvh.d   $xr1, $xr6, $xr4                     \n"
      "xvilvl.d   $xr2, $xr7, $xr5                     \n"
      "xvilvh.d   $xr3, $xr7, $xr5                     \n"

      // Store 4 full 256-bit (32-byte) destination rows
      "xvst       $xr0, %[dst0], 0                     \n"
      "xvst       $xr1, %[dst1], 0                     \n"
      "xvst       $xr2, %[dst2], 0                     \n"
      "xvst       $xr3, %[dst3], 0                     \n"
      "addi.d     %[dst0], %[dst0], 32                 \n"
      "addi.d     %[dst1], %[dst1], 32                 \n"
      "addi.d     %[dst2], %[dst2], 32                 \n"
      "addi.d     %[dst3], %[dst3], 32                 \n"
      "addi.w     %[w], %[w], -1                       \n"
      "bnez       %[w], 1b                             \n"
      "2:                                              \n"
      : [src] "+r"(src),     // %[src]
        [src4] "=&r"(src4),  // %[src4]
        [dst0] "+r"(dst0),   // %[dst0]
        [dst1] "+r"(dst1),   // %[dst1]
        [dst2] "+r"(dst2),   // %[dst2]
        [dst3] "+r"(dst3),   // %[dst3]
        [w] "+r"(width)      // %[w]
      : [s] "r"(s),          // %[s]
        [s2] "r"(s2),        // %[s2]
        [s3] "r"(s3),        // %[s3]
        [s4] "r"(s4)         // %[s4]
      : "memory", "$xr0", "$xr1", "$xr2", "$xr3", "$xr4", "$xr5", "$xr6",
        "$xr7");
}

#ifdef __cplusplus
}  // extern "C"
}  // namespace libyuv
#endif

#endif  // !defined(LIBYUV_DISABLE_LASX) && defined(__loongarch_asx)
