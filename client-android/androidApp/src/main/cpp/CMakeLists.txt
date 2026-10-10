cmake_minimum_required(VERSION 3.22.1)
project(aerodance_yuv LANGUAGES C CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)
set(LIBYUV_DISABLE_JPEG ON CACHE BOOL "" FORCE)
# NDK r27's C probe accepts streaming attributes that its C++ compiler cannot
# fully compile. Keep SME disabled; NEON and supported SVE kernels remain enabled.
set(CAN_COMPILE_SME FALSE CACHE INTERNAL "NDK r27 lacks complete SME support" FORCE)
# Upstream CMake enables separately compiled ARM NEON kernels and runtime dispatch.
add_subdirectory(third_party/libyuv EXCLUDE_FROM_ALL)
target_compile_options(yuv_common_objects PRIVATE -O2)
foreach(kernel neon neon64 sve sme)
    if(TARGET yuv_${kernel})
        target_compile_options(yuv_${kernel} PRIVATE -O2)
    endif()
endforeach()
add_library(aerodance_yuv SHARED yuv_jni.cc)
target_include_directories(aerodance_yuv PRIVATE third_party/libyuv/include)
target_link_libraries(aerodance_yuv PRIVATE yuv jnigraphics)
