package tech.aerodance.androidclient.diagnostics

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.ImageFormat
import android.graphics.Matrix
import android.hardware.camera2.CameraCaptureSession
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraDevice
import android.hardware.camera2.CameraManager
import android.hardware.camera2.CaptureRequest
import android.media.Image
import android.media.ImageReader
import android.os.Bundle
import android.os.Handler
import android.os.HandlerThread
import android.os.SystemClock
import android.util.Log
import android.util.Range
import android.widget.TextView
import java.io.File
import java.util.UUID
import com.google.mediapipe.tasks.core.Delegate
import tech.aerodance.androidclient.camera.CameraSource
import tech.aerodance.androidclient.pose.LivePoseEstimator
import tech.aerodance.androidclient.protocol.PoseRecord

/** Debug-only bounded Camera2 capture check; no preview, network output, or inference. */
class CameraCompatibilityActivity : Activity() {
    private val thread = HandlerThread("camera-probe")
    private lateinit var worker: Handler
    private lateinit var output: TextView
    private var camera: CameraDevice? = null
    private var session: CameraCaptureSession? = null
    private var reader: ImageReader? = null
    private var finished = false
    private var frames = 0
    private var firstArrival = 0L
    private var lastArrival = 0L
    private var firstSensor = 0L
    private var lastSensor = 0L
    private var badTimestamps = 0
    private var minInterval = Long.MAX_VALUE
    private var maxInterval = 0L
    private var orientation = 0
    private var strides = ""
    private var content = "no snapshot"
    private var snapshotTaken = false
    private var fps = Range(30, 30)
    private var live = false
    private var delegate = Delegate.CPU
    private var durationMs = 12_000L
    private var estimator: LivePoseEstimator? = null
    private var results = 0
    private var detected = 0
    private var empty = 0
    private var latest: PoseRecord? = null
    private var conversionTotal = 0L
    private var inferenceTotal = 0L
    private var maxAge = 0L
    private var destroyRequested = false
    private var resourcesClosed = false
    private val captureTimeout = Runnable { finishProbe("FAIL capture timeout: frames=$frames") }
    private val captureComplete = Runnable { complete() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        output = TextView(this).apply { text = "Checking camera 0, 640×480 YUV, 30 FPS…" }
        setContentView(output)
        fps = Range(intent.getIntExtra("fpsMin", 30), intent.getIntExtra("fpsMax", 30))
        live = intent.getBooleanExtra("livePose", false)
        delegate = if (intent.getBooleanExtra("gpu", false)) Delegate.GPU else Delegate.CPU
        durationMs = intent.getLongExtra("durationMs", 12_000L).coerceIn(12_000L, 120_000L)
        thread.start()
        worker = Handler(thread.looper)
        if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            worker.post { startProbe() }
        } else requestPermissions(arrayOf(Manifest.permission.CAMERA), 1)
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == 1) worker.post {
            if (grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) startProbe()
            else finishProbe("FAIL camera permission denied")
        }
    }

    private fun startProbe() {
        if (finished) return
        File(filesDir, "camera-compatibility.txt").delete()
        File(filesDir, "camera-upright.png").delete()
        worker.postDelayed(captureTimeout, durationMs + 8_000)
        try {
            val manager = getSystemService(CameraManager::class.java)
            val characteristics = manager.getCameraCharacteristics("0")
            orientation = characteristics.get(CameraCharacteristics.SENSOR_ORIENTATION) ?: 0
            if (live) {
                File(filesDir, "camera-live-pose.json").delete()
                estimator = LivePoseEstimator(this, UUID.randomUUID().toString(), CameraSource.INPUT_ROTATION_DEGREES,
                    onResult = { record, conversion, inference -> worker.post {
                        if (!finished) {
                            results++
                            if (record.poses.isEmpty()) empty++ else detected++
                            latest = record
                            conversionTotal += conversion
                            inferenceTotal += inference
                            maxAge = maxOf(maxAge, record.resultTimeMs - record.frameReceivedTimeMs)
                        }
                    } },
                    onError = { error -> worker.post { fail(Exception("LIVE_STREAM failure", error)) } },
                    onClosed = { worker.post { closeReader() } }, delegate = delegate)
            }
            check(characteristics.get(CameraCharacteristics.CONTROL_AE_AVAILABLE_TARGET_FPS_RANGES)
                ?.contains(fps) == true) { "$fps unavailable" }
            reader = ImageReader.newInstance(640, 480, ImageFormat.YUV_420_888, 3).apply {
                setOnImageAvailableListener({ source ->
                    if (!finished) {
                        try {
                            source.acquireLatestImage()?.let { image ->
                                val arrival = SystemClock.elapsedRealtime()
                                if (live) {
                                    try { inspect(image) } catch (error: Exception) { image.close(); throw error }
                                    estimator!!.offer(image, arrival)
                                } else image.use { inspect(it) }
                            }
                        }
                        catch (error: Exception) { fail(error) }
                    }
                }, worker)
            }
            manager.openCamera("0", object : CameraDevice.StateCallback() {
                override fun onOpened(device: CameraDevice) {
                    if (finished) { device.close(); return }
                    camera = device
                    try {
                        device.createCaptureSession(listOf(reader!!.surface), object : CameraCaptureSession.StateCallback() {
                            override fun onConfigured(configured: CameraCaptureSession) {
                                if (finished) { configured.close(); return }
                                session = configured
                                try {
                                    val request = device.createCaptureRequest(CameraDevice.TEMPLATE_RECORD).apply {
                                        addTarget(reader!!.surface)
                                        set(CaptureRequest.CONTROL_MODE, CaptureRequest.CONTROL_MODE_AUTO)
                                        set(CaptureRequest.CONTROL_AE_TARGET_FPS_RANGE, fps)
                                        set(CaptureRequest.CONTROL_AF_MODE, CaptureRequest.CONTROL_AF_MODE_OFF)
                                        set(CaptureRequest.CONTROL_AE_MODE, CaptureRequest.CONTROL_AE_MODE_ON)
                                        set(CaptureRequest.CONTROL_AWB_MODE, CaptureRequest.CONTROL_AWB_MODE_AUTO)
                                        set(CaptureRequest.CONTROL_AE_ANTIBANDING_MODE, CaptureRequest.CONTROL_AE_ANTIBANDING_MODE_OFF)
                                        // Ciroc day controls, gated on the current HAL's advertised keys.
                                        val names = characteristics.availableCaptureRequestKeys.orEmpty().map { it.name }
                                        for ((name, value) in listOf(
                                            "com.flocksafety.camera.flock_night_mode" to 0.toByte(),
                                            "android.statistics.histogramMode" to 1.toByte(),
                                        )) {
                                            if (name in names) set(CaptureRequest.Key(name, Byte::class.javaPrimitiveType!!), value)
                                            Log.i(TAG, "$name supported=${name in names}")
                                        }
                                    }.build()
                                    configured.setRepeatingRequest(request, null, worker)
                                    worker.postDelayed(captureComplete, durationMs)
                                } catch (error: Exception) { fail(error) }
                            }
                            override fun onConfigureFailed(configured: CameraCaptureSession) {
                                configured.close()
                                finishProbe("FAIL session configuration")
                            }
                        }, worker)
                    } catch (error: Exception) { fail(error) }
                }
                override fun onDisconnected(device: CameraDevice) {
                    device.close(); finishProbe("FAIL camera disconnected")
                }
                override fun onError(device: CameraDevice, error: Int) {
                    device.close(); finishProbe("FAIL camera error=$error")
                }
            }, worker)
        } catch (error: Exception) { fail(error) }
    }

    private fun inspect(image: Image) {
        if (snapshotTaken) return // Drain callbacks queued during PNG saving without extending the measurement.
        val arrival = SystemClock.elapsedRealtimeNanos()
        check(image.width == 640 && image.height == 480 && image.format == ImageFormat.YUV_420_888)
        if (frames == 0) {
            firstArrival = arrival
            firstSensor = image.timestamp
            strides = image.planes.joinToString { "${it.rowStride}/${it.pixelStride}" }
        } else {
            if (image.timestamp <= lastSensor) badTimestamps++
            val interval = arrival - lastArrival
            minInterval = minOf(minInterval, interval)
            maxInterval = maxOf(maxInterval, interval)
        }
        frames++
        lastArrival = arrival
        lastSensor = image.timestamp
        // Measure capture before the expensive diagnostic PNG conversion on this low-RAM board.
        if (!live && !snapshotTaken && frames >= 30 && arrival - firstArrival >= 11_000_000_000L) {
            snapshotTaken = true
            snapshot(image)
            worker.post { complete() } // The acquired image closes before teardown.
        }
    }

    private fun snapshot(image: Image) {
        val planes = image.planes
        val buffers = planes.map { it.buffer.duplicate() }
        fun sample(plane: Int, x: Int, y: Int): Int {
            val p = planes[plane]
            val b = buffers[plane]
            return b.get(b.position() + y * p.rowStride + x * p.pixelStride).toInt() and 255
        }
        val pixels = IntArray(image.width * image.height)
        var minY = 255
        var maxY = 0
        var sumY = 0L
        for (y in 0 until image.height) for (x in 0 until image.width) {
            val luma = sample(0, x, y)
            minY = minOf(minY, luma); maxY = maxOf(maxY, luma); sumY += luma
            val c = maxOf(0, luma - 16)
            val u = sample(1, x / 2, y / 2) - 128
            val v = sample(2, x / 2, y / 2) - 128
            val r = ((298 * c + 409 * v + 128) shr 8).coerceIn(0, 255)
            val g = ((298 * c - 100 * u - 208 * v + 128) shr 8).coerceIn(0, 255)
            val b = ((298 * c + 516 * u + 128) shr 8).coerceIn(0, 255)
            pixels[y * image.width + x] = (255 shl 24) or (r shl 16) or (g shl 8) or b
        }
        val raw = Bitmap.createBitmap(pixels, image.width, image.height, Bitmap.Config.ARGB_8888)
        val upright = Bitmap.createBitmap(raw, 0, 0, raw.width, raw.height,
            Matrix().apply { postRotate(orientation.toFloat()) }, false)
        try {
            File(filesDir, "camera-upright.png").outputStream().use {
                check(upright.compress(Bitmap.CompressFormat.PNG, 100, it))
            }
            content = "Y min=$minY max=$maxY mean=${sumY.toDouble() / pixels.size}; upright=${upright.width}x${upright.height} unmirrored"
        } finally {
            if (upright !== raw) upright.recycle()
            raw.recycle()
        }
    }

    private fun complete() {
        val arrivalSpan = (lastArrival - firstArrival) / 1e9
        val sensorSpan = (lastSensor - firstSensor) / 1e9
        val pass = frames >= 30 && badTimestamps == 0 && firstSensor > 0 && (!live || results > 0)
        finishProbe("${if (pass) "PASS" else "FAIL"} camera=0 YUV=640x480 requestedFps=$fps; " +
            "frames=$frames; arrivalFps=${if (arrivalSpan > 0) (frames - 1) / arrivalSpan else 0.0}; " +
            "sensorFps=${if (sensorSpan > 0) (frames - 1) / sensorSpan else 0.0}; " +
            "sensorFirstNs=$firstSensor sensorLastNs=$lastSensor nonIncreasing=$badTimestamps; " +
            "arrivalIntervalMs=${if (frames > 1) minInterval / 1e6 else 0.0}..${maxInterval / 1e6}; " +
            "planeRowPixelStrides=[$strides]; rotation=${if (live) CameraSource.INPUT_ROTATION_DEGREES else orientation}; $content" +
            if (live) "; LIVE_STREAM delegate=$delegate results=$results detected=$detected empty=$empty replacements=${estimator?.replacements}; " +
                "meanConversionMs=${if (results > 0) conversionTotal / results else 0}; " +
                "meanInferenceMs=${if (results > 0) inferenceTotal / results else 0}; maxArrivalToResultMs=$maxAge; " +
                "upright=${latest?.width}x${latest?.height} unmirrored" else "")
    }

    private fun fail(error: Exception) {
        Log.e(TAG, "Capture failure", error)
        finishProbe("FAIL ${error.javaClass.simpleName}: ${error.message}; frames=$frames")
    }

    private fun finishProbe(report: String) {
        if (finished) return
        finished = true
        worker.removeCallbacks(captureTimeout)
        worker.removeCallbacks(captureComplete)
        Log.i(TAG, report)
        File(filesDir, "camera-compatibility.txt").writeText(report + "\n")
        latest?.let { File(filesDir, "camera-live-pose.json").writeText(it.json()) }
        runOnUiThread { if (!isDestroyed) output.text = report }
        // Persist the measurement before close: a stalled HAL can delay teardown.
        try { session?.close() } finally {
            session = null
            try { camera?.close() } finally {
                camera = null
                if (estimator == null) closeReader() else estimator?.close()
            }
        }
    }

    private fun closeReader() {
        reader?.close(); reader = null
        resourcesClosed = true
        Log.i(TAG, "Camera and inference resources closed")
        if (destroyRequested) thread.quitSafely()
    }

    override fun onStop() {
        worker.post { finishProbe("STOP activity left foreground; frames=$frames") }
        super.onStop()
    }

    override fun onDestroy() {
        worker.post {
            destroyRequested = true
            finishProbe("STOP activity destroyed; frames=$frames")
            if (resourcesClosed) thread.quitSafely()
        }
        super.onDestroy()
    }

    companion object { private const val TAG = "CameraCompatibility" }
}
