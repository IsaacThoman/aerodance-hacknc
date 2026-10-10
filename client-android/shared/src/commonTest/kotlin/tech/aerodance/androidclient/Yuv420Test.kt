package tech.aerodance.androidclient

import kotlin.test.*
import tech.aerodance.androidclient.camera.YuvPlane
import tech.aerodance.androidclient.camera.yuv420Argb

class Yuv420Test {
    @Test fun paddedInterleavedPlanesMatchPackedPlanesAndRotateWithoutMirroring() {
        val packed = listOf(
            YuvPlane(byteArrayOf(16, 40, 80, 100, 120, 140.toByte(), 160.toByte(), 235.toByte()), 4, 1),
            YuvPlane(byteArrayOf(128.toByte(), 100), 2, 1),
            YuvPlane(byteArrayOf(128.toByte(), 200.toByte()), 2, 1))
        val padded = listOf(
            YuvPlane(byteArrayOf(16, 40, 80, 100, 0, 0, 120, 140.toByte(), 160.toByte(), 235.toByte()), 6, 1),
            YuvPlane(byteArrayOf(128.toByte(), 0, 100), 4, 2),
            YuvPlane(byteArrayOf(128.toByte(), 0, 200.toByte()), 4, 2))
        val raw = yuv420Argb(4, 2, packed, 0)
        assertEquals(0xff000000.toInt(), raw[0])
        assertContentEquals(raw, yuv420Argb(4, 2, padded, 0))
        assertContentEquals(intArrayOf(raw[4], raw[0], raw[5], raw[1], raw[6], raw[2], raw[7], raw[3]),
            yuv420Argb(4, 2, padded, 90))
        assertContentEquals(raw.reversedArray(), yuv420Argb(4, 2, packed, 180))
        assertContentEquals(intArrayOf(raw[3], raw[7], raw[2], raw[6], raw[1], raw[5], raw[0], raw[4]),
            yuv420Argb(4, 2, packed, 270))
    }
    @Test fun truncatedPlaneFailsBeforeReadingIt() {
        assertFailsWith<IllegalArgumentException> {
            yuv420Argb(2, 2, List(3) { YuvPlane(byteArrayOf(16), 2, 1) }, 0)
        }
    }

    @Test fun reusedDestinationMatchesReferenceForOddSizesStridesAndAllRotations() {
        val width = 5; val height = 3
        val planes = listOf(
            YuvPlane(ByteArray(29) { (it * 37).toByte() }, 10, 2),
            YuvPlane(ByteArray(13) { (it * 53).toByte() }, 8, 2),
            YuvPlane(ByteArray(15) { (it * 71).toByte() }, 8, 3))
        val destination = IntArray(width * height)
        for (rotation in listOf(0, 90, 180, 270)) {
            val expected = IntArray(width * height)
            for (y in 0 until height) for (x in 0 until width) {
                fun sample(p: Int, px: Int, py: Int) =
                    planes[p].bytes[py * planes[p].rowStride + px * planes[p].pixelStride].toInt() and 255
                val c = maxOf(0, sample(0, x, y) - 16)
                val u = sample(1, x / 2, y / 2) - 128
                val v = sample(2, x / 2, y / 2) - 128
                val r = ((298 * c + 409 * v + 128) shr 8).coerceIn(0, 255)
                val g = ((298 * c - 100 * u - 208 * v + 128) shr 8).coerceIn(0, 255)
                val b = ((298 * c + 516 * u + 128) shr 8).coerceIn(0, 255)
                val index = when (rotation) {
                    90 -> x * height + height - 1 - y
                    180 -> (height - 1 - y) * width + width - 1 - x
                    270 -> (width - 1 - x) * height + y
                    else -> y * width + x
                }
                expected[index] = (255 shl 24) or (r shl 16) or (g shl 8) or b
            }
            destination.fill(0x12345678)
            assertSame(destination, yuv420Argb(width, height, planes, rotation, destination))
            assertContentEquals(expected, destination)
        }
        assertFailsWith<IllegalArgumentException> { yuv420Argb(width, height, planes, 0, IntArray(1)) }
    }
}
