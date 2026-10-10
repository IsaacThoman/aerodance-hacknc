package tech.aerodance.androidclient.camera

import android.graphics.Bitmap
import java.nio.ByteBuffer

/** Worker-confined native scratch; destination bitmap belongs to the caller, never this converter. */
internal class LibyuvBitmap : AutoCloseable {
    private var handle = create()

    fun convert(width: Int, height: Int, planes: List<Plane>, rotation: Int): Bitmap {
        check(handle != 0L)
        require(width > 0 && height > 0 && width.toLong() * height <= Int.MAX_VALUE / 4)
        require(rotation in listOf(0, 90, 180, 270) && planes.size == 3)
        planes.forEachIndexed { index, plane ->
            val w = if (index == 0) width else (width + 1) / 2
            val h = if (index == 0) height else (height + 1) / 2
            require(plane.buffer.isDirect && plane.rowStride > 0 && plane.pixelStride > 0)
            require((w - 1).toLong() * plane.pixelStride + 1 <= plane.rowStride)
            require((h - 1).toLong() * plane.rowStride + (w - 1).toLong() * plane.pixelStride < plane.buffer.remaining())
        }
        val sideways = rotation % 180 != 0
        val bitmap = Bitmap.createBitmap(if (sideways) height else width,
            if (sideways) width else height, Bitmap.Config.ARGB_8888)
        try {
            // slice() gives JNI address zero at the actual plane position and capacity at its limit.
            val y = planes[0]; val u = planes[1]; val v = planes[2]
            check(convertNative(handle, width, height,
                y.buffer.slice(), y.rowStride, y.pixelStride,
                u.buffer.slice(), u.rowStride, u.pixelStride,
                v.buffer.slice(), v.rowStride, v.pixelStride, rotation, bitmap) == 0) {
                "libyuv conversion failed"
            }
            return bitmap
        } catch (error: Throwable) { bitmap.recycle(); throw error }
    }

    override fun close() { if (handle != 0L) { destroy(handle); handle = 0 } }

    data class Plane(val buffer: ByteBuffer, val rowStride: Int, val pixelStride: Int)
    private external fun create(): Long
    private external fun destroy(handle: Long)
    private external fun convertNative(handle: Long, width: Int, height: Int,
        y: ByteBuffer, yRow: Int, yPixel: Int, u: ByteBuffer, uRow: Int, uPixel: Int,
        v: ByteBuffer, vRow: Int, vPixel: Int, rotation: Int, bitmap: Bitmap): Int

    companion object { init { System.loadLibrary("aerodance_yuv") } }
}
