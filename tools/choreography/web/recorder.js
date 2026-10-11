export class Recorder {
  constructor({ source, transport, request, projectId, onFailure }) {
    Object.assign(this, { source, transport, request, projectId, onFailure });
    this.pending = [];
    this.batchId = 0;
    this.ordinal = 0;
    this.bytes = 0;
    this.chain = Promise.resolve();
    this.failure = null;
  }
  async start() {
    this.metadata = await this.request(
      `/api/projects/${this.projectId}/takes`,
      {
        method: "POST",
        body: {
          name: `Take · ${new Date().toLocaleTimeString()}`,
          status: { poseModel: this.source.view.model, protocolVersion: 2 },
        },
      },
    );
    this.running = true;
    this.session = this.source.view.snapshot?.sessionId;
    this.input = this.source.view.snapshot?.input;
    this.pending.push({
      ordinal: this.ordinal++,
      receivedBrowserTimeMs: performance.now(),
      audioPositionAtReceiptMs: this.transport.current(),
      event: {
        type: "audio-start-scheduled",
        audioContextStartTime: this.transport.startTime,
        positionMs: this.transport.positionMs,
        rate: this.transport.rate,
      },
    });
    this.unsubscribe = this.source.subscribeRecords((e) => {
      if (!this.running) return;
      if (
        e.record.sessionId !== this.session ||
        (e.record.type === "pose" &&
          (e.record.playerCount !== 2 ||
            e.record.input.width !== this.input.width ||
            e.record.input.height !== this.input.height ||
            e.record.input.mirrored !== false))
      ) {
        this.onFailure("Android session, player mode or geometry changed");
        return;
      }
      const envelope = {
        ordinal: this.ordinal++,
        receivedBrowserTimeMs: e.receivedBrowserTimeMs,
        audioPositionAtReceiptMs:
          this.transport.current() -
          (this.transport.active
            ? Math.max(0, performance.now() - e.receivedBrowserTimeMs) *
              this.transport.rate
            : 0),
        audioPlaybackRate: this.transport.rate,
        record: e.record,
      };
      this.pending.push(envelope);
      this.bytes += JSON.stringify(envelope).length;
      if (
        this.bytes > 8 * 1024 * 1024 ||
        performance.now() - (this.lastAck || this.startedAt) > 5000
      ) {
        this.onFailure("Recording stopped: disk uploads are falling behind");
        return;
      }
      if (this.pending.length >= 150) this.flush();
    });
    this.startedAt = performance.now();
    this.lastAck = this.startedAt;
    this.timer = setInterval(() => this.flush(), 500);
  }
  flush() {
    if (!this.pending.length || this.failure) return;
    const records = this.pending.splice(0),
      batchId = this.batchId++;
    this.chain = this.chain
      .then(async () => {
        const options = { method: "POST", body: { batchId, records } };
        try {
          await this.request(
            `/api/projects/${this.projectId}/takes/${this.metadata.takeId}/batches`,
            options,
          );
        } catch {
          await this.request(
            `/api/projects/${this.projectId}/takes/${this.metadata.takeId}/batches`,
            options,
          );
        }
        this.lastAck = performance.now();
        this.bytes -= JSON.stringify(records).length;
      })
      .catch((error) => {
        this.failure = error;
        this.onFailure(error.message);
      });
  }
  async stop(reason = null) {
    if (!this.running) throw Error("No recording is active");
    this.running = false;
    this.unsubscribe?.();
    clearInterval(this.timer);
    this.pending.push({
      ordinal: this.ordinal++,
      receivedBrowserTimeMs: performance.now(),
      audioPositionAtReceiptMs: this.transport.current(),
      event: { type: "audio-stop", reason },
    });
    this.flush();
    await this.chain;
    if (this.failure)
      throw Error(`Incomplete take retained on disk: ${this.failure.message}`);
    return this.request(
      `/api/projects/${this.projectId}/takes/${this.metadata.takeId}/finalize`,
      {
        method: "POST",
        body: {
          batchCount: this.batchId,
          recordCount: this.ordinal,
          interruptionReason: reason,
        },
      },
    );
  }
}
