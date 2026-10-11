import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import { Store, sha, json, id } from "./store.js";
import { makeZip, readZip } from "./zip.js";
import {
  newProject,
  takeFromRecords,
  validateProject,
  validateTake,
  trackDataIds,
  migrateProject,
} from "../core.js";
import { validate as validateWire } from "../../../client/src/pose/protocol.js";

export function createStudio({
  dataDir = process.env.STUDIO_DATA_DIR || path.resolve("studio-data"),
  distDir = path.resolve("tools/choreography/dist"),
} = {}) {
  const app = express(),
    store = new Store(dataDir);
  // Browser writes are same-origin. LAN device CORS remains Android's responsibility.
  app.use("/api", (req, res, next) => {
    const origin = req.headers.origin;
    if (origin && origin !== `${req.protocol}://${req.get("host")}`)
      return res
        .status(403)
        .json({ error: "Use the studio origin for writes" });
    next();
  });
  app.get("/api/health", async (_req, res) => {
    try {
      await fs.mkdir(dataDir, { recursive: true });
      await fs.access(dataDir, fs.constants.W_OK);
      res.json({ ok: true });
    } catch {
      res.status(503).json({ error: "Studio data directory is not writable" });
    }
  });
  const raw = express.raw({ type: () => true, limit: "128mb" }),
    body = express.json({ limit: "32mb" });
  app.get("/api/projects", async (_req, res) => res.json(await store.list()));
  app.post("/api/projects", body, async (_req, res) =>
    res.status(201).json(await store.save(newProject(), null)),
  );
  app.get("/api/projects/:projectId", async (req, res) =>
    res.json(await store.open(req.params.projectId)),
  );
  app.put("/api/projects/:projectId", body, async (req, res) => {
    if (req.body.projectId !== req.params.projectId)
      throw Error("Project ID mismatch");
    res.json(await store.save(req.body, req.body.revision));
  });
  app.delete("/api/projects/:projectId", body, async (req, res) =>
    res.json(await store.remove(id(req.params.projectId), req.body.revision)),
  );
  app.delete("/api/projects/:projectId/takes/:takeId", body, async (req, res) =>
    res.json(
      await store.remove(
        id(req.params.projectId),
        req.body.revision,
        id(req.params.takeId),
      ),
    ),
  );
  app.post("/api/projects/:projectId/tracks", body, async (req, res) =>
    res
      .status(201)
      .json(await store.writeTrack(id(req.params.projectId), req.body, true)),
  );
  app.get("/api/projects/:projectId/tracks/:dataId", async (req, res) =>
    res.json(
      await store.read(
        req.params.projectId,
        "tracks",
        `${id(req.params.dataId)}.json`,
      ),
    ),
  );
  app.get("/api/projects/:projectId/takes/:takeId", async (req, res) =>
    res.json(
      await store.read(
        req.params.projectId,
        "takes",
        `${id(req.params.takeId)}.json`,
      ),
    ),
  );
  app.post("/api/projects/:projectId/import", body, async (req, res) => {
    const projectId = id(req.params.projectId);
    const take = await store.locked(projectId, async () => {
      await store.read(projectId, "project.json");
      return store.writeTake(projectId, req.body);
    });
    res.status(201).json(take);
  });
  app.post("/api/projects/:projectId/audio", raw, async (req, res) => {
    const projectId = id(req.params.projectId),
      types = {
        "audio/mpeg": "mp3",
        "audio/wav": "wav",
        "audio/x-wav": "wav",
        "audio/ogg": "ogg",
        "audio/mp4": "m4a",
        "audio/flac": "flac",
      },
      mime = req.get("content-type")?.split(";")[0],
      extension = types[mime];
    if (!extension) throw Error("Upload MP3, WAV, Ogg, M4A or FLAC audio");
    const durationMs = Math.round(Number(req.query.durationMs));
    if (!(durationMs > 0 && durationMs <= 3600000))
      throw Error("Invalid decoded duration");
    const audio = {
      sha256: sha(req.body),
      extension,
      mimeType: mime,
      durationMs,
      name: String(req.query.name || "Song audio").slice(0, 200),
    };
    const next = await store.locked(projectId, async () => {
      const p = await store.read(projectId, "project.json");
      if (p.revision !== Number(req.query.revision))
        throw Object.assign(
          Error("Project changed. Save/reload before uploading."),
          { status: 409 },
        );
      await store.atomic(
        store.location(projectId, "assets", `${audio.sha256}.${extension}`),
        req.body,
      );
      p.audio = audio;
      p.durationMs = durationMs;
      p.playableEndMs = durationMs;
      p.playableStartMs = 0;
      p.alignmentReviewed = false;
      p.revision++;
      p.updatedAt = new Date().toISOString();
      await store.atomic(
        store.location(projectId, "revisions", `${p.revision}.json`),
        json(p),
      );
      await store.atomic(store.location(projectId, "project.json"), json(p));
      return p;
    });
    res.json(next);
  });
  app.get("/api/projects/:projectId/audio", async (req, res) => {
    const p = await store.read(req.params.projectId, "project.json");
    if (!p.audio) return res.sendStatus(404);
    res
      .type(p.audio.mimeType)
      .sendFile(
        store.location(
          p.projectId,
          "assets",
          `${p.audio.sha256}.${p.audio.extension}`,
        ),
      );
  });
  app.post("/api/projects/:projectId/takes", body, async (req, res) => {
    const projectId = id(req.params.projectId);
    const metadata = await store.locked(projectId, async () => {
      await store.read(projectId, "project.json");
      const takeId = randomUUID(),
        metadata = {
          takeId,
          projectId,
          name: String(req.body.name || "Android take").slice(0, 200),
          createdAt: new Date().toISOString(),
          status: req.body.status || null,
        };
      const folder = store.location(projectId, "capture", takeId);
      await fs.mkdir(path.join(folder, "batches"), { recursive: true });
      await store.atomic(path.join(folder, "capture.json"), json(metadata));
      return metadata;
    });
    res.status(201).json(metadata);
  });
  app.post(
    "/api/projects/:projectId/takes/:takeId/batches",
    body,
    async (req, res) => {
      const projectId = id(req.params.projectId),
        takeId = id(req.params.takeId),
        folder = store.location(projectId, "capture", takeId),
        { batchId, records } = req.body;
      if (
        !Number.isSafeInteger(batchId) ||
        batchId < 0 ||
        !Array.isArray(records) ||
        records.length > 500
      )
        throw Error("Invalid record batch");
      for (const e of records) {
        if (
          !Number.isSafeInteger(e.ordinal) ||
          e.ordinal < 0 ||
          !Number.isFinite(e.receivedBrowserTimeMs) ||
          !Number.isFinite(e.audioPositionAtReceiptMs) ||
          (e.audioPlaybackRate != null &&
            (!Number.isFinite(e.audioPlaybackRate) || e.audioPlaybackRate <= 0))
        )
          throw Error("Invalid recorder timing");
        if (e.record) {
          if (Buffer.byteLength(JSON.stringify(e.record)) > 16384)
            throw Error("Wire record exceeds 16 KiB");
          validateWire(e.record);
        } else if (!e.event) throw Error("Missing record/event");
      }
      await store.locked(projectId, async () => {
        await store.read(projectId, "project.json");
        await fs.access(path.join(folder, "capture.json"));
        if (
          await fs.access(path.join(folder, "sealed")).then(
            () => true,
            () => false,
          )
        )
          throw Error("Take already finalized");
        const bytes = json(records),
          filename = path.join(folder, "batches", `${batchId}.json`);
        try {
          const previous = await fs.readFile(filename);
          if (!previous.equals(bytes))
            throw Error("Batch retry differs from saved content");
        } catch (e) {
          if (e.code !== "ENOENT") throw e;
          await store.atomic(filename, bytes);
        }
      });
      res.json({ batchId, durable: true });
    },
  );
  app.post(
    "/api/projects/:projectId/takes/:takeId/finalize",
    body,
    async (req, res) => {
      const projectId = id(req.params.projectId),
        takeId = id(req.params.takeId),
        folder = store.location(projectId, "capture", takeId);
      const take = await store.locked(projectId, async () => {
        await store.read(projectId, "project.json");
        if (
          await fs.access(path.join(folder, "sealed")).then(
            () => true,
            () => false,
          )
        )
          return store.read(projectId, "takes", `${takeId}.json`);
        const metadata = JSON.parse(
            await fs.readFile(path.join(folder, "capture.json"), "utf8"),
          ),
          records = [];
        if (
          !Number.isInteger(req.body.batchCount) ||
          req.body.batchCount < 1 ||
          req.body.batchCount > 5000
        )
          throw Error("Invalid batch count");
        for (let n = 0; n < req.body.batchCount; n++) {
          const batch = JSON.parse(
            await fs.readFile(
              path.join(folder, "batches", `${n}.json`),
              "utf8",
            ),
          );
          for (const e of batch) {
            if (e.ordinal !== records.length)
              throw Error("Missing/out-of-order recorder records");
            records.push(e);
          }
        }
        if (records.length !== req.body.recordCount)
          throw Error("Incomplete take");
        metadata.interruptionReason = req.body.interruptionReason || null;
        const result = takeFromRecords(records, metadata);
        result.provenance.rawSha256 = sha(
          Buffer.from(records.map((e) => JSON.stringify(e) + "\n").join("")),
        );
        await store.atomic(
          path.join(folder, "records.ndjson"),
          Buffer.from(records.map((e) => JSON.stringify(e) + "\n").join("")),
        );
        const saved = await store.writeTake(projectId, result);
        await store.atomic(path.join(folder, "sealed"), Buffer.from("sealed"));
        return saved;
      });
      res.json(take);
    },
  );
  app.post("/api/projects/:projectId/compile", body, async (req, res) => {
    const p = await store.read(req.params.projectId, "project.json");
    if (p.revision !== req.body.revision)
      throw Object.assign(Error("Compile requires the saved revision"), {
        status: 409,
      });
    res.json(await store.compile(p));
  });
  app.get("/api/projects/:projectId/export", async (req, res) => {
    const p = await store.read(req.params.projectId, "project.json");
    const { files } = await store.bundle(p);
    res
      .attachment(`${p.songId}-r${p.revision}.aerodance-song.zip`)
      .type("application/zip")
      .send(makeZip(files));
  });
  app.get("/api/projects/:projectId/backup", async (req, res) => {
    const p = await store.read(req.params.projectId, "project.json"),
      files = new Map([["project.json", json(p)]]);
    for (const t of p.takes) {
      files.set(
        `takes/${t.takeId}.json`,
        await fs.readFile(
          store.location(p.projectId, "takes", `${t.takeId}.json`),
        ),
      );
      const rawFile = store.location(
        p.projectId,
        "capture",
        t.takeId,
        "records.ndjson",
      );
      try {
        files.set(`raw/${t.takeId}.ndjson`, await fs.readFile(rawFile));
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
    }
    for (const dataId of trackDataIds(p))
      files.set(
        `tracks/${dataId}.json`,
        await fs.readFile(
          store.location(p.projectId, "tracks", `${id(dataId)}.json`),
        ),
      );
    if (p.audio)
      files.set(
        `assets/${p.audio.sha256}.${p.audio.extension}`,
        await fs.readFile(
          store.location(
            p.projectId,
            "assets",
            `${p.audio.sha256}.${p.audio.extension}`,
          ),
        ),
      );
    res
      .attachment(`${p.songId}.aerodance-project.zip`)
      .type("application/zip")
      .send(makeZip(files));
  });
  app.post("/api/restore", raw, async (req, res) => {
    const files = readZip(req.body),
      restored = JSON.parse(files.get("project.json")?.toString() || "null");
    let p = restored;
    validateProject(p);
    p.projectId = randomUUID();
    p.revision = 0;
    for (const ref of p.takes) {
      const take = JSON.parse(
        files.get(`takes/${ref.takeId}.json`)?.toString() || "null",
      );
      validateTake(take);
      await store.writeTake(p.projectId, take);
      const raw = files.get(`raw/${ref.takeId}.ndjson`);
      if (raw)
        await store.atomic(
          store.location(p.projectId, "capture", ref.takeId, "records.ndjson"),
          raw,
        );
    }
    if (p.schemaVersion === 1) {
      const assets = await store.takes(p);
      p = migrateProject(p, assets);
      for (const dataId of trackDataIds(p))
        await store.writeTrack(p.projectId, assets.get(dataId));
    } else {
      for (const dataId of trackDataIds(p)) {
        const data = JSON.parse(
          files.get(`tracks/${dataId}.json`)?.toString() || "null",
        );
        if (data?.dataId !== dataId)
          throw Error("Backup track reference mismatch");
        await store.writeTrack(p.projectId, data);
      }
    }
    if (p.audio) {
      if (
        !/^[a-f0-9]{64}$/.test(p.audio.sha256) ||
        !["mp3", "wav", "ogg", "m4a", "flac"].includes(p.audio.extension)
      )
        throw Error("Invalid audio reference");
      const asset = files.get(`assets/${p.audio.sha256}.${p.audio.extension}`);
      if (!asset || sha(asset) !== p.audio.sha256)
        throw Error("Backup audio hash mismatch");
      await store.atomic(
        store.location(
          p.projectId,
          "assets",
          `${p.audio.sha256}.${p.audio.extension}`,
        ),
        asset,
      );
    }
    res.status(201).json(await store.save(p, null));
  });
  app.use("/api", (_req, res) =>
    res.status(404).json({ error: "API route not found" }),
  );
  app.use(express.static(distDir));
  app.get("/{*splat}", (_req, res) =>
    res.sendFile(path.join(distDir, "index.html")),
  );
  app.use((err, _req, res, _next) => {
    const status = err.status || (err.code === "ENOENT" ? 404 : 400);
    res.status(status).json({
      error: status === 404 ? "Project/asset not found" : err.message,
    });
  });
  return { app, store };
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const { app } = createStudio();
  app.listen(Number(process.env.STUDIO_PORT) || 3000, "0.0.0.0", () =>
    console.log(
      `Dance Studio: http://localhost:${process.env.STUDIO_PORT || 3000}`,
    ),
  );
}
