package tech.aerodance.androidclient.camera

import android.graphics.Bitmap
import android.graphics.ImageFormat
import android.media.Image

/** Bulk copy planes before conversion, avoiding a direct ByteBuffer read for every pixel. */
fun uprightBitmap(image: Image, rotation: Int): Bitmap {
    require(image.format == ImageFormat.YUV_420_888)
    val planes = image.planes.map { plane ->
        val buffer = plane.buffer.duplicate()
        val bytes = ByteArray(buffer.remaining())
        buffer.get(bytes)
        YuvPlane(bytes, plane.rowStride, plane.pixelStride)
    }
    val pixels = yuv420Argb(image.width, image.height, planes, rotation)
    val sideways = rotation % 180 != 0
    return Bitmap.createBitmap(pixels, if (sideways) image.height else image.width,
        if (sideways) image.width else image.height, Bitmap.Config.ARGB_8888)
}
