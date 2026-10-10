package tech.aerodance.androidclient

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import tech.aerodance.androidclient.pipeline.LatestFrameMailbox
import tech.aerodance.androidclient.pipeline.TaskTimestamps

class FrameAdmissionTest {
    @Test fun slowInferenceKeepsOnlyLatestAndDisposesEveryOtherFrame() {
        val disposed = mutableListOf<Int>()
        val mailbox = LatestFrameMailbox<Int> { disposed.add(it) }
        mailbox.offer(0)
        val inFlight = mailbox.take()
        for (frame in 1..1000) mailbox.offer(frame)
        assertEquals(0, inFlight)
        assertEquals((1..999).toList(), disposed)
        assertEquals(999, mailbox.replacements)
        assertEquals(1000, mailbox.take())
        assertNull(mailbox.take())
        mailbox.close()
        // Taken values belong to the consumer; the mailbox must not dispose them.
        assertEquals(999, disposed.size)
    }

    @Test fun shutdownClosesPendingAndRejectsLateFramesExactlyOnce() {
        val disposed = mutableListOf<Int>()
        val mailbox = LatestFrameMailbox<Int> { disposed.add(it) }
        mailbox.offer(1)
        mailbox.close()
        mailbox.close()
        assertFalse(mailbox.offer(2))
        assertNull(mailbox.take())
        assertEquals(listOf(1, 2), disposed)
    }

    @Test fun timestampKeysAdvanceWhenArrivalMillisecondsRepeat() {
        val timestamps = TaskTimestamps()
        assertEquals(listOf(100L, 101L, 102L, 200L),
            listOf(100L, 100L, 100L, 200L).map(timestamps::next))
    }
}
