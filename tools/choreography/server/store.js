import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import {
  validateProject,
  validateTake,
  compileProject,
  reviewReport,
  trackDataIds,
  validateTrackData,
  migrateProject,
} from "../core.js";
export const sha = (b) => createHash("sha256").update(b).digest("hex");
export const json = (v) => Buffer.from(JSON.stringify(v, null, 2) + "\n");
export const id = (value) => {
  if (!/^[a-zA-Z0-9-]{1,80}$/.test(value)) throw Error("Invalid ID");
  return value;
};
export class Store {
  constructor(root) {
    this.root = path.resolve(root);
    this.queues = new Map();
  }
  location(projectId, ...parts) {
    return path.join(this.root, "projects", id(projectId), ...parts);
  }
  async read(projectId, ...parts) {
    return JSON.parse(
      await fs.readFile(this.location(projectId, ...parts), "utf8"),
    );
  }
  async atomic(filename, bytes) {
    await fs.mkdir(path.dirname(filename), { recursive: true });
    const tmp = `${filename}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(tmp, bytes);
      await fs.rename(tmp, filename);
    } finally {
      await fs.rm(tmp, { force: true });
    }
  }
  async locked(key, fn) {
    const previous = this.queues.get(key) || Promise.resolve();
    const next = previous.catch(() => {}).then(fn);
    this.queues.set(key, next);
    try {
      return await next;
    } finally {
      if (this.queues.get(key) === next) this.queues.delete(key);
    }
  }
  async save(project, expectedRevision, alreadyLocked = false) {
    validateProject(project);
    const persist = async () => {
      let current;
      try {
        current = await this.read(project.projectId, "project.json");
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
      if (
        (current && current.revision !== expectedRevision) ||
        (!current && expectedRevision !== null)
      )
        throw Object.assign(
          Error("Project changed in another window. Reload before saving."),
          { status: 409 },
        );
      if (current?.audio) {
        if (project.audio?.sha256 !== current.audio.sha256)
          throw Error("Upload audio through the asset API");
      } else if (project.audio) {
        await fs.access(
          this.location(
            project.projectId,
            "assets",
            `${project.audio.sha256}.${project.audio.extension}`,
          ),
        );
      }
      for (const t of project.takes)
        await fs.access(
          this.location(project.projectId, "takes", `${id(t.takeId)}.json`),
        );
      for (const dataId of trackDataIds(project))
        await fs.access(
          this.location(project.projectId, "tracks", `${id(dataId)}.json`),
        );
      if (project.schemaVersion === 2) {
        for (const track of project.tracks)
          for (const dataId of new Set(
            [track.dataId, track.originalDataId].filter(Boolean),
          )) {
            const data = await this.read(
              project.projectId,
              "tracks",
              `${id(dataId)}.json`,
            );
            if (data.playerId !== track.playerId || data.dataId !== dataId)
              throw Error("Track snapshot belongs to another player");
          }
      }
      const next = {
        ...project,
        revision: (current?.revision || 0) + 1,
        createdAt: current?.createdAt || project.createdAt,
        updatedAt: new Date().toISOString(),
      };
      await this.atomic(
        this.location(project.projectId, "revisions", `${next.revision}.json`),
        json(next),
      );
      await this.atomic(
        this.location(project.projectId, "project.json"),
        json(next),
      );
      return next;
    };
    return alreadyLocked ? persist() : this.locked(project.projectId, persist);
  }
  async list() {
    await fs.mkdir(path.join(this.root, "projects"), { recursive: true });
    const folders = await fs.readdir(path.join(this.root, "projects"));
    const projects = [];
    for (const folder of folders) {
      try {
        const p = await this.read(folder, "project.json");
        projects.push({
          projectId: p.projectId,
          title: p.metadata.title,
          artist: p.metadata.artist,
          updatedAt: p.updatedAt,
        });
      } catch {}
    }
    return projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async writeTake(projectId, take) {
    validateTake(take);
    const { sha256: _oldHash, ...content } = take;
    const bytes = json(content);
    take = { ...content, sha256: sha(bytes) };
    const filename = this.location(
      projectId,
      "takes",
      `${id(take.takeId)}.json`,
    );
    await fs.mkdir(path.dirname(filename), { recursive: true });
    await fs.writeFile(filename, json(take), { flag: "wx" });
    return take;
  }
  async takes(p) {
    const entries = await Promise.all(
      p.takes.map(async (t) => [
        t.takeId,
        await this.read(p.projectId, "takes", `${id(t.takeId)}.json`),
      ]),
    );
    for (const dataId of trackDataIds(p))
      entries.push([
        dataId,
        await this.read(p.projectId, "tracks", `${id(dataId)}.json`),
      ]);
    return new Map(entries);
  }
  async open(projectId) {
    return this.locked(projectId, async () => {
      const p = await this.read(projectId, "project.json");
      if (p.schemaVersion === 2) return p;
      const assets = await this.takes(p),
        next = migrateProject(p, assets);
      for (const dataId of trackDataIds(next))
        await this.writeTrack(projectId, assets.get(dataId), false, true);
      return this.save(next, p.revision, true);
    });
  }
  async writeTrack(
    projectId,
    data,
    requireProject = false,
    alreadyLocked = false,
  ) {
    validateTrackData(data);
    const persist = async () => {
      if (requireProject) await this.read(projectId, "project.json");
      const filename = this.location(
        projectId,
        "tracks",
        `${id(data.dataId)}.json`,
      );
      try {
        const current = await fs.readFile(filename);
        if (!current.equals(json(data)))
          throw Error("Track snapshot is immutable");
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
        await this.atomic(filename, json(data));
      }
      return { dataId: data.dataId };
    };
    return alreadyLocked ? persist() : this.locked(projectId, persist);
  }
  async remove(projectId, expectedRevision, takeId = null) {
    return this.locked(projectId, async () => {
      const p = await this.read(projectId, "project.json");
      if (p.revision !== expectedRevision)
        throw Object.assign(Error("Project changed. Reload before deleting."), {
          status: 409,
        });
      if (!takeId) {
        await fs.rm(this.location(projectId), { recursive: true });
        return { deleted: true };
      }
      if (p.schemaVersion !== 2)
        throw Error("Open the project before deleting takes");
      if (!p.takes.some((t) => t.takeId === takeId))
        throw Object.assign(Error("Take not found"), { status: 404 });
      p.takes = p.takes.filter((t) => t.takeId !== takeId);
      p.revision++;
      p.updatedAt = new Date().toISOString();
      await this.atomic(
        this.location(projectId, "revisions", `${p.revision}.json`),
        json(p),
      );
      await this.atomic(this.location(projectId, "project.json"), json(p));
      await fs.rm(this.location(projectId, "takes", `${id(takeId)}.json`), {
        force: true,
      });
      await fs.rm(this.location(projectId, "capture", id(takeId)), {
        recursive: true,
        force: true,
      });
      return p;
    });
  }
  async compile(p) {
    const data = compileProject(p, await this.takes(p));
    data.provenance.settingsHash = sha(
      json({
        operations: p.operations.slice(0, p.operationCursor),
        tracks: p.tracks,
      }),
    );
    return { data, report: reviewReport(p, data) };
  }
  async bundle(p) {
    const { data, report } = await this.compile(p);
    if (report.blockers.length)
      throw Object.assign(Error(report.blockers.join("\n")), { status: 422 });
    const extension = p.audio.extension,
      filename = `audio.${extension}`,
      audio = await fs.readFile(
        this.location(p.projectId, "assets", `${p.audio.sha256}.${extension}`),
      );
    if (sha(audio) !== p.audio.sha256)
      throw Error("Audio integrity check failed");
    const song = {
      schema: "aerodance.song",
      schemaVersion: 1,
      songId: p.songId,
      bundleRevision: p.revision,
      ...p.metadata,
      durationMs: p.durationMs,
      playableStartMs: p.playableStartMs,
      playableEndMs: p.playableEndMs,
      supportedPlayerCounts: [1, 2],
      audio: { path: filename, mimeType: p.audio.mimeType },
      choreography: { path: "choreography.json", schemaVersion: 1 },
      coachMode: "mirror-player",
      rigProfile: "frutiger-seven-bone-v1",
      createdAt: p.createdAt,
      publishedAt: p.updatedAt,
      build: { compilerVersion: "1.0.0", projectRevision: p.revision },
    };
    const files = new Map([
      ["song.json", json(song)],
      ["choreography.json", Buffer.from(JSON.stringify(data) + "\n")],
      [filename, audio],
    ]);
    const checksums = {
      schema: "aerodance.checksums",
      schemaVersion: 1,
      files: [...files].map(([name, bytes]) => ({
        path: name,
        bytes: bytes.length,
        sha256: sha(bytes),
      })),
    };
    if (
      [...files.values()].some((bytes) => bytes.length > 128 * 1024 * 1024) ||
      [...files.values()].reduce((sum, bytes) => sum + bytes.length, 0) >
        192 * 1024 * 1024
    )
      throw Error(
        "Bundle exceeds the game loader size limit; shorten the playable range or use smaller audio",
      );
    files.set("checksums.json", json(checksums));
    return {
      files: new Map(
        [...files].map(([name, bytes]) => [`${p.songId}/${name}`, bytes]),
      ),
      report,
    };
  }
}
