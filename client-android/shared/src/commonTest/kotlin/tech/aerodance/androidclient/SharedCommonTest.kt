package tech.aerodance.androidclient

import kotlin.test.*
import tech.aerodance.androidclient.protocol.*

class SharedCommonTest {
    @Test fun detectedAndAbsentFixturesMatchContract() {
        val detected = syntheticPose("test", 1, 1000)
        assertEquals(33, detected.poses.single().landmarks.size)
        assertEquals(480, detected.width)
        assertEquals(640, detected.height)
        assertFalse(detected.mirrored)
        val wire = detected.json()
        assertTrue(wire.endsWith("\n"))
        assertEquals(1, wire.count { it == '\n' })
        assertTrue(wire.encodeToByteArray().size <= MAX_RECORD_BYTES + 1)
        assertTrue(syntheticPose("test", 2, 9000).json().contains("\"poses\":[]"))
    }

    @Test fun rejectsInvalidResultsButPreservesOutOfImageCoordinates() {
        assertFailsWith<IllegalArgumentException> { Landmark(Float.NaN, 0f, 0f) }
        assertFailsWith<IllegalArgumentException> { Landmark(0f, 0f, Float.POSITIVE_INFINITY) }
        assertFailsWith<IllegalArgumentException> { Landmark(0f, 0f, 0f, 1.1f) }
        assertEquals(-.2f, Landmark(-.2f, 1.2f, 0f).x)
        assertFailsWith<IllegalArgumentException> { Pose(emptyList()) }
        assertFailsWith<IllegalArgumentException> { PoseRecord("s", 0, 0, 0, 1, 1, emptyList()) }
        assertFailsWith<IllegalArgumentException> { PoseRecord("s", 1, 2, 1, 1, 1, emptyList()) }
    }

    @Test fun heartbeatDoesNotConsumePoseSequenceAndEscapesSession() {
        val wire = heartbeat("s\n\"\\", 100, null, PipelineState.running)
        assertTrue(wire.contains("\"lastPoseSeq\":null"))
        assertTrue(wire.contains("s\\u000a\\\"\\\\"))
        assertEquals(1, wire.count { it == '\n' })
        assertTrue(heartbeat("s", 100, 42, PipelineState.running).contains("\"lastPoseSeq\":42"))
        assertTrue(status("board", "s", PipelineState.running).contains("\"poseModel\":\"synthetic\""))
    }

    @Test fun rejectsOversizeUtf8Record() {
        assertFailsWith<IllegalArgumentException> {
            heartbeat("é".repeat(MAX_RECORD_BYTES), 0, null, PipelineState.starting)
        }
    }
}
