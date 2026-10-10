package tech.aerodance.androidclient.camera

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.ImageFormat
import android.hardware.camera2.*
import android.media.Image
import android.media.ImageReader
import android.os.Handler
import android.os.HandlerThread
import android.os.SystemClock
import android.util.Range
import java.util.concurrent.atomic.AtomicLong

/** Fixed board Camera2 adapter. Stop requests before closing the estimator's owned images. */
class CameraSource(context: Context, private val onFrame: (Image, Long) -> Unit,
    private val onRunning: () -> Unit, private val onError: (Throwable) -> Unit) {
    private val manager = context.getSystemService(CameraManager::class.java)
    val rotation = INPUT_ROTATION_DEGREES
    private val thread = HandlerThread("pose-camera").apply { start() }
    private val worker = Handler(thread.looper)
    private var device: CameraDevice? = null
    private var session: CameraCaptureSession? = null
    private var reader: ImageReader? = null
    private var stopped = false
    private var closed = false
    private var lastFrameMs = 0L
    private val count = AtomicLong()
    val frameCount: Long get() = count.get()
    private val checkFrames = object : Runnable {
        override fun run() {
            if (stopped) return
            if (SystemClock.elapsedRealtime() - lastFrameMs > 5_000) {
                fail(IllegalStateException("No camera frames for 5 seconds; check camera owner and prepare-camera.sh"))
            } else worker.postDelayed(this, 1_000)
        }
    }

    @SuppressLint("MissingPermission")
    fun start() { worker.post {
        if (stopped) return@post
        try {
            reader = ImageReader.newInstance(640, 480, ImageFormat.YUV_420_888, 3).apply {
                setOnImageAvailableListener({ source ->
                    try {
                        source.acquireLatestImage()?.let { image ->
                            if (stopped) image.close() else {
                                lastFrameMs = SystemClock.elapsedRealtime()
                                count.incrementAndGet()
                                // Consumer takes ownership on every call, including shutdown rejection.
                                onFrame(image, lastFrameMs)
                            }
                        }
                    } catch (error: Exception) { fail(error) }
                }, worker)
            }
            lastFrameMs = SystemClock.elapsedRealtime()
            worker.postDelayed(checkFrames, 5_000)
            manager.openCamera("0", object : CameraDevice.StateCallback() {
                override fun onOpened(camera: CameraDevice) {
                    if (stopped) { camera.close(); return }
                    device = camera
                    try {
                        camera.createCaptureSession(listOf(reader!!.surface), object : CameraCaptureSession.StateCallback() {
                            override fun onConfigured(configured: CameraCaptureSession) {
                                if (stopped) { configured.close(); return }
                                session = configured
                                try {
                                    val request = camera.createCaptureRequest(CameraDevice.TEMPLATE_RECORD).apply {
                                        addTarget(reader!!.surface)
                                        set(CaptureRequest.CONTROL_MODE, CaptureRequest.CONTROL_MODE_AUTO)
                                        set(CaptureRequest.CONTROL_AE_TARGET_FPS_RANGE, Range(30, 30))
                                        set(CaptureRequest.CONTROL_AF_MODE, CaptureRequest.CONTROL_AF_MODE_OFF)
                                        set(CaptureRequest.CONTROL_AE_MODE, CaptureRequest.CONTROL_AE_MODE_ON)
                                        set(CaptureRequest.CONTROL_AWB_MODE, CaptureRequest.CONTROL_AWB_MODE_AUTO)
                                        set(CaptureRequest.CONTROL_AE_ANTIBANDING_MODE, CaptureRequest.CONTROL_AE_ANTIBANDING_MODE_OFF)
                                    }.build()
                                    configured.setRepeatingRequest(request, null, worker)
                                    onRunning()
                                } catch (error: Exception) { fail(error) }
                            }
                            override fun onConfigureFailed(configured: CameraCaptureSession) {
                                configured.close(); fail(IllegalStateException("Camera session configuration failed"))
                            }
                        }, worker)
                    } catch (error: Exception) { fail(error) }
                }
                override fun onDisconnected(camera: CameraDevice) {
                    camera.close(); fail(IllegalStateException("Camera disconnected"))
                }
                override fun onError(camera: CameraDevice, error: Int) {
                    camera.close(); fail(IllegalStateException("Camera error $error"))
                }
            }, worker)
        } catch (error: Exception) { fail(error) }
    } }

    private fun fail(error: Throwable) {
        if (stopped) return
        stopOnWorker()
        onError(error)
    }

    private fun stopOnWorker() {
        stopped = true
        worker.removeCallbacks(checkFrames)
        try { session?.close() } finally { session = null; device?.close(); device = null }
    }

    fun stopCapture() { worker.post { stopOnWorker() } }

    /** Call only after estimator shutdown has released all acquired camera images. */
    fun close(onClosed: () -> Unit = {}) { worker.post {
        if (closed) return@post
        closed = true
        try { stopOnWorker() } finally {
            reader?.close(); reader = null; thread.quitSafely(); onClosed()
        }
    } }

    companion object {
        // The user confirmed this camera mounting should be processed without rotation.
        const val INPUT_ROTATION_DEGREES = 0
    }
}
