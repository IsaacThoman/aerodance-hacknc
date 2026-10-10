#include <jni.h>
#include <android/bitmap.h>
#include <libyuv.h>
#include <cstdint>
#include <new>
#include <vector>

namespace {
struct Converter { std::vector<uint8_t> planar, rgba; };
struct Plane { const uint8_t* data; int row, pixel; jlong size; };
bool valid(const Plane& p, int w, int h) {
  return p.data && p.row > 0 && p.pixel > 0 &&
      int64_t(w - 1) * p.pixel + 1 <= p.row &&
      int64_t(h - 1) * p.row + int64_t(w - 1) * p.pixel < p.size;
}
void pack(const Plane& p, uint8_t* dst, int w, int h) {
  for (int y = 0; y < h; ++y)
    for (int x = 0; x < w; ++x)
      dst[y * w + x] = p.data[size_t(y) * p.row + size_t(x) * p.pixel];
}
}  // namespace

extern "C" JNIEXPORT jlong JNICALL
Java_tech_aerodance_androidclient_camera_LibyuvBitmap_create(JNIEnv* env, jobject) {
  auto* converter = new (std::nothrow) Converter;
  if (!converter) env->ThrowNew(env->FindClass("java/lang/OutOfMemoryError"), "libyuv scratch allocation");
  return reinterpret_cast<jlong>(converter);
}
extern "C" JNIEXPORT void JNICALL
Java_tech_aerodance_androidclient_camera_LibyuvBitmap_destroy(JNIEnv*, jobject, jlong handle) {
  delete reinterpret_cast<Converter*>(handle);
}
extern "C" JNIEXPORT jint JNICALL
Java_tech_aerodance_androidclient_camera_LibyuvBitmap_convertNative(
    JNIEnv* env, jobject, jlong handle, jint w, jint h,
    jobject y, jint yr, jint yp, jobject u, jint ur, jint up,
    jobject v, jint vr, jint vp, jint rotation, jobject bitmap) {
  auto* converter = reinterpret_cast<Converter*>(handle);
  if (!converter || w <= 0 || h <= 0 || int64_t(w) * h > INT32_MAX / 4 ||
      (rotation != 0 && rotation != 90 && rotation != 180 && rotation != 270)) return -1;
  const int cw = (w + 1) / 2, ch = (h + 1) / 2;
  Plane py{static_cast<const uint8_t*>(env->GetDirectBufferAddress(y)), yr, yp, env->GetDirectBufferCapacity(y)};
  Plane pu{static_cast<const uint8_t*>(env->GetDirectBufferAddress(u)), ur, up, env->GetDirectBufferCapacity(u)};
  Plane pv{static_cast<const uint8_t*>(env->GetDirectBufferAddress(v)), vr, vp, env->GetDirectBufferCapacity(v)};
  if (!valid(py, w, h) || !valid(pu, cw, ch) || !valid(pv, cw, ch)) return -1;
  AndroidBitmapInfo info{};
  const bool sideways = rotation == 90 || rotation == 270;
  if (AndroidBitmap_getInfo(env, bitmap, &info) != ANDROID_BITMAP_RESULT_SUCCESS ||
      info.format != ANDROID_BITMAP_FORMAT_RGBA_8888 ||
      info.width != uint32_t(sideways ? h : w) || info.height != uint32_t(sideways ? w : h) ||
      info.stride < info.width * 4 || info.stride > INT32_MAX) return -1;
  // Allocate scratch before locking so allocation failure cannot leave the bitmap locked.
  try {
    if (rotation) converter->rgba.resize(size_t(w) * h * 4);
    const uintptr_t u_address = reinterpret_cast<uintptr_t>(pu.data);
    const uintptr_t v_address = reinterpret_cast<uintptr_t>(pv.data);
    const bool interleaved = up == 2 && vp == 2 && ur == vr &&
        (u_address + 1 == v_address || v_address + 1 == u_address);
    // Avoid libyuv's per-call UV weave allocation for separate strided planes.
    if (yp != 1 || !((up == 1 && vp == 1) || interleaved)) {
      converter->planar.resize(size_t(w) * h + size_t(cw) * ch * 2);
      auto* dst_y = converter->planar.data();
      auto* dst_u = dst_y + size_t(w) * h;
      auto* dst_v = dst_u + size_t(cw) * ch;
      pack(py, dst_y, w, h); pack(pu, dst_u, cw, ch); pack(pv, dst_v, cw, ch);
      py = {dst_y, w, 1, int64_t(w) * h};
      pu = {dst_u, cw, 1, int64_t(cw) * ch};
      pv = {dst_v, cw, 1, int64_t(cw) * ch};
    }
  } catch (const std::bad_alloc&) {
    env->ThrowNew(env->FindClass("java/lang/OutOfMemoryError"), "libyuv scratch allocation");
    return -1;
  }
  void* pixels = nullptr;
  if (AndroidBitmap_lockPixels(env, bitmap, &pixels) != ANDROID_BITMAP_RESULT_SUCCESS) return -1;
  auto* dst = rotation ? converter->rgba.data() : static_cast<uint8_t*>(pixels);
  // ABGR is RGBA byte order on Android's little-endian bitmap storage. I601 is limited-range BT.601.
  int result = libyuv::Android420ToABGR(py.data, py.row, pu.data, pu.row, pv.data, pv.row,
      pu.pixel, dst, rotation ? w * 4 : int(info.stride), w, h);
  if (result == 0 && rotation)
    result = libyuv::ARGBRotate(dst, w * 4, static_cast<uint8_t*>(pixels), int(info.stride),
        w, h, static_cast<libyuv::RotationMode>(rotation));
  const int unlocked = AndroidBitmap_unlockPixels(env, bitmap);
  return result == 0 && unlocked == ANDROID_BITMAP_RESULT_SUCCESS ? 0 : -1;
}
