package tech.aerodance.androidclient.pose

import android.content.Context
import android.graphics.Bitmap
import android.media.Image
import android.os.Handler
import android.os.HandlerThread
import android.os.SystemClock
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.framework.image.MPImage
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.core.Delegate
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.poselandmarker.PoseLandmarker
import tech.aerodance.androidclient.camera.YuvToBitmap
import tech.aerodance.androidclient.pipeline.LatestFrameMailbox
import tech.aerodance.androidclient.pipeline.TaskTimestamps
import tech.aerodance.androidclient.protocol.Landmark
import tech.aerodance.androidclient.protocol.Pose
import tech.aerodance.androidclient.protocol.PoseRecord

/** GPU inference: one input in flight, one replaceable camera image, no per-frame runnable queue. */
class LivePoseEstimator(
    context: Context,
    private val sessionId: String,
    private val rotation: Int,
    private val onResult: (PoseRecord, Long, Long) -> Unit,
    private val onError: (Throwable) -> Unit,
    private val onClosed: () -> Unit = {},
) : AutoCloseable {
    private data class Frame(val image: Image, val arrival: Long)
    private data class Input(val image: MPImage, val bitmap: Bitmap, val arrival: Long,
        val timestamp: Long, val conversionMs: Long, val submitted: Long) : AutoCloseable {
        override fun close() { image.close(); bitmap.recycle() }
    }
    private val lock = Any()
    private val mailbox = LatestFrameMailbox<Frame> { it.image.close() }
    private var closed = false
    private var scheduled = false
    private val thread = HandlerThread("live-pose").apply { start() }
    private val worker = Handler(thread.looper)
    private val timestamps = TaskTimestamps()
    private val converter = YuvToBitmap()
    private var task: PoseLandmarker? = null
    private var input: Input? = null
    private var seq = 0L
    val replacements: Long get() = synchronized(lock) { mailbox.replacements }
    private val watchdog = Runnable { fail(IllegalStateException("No inference callback within 5 seconds")) }

    init {
        val appContext = context.applicationContext
        worker.post {
            try {
                if (isClosed()) return@post
                task = PoseLandmarker.createFromOptions(appContext,
                    PoseLandmarker.PoseLandmarkerOptions.builder()
                        .setBaseOptions(BaseOptions.builder().setModelAssetPath("pose_landmarker_lite.task")
                            .setDelegate(Delegate.GPU).build())
                        .setRunningMode(RunningMode.LIVE_STREAM).setNumPoses(1)
                        .setOutputSegmentationMasks(false)
                        .setResultListener { result, _ ->
                            val completed = SystemClock.elapsedRealtime()
                            // Copy native result values on the callback thread, before returning to Tasks.
                            try {
                                val poses = result.landmarks().map { points -> Pose(points.map { p ->
                                    Landmark(p.x(), p.y(), p.z(), p.visibility().orElse(null), p.presence().orElse(null))
                                }) }
                                val timestamp = result.timestampMs()
                                worker.post { complete(timestamp, completed, poses) }
                            } catch (error: Exception) { worker.post { fail(error) } }
                        }
                        .setErrorListener { error -> worker.post { fail(error) } }.build())
            } catch (error: Exception) { fail(error) }
        }
    }

    /** Ownership transfers on every call, including rejection after shutdown. */
    fun offer(image: Image, arrivalMs: Long) = synchronized(lock) {
        if (!mailbox.offer(Frame(image, arrivalMs))) return@synchronized
        if (!scheduled) {
            scheduled = true
            worker.post { drain() }
        }
    }

    private fun isClosed() = synchronized(lock) { closed }

    private fun drain() {
        if (isClosed() || input != null) return
        val frame = synchronized(lock) {
            mailbox.take().also { if (it == null) scheduled = false }
        } ?: return
        var bitmap: Bitmap? = null
        try {
            val started = SystemClock.elapsedRealtime()
            bitmap = frame.image.use { converter.convert(it, rotation) }
            if (isClosed()) { bitmap.recycle(); return }
            val converted = SystemClock.elapsedRealtime()
            val mpImage = BitmapImageBuilder(bitmap).build()
            val admitted = Input(mpImage, bitmap, frame.arrival, timestamps.next(frame.arrival),
                converted - started, converted)
            input = admitted
            bitmap = null // Input now owns storage through callback or task shutdown.
            worker.postDelayed(watchdog, 5_000)
            checkNotNull(task).detectAsync(admitted.image, admitted.timestamp)
        } catch (error: Exception) {
            bitmap?.recycle()
            fail(error)
        }
    }

    private fun complete(timestamp: Long, completed: Long, poses: List<Pose>) {
        if (isClosed()) return
        val admitted = input ?: return fail(IllegalStateException("Callback without input"))
        if (timestamp != admitted.timestamp) return fail(IllegalStateException("Mismatched task timestamp"))
        worker.removeCallbacks(watchdog)
        try {
            val record = PoseRecord(sessionId, ++seq, admitted.arrival, completed,
                admitted.bitmap.width, admitted.bitmap.height, poses)
            onResult(record, admitted.conversionMs, completed - admitted.submitted)
        } catch (error: Exception) { fail(error); return }
        admitted.close()
        input = null
        drain()
    }

    private fun fail(error: Throwable) {
        if (isClosed()) return
        close()
        onError(error)
    }

    override fun close() {
        synchronized(lock) {
            if (closed) return
            closed = true
            mailbox.close()
        }
        worker.post {
            worker.removeCallbacks(watchdog)
            // Drain native work before freeing storage still referenced by detectAsync.
            try { task?.close() } finally {
                task = null
                input?.close(); input = null
                converter.close()
                thread.quitSafely()
                onClosed()
            }
        }
    }
}
