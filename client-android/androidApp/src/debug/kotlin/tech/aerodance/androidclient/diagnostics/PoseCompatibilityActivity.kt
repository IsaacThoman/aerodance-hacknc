package tech.aerodance.androidclient.diagnostics

import android.app.Activity
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Bundle
import android.os.SystemClock
import android.util.Log
import android.widget.TextView
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.core.Delegate
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.poselandmarker.PoseLandmarker
import java.io.File
import java.util.concurrent.Executors

/** Debug-only, offline GPU/native compatibility check. Does not publish synthetic or live poses. */
class PoseCompatibilityActivity : Activity() {
    private val worker = Executors.newSingleThreadExecutor()
    private lateinit var output: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        output = TextView(this).apply { text = "Running GPU compatibility check…" }
        setContentView(output)
        worker.execute {
            val report = runCatching { probe() }.fold(
                onSuccess = { "PASS $it" },
                onFailure = { Log.e(TAG, "Compatibility failure", it); "FAIL ${it.javaClass.simpleName}: ${it.message}" },
            )
            Log.i(TAG, report)
            File(filesDir, "pose-compatibility.txt").writeText(report + "\n")
            runOnUiThread { if (!isDestroyed) output.text = report }
        }
    }

    private fun probe(): String {
        val source = requireNotNull(BitmapFactory.decodeFile(File(filesDir, "pose.jpg").path)) {
            "Push the known pose.jpg fixture into filesDir first (see compatibility validation)."
        }
        val bitmap = source.copy(Bitmap.Config.ARGB_8888, false)
        source.recycle()
        try {
            val started = SystemClock.elapsedRealtime()
            val options = PoseLandmarker.PoseLandmarkerOptions.builder()
                .setBaseOptions(BaseOptions.builder().setModelAssetPath("pose_landmarker_lite.task")
                    .setDelegate(Delegate.GPU).build())
                .setRunningMode(RunningMode.IMAGE).setNumPoses(2)
                .setOutputSegmentationMasks(false).build()
            PoseLandmarker.createFromOptions(this, options).use { task ->
                val loaded = SystemClock.elapsedRealtime()
                val image = BitmapImageBuilder(bitmap).build()
                try {
                    val result = task.detect(image)
                    val finished = SystemClock.elapsedRealtime()
                    val points = result.landmarks().single()
                    check(points.size == 33) { "Expected 33 landmarks, got ${points.size}" }
                    check(points.all { it.x().isFinite() && it.y().isFinite() && it.z().isFinite() })
                    check(points[0].y() < points[23].y() && points[23].y() < points[27].y()) {
                        "Expected upright fixture: nose above hip above ankle"
                    }
                    val nose = points[0]
                    return "GPU Lite: 1 pose, 33 finite landmarks; input=${bitmap.width}x${bitmap.height}; " +
                        "loadMs=${loaded - started}; inferenceMs=${finished - loaded}; " +
                        "nose=(${nose.x()},${nose.y()},${nose.z()})"
                } finally { image.close() }
            }
        } finally { bitmap.recycle() }
    }

    override fun onDestroy() {
        worker.shutdown() // Inference owns its storage until detect returns, even on activity exit.
        super.onDestroy()
    }

    companion object { private const val TAG = "PoseCompatibility" }
}
