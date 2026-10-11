package tech.aerodance.androidclient

import kotlin.test.*
import tech.aerodance.androidclient.protocol.*

class PlayerAssignmentTest {
    private fun pose(x: Float, score: Float? = 1f): Pose =
        Pose(List(33) { Landmark(x, .4f, 0f, score, score) })
    private fun hips(pose: Pose, score: Float?) = pose.copy(landmarks = pose.landmarks.mapIndexed { i, p ->
        if (i in 23..24) p.copy(visibility = score, presence = score) else p
    })

    @Test fun sidesCenterMissingAndShuffledResults() {
        val left = pose(.2f); val right = pose(.8f)
        assertEquals(listOf(0, 1), assignPlayers(listOf(left, right), 2).map { it.playerId })
        assertEquals(assignPlayers(listOf(left, right), 2), assignPlayers(listOf(right, left), 2))
        assertEquals(0, assignPlayers(listOf(right), 2).single().playerId)
        assertEquals(1, assignPlayers(listOf(left), 2).single().playerId)
        assertEquals(0, assignPlayers(listOf(pose(.5f)), 2).single().playerId)
        assertEquals(emptyList(), assignPlayers(emptyList(), 2))
    }

    @Test fun confidenceFallbackAndArmsAcrossCenter() {
        assertEquals(1, assignPlayers(listOf(hips(pose(.2f), null)), 2).single().playerId)
        assertEquals(1, assignPlayers(listOf(pose(.2f, .5f)), 2).single().playerId)
        assertTrue(assignPlayers(listOf(pose(.2f, .499f)), 2).isEmpty())
        assertTrue(assignPlayers(listOf(pose(.2f, null)), 2).isEmpty())
        val reaching = pose(.2f).copy(landmarks = pose(.2f).landmarks.mapIndexed { i, p ->
            if (i in 13..22) p.copy(x = .9f) else p
        })
        assertEquals(1, assignPlayers(listOf(reaching), 2).single().playerId)
        val fallback = hips(pose(.8f), .49f)
        assertEquals(0, assignPlayers(listOf(fallback), 2).single().playerId)
    }

    @Test fun sameSideChoosesCenterThenConfidenceThenX() {
        val outer = pose(.95f); val centered = pose(.75f, .6f)
        assertEquals(centered, assignPlayers(listOf(outer, centered), 2).single())
        val weak = pose(.875f, .5f); val strong = pose(.625f, .9f)
        assertEquals(strong, assignPlayers(listOf(weak, strong), 2).single())
        val tied = pose(.875f, .9f)
        assertEquals(strong, assignPlayers(listOf(tied, strong), 2).single())
        assertEquals(listOf(0), assignPlayers(listOf(pose(.8f), pose(.9f)), 2).map { it.playerId })
    }

    @Test fun singlePlayerAlwaysZeroIncludingNoTorso() {
        val right = pose(.9f)
        assertEquals(0, assignPlayers(listOf(right.copy(playerId = 1)), 1).single().playerId)
        assertEquals(right, assignPlayers(listOf(pose(.1f, .7f), right), 1).single())
        assertEquals(pose(.1f), assignPlayers(listOf(right, pose(.1f)), 1).single())
        assertEquals(0, assignPlayers(listOf(pose(.9f, null)), 1).single().playerId)
        assertEquals(pose(.1f, null), assignPlayers(listOf(pose(.9f, null), pose(.1f, null)), 1).single())
    }

    @Test fun liveSwitchClearsAndMapsCompletionsInNewMode() {
        val output = PlayerOutput("session")
        fun complete(x: Float, now: Long) = output.publish(InferenceResult(now, now, 640, 480, listOf(pose(x))))
        assertEquals(0, complete(.8f, 10).poses.single().playerId)
        val first = output.configure(2, 11)
        assertEquals(2, first.effectiveFromSeq)
        assertTrue(output.latest!!.poses.isEmpty())
        assertEquals(2, output.latest!!.playerCount)
        assertEquals(first, output.configure(2, 12))
        assertEquals(2, output.latest!!.seq)
        assertEquals(0, complete(.8f, 13).poses.single().playerId)
        val back = output.configure(1, 14)
        assertEquals(4, back.effectiveFromSeq)
        assertTrue(output.latest!!.poses.isEmpty())
        val result = complete(.8f, 15)
        assertEquals(5, result.seq)
        assertEquals("session", result.sessionId)
        assertEquals(0, result.poses.single().playerId)
        assertEquals(1, result.playerCount)
        assertFailsWith<IllegalArgumentException> { output.configure(3, 16) }
        assertEquals(result, output.latest)
    }

    @Test fun strictConfigAndWireValidation() {
        assertEquals(2, parsePlayerCount(" { \"playerCount\" : 2 } \n"))
        for (body in listOf("{}", "{\"playerCount\":0}", "{\"playerCount\":2.0}",
            "{\"playerCount\":\"2\"}", "{\"playerCount\":true}", "{\"playerCount\":1,\"unknown\":1}",
            "{\"playerCount\":1,\"playerCount\":2}", "{\"playerCount\":2}{}", "{\"playerCount\":2}\u000c")) {
            assertFailsWith<IllegalArgumentException>(body) { parsePlayerCount(body) }
        }
        fun record(poses: List<Pose>, count: Int) = PoseRecord("s", 1, 1, 1, 640, 480, poses, playerCount = count)
        assertFailsWith<IllegalArgumentException> { record(listOf(pose(.8f).copy(playerId = 1)), 1) }
        assertFailsWith<IllegalArgumentException> { record(listOf(pose(.2f), pose(.3f)), 2) }
        assertFailsWith<IllegalArgumentException> { record(listOf(pose(.8f).copy(playerId = 1), pose(.2f)), 2) }
        val wire = record(listOf(pose(.2f), pose(.8f).copy(playerId = 1)), 2).json()
        assertTrue(wire.contains("\"playerId\":1"))
        assertTrue(wire.encodeToByteArray().size <= MAX_RECORD_BYTES + 1)
        assertTrue(status("board", "s", PipelineState.starting, playerCount = 2).contains("\"maxPoses\":2"))
    }
}
