package tech.aerodance.androidclient.pipeline

import android.content.Context
import tech.aerodance.androidclient.camera.CameraSource
import tech.aerodance.androidclient.pose.LivePoseEstimator
import tech.aerodance.androidclient.protocol.PipelineState
import tech.aerodance.androidclient.streaming.PoseServer
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.TimeUnit

/** Activity-owned server with capture/inference resources owned by the current stream. */
class PipelineController(context: Context, deviceId: String, origins: Set<String>,
    private val synthetic: Boolean = false,
    initialPlayerCount: Int = 1,
    private val onError: (Throwable) -> Unit) : AutoCloseable {
    private val worker = Executors.newSingleThreadExecutor()
    private val closed = AtomicBoolean()
    private val reconcileQueued = AtomicBoolean()
    private val released = CountDownLatch(1)
    private val appContext = context.applicationContext
    val server = PoseServer(deviceId, origins, synthetic = synthetic, initialPlayerCount = initialPlayerCount,
        onConnectionChanged = ::connectionChanged)
    @Volatile private var capture: Capture? = null
    @Volatile private var stoppedFrames = 0L
    @Volatile private var stoppedReplacements = 0L
    val frameCount: Long get() = stoppedFrames + (capture?.source?.frameCount ?: 0)
    val replacements: Long get() = stoppedReplacements + (capture?.estimator?.replacements ?: 0)
    @Volatile var conversionMs = 0L
        private set
    @Volatile var inferenceMs = 0L
        private set

    private inner class Capture {
        private val active = AtomicBoolean(true)
        private val stopped = CountDownLatch(1)
        val source: CameraSource = CameraSource(appContext,
            onFrame = { image, arrival ->
                if (active.get() && !closed.get() && server.connected) estimator.offer(image, arrival)
                else image.close()
            },
            onRunning = {},
            onError = { if (active.get()) fail(it) })
        val estimator: LivePoseEstimator = LivePoseEstimator(appContext, source.rotation,
            onResult = { record, conversion, inference ->
                if (active.get() && !closed.get() && server.connected) {
                    conversionMs = conversion; inferenceMs = inference
                    server.publish(record)
                }
            }, onError = { if (active.get()) fail(it) },
            onClosed = { source.close { stopped.countDown() } })

        fun stop() {
            active.set(false)
            source.stopCapture()
            estimator.close()
            // Closing during GPU initialization must wait for its owning worker.
            check(stopped.await(90, TimeUnit.SECONDS)) { "Camera/inference shutdown timed out" }
        }
    }

    fun start() {
        try {
            // 'running' means the server is ready to accept a stream. Existing clients
            // poll readiness before opening it; no camera or GPU task is needed while idle.
            server.state = PipelineState.running
            server.start()
        } catch (error: Exception) { fail(error); throw error }
    }

    private fun connectionChanged() {
        if (closed.get() || synthetic || !reconcileQueued.compareAndSet(false, true)) return
        try {
            worker.execute {
                reconcileQueued.set(false)
                try {
                    // Read current demand rather than replaying potentially stale connect events.
                    if (!closed.get() && server.connected) {
                        if (capture == null) {
                            val started = Capture()
                            capture = started
                            if (!closed.get() && server.connected) started.source.start()
                            else stopCapture()
                        }
                    } else stopCapture()
                } catch (error: Exception) { fail(error) }
            }
        } catch (_: RejectedExecutionException) {
            reconcileQueued.set(false) // Shutdown already owns resource release.
        }
    }

    private fun stopCapture() {
        val old = capture ?: return
        old.stop()
        stoppedFrames += old.source.frameCount
        stoppedReplacements += old.estimator.replacements
        capture = null
        conversionMs = 0; inferenceMs = 0
    }

    private fun fail(error: Throwable) {
        if (closed.get()) return
        close()
        server.state = PipelineState.error
        onError(error)
    }

    override fun close() {
        if (!closed.compareAndSet(false, true)) return
        server.close()
        worker.execute {
            try { stopCapture() }
            catch (error: Exception) { onError(error) }
            finally { released.countDown(); worker.shutdown() }
        }
    }

    fun awaitStopped() { check(released.await(95, TimeUnit.SECONDS)) { "Camera/inference shutdown timed out" } }
}
