package tech.aerodance.androidclient.pipeline

import android.content.Context
import tech.aerodance.androidclient.camera.CameraSource
import tech.aerodance.androidclient.pose.LivePoseEstimator
import tech.aerodance.androidclient.protocol.PipelineState
import tech.aerodance.androidclient.streaming.PoseServer
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Activity-owned capture/inference/server. Browser lifetime never controls the producer. */
class PipelineController(context: Context, deviceId: String, origins: Set<String>,
    private val synthetic: Boolean = false,
    initialPlayerCount: Int = 1,
    private val onError: (Throwable) -> Unit) : AutoCloseable {
    val server = PoseServer(deviceId, origins, synthetic = synthetic, initialPlayerCount = initialPlayerCount)
    private val closed = AtomicBoolean()
    private val released = CountDownLatch(1)
    private var camera: CameraSource? = null
    private var estimator: LivePoseEstimator? = null
    val frameCount: Long get() = camera?.frameCount ?: 0
    val replacements: Long get() = estimator?.replacements ?: 0
    @Volatile var conversionMs = 0L
        private set
    @Volatile var inferenceMs = 0L
        private set
    private val appContext = context.applicationContext

    fun start() {
        try {
            server.start()
            if (synthetic) return
            val source = CameraSource(appContext,
                onFrame = { image, arrival -> estimator!!.offer(image, arrival) },
                onRunning = { /* Readiness requires the first successful inference, not just camera setup. */ },
                onError = ::fail)
            camera = source
            estimator = LivePoseEstimator(appContext, source.rotation,
                onResult = { record, conversion, inference ->
                    conversionMs = conversion; inferenceMs = inference
                    if (!closed.get()) { server.state = PipelineState.running; server.publish(record) }
                }, onError = ::fail, onClosed = { source.close { released.countDown() } })
            source.start()
        } catch (error: Exception) { fail(error); throw error }
    }

    private fun fail(error: Throwable) {
        if (closed.get()) return
        server.state = PipelineState.error
        close()
        onError(error)
    }

    override fun close() {
        if (!closed.compareAndSet(false, true)) return
        camera?.stopCapture()
        if (estimator == null) {
            camera?.close { released.countDown() } ?: released.countDown()
        } else estimator?.close()
        server.close()
    }

    fun awaitStopped() { check(released.await(10, TimeUnit.SECONDS)) { "Camera/inference shutdown timed out" } }
}
