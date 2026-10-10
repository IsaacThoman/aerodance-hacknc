package tech.aerodance.androidclient.camera

import android.graphics.Bitmap
import android.graphics.ImageFormat
import android.media.Image

/** Worker-confined libyuv conversion into independently owned inference bitmap storage. */
class YuvToBitmap : AutoCloseable {
    private var native: LibyuvBitmap? = null

    fun convert(image: Image, rotation: Int): Bitmap {
        require(image.format == ImageFormat.YUV_420_888)
        val crop = image.cropRect
        require(crop.left == 0 && crop.top == 0 && crop.right == image.width && crop.bottom == image.height) {
            "Cropped YUV input is unsupported"
        }
        val converter = native ?: LibyuvBitmap().also { native = it }
        return converter.convert(image.width, image.height, image.planes.map {
            LibyuvBitmap.Plane(it.buffer, it.rowStride, it.pixelStride)
        }, rotation)
    }

    override fun close() { native?.close(); native = null }
}
