package tech.aerodance.androidclient.camera

data class YuvPlane(val bytes: ByteArray, val rowStride: Int, val pixelStride: Int)

/** Limited-range YUV to unmirrored upright ARGB; bytes start at each plane's position. */
fun yuv420Argb(width: Int, height: Int, planes: List<YuvPlane>, rotation: Int,
    pixels: IntArray = IntArray(width * height)): IntArray {
    require(width > 0 && height > 0 && planes.size == 3 && rotation in listOf(0, 90, 180, 270))
    require(width.toLong() * height == pixels.size.toLong())
    planes.forEachIndexed { index, plane ->
        val w = if (index == 0) width else (width + 1) / 2
        val h = if (index == 0) height else (height + 1) / 2
        require(plane.rowStride > 0 && plane.pixelStride > 0)
        require((h - 1).toLong() * plane.rowStride + (w - 1).toLong() * plane.pixelStride < plane.bytes.size)
    }
    val yp = planes[0]; val up = planes[1]; val vp = planes[2]
    val yBytes = yp.bytes; val uBytes = up.bytes; val vBytes = vp.bytes
    val uprightWidth = if (rotation % 180 == 0) width else height
    val step = when (rotation) { 90 -> uprightWidth; 180 -> -1; 270 -> -uprightWidth; else -> 1 }
    for (y in 0 until height) {
        val yRow = y * yp.rowStride
        val uRow = y / 2 * up.rowStride
        val vRow = y / 2 * vp.rowStride
        var index = when (rotation) {
            90 -> height - 1 - y
            180 -> (height - 1 - y) * uprightWidth + width - 1
            270 -> (width - 1) * uprightWidth + y
            else -> y * width
        }
        var red = 0; var green = 0; var blue = 0
        for (x in 0 until width) {
            val c = maxOf(0, (yBytes[yRow + x * yp.pixelStride].toInt() and 255) - 16)
            // Each pair shares chroma; calculate its color contribution once.
            if (x % 2 == 0) {
                val u = (uBytes[uRow + x / 2 * up.pixelStride].toInt() and 255) - 128
                val v = (vBytes[vRow + x / 2 * vp.pixelStride].toInt() and 255) - 128
                red = 409 * v + 128
                green = -100 * u - 208 * v + 128
                blue = 516 * u + 128
            }
            val luma = 298 * c
            val r = ((luma + red) shr 8).coerceIn(0, 255)
            val g = ((luma + green) shr 8).coerceIn(0, 255)
            val b = ((luma + blue) shr 8).coerceIn(0, 255)
            pixels[index] = (255 shl 24) or (r shl 16) or (g shl 8) or b
            index += step
        }
    }
    return pixels
}
