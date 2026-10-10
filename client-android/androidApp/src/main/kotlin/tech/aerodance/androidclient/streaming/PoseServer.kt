package tech.aerodance.androidclient.streaming

import android.os.SystemClock
import tech.aerodance.androidclient.protocol.*
import java.net.ServerSocket
import java.net.Socket
import java.util.UUID
import java.util.concurrent.*
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicReference

/** Small HTTP/1.1 server: fixed workers, no request queue, one conflated result, one stream. */
class PoseServer(private val deviceId: String, private val origins: Set<String>, private val synthetic: Boolean = true) : AutoCloseable {
    val sessionId: String = UUID.randomUUID().toString()
    private val listener = ServerSocket()
    private val running = AtomicBoolean(false)
    private val stream = AtomicBoolean(false)
    private val latest = AtomicReference<PoseRecord?>()
    private val signal = Object()
    private val clients = ConcurrentHashMap<Socket, AtomicLong>()
    private val workers = ThreadPoolExecutor(4, 4, 0, TimeUnit.SECONDS, SynchronousQueue())
    private val producer = Executors.newSingleThreadScheduledExecutor()
    private val watchdog = Executors.newSingleThreadScheduledExecutor()
    private var seq = 0L
    @Volatile var state = PipelineState.starting
    val connected: Boolean get() = stream.get()
    val resultCount: Long get() = latest.get()?.seq ?: 0

    fun start() {
        try {
            listener.reuseAddress = true
            listener.bind(java.net.InetSocketAddress(PORT))
            running.set(true)
            if (synthetic) producer.scheduleAtFixedRate({
                val now = SystemClock.elapsedRealtime()
                publish(syntheticPose(sessionId, ++seq, now))
            }, 0, 33, TimeUnit.MILLISECONDS)
            if (synthetic) state = PipelineState.running
            watchdog.scheduleAtFixedRate({
                val now = SystemClock.elapsedRealtime()
                clients.forEach { (socket, deadline) ->
                    val expires = deadline.get()
                    if (expires != 0L && now >= expires) runCatching { socket.close() }
                }
            }, 0, 25, TimeUnit.MILLISECONDS)
            Thread({
                while (running.get()) {
                    val socket = try { listener.accept() } catch (_: Exception) { break }
                    val deadline = AtomicLong()
                    clients[socket] = deadline
                    try { workers.execute { handle(socket, deadline) } }
                    catch (_: RejectedExecutionException) { clients.remove(socket); socket.close() }
                }
            }, "pose-http-accept").start()
        } catch (e: Exception) { close(); throw e }
    }

    private fun handle(socket: Socket, deadline: AtomicLong) {
        var ownsStream = false
        try {
            socket.tcpNoDelay = true
            socket.sendBufferSize = 4096
            socket.soTimeout = 2000
            // Bound total header time as well as size; do not accept indefinite trickle requests.
            deadline.set(SystemClock.elapsedRealtime() + 2000)
            val input = socket.getInputStream()
            val bytes = java.io.ByteArrayOutputStream()
            var tail = ""
            while (!tail.endsWith("\r\n\r\n")) {
                val b = input.read()
                if (b < 0 || bytes.size() >= 8192) return
                bytes.write(b)
                tail = (tail + b.toChar()).takeLast(4)
            }
            deadline.set(0)
            val lines = bytes.toString("US-ASCII").split("\r\n")
            val request = lines.first().split(' ')
            if (request.size != 3 || request[2] != "HTTP/1.1") return
            val headers = mutableMapOf<String, String>()
            for (line in lines.drop(1).filter { it.isNotEmpty() }) {
                val parts = line.split(':', limit = 2)
                if (parts.size != 2 || headers.put(parts[0].lowercase(), parts[1].trim()) != null) return
            }
            val origin = headers["origin"]
            val allowed = origin == null || origin in origins
            val cors = if (origin != null && allowed) "Access-Control-Allow-Origin: $origin\r\nVary: Origin\r\n" else "Vary: Origin\r\n"
            fun respond(code: String, body: String, extra: String = "") {
                val data = body.toByteArray(Charsets.UTF_8)
                write(socket, deadline, "HTTP/1.1 $code\r\n${cors}Connection: close\r\nCache-Control: no-store\r\nContent-Type: application/json\r\n${extra}Content-Length: ${data.size}\r\n\r\n".toByteArray() + data)
            }
            if (!allowed) { respond("403 Forbidden", "{\"error\":\"Origin not allowed\"}"); return }
            if (request[1] !in setOf("/v1/status", "/v1/stream")) { respond("404 Not Found", "{}"); return }
            if (request[0] == "OPTIONS") {
                if (headers["access-control-request-method"]?.let { it != "GET" } == true || !headers["access-control-request-headers"].isNullOrEmpty()) {
                    respond("403 Forbidden", "{}"); return
                }
                respond("204 No Content", "", "Access-Control-Allow-Methods: GET, OPTIONS\r\n")
                return
            }
            if (request[0] != "GET") { respond("405 Method Not Allowed", "{}", "Allow: GET, OPTIONS\r\n"); return }
            if (request[1] == "/v1/status") { respond("200 OK", status(deviceId, sessionId, state, synthetic)); return }
            if (!stream.compareAndSet(false, true)) { respond("409 Conflict", "{\"error\":\"A browser is already connected\"}"); return }
            ownsStream = true
            write(socket, deadline, "HTTP/1.1 200 OK\r\n${cors}Content-Type: application/x-ndjson\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n".toByteArray())
            var lastSeq = 0L
            var lastWrite = 0L
            while (running.get() && !socket.isClosed) {
                val now = SystemClock.elapsedRealtime()
                val pose = latest.get()
                if (pose != null && pose.seq != lastSeq && now - pose.resultTimeMs < 250) {
                    write(socket, deadline, pose.json().toByteArray(Charsets.UTF_8))
                    lastSeq = pose.seq
                    lastWrite = now
                } else if (lastWrite == 0L || now - lastWrite >= 5000) {
                    write(socket, deadline, heartbeat(sessionId, now, latest.get()?.seq, state).toByteArray(Charsets.UTF_8))
                    lastWrite = now
                } else synchronized(signal) {
                    if (latest.get()?.seq == lastSeq || latest.get() === pose) signal.wait(1000)
                }
                // A stale reconnect snapshot is skipped, not a reason to disconnect a healthy reader.
                if (lastSeq > 0 && pose != null && pose.seq != lastSeq && now - pose.resultTimeMs >= 250) break
            }
        } catch (_: Exception) {
            // Disconnect, timeout and shutdown all release the stream slot below.
        } finally {
            if (ownsStream) stream.set(false)
            clients.remove(socket)
            runCatching { socket.close() }
        }
    }

    fun publish(record: PoseRecord) {
        require(record.sessionId == sessionId)
        if (!running.get()) return
        latest.set(record)
        synchronized(signal) { signal.notifyAll() }
    }

    private fun write(socket: Socket, deadline: AtomicLong, bytes: ByteArray) {
        deadline.set(SystemClock.elapsedRealtime() + 250)
        try {
            socket.getOutputStream().write(bytes)
            socket.getOutputStream().flush()
        } finally { deadline.set(0) }
    }

    override fun close() {
        state = PipelineState.stopping
        running.set(false)
        runCatching { listener.close() }
        clients.keys.forEach { runCatching { it.close() } }
        synchronized(signal) { signal.notifyAll() }
        producer.shutdownNow()
        workers.shutdownNow()
        watchdog.shutdownNow()
    }
}
