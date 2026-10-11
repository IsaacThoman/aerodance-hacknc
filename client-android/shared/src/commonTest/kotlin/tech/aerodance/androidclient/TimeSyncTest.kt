package tech.aerodance.androidclient

import kotlin.test.*
import tech.aerodance.androidclient.protocol.*

class TimeSyncTest {
    private class FakeClock(vararg readings: Long) : MonotonicClock {
        private val pending = ArrayDeque(readings.toList())
        var reads = 0
        override fun nowMs(): Long { reads++; return pending.removeFirst() }
    }

    @Test fun responseSerializesExactContract() {
        assertEquals(
            """{"protocolVersion":2,"sessionId":"session-abc","receivedTimeMs":1250,"sentTimeMs":1251}""",
            TimeSyncResponse("session-abc", 1250, 1251).json(),
        )
        assertEquals(
            "{\"protocolVersion\":2,\"sessionId\":\"s\\u000a\\\"\\\\\",\"receivedTimeMs\":0,\"sentTimeMs\":0}",
            TimeSyncResponse("s\n\"\\", 0, 0).json(),
        )
    }

    @Test fun bothTimestampsComeFromTheSharedClock() {
        // The server samples receipt, then the helper samples send time from the same clock.
        val clock = FakeClock(1000, 1003)
        val response = timeSyncResponse("s", clock.nowMs(), clock)
        assertEquals(TimeSyncResponse("s", 1000, 1003), response)
        assertEquals(2, clock.reads)
        // Heartbeats and pose records carry the same clock's readings, so they are directly comparable.
        val now = FakeClock(1010).nowMs()
        assertTrue(heartbeat("s", now, null, PipelineState.running).contains("\"producerTimeMs\":1010"))
        val pose = syntheticPose("s", 1, now)
        assertEquals(now, pose.frameReceivedTimeMs)
        assertEquals(now, pose.resultTimeMs)
    }

    @Test fun rejectsInvalidTimes() {
        assertFailsWith<IllegalArgumentException> { TimeSyncResponse("", 1, 1) }
        assertFailsWith<IllegalArgumentException> { TimeSyncResponse("s", -1, 1) }
        assertFailsWith<IllegalArgumentException> { TimeSyncResponse("s", 5, 4) }
    }

    @Test fun statusAdvertisesTimeSyncCapabilityForLiveAndSynthetic() {
        for (synthetic in listOf(true, false)) {
            val wire = status("board", "s", PipelineState.running, synthetic, 2)
            assertTrue(wire.startsWith("{\"protocolVersion\":2,"))
            val capabilities = wire.substringAfter("\"capabilities\":{").substringBefore('}')
            assertTrue(capabilities.contains("\"timeSync\":true"), wire)
            assertTrue(capabilities.contains("\"supportedPlayerCounts\":[1,2]"))
        }
    }
}
