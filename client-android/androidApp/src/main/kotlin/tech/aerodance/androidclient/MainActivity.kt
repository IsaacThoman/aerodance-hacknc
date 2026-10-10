package tech.aerodance.androidclient

import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.*
import androidx.compose.ui.text.font.FontFamily
import android.graphics.Typeface
import tech.aerodance.androidclient.protocol.PORT
import tech.aerodance.androidclient.streaming.PoseServer
import java.net.Inet4Address
import java.net.NetworkInterface
import java.net.URI
import java.util.concurrent.Executors

class MainActivity : ComponentActivity() {
    private val worker = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())
    @Volatile private var server: PoseServer? = null
    private var active = false
    private var generation = 0
    private var running by mutableStateOf(false)
    private var busy by mutableStateOf(false)
    private var connected by mutableStateOf(false)
    private var results by mutableStateOf(0L)
    private var address by mutableStateOf("No LAN address")
    private var error by mutableStateOf<String?>(null)
    private var origin by mutableStateOf("")
    private val poll = object : Runnable {
        override fun run() {
            if (!active) return
            connected = server?.connected == true
            results = server?.resultCount ?: 0
            worker.execute {
                val addresses = runCatching {
                    NetworkInterface.getNetworkInterfaces().toList().flatMap { it.inetAddresses.toList() }
                        .filterIsInstance<Inet4Address>().filter { !it.isLoopbackAddress }
                        .joinToString("\n") { "http://${it.hostAddress}:$PORT" }
                }.getOrDefault("").ifBlank { "No LAN IPv4 address (port $PORT)" }
                main.post { address = addresses }
            }
            main.postDelayed(this, 500)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        origin = getPreferences(MODE_PRIVATE).getString("origin", "") ?: ""
        // This Things image omits fonts referenced by its default family configuration.
        val fontFamily = runCatching {
            FontFamily(Typeface.createFromFile("/system/fonts/Roboto-Regular.ttf"))
        }.getOrDefault(FontFamily.Default)
        setContent {
            App(running, busy, address, connected, results, error, origin,
                onOriginChange = { origin = it }, onStart = { start() }, onStop = { stop() }, fontFamily = fontFamily)
        }
    }

    override fun onStart() {
        super.onStart()
        active = true
        main.post(poll)
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
        if (android.os.Build.VERSION.SDK_INT >= 37 && checkSelfPermission("android.permission.ACCESS_LOCAL_NETWORK") != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf("android.permission.ACCESS_LOCAL_NETWORK"), 1337)
            error = "Allow local network access, then press Start."
            return
        }
        getPreferences(MODE_PRIVATE).edit().putString("origin", approvedOrigin).apply()
        busy = true
        error = null
        val token = ++generation
        val deviceId = Settings.Secure.getString(contentResolver, Settings.Secure.ANDROID_ID) ?: "controller-01"
        worker.execute {
            val candidate = PoseServer(deviceId, setOf(approvedOrigin))
            val failure = runCatching { candidate.start() }.exceptionOrNull()
            main.post {
                if (!active || token != generation) {
                    if (worker.isShutdown) Thread({ candidate.close() }, "pose-start-cleanup").start()
                    else worker.execute { candidate.close() }
                    return@post
                }
                busy = false
                if (failure != null) { error = "Cannot start server: ${failure.message}" }
                else { server = candidate; running = true }
            }
        }
    }

    private fun stop() {
        ++generation
        val old = server
        server = null
        running = false
        connected = false
        busy = false
        worker.execute { old?.close() }
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
