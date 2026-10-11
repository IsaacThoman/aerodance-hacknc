package tech.aerodance.androidclient.protocol

const val PORT = 1337
const val MAX_RECORD_BYTES = 16 * 1024

enum class PipelineState { starting, running, error, stopping }

data class Landmark(val x: Float, val y: Float, val z: Float, val visibility: Float? = null, val presence: Float? = null) {
    init {
        require(x.isFinite() && y.isFinite() && z.isFinite())
        require(visibility == null || (visibility.isFinite() && visibility in 0f..1f))
        require(presence == null || (presence.isFinite() && presence in 0f..1f))
    }
}

data class Pose(val landmarks: List<Landmark>, val playerId: Int = 0) {
    init { require(landmarks.size == 33) }
}

data class PoseRecord(
    val sessionId: String, val seq: Long, val frameReceivedTimeMs: Long,
    val resultTimeMs: Long, val width: Int, val height: Int,
    val poses: List<Pose>, val mirrored: Boolean = false, val playerCount: Int = 1,
) {
    init {
        require(sessionId.isNotBlank() && seq > 0)
        require(frameReceivedTimeMs >= 0 && resultTimeMs >= frameReceivedTimeMs)
        require(width > 0 && height > 0 && playerCount in 1..2 && poses.size <= playerCount)
        require(poses.all { it.playerId in 0 until playerCount })
        require(poses.map { it.playerId } == poses.map { it.playerId }.distinct().sorted())
    }

    fun json(): String = checkedRecord("""{"protocolVersion":2,"type":"pose","sessionId":${quote(sessionId)},"seq":$seq,"frameReceivedTimeMs":$frameReceivedTimeMs,"resultTimeMs":$resultTimeMs,"playerCount":$playerCount,"input":{"width":$width,"height":$height,"mirrored":$mirrored},"poses":[${poses.joinToString { pose ->
        "{\"playerId\":${pose.playerId},\"landmarks\":[" + pose.landmarks.joinToString { l ->
            """{"x":${l.x},"y":${l.y},"z":${l.z},"visibility":${l.visibility},"presence":${l.presence}}"""
        } + "]}"
    }}]}""")
}

fun heartbeat(sessionId: String, nowMs: Long, seq: Long?, state: PipelineState): String {
    require(nowMs >= 0 && (seq == null || seq > 0))
    return checkedRecord("""{"protocolVersion":2,"type":"heartbeat","sessionId":${quote(sessionId)},"producerTimeMs":$nowMs,"lastPoseSeq":$seq,"pipelineState":"$state"}""")
}

fun status(deviceId: String, sessionId: String, state: PipelineState, synthetic: Boolean = true, playerCount: Int = 1): String =
    """{"protocolVersion":2,"deviceId":${quote(deviceId)},"sessionId":${quote(sessionId)},"deviceName":"Open-Q 624A Pose Controller${if (synthetic) " (synthetic)" else ""}","pipelineState":"$state","playerCount":$playerCount,"capabilities":{"supportedPlayerCounts":[1,2],"poseModel":"${if (synthetic) "synthetic" else "pose_landmarker_lite"}","maxPoses":2,"landmarksPerPose":33,"worldLandmarks":false,"sensorTimestampSource":"unknown","timeSync":true}}"""

/**
 * Monotonic millisecond clock shared by pose records, heartbeats and `/v1/time`.
 * Android supplies `SystemClock.elapsedRealtime()`; tests inject a fake.
 */
fun interface MonotonicClock {
    fun nowMs(): Long
}

/** `GET /v1/time` body: request-received and response-prepared times on the pose-record clock. */
data class TimeSyncResponse(val sessionId: String, val receivedTimeMs: Long, val sentTimeMs: Long) {
    init { require(sessionId.isNotBlank() && receivedTimeMs >= 0 && sentTimeMs >= receivedTimeMs) }

    fun json(): String =
        """{"protocolVersion":2,"sessionId":${quote(sessionId)},"receivedTimeMs":$receivedTimeMs,"sentTimeMs":$sentTimeMs}"""
}

/** Samples `sentTimeMs` from [clock] last, immediately before the caller serializes and writes the body. */
fun timeSyncResponse(sessionId: String, receivedTimeMs: Long, clock: MonotonicClock): TimeSyncResponse =
    TimeSyncResponse(sessionId, receivedTimeMs, clock.nowMs())

private fun checkedRecord(json: String): String {
    require(json.encodeToByteArray().size <= MAX_RECORD_BYTES)
    return "$json\n"
}

internal fun quote(value: String): String = buildString {
    append('"')
    value.forEach { c ->
        when (c) {
            '"' -> append("\\\"")
            '\\' -> append("\\\\")
            else -> if (c.code < 32) append("\\u" + c.code.toString(16).padStart(4, '0')) else append(c)
        }
    }
    append('"')
}

/** Anatomical index order; sway makes delivery and animation visible without camera hardware. */
fun syntheticPose(sessionId: String, seq: Long, nowMs: Long, playerCount: Int = 1): PoseRecord {
    val points = listOf(
        .50f to .15f, .47f to .13f, .45f to .13f, .43f to .14f,
        .53f to .13f, .55f to .13f, .57f to .14f, .40f to .16f, .60f to .16f,
        .47f to .19f, .53f to .19f, .35f to .30f, .65f to .30f,
        .25f to .43f, .75f to .43f, .20f to .55f, .80f to .55f,
        .18f to .57f, .82f to .57f, .19f to .59f, .81f to .59f,
        .22f to .56f, .78f to .56f, .42f to .55f, .58f to .55f,
        .40f to .72f, .60f to .72f, .38f to .88f, .62f to .88f,
        .37f to .91f, .63f to .91f, .33f to .93f, .67f to .93f,
    )
    val sway = kotlin.math.sin(nowMs / 1000.0).toFloat() * .06f
    // Periodic absence exercises clearing instead of retaining the last skeleton.
    val poses = if (nowMs / 1000 % 10 == 9L) emptyList() else listOf(
        Pose(points.map { (x, y) -> Landmark(x + sway, y, 0f, 1f, 1f) })
    )
    val selected = if (playerCount == 1) poses else poses.flatMap { pose ->
        listOf(0, 1).map { id -> Pose(pose.landmarks.map { it.copy(x = it.x * .45f + id * .5f) }, id) }
    }
    return PoseRecord(sessionId, seq, nowMs, nowMs, 480, 640, selected, playerCount = playerCount)
}
