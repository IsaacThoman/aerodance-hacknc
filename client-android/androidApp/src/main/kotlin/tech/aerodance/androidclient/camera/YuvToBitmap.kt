package tech.aerodance.androidclient.camera

import android.graphics.Bitmap
import android.graphics.ImageFormat
import android.media.Image

/** Bulk copy planes before conversion, avoiding a direct ByteBuffer read for every pixel. */
class YuvToBitmap {
    private val planeBytes = Array(3) { ByteArray(0) }
    private var pixels = IntArray(0)

    /** Worker-confined scratch buffers; the returned bitmap owns a separate pixel copy. */
    fun convert(image: Image, rotation: Int): Bitmap {
        require(image.format == ImageFormat.YUV_420_888)
        val planes = image.planes.mapIndexed { index, plane ->
            val buffer = plane.buffer.duplicate()
            val size = buffer.remaining()
            // Exact lengths keep truncated-plane validation correct after a size change.
            if (planeBytes[index].size != size) planeBytes[index] = ByteArray(size)
            val bytes = planeBytes[index]
            buffer.get(bytes)
            YuvPlane(bytes, plane.rowStride, plane.pixelStride)
        }
        if (pixels.size != image.width * image.height) pixels = IntArray(image.width * image.height)
        yuv420Argb(image.width, image.height, planes, rotation, pixels)
        val sideways = rotation % 180 != 0
        return Bitmap.createBitmap(pixels, if (sideways) image.height else image.width,
            if (sideways) image.width else image.height, Bitmap.Config.ARGB_8888)
    }
}
