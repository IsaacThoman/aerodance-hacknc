package tech.aerodance.androidclient.pipeline

/** One owned pending frame. The caller serializes access and owns frames returned by take(). */
class LatestFrameMailbox<T>(private val dispose: (T) -> Unit) {
    private var pending: T? = null
    private var closed = false
    var replacements: Long = 0
        private set

    fun offer(frame: T): Boolean {
        if (closed) { dispose(frame); return false }
        pending?.let { dispose(it); replacements++ }
        pending = frame
        return true
    }

    fun take(): T? = pending.also { pending = null }

    fun close() {
        closed = true
        pending?.let(dispose)
        pending = null
    }
}

/** Task timestamps are an admission key; arrival time stays unchanged in the wire record. */
class TaskTimestamps {
    private var last = -1L
    fun next(arrivalMs: Long): Long {
        require(arrivalMs >= 0 && last < Long.MAX_VALUE)
        return maxOf(arrivalMs, last + 1).also { last = it }
    }
}
