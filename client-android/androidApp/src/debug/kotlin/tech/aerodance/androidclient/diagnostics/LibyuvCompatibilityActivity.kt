package tech.aerodance.androidclient.diagnostics

import android.app.Activity
import android.os.Bundle
import android.util.Log
import android.widget.TextView
import tech.aerodance.androidclient.camera.LibyuvBitmap
import java.io.File
import java.nio.ByteBuffer
import java.util.concurrent.Executors
import kotlin.math.abs
import kotlin.math.roundToInt

/** Real JNI/bitmap/NEON checks, including buffer positions and exact final-row limits. */
class LibyuvCompatibilityActivity : Activity() {
    private val worker = Executors.newSingleThreadExecutor()
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val output = TextView(this).apply { text = "Checking libyuv fixtures…" }
        setContentView(output)
        worker.execute {
            val report = runCatching { validate() }.fold({ "PASS $it" }, {
                Log.e("LibyuvCompatibility", "Fixture failure", it)
                "FAIL ${it.javaClass.simpleName}: ${it.message}"
            })
            File(filesDir, "libyuv-compatibility.txt").writeText(report + "\n")
            Log.i("LibyuvCompatibility", report)
            runOnUiThread { if (!isDestroyed) output.text = report }
        }
    }

    private fun validate(): String {
        var fixtures = 0
        var maxError = 0
        val samples = arrayOf(intArrayOf(16, 235, 0, 255, 80, 140),
            intArrayOf(128, 16, 240, 100), intArrayOf(128, 240, 16, 200))
        val shifts = intArrayOf(16, 8, 0)
        val expected = IntArray(3)
        LibyuvBitmap().use { converter ->
            for ((width, height) in listOf(1 to 1, 3 to 5, 4 to 2, 33 to 7, 640 to 480)) {
                for (layout in 0..3) {
                    val cw = (width + 1) / 2; val ch = (height + 1) / 2
                    val yPixel = if (layout == 3) 2 else 1
                    val uPixel = if (layout == 0) 1 else 2
                    val vPixel = if (layout == 3) 3 else uPixel
                    // Includes black/white, below-black/above-white and saturated color samples.
                    fun sample(p: Int, x: Int, y: Int): Int = when (p) {
                        0 -> samples[0][(x + y * 3) % 6]
                        1 -> samples[1][(x + y) % 4]
                        else -> samples[2][(x + y * 2) % 4]
                    }
                    fun plane(p: Int, w: Int, h: Int, pixel: Int): LibyuvBitmap.Plane {
                        val row = w * pixel + 7
                        val size = (h - 1) * row + (w - 1) * pixel + 1
                        val buffer = ByteBuffer.allocateDirect(size + 19)
                        for (y in 0 until h) for (x in 0 until w)
                            buffer.put(11 + y * row + x * pixel, sample(p, x, y).toByte())
                        buffer.position(11); buffer.limit(11 + size)
                        return LibyuvBitmap.Plane(buffer, row, pixel)
                    }
                    val planes = mutableListOf(plane(0, width, height, yPixel),
                        plane(1, cw, ch, uPixel), plane(2, cw, ch, vPixel))
                    if (layout == 2) {
                        // Truly shared NV21 chroma with V immediately before U.
                        val row = cw * 2 + 6
                        val size = (ch - 1) * row + (cw - 1) * 2 + 2
                        val buffer = ByteBuffer.allocateDirect(size + 13)
                        for (y in 0 until ch) for (x in 0 until cw) {
                            buffer.put(11 + y * row + x * 2, sample(2, x, y).toByte())
                            buffer.put(12 + y * row + x * 2, sample(1, x, y).toByte())
                        }
                        fun shared(offset: Int) = LibyuvBitmap.Plane(buffer.duplicate().apply {
                            position(11 + offset); limit(11 + size - (1 - offset))
                        }, row, 2)
                        planes[1] = shared(1); planes[2] = shared(0)
                    }
                    for (rotation in listOf(0, 90, 180, 270)) {
                        val positions = planes.map { it.buffer.position() }
                        val bitmap = converter.convert(width, height, planes, rotation)
                        try {
                            val actual = IntArray(width * height)
                            bitmap.getPixels(actual, 0, bitmap.width, 0, 0, bitmap.width, bitmap.height)
                            for (y in 0 until height) for (x in 0 until width) {
                                val c = sample(0, x, y) - 16.0
                                val u = sample(1, x / 2, y / 2) - 128.0
                                val v = sample(2, x / 2, y / 2) - 128.0
                                expected[0] = (1.164 * c + 1.596 * v).roundToInt().coerceIn(0, 255)
                                expected[1] = (1.164 * c - 0.392 * u - 0.813 * v).roundToInt().coerceIn(0, 255)
                                expected[2] = (1.164 * c + 2.017 * u).roundToInt().coerceIn(0, 255)
                                val index = when (rotation) {
                                    0 -> y * width + x
                                    90 -> x * height + height - 1 - y
                                    180 -> (height - 1 - y) * width + width - 1 - x
                                    else -> (width - 1 - x) * height + y
                                }
                                val pixel = actual[index]
                                check(pixel ushr 24 == 255)
                                for (channel in 0..2) {
                                    val shift = shifts[channel]
                                    val error = abs(((pixel ushr shift) and 255) - expected[channel])
                                    maxError = maxOf(maxError, error)
                                    check(error <= 3) { "${width}x$height layout=$layout rotation=$rotation ($x,$y) channel=$channel error=$error" }
                                }
                            }
                            check(positions == planes.map { it.buffer.position() })
                            fixtures++
                        } finally { bitmap.recycle() }
                    }
                    val truncated = planes.toMutableList()
                    truncated[0] = planes[0].copy(buffer = planes[0].buffer.duplicate().apply { limit(limit() - 1) })
                    check(runCatching { converter.convert(width, height, truncated, 0) }.exceptionOrNull() is IllegalArgumentException)
                }
            }
        }
        return "$fixtures fixtures; RGBA/BT.601/positions/strides/odd dimensions/rotations/truncation; maxChannelError=$maxError"
    }

    override fun onDestroy() { worker.shutdown(); super.onDestroy() }
}
