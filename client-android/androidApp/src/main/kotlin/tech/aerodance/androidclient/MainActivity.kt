package tech.aerodance.androidclient

import android.os.Bundle
import com.google.mediapipe.tasks.core.Delegate
import android.os.Handler
import android.os.SystemClock
import android.os.Looper
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.*
import androidx.compose.ui.text.font.FontFamily
import android.graphics.Typeface
import tech.aerodance.androidclient.protocol.PORT
import tech.aerodance.androidclient.streaming.PoseServer
import tech.aerodance.androidclient.pipeline.PipelineController
import java.net.Inet4Address
import java.net.NetworkInterface
import java.net.URI
import java.util.concurrent.Executors

class MainActivity : ComponentActivity() {
    private val worker = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())
    @Volatile private var server: PoseServer? = null
    @Volatile private var pipeline: PipelineController? = null
    private var active = false
    private var generation = 0
    private var running by mutableStateOf(false)
    private var busy by mutableStateOf(false)
    private var connected by mutableStateOf(false)
    private var results by mutableStateOf(0L)
    private var frames by mutableStateOf(0L)
    private var timings by mutableStateOf("")
    private var address by mutableStateOf("No LAN address")
    private var error by mutableStateOf<String?>(null)
    private var origin by mutableStateOf("")
    private var gpu by mutableStateOf(true)
    private var synthetic = false
    private var ratePipeline: PipelineController? = null
    private var rateTime = 0L
    private var rateFrames = 0L
    private var rateResults = 0L
    private var addressRefreshPending = false
    private var nextAddressRefresh = 0L
    private val poll = object : Runnable {
        override fun run() {
            if (!active) return
            connected = server?.connected == true
            results = server?.resultCount ?: 0
            frames = pipeline?.frameCount ?: 0
            pipeline?.let {
                val now = SystemClock.elapsedRealtime()
                if (ratePipeline !== it) {
                    ratePipeline = it; rateTime = now; rateFrames = frames; rateResults = results
                    timings = "Measuring capture and pose rates…"
                } else if (now - rateTime >= 1_000) {
                    val seconds = (now - rateTime) / 1_000.0
                    timings = java.lang.String.format(java.util.Locale.US,
                        "Capture %.1f FPS; poses %.1f/s\nConversion %d ms; inference %d ms; replaced %d",
                        (frames - rateFrames) / seconds, (results - rateResults) / seconds,
                        it.conversionMs, it.inferenceMs, it.replacements)
                    rateTime = now; rateFrames = frames; rateResults = results
                }
            }
            val now = SystemClock.elapsedRealtime()
            if (!addressRefreshPending && now >= nextAddressRefresh) {
                addressRefreshPending = true
                nextAddressRefresh = now + 5_000
                worker.execute {
                    val addresses = runCatching {
                        NetworkInterface.getNetworkInterfaces().toList().flatMap { it.inetAddresses.toList() }
                            .filterIsInstance<Inet4Address>().filter { !it.isLoopbackAddress }
                            .joinToString("\n") { "http://${it.hostAddress}:$PORT" }
                    }.getOrDefault("").ifBlank { "No LAN IPv4 address (port $PORT)" }
                    main.post {
                        addressRefreshPending = false
                        if (active) address = addresses
                    }
                }
            }
            main.postDelayed(this, 500)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        gpu = getPreferences(MODE_PRIVATE).getBoolean("gpu", true)
        origin = getPreferences(MODE_PRIVATE).getString("origin", "") ?: ""
        if (applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE != 0) {
            intent.getStringExtra("testOrigin")?.let { origin = it }
            synthetic = intent.getBooleanExtra("synthetic", false)
            gpu = intent.getBooleanExtra("gpu", gpu)
        }
        // This Things image omits fonts referenced by its default family configuration.
        val fontFamily = runCatching {
            FontFamily(Typeface.createFromFile("/system/fonts/Roboto-Regular.ttf"))
        }.getOrDefault(FontFamily.Default)
        setContent {
            App(running, busy, address, connected, results, error, origin,
                onOriginChange = { origin = it }, onStart = { start() }, onStop = { stop() }, fontFamily = fontFamily,
                frames = frames, timings = timings, synthetic = synthetic, gpu = gpu,
                onGpuChange = {
                    gpu = it
                    getPreferences(MODE_PRIVATE).edit().putBoolean("gpu", it).apply()
                })
        }
    }

    override fun onStart() {
        super.onStart()
        active = true
        main.post(poll)
        start()
    }

    private fun start() {
        if (running || busy || !active) return
        val approvedOrigin = origin.trim()
        val valid = runCatching {
            val uri = URI(approvedOrigin)
            uri.scheme in setOf("https", "http") && !uri.host.isNullOrBlank() &&
                uri.rawUserInfo == null && uri.rawQuery == null && uri.rawFragment == null &&
                uri.rawPath.isNullOrEmpty() && uri.port in -1..65535 && approvedOrigin != "null"
        }.getOrDefault(false)
        if (!valid) { error = "Enter an origin such as https://game.example.com (no path or trailing slash)."; return }
        if (!synthetic && checkSelfPermission(android.Manifest.permission.CAMERA) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(android.Manifest.permission.CAMERA), 1338)
            error = "Allow camera access to start pose capture."
            return
        }
        if (android.os.Build.VERSION.SDK_INT >= 37 && checkSelfPermission("android.permission.ACCESS_LOCAL_NETWORK") != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf("android.permission.ACCESS_LOCAL_NETWORK"), 1337)
            error = "Allow local network access to start streaming."
            return
        }
        getPreferences(MODE_PRIVATE).edit().putString("origin", approvedOrigin).apply()
        busy = true
        error = null
        val token = ++generation
        val delegate = if (gpu) Delegate.GPU else Delegate.CPU
        val deviceId = Settings.Secure.getString(contentResolver, Settings.Secure.ANDROID_ID) ?: "controller-01"
        worker.execute {
            var candidate: PipelineController? = null
            val failure = runCatching {
                candidate = PipelineController(this, deviceId, setOf(approvedOrigin), synthetic, delegate) { failure -> main.post {
                    if (active && token == generation) {
                        stop()
                        error = "Pose pipeline failed: ${failure.message}"
                    }
                } }
                candidate!!.start()
            }.exceptionOrNull()
            val started = candidate
            main.post {
                if (!active || token != generation) {
                    if (worker.isShutdown) Thread({ started?.close() }, "pose-start-cleanup").start()
                    else worker.execute { started?.close(); started?.awaitStopped() }
                    return@post
                }
                busy = false
                if (failure != null) { error = "Cannot start server: ${failure.message}" }
                else { pipeline = started; server = started!!.server; running = true }
            }
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == 1337) {
            if (grantResults.firstOrNull() == android.content.pm.PackageManager.PERMISSION_GRANTED) start()
            else error = "Local network access denied. Allow it in Settings, then press Start."
        }
        if (requestCode == 1338) {
            if (grantResults.firstOrNull() == android.content.pm.PackageManager.PERMISSION_GRANTED) start()
            else error = "Camera access denied. Allow it in Settings, then press Start."
        }
    }

    private fun stop() {
        ++generation
        val old = pipeline
        pipeline = null
        server = null
        running = false
        connected = false
        busy = false
        worker.execute {
            old?.close()
            runCatching { old?.awaitStopped() }.onFailure { failure -> main.post { error = failure.message } }
        }
    }

    override fun onStop() {
        active = false
        main.removeCallbacks(poll)
        stop()
        super.onStop()
    }

    override fun onDestroy() {
        // Shutdown stays ordered after queued resource-release work.
        worker.shutdown()
        super.onDestroy()
    }
}
