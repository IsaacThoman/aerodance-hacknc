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

// This module is for RVV (RISC-V Vector extension)
#if !defined(LIBYUV_DISABLE_RVV) && defined(__riscv_vector)
#ifdef __cplusplus
namespace libyuv {
extern "C" {
#endif

#ifndef RVV_VL_CLOBBER
#ifdef __clang__
#define RVV_VL_CLOBBER
#else
#define RVV_VL_CLOBBER "vl",
#endif
#endif

#ifdef HAS_TRANSPOSENX4_32_RVV
// Transpose 32 bit values (ARGB) in Nx4 tiles, moving down N rows of source
// (VL at a time) and across N columns of destination (4 rows).
// Tuned for 512-bit VL (SiFive X280).
void TransposeNx4_32_RVV(const uint8_t* src,
                         int src_stride,
                         uint8_t* dst,
                         int dst_stride,
                         int width) {
  int vl;
  ptrdiff_t src_step;
  ptrdiff_t dst_step;
  uint8_t* dst1 = dst + (ptrdiff_t)dst_stride;
  uint8_t* dst2 = dst1 + (ptrdiff_t)dst_stride;
  uint8_t* dst3 = dst2 + (ptrdiff_t)dst_stride;
  asm volatile(
      "vsetvli      %[vl], %[w], e32, m2, ta, ma       \n"
      "slli         %[dst_step], %[vl], 2              \n"
      "mul          %[src_step], %[vl], %[src_stride]  \n"
      "sub          %[w], %[w], %[vl]                  \n"
      "bltz         %[w], 2f                           \n"
      "1:                                              \n"
      "vlsseg4e32.v v8, (%[src]), %[src_stride]        \n"
      "add          %[src], %[src], %[src_step]        \n"
      "vse32.v      v8, (%[dst0])                      \n"
      "vse32.v      v10, (%[dst1])                     \n"
      "vse32.v      v12, (%[dst2])                     \n"
      "vse32.v      v14, (%[dst3])                     \n"
      "add          %[dst0], %[dst0], %[dst_step]      \n"
      "add          %[dst1], %[dst1], %[dst_step]      \n"
      "add          %[dst2], %[dst2], %[dst_step]      \n"
      "add          %[dst3], %[dst3], %[dst_step]      \n"
      "sub          %[w], %[w], %[vl]                  \n"
      "bgez         %[w], 1b                           \n"
      "2:                                              \n"
      "add          %[w], %[w], %[vl]                  \n"
      "beqz         %[w], 3f                           \n"
      "vsetvli      %[vl], %[w], e32, m2, ta, ma       \n"
      "vlsseg4e32.v v8, (%[src]), %[src_stride]        \n"
      "vse32.v      v8, (%[dst0])                      \n"
      "vse32.v      v10, (%[dst1])                     \n"
      "vse32.v      v12, (%[dst2])                     \n"
      "vse32.v      v14, (%[dst3])                     \n"
      "3:                                              \n"
      : [w] "+r"(width),                         // %[w]
        [src] "+r"(src),                         // %[src]
        [dst0] "+r"(dst),                        // %[dst0]
        [dst1] "+r"(dst1),                       // %[dst1]
        [dst2] "+r"(dst2),                       // %[dst2]
        [dst3] "+r"(dst3),                       // %[dst3]
        [vl] "=&r"(vl),                          // %[vl]
        [src_step] "=&r"(src_step),              // %[src_step]
        [dst_step] "=&r"(dst_step)               // %[dst_step]
      : [src_stride] "r"((ptrdiff_t)src_stride)  // %[src_stride]
      : RVV_VL_CLOBBER "vtype", "memory", "v8", "v9", "v10", "v11", "v12",
        "v13", "v14", "v15");
}
#endif  // HAS_TRANSPOSE4X4_32_RVV

#ifdef HAS_TRANSPOSEWXH_32_RVV
// Transpose 32 bit plane of any width x height using RVV without scalar
// fallback.
void TransposeWxH_32_RVV(const uint8_t* src,
                         int src_stride,
                         uint8_t* dst,
                         int dst_stride,
                         int width,
                         int height) {
  while (width >= 4) {
    TransposeNx4_32_RVV(src, src_stride, dst, dst_stride, height);
    src += 16;
    dst += 4 * (ptrdiff_t)dst_stride;
    width -= 4;
  }
  while (width > 0) {
    const uint8_t* s_col = src;
    uint8_t* d_row = dst;
    int h = height;
    int vl;
    ptrdiff_t src_step;
    ptrdiff_t dst_step;
    asm volatile(
        "vsetvli  %[vl], %[h], e32, m8, ta, ma       \n"
        "slli     %[d_step], %[vl], 2                \n"
        "mul      %[s_step], %[vl], %[src_stride]    \n"
        "sub      %[h], %[h], %[vl]                  \n"
        "bltz     %[h], 2f                           \n"
        "1:                                          \n"
        "vlse32.v v8, (%[s]), %[src_stride]          \n"
        "add      %[s], %[s], %[s_step]              \n"
        "vse32.v  v8, (%[d])                         \n"
        "add      %[d], %[d], %[d_step]              \n"
        "sub      %[h], %[h], %[vl]                  \n"
        "bgez     %[h], 1b                           \n"
        "2:                                          \n"
        "add      %[h], %[h], %[vl]                  \n"
        "beqz     %[h], 3f                           \n"
        "vsetvli  %[vl], %[h], e32, m8, ta, ma       \n"
        "vlse32.v v8, (%[s]), %[src_stride]          \n"
        "vse32.v  v8, (%[d])                         \n"
        "3:                                          \n"
        : [h] "+r"(h),                             // %[h]
          [s] "+r"(s_col),                         // %[s]
          [d] "+r"(d_row),                         // %[d]
          [vl] "=&r"(vl),                          // %[vl]
          [s_step] "=&r"(src_step),                // %[s_step]
          [d_step] "=&r"(dst_step)                 // %[d_step]
        : [src_stride] "r"((ptrdiff_t)src_stride)  // %[src_stride]
        : RVV_VL_CLOBBER "vtype", "memory", "v8", "v9", "v10", "v11", "v12",
          "v13", "v14", "v15");
    src += 4;
    dst += (ptrdiff_t)dst_stride;
    width -= 1;
  }
}
#endif  // HAS_TRANSPOSEWXH_32_RVV

#ifdef __cplusplus
}  // extern "C"
}  // namespace libyuv
#endif

#endif  // !defined(LIBYUV_DISABLE_RVV) && defined(__riscv_vector)
