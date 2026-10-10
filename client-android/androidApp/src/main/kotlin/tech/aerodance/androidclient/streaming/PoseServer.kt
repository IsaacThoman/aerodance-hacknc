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
class PoseServer(private val deviceId: String, private val origins: Set<String>, private val synthetic: Boolean = true, initialPlayerCount: Int = 1) : AutoCloseable {
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
    private val output = PlayerOutput(sessionId, initialPlayerCount)
    val playerCount: Int get() = synchronized(signal) { output.playerCount }
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
                synchronized(signal) {
                    val fixture = syntheticPose(sessionId, 1, now, output.playerCount)
                    publish(InferenceResult(now, now, fixture.width, fixture.height, fixture.poses))
                }
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
            val input = socket.getInputStream().buffered(8192)
            val bytes = java.io.ByteArrayOutputStream()
            var tail = 0
            while (tail != 0x0d0a0d0a) {
                val b = input.read()
                if (b < 0 || bytes.size() >= 8192) return
                bytes.write(b)
                tail = (tail shl 8) or b
            }
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
            if (request[1] !in setOf("/v1/status", "/v1/stream", "/v1/config")) { respond("404 Not Found", "{}"); return }
            val control = request[1] == "/v1/config"
            val method = if (control) "POST" else "GET"
            if (control && origin == null) { respond("403 Forbidden", "{\"error\":\"Configured Origin required\"}"); return }
            if (request[0] == "OPTIONS") {
                val requestedHeaders = headers["access-control-request-headers"].orEmpty()
                    .split(',').map { it.trim().lowercase() }.filter { it.isNotEmpty() }
                if (headers["access-control-request-method"]?.let { it != method } == true ||
                    requestedHeaders.any { !control || it != "content-type" }) {
                    respond("403 Forbidden", "{}"); return
                }
                respond("204 No Content", "", "Access-Control-Allow-Methods: $method, OPTIONS\r\n" +
                    if (control) "Access-Control-Allow-Headers: Content-Type\r\n" else "")
                return
            }
            if (request[0] != method) { respond("405 Method Not Allowed", "{}", "Allow: $method, OPTIONS\r\n"); return }
            if (control) {
                if (headers.containsKey("transfer-encoding") || headers.containsKey("content-encoding") || headers.containsKey("expect")) {
                    respond("400 Bad Request", "{\"error\":\"Unsupported request framing\"}"); return
                }
                if (headers["content-type"]?.lowercase()?.matches(Regex("application/json(?:;\\s*charset=utf-8)?")) != true) {
                    respond("415 Unsupported Media Type", "{}"); return
                }
                val lengthText = headers["content-length"]
                val length = lengthText?.takeIf { it.matches(Regex("[0-9]+")) }?.toLongOrNull()
                if (length == null) { respond("400 Bad Request", "{}"); return }
                if (length > 1024) { respond("413 Payload Too Large", "{}"); return }
                val body = ByteArray(length.toInt())
                var offset = 0
                while (offset < body.size) {
                    val n = input.read(body, offset, body.size - offset)
                    if (n < 0) { respond("400 Bad Request", "{}"); return }
                    offset += n
                }
                if (socket.isClosed || SystemClock.elapsedRealtime() >= deadline.get()) return
                val count = try {
                    val decoder = Charsets.UTF_8.newDecoder()
                        .onMalformedInput(java.nio.charset.CodingErrorAction.REPORT)
                        .onUnmappableCharacter(java.nio.charset.CodingErrorAction.REPORT)
                    parsePlayerCount(decoder.decode(java.nio.ByteBuffer.wrap(body)).toString())
                } catch (_: Exception) { respond("400 Bad Request", "{}"); return }
                // The lock holds only mapping/publication, never GPU work or socket writes.
                val applied = synchronized(signal) {
                    if (!running.get() || socket.isClosed || SystemClock.elapsedRealtime() >= deadline.get()) return@synchronized null
                    output.configure(count, SystemClock.elapsedRealtime()).also {
                        latest.set(output.latest)
                        signal.notifyAll()
                    }
                }
                if (applied == null) return
                respond("200 OK", applied.json())
                return
            }
            deadline.set(0)
            if (request[1] == "/v1/status") {
                respond("200 OK", status(deviceId, sessionId, state, synthetic, playerCount)); return
            }
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

    fun publish(result: InferenceResult) = synchronized(signal) {
        if (!running.get()) return@synchronized
        latest.set(output.publish(result))
        signal.notifyAll()
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
