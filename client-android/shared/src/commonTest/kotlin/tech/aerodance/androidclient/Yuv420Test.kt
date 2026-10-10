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
}
