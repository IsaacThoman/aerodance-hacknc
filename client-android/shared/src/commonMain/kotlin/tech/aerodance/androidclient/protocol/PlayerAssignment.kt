package tech.aerodance.androidclient.protocol

import kotlin.math.abs

private data class Torso(val x: Double, val confidence: Double)
private fun Pose.torso(): Torso? {
    for ((a, b) in listOf(23 to 24, 11 to 12)) {
        val pair = listOf(landmarks[a], landmarks[b])
        if (pair.all { (it.visibility ?: 0f) >= .5f && (it.presence ?: 0f) >= .5f }) {
            return Torso(pair.sumOf { it.x.toDouble() } / 2,
                pair.sumOf { it.visibility!!.toDouble() + it.presence!!.toDouble() } / 4)
        }
    }
    return null
}
private fun Pose.confidence(): Double {
    val scores = landmarks.flatMap { listOfNotNull(it.visibility, it.presence) }
    return if (scores.isEmpty()) 0.0 else scores.sumOf { it.toDouble() } / scores.size
}
private fun Pose.selectionX(): Double = torso()?.x ?: landmarks.sumOf { it.x.toDouble() } / 33

// Final tie-break makes exact score/X ties independent of native detection order too.
private val geometryOrder = Comparator<Pose> { a, b ->
    val av = a.landmarks.flatMap { listOf(it.x, it.y, it.z, it.visibility ?: -1f, it.presence ?: -1f) }
    val bv = b.landmarks.flatMap { listOf(it.x, it.y, it.z, it.visibility ?: -1f, it.presence ?: -1f) }
    av.indices.firstNotNullOfOrNull { i -> av[i].compareTo(bv[i]).takeIf { it != 0 } } ?: 0
}

/** IDs describe fixed regions of the unmirrored inference image, never human identity. */
fun assignPlayers(detections: List<Pose>, playerCount: Int): List<Pose> {
    require(playerCount in 1..2)
    if (playerCount == 1) {
        return listOfNotNull(detections.minWithOrNull(
            compareByDescending<Pose> { it.confidence() }.thenBy { it.selectionX() }.then(geometryOrder)
        )?.copy(playerId = 0))
    }
    val candidates = detections.mapNotNull { pose -> pose.torso()?.let { pose to it } }
    return (0..1).mapNotNull { id ->
        candidates.filter { (_, torso) -> (if (torso.x < .5) 0 else 1) == id }
            .minWithOrNull(compareBy<Pair<Pose, Torso>> { abs(it.second.x - if (id == 0) .25 else .75) }
                .thenByDescending { it.second.confidence }.thenBy { it.second.x }
                .thenComparator { a, b -> geometryOrder.compare(a.first, b.first) })?.first?.copy(playerId = id)
    }
}

data class InferenceResult(val frameReceivedTimeMs: Long, val resultTimeMs: Long,
    val width: Int, val height: Int, val poses: List<Pose>)

data class ConfigResponse(val playerCount: Int, val sessionId: String, val effectiveFromSeq: Long) {
    fun json(): String = """{"playerCount":$playerCount,"sessionId":${quote(sessionId)},"effectiveFromSeq":$effectiveFromSeq}"""
}

/** Called under the publication lock: mode selection, sequence allocation and clearing are atomic. */
class PlayerOutput(private val sessionId: String, initialPlayerCount: Int = 1) {
    init { require(initialPlayerCount in 1..2) }
    var playerCount = initialPlayerCount
        private set
    var latest: PoseRecord? = null
        private set
    private var seq = 0L
    private var boundary = 1L

    fun publish(result: InferenceResult): PoseRecord {
        return PoseRecord(sessionId, ++seq, result.frameReceivedTimeMs, result.resultTimeMs,
            result.width, result.height, assignPlayers(result.poses, playerCount), playerCount = playerCount)
            .also { latest = it }
    }

    fun configure(count: Int, nowMs: Long): ConfigResponse {
        require(count in 1..2)
        if (count != playerCount) {
            playerCount = count
            boundary = seq + 1
            publish(InferenceResult(nowMs, nowMs, latest?.width ?: 640, latest?.height ?: 480, emptyList()))
        }
        return ConfigResponse(playerCount, sessionId, boundary)
    }
}

/** Deliberately narrow control grammar: one field, integer literal, no trailing JSON. */
fun parsePlayerCount(json: String): Int {
    val match = Regex("""[ \t\r\n]*\{[ \t\r\n]*"playerCount"[ \t\r\n]*:[ \t\r\n]*([12])[ \t\r\n]*\}[ \t\r\n]*""").matchEntire(json)
    require(match != null) { "Expected playerCount integer 1 or 2 only" }
    return match.groupValues[1].toInt()
}
