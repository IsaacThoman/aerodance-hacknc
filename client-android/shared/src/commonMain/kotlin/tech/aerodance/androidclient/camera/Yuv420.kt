package tech.aerodance.androidclient.camera

data class YuvPlane(val bytes: ByteArray, val rowStride: Int, val pixelStride: Int)

/** Limited-range YUV to unmirrored upright ARGB; bytes start at each plane's position. */
fun yuv420Argb(width: Int, height: Int, planes: List<YuvPlane>, rotation: Int): IntArray {
    require(width > 0 && height > 0 && planes.size == 3 && rotation in listOf(0, 90, 180, 270))
    planes.forEachIndexed { index, plane ->
        val w = if (index == 0) width else (width + 1) / 2
        val h = if (index == 0) height else (height + 1) / 2
        require(plane.rowStride > 0 && plane.pixelStride > 0)
        require((h - 1).toLong() * plane.rowStride + (w - 1).toLong() * plane.pixelStride < plane.bytes.size)
    }
    val yp = planes[0]; val up = planes[1]; val vp = planes[2]
    val yBytes = yp.bytes; val uBytes = up.bytes; val vBytes = vp.bytes
    val pixels = IntArray(width * height)
    val uprightWidth = if (rotation % 180 == 0) width else height
    for (y in 0 until height) {
        val yRow = y * yp.rowStride
        val uRow = y / 2 * up.rowStride
        val vRow = y / 2 * vp.rowStride
        for (x in 0 until width) {
            val c = maxOf(0, (yBytes[yRow + x * yp.pixelStride].toInt() and 255) - 16)
            val u = (uBytes[uRow + x / 2 * up.pixelStride].toInt() and 255) - 128
            val v = (vBytes[vRow + x / 2 * vp.pixelStride].toInt() and 255) - 128
            val r = ((298 * c + 409 * v + 128) shr 8).coerceIn(0, 255)
            val g = ((298 * c - 100 * u - 208 * v + 128) shr 8).coerceIn(0, 255)
            val b = ((298 * c + 516 * u + 128) shr 8).coerceIn(0, 255)
            val index = when (rotation) {
                90 -> x * uprightWidth + height - 1 - y
                180 -> (height - 1 - y) * uprightWidth + width - 1 - x
                270 -> (width - 1 - x) * uprightWidth + y
                else -> y * width + x
            }
            pixels[index] = (255 shl 24) or (r shl 16) or (g shl 8) or b
        }
    }
    return pixels
}
