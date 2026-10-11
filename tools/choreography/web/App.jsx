import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PoseSourceController } from "../../../client/src/pose/PoseSourceController.js";
import WebcamControls from './WebcamControls.jsx';
import { DEFAULT_STAGE, STAGE_LIST } from "../../../packages/stages/catalog.js";
import { NdjsonDecoder } from "../../../client/src/pose/protocol.js";
import {
  JOINT_NAMES,
  copy,
  clamp,
  sampleSnapshot,
} from "../../../packages/pose/choreography.js";
import {
  compileProject,
  reviewReport,
  importMotion,
  takeFromRecords,
  addTake,
  appendOperation,
  validateProject,
  overwriteTracks,
  clearTrack,
  offsetTrack,
  historyStep,
  trackDataIds,
  missingIntervals,
  interpolateTrack,
} from "../core.js";
import { AudioTransport } from "./audio.js";
import { Recorder } from "./recorder.js";
import Preview from "./Preview.jsx";
import { calibratePoses } from "../../../packages/character/calibration.js";
import { LiveCalibration } from '../../../packages/character/liveCalibration.js';

async function request(url, { body, ...options } = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(body && !(body instanceof Blob)
        ? { "Content-Type": "application/json" }
        : {}),
      ...options.headers,
    },
    body: body instanceof Blob ? body : body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    let message;
    try {
      message = (await response.json()).error;
    } catch {
      message = `HTTP ${response.status}`;
    }
    throw Error(message);
  }
  return response.json();
}
const timeLabel = (ms) =>
  `${Math.floor(Math.max(0, ms) / 60000)
    .toString()
    .padStart(
      2,
      "0",
    )}:${((Math.max(0, ms) / 1000) % 60).toFixed(2).padStart(5, "0")}`;
const opNames = {
  joint: "Joint keyframe",
  swap: "Swap tracks",
  mirror: "Mirror target",
  smooth: "Smooth coordinates",
  repair: "Gap repair",
  exclude: "Score exclusion",
  approve: "Reference approval",
  overwrite: "Overwrite track",
  clear: "Delete track",
  offset: "Track offset",
  interpolate: "Interpolate missing intervals",
};
const POINT_GROUPS = {
  head: { label: "Head", indices: Array.from({ length: 11 }, (_, i) => i) },
  leftHand: { label: "Left hand", indices: [15, 17, 19, 21] },
  rightHand: { label: "Right hand", indices: [16, 18, 20, 22] },
  hands: { label: "Both hands", indices: [15, 16, 17, 18, 19, 20, 21, 22] },
  leftFoot: { label: "Left foot", indices: [27, 29, 31] },
  rightFoot: { label: "Right foot", indices: [28, 30, 32] },
  feet: { label: "Both feet", indices: [27, 28, 29, 30, 31, 32] },
  body: {
    label: "Whole skeleton",
    indices: Array.from({ length: 33 }, (_, i) => i),
  },
};
const EMPTY = { poses: [], quality: [] };

export default function App() {
  const [projects, setProjects] = useState([]),
    [project, setProject] = useState(null),
    [takes, setTakes] = useState(new Map()),
    [dirty, setDirty] = useState(false),
    [saveStatus, setSaveStatus] = useState("Saved"),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const [cursor, setCursor] = useState(0),
    [playing, setPlaying] = useState(false),
    [speed, setSpeed] = useState(1),
    [loop, setLoop] = useState(false),
    [selection, setSelection] = useState([0, 1000]),
    [mode, setMode] = useState("both"),
    [view, setView] = useState("playback"),
    [takeCursor, setTakeCursor] = useState(0),
    [tab, setTab] = useState("joint"),
    [playerId, setPlayerId] = useState(0),
    [joint, setJoint] = useState(15),
    [pointGroup, setPointGroup] = useState("single"),
    [draftJoint, setDraftJoint] = useState(null),
    [peaks, setPeaks] = useState([]),
    [activeTake, setActiveTake] = useState(""),
    [reason, setReason] = useState("Reviewed against audio and source pose"),
    [ip, setIp] = useState(
      () => localStorage.getItem("aerodance-client-ip") || "192.168.43.1",
    ),
    [connection, setConnection] = useState({
      status: "disconnected",
      snapshot: null,
    }),
    [recording, setRecording] = useState(false),
    [recordCount, setRecordCount] = useState(0),
    [recordDelay, setRecordDelay] = useState(3),
    [countdown, setCountdown] = useState(null);
  const [liveTracks, setLiveTracks] = useState(null);
  const takeClock = useRef(null),
    viewRef = useRef(view),
    takeRef = useRef(null),
    assetsRef = useRef(takes),
    persistedTracks = useRef(new Set());
  viewRef.current = view;
  assetsRef.current = takes;
  takeRef.current = takes.get(activeTake) || null;
  const [inputMode, setInputMode] = useState('android');
  const liveHistory = useRef(new LiveCalibration());
  const [calibrationCounts, setCalibrationCounts] = useState([0, 0]);
  const source = useMemo(() => new PoseSourceController(), []),
    transport = useMemo(() => new AudioTransport(), []),
    recorder = useRef(null),
    recordStopping = useRef(false),
    savePromise = useRef(null),
    projectRef = useRef(project),
    dirtyRef = useRef(dirty),
    recordingRef = useRef(recording),
    cursorRef = useRef(cursor),
    playingRef = useRef(playing),
    recordEnd = useRef(0);
  projectRef.current = project;
  dirtyRef.current = dirty;
  recordingRef.current = recording;
  cursorRef.current = cursor;
  playingRef.current = playing;
  const edit = useCallback((fn) => {
    setProject((p) => (typeof fn === "function" ? fn(copy(p)) : fn));
    setDirty(true);
    setSaveStatus("Unsaved");
    setError("");
  }, []);
  const execute = async (fn) => {
    setBusy(true);
    setError("");
    try {
      return await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const refresh = async () => setProjects(await request("/api/projects"));
  const saveProject = useCallback(async () => {
    if (savePromise.current) await savePromise.current;
    if (!dirtyRef.current) return projectRef.current;
    const sent = projectRef.current;
    setSaveStatus("Saving…");
    const job = (async () => {
      for (const dataId of trackDataIds(sent)) {
        if (persistedTracks.current.has(dataId)) continue;
        await request(`/api/projects/${sent.projectId}/tracks`, {
          method: "POST",
          body: assetsRef.current.get(dataId),
        });
        persistedTracks.current.add(dataId);
      }
      return request(`/api/projects/${sent.projectId}`, {
        method: "PUT",
        body: sent,
      });
    })();
    savePromise.current = job;
    try {
      const next = await job;
      if (projectRef.current === sent) {
        projectRef.current = next;
        dirtyRef.current = false;
        setProject(next);
        setDirty(false);
      } else {
        setProject((p) =>
          p?.projectId === sent.projectId
            ? { ...p, revision: next.revision }
            : p,
        );
      }
      setSaveStatus("Saved");
      await refresh();
      return next;
    } catch (e) {
      setSaveStatus("Save failed");
      throw e;
    } finally {
      if (savePromise.current === job) savePromise.current = null;
    }
  }, []);
  async function openProject(p) {
    // Validate saved projects before installing them into render state.
    validateProject(copy(p));
    if (recordingRef.current)
      throw Error("Stop recording before switching projects");
    transport.pause();
    takeClock.current = null;
    setView("playback");
    setTakeCursor(0);
    setPlaying(false);
    setCountdown(null);
    setCursor(0);
    setDraftJoint(null);
    const entries = await Promise.all(
      p.takes.map(async (t) => [
        t.takeId,
        await request(`/api/projects/${p.projectId}/takes/${t.takeId}`),
      ]),
    );
    const trackEntries = await Promise.all(
      trackDataIds(p).map(async (dataId) => [
        dataId,
        await request(`/api/projects/${p.projectId}/tracks/${dataId}`),
      ]),
    );
    entries.push(...trackEntries);
    persistedTracks.current = new Set(trackDataIds(p));
    if (p.audio) {
      const response = await fetch(`/api/projects/${p.projectId}/audio`);
      if (!response.ok) throw Error("Project audio is unavailable");
      const decoded = await transport.load(await response.arrayBuffer());
      setPeaks(decoded.peaks);
    } else {
      transport.buffer = null;
      setPeaks([]);
    }
    projectRef.current = p;
    dirtyRef.current = false;
    setProject(p);
    setTakes(new Map(entries));
    setDirty(false);
    setSaveStatus("Saved");
    setSelection([
      p.playableStartMs,
      Math.min(p.playableEndMs || 1000, p.playableStartMs + 1000),
    ]);
    setActiveTake(p.takes[0]?.takeId || "");
  }
  useEffect(() => {
    execute(async () => {
      const list = await request("/api/projects");
      setProjects(list);
      if(!list.length) {
        await openProject(await request('/api/projects',{method:'POST',body:{}}));
      } else {
        const failures=[];
        let opened=false;
        for(const summary of list) {
          try {
            await openProject(await request(`/api/projects/${summary.projectId}`));
            opened=true; break;
          } catch(e) { failures.push(`${summary.title}: ${e.message}`); }
        }
        if(!opened) throw Error(`No saved project can be opened. ${failures.join(' ')}`);
        if(failures.length) setNotice(`Opened a compatible project. Skipped incompatible or unavailable projects: ${failures.join(' ')}`);
      }
      await refresh();
    });
    return () => {
      source.disconnect();
      transport.dispose();
    };
  }, []);
  useEffect(() => {
    const closeMenus = (e) =>
      document.querySelectorAll(".take-menu[open]").forEach((menu) => {
        if (e.key === "Escape" || !menu.contains(e.target)) menu.open = false;
      });
    document.addEventListener("pointerdown", closeMenus);
    document.addEventListener("keydown", closeMenus);
    return () => {
      document.removeEventListener("pointerdown", closeMenus);
      document.removeEventListener("keydown", closeMenus);
    };
  }, []);
  useEffect(() => source.subscribe(setConnection), [source]);
  useEffect(() => {
    const s = connection.snapshot;
    if (!s) {
      liveHistory.current.reset();
      setCalibrationCounts([0, 0]);
      setLiveTracks(null); return;
    }
    const history = liveHistory.current;
    const previousSession=history.session;
    const changed=history.accept(s);
    if(changed || previousSession!==history.session) {
      setLiveTracks(history.tracks); setCalibrationCounts(history.counts);
    }
  }, [connection.snapshot]);
  useEffect(() => {
    if (!dirty || !project || recording || busy) return;
    const timer = setTimeout(
      () => saveProject().catch((e) => setError(e.message)),
      1200,
    );
    return () => clearTimeout(timer);
  }, [project, dirty, recording, busy, saveProject]);
  useEffect(() => {
    const unload = (e) => {
      if (dirtyRef.current || recordingRef.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", unload);
    return () => window.removeEventListener("beforeunload", unload);
  }, []);
  useEffect(() => {
    const hidden = () => {
      if (!document.hidden) return;
      if (recordingRef.current) void stopRecording("Tab was hidden");
      else {
        takeClock.current = null;
        const t = transport.pause();
        setPlaying(false);
        if (viewRef.current !== "take") setCursor(Math.max(0, t));
      }
    };
    document.addEventListener("visibilitychange", hidden);
    return () => document.removeEventListener("visibilitychange", hidden);
  }, []);
  useEffect(() => {
    if (recording && connection.status !== "connected")
      void stopRecording("Pose source connection interrupted");
  }, [recording, connection.status]);
  useEffect(() => {
    let frame;
    const tick = () => {
      if (viewRef.current === "take" && takeClock.current && takeRef.current) {
        const take = takeRef.current;
        const end =
          (take.samples.at(-1).takeTimeMs - take.samples[0].takeTimeMs) *
          take.timeScale;
        const now =
          takeClock.current.positionMs +
          (performance.now() - takeClock.current.startTime) *
            takeClock.current.speed;
        setTakeCursor(Math.min(end, now));
        if (now >= end) {
          takeClock.current = null;
          transport.pause();
          setPlaying(false);
        }
      } else if (transport.active) {
        const now = transport.current();
        setCountdown(
          recordingRef.current &&
            transport.context.currentTime < transport.startTime
            ? Math.ceil(transport.startTime - transport.context.currentTime)
            : null,
        );
        setCursor(Math.max(0, now));
        if (recordingRef.current) {
          setRecordCount(recorder.current?.ordinal || 0);
          if (now >= recordEnd.current) void stopRecording();
        } else if (playingRef.current && projectRef.current) {
          const end = loop ? selection[1] : projectRef.current.playableEndMs;
          if (now >= end) {
            if (loop)
              transport
                .play(selection[0], 0, speed)
                .catch((e) => setError(e.message));
            else {
              transport.pause();
              setPlaying(false);
              setCursor(end);
            }
          }
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [loop, selection, speed]);
  const compiled = useMemo(() => {
    if (!project || !takes.size) return { data: null, report: null };
    try {
      const data = compileProject(project, takes);
      return { data, report: reviewReport(project, data) };
    } catch (e) {
      return { data: null, report: null, error: e.message };
    }
  }, [project, takes]);
  const original = useMemo(() => {
    if (!project || !takes.size) return null;
    try {
      return compileProject(
        {
          ...project,
          tracks: project.tracks.map((t) => ({
            ...t,
            dataId: t.originalDataId,
          })),
          operations: [],
          operationCursor: 0,
        },
        takes,
      );
    } catch {
      return null;
    }
  }, [
    project?.tracks,
    takes,
    project?.playableStartMs,
    project?.playableEndMs,
    project?.durationMs,
  ]);
  const showingLive = recording || view === "live";
  const showingTake = !recording && view === "take";
  const readOnly = showingLive || showingTake;
  const selectedTake = takes.get(activeTake);
  const takeDuration = selectedTake
    ? (selectedTake.samples.at(-1).takeTimeMs -
        selectedTake.samples[0].takeTimeMs) *
      selectedTake.timeScale
    : 0;
  const previewTracks = useMemo(
    () =>
      selectedTake
        ? [0, 1].map((playerId) => ({
            playerId,
            calibration: calibratePoses(
              selectedTake.samples.flatMap((s) =>
                s.poses.filter((p) => p.playerId === playerId),
              ),
              selectedTake.input,
              { adaptiveDistance: selectedTake.source === "webcam" },
            ),
          }))
        : null,
    [selectedTake],
  );
  const fillable = useMemo(
    () =>
      [0, 1].map((id) => {
        try {
          return project ? missingIntervals(project, takes, id).length : 0;
        } catch {
          return 0;
        }
      }),
    [project, takes],
  );
  let snapshot = showingLive
    ? connection.snapshot || EMPTY
    : showingTake
      ? selectedTake
        ? sampleSnapshot(
            selectedTake.samples,
            selectedTake.samples[0].takeTimeMs +
              takeCursor / selectedTake.timeScale,
            "takeTimeMs",
          )
        : EMPTY
      : compiled.data
        ? sampleSnapshot(compiled.data.samples, cursor)
        : EMPTY;
  if (draftJoint && !readOnly) {
    snapshot = copy(snapshot);
    const p = snapshot.poses.find((p) => p.playerId === draftJoint.playerId);
    if (p)
      for (const target of draftJoint.targets)
        Object.assign(p.landmarks[target.joint], target.value);
  }
  const selectedPose = snapshot.poses.find((p) => p.playerId === playerId),
    selectedJoint = selectedPose?.landmarks[joint];
  const fallbackTracks = useMemo(
    () =>
      [0, 1].map((playerId) => ({
        playerId,
        calibration: {
          inputWidth: 640,
          inputHeight: 480,
          torsoLength: 0.2,
          baseHip: { x: playerId === 0 ? 0.25 : 0.75, y: 0.55, z: 0 },
          floorY: 0.9,
          profileVersion: 1,
        },
      })),
    [],
  );
  const pause = () => {
    transport.pause();
    takeClock.current = null;
    playingRef.current = false;
    setPlaying(false);
  };
  const changeView = (next) => {
    pause();
    setView(next);
    setDraftJoint(null);
  };
  const selectTake = (takeId) => {
    pause();
    setActiveTake(takeId);
    setTakeCursor(0);
    setView("take");
    setDraftJoint(null);
  };
  const modifyTracks = (fn) => {
    const assets = new Map(takes),
      next = fn(project, assets);
    assetsRef.current = assets;
    setTakes(assets);
    edit(next);
  };
  const seek = (time) => {
    if (recording) return;
    if (showingTake) {
      pause();
      setTakeCursor(clamp(time, 0, takeDuration));
      return;
    }
    transport.seek(time);
    setPlaying(false);
    setCursor(time);
    setDraftJoint(null);
  };
  const play = () =>
    execute(async () => {
      if (recording) return;
      if (showingTake) {
        if (playing) {
          pause();
          return;
        }
        if (!selectedTake) return;
        const positionMs = takeCursor >= takeDuration ? 0 : takeCursor;
        setTakeCursor(positionMs);
        const songPosition =
          selectedTake.offsetMs +
          selectedTake.samples[0].takeTimeMs * selectedTake.timeScale +
          positionMs;
        if (transport.buffer && songPosition < project.durationMs)
          await transport.play(
            Math.max(0, songPosition),
            Math.max(0, -songPosition) / (1000 * speed),
            speed,
          );
        takeClock.current = { positionMs, startTime: performance.now(), speed };
        setPlaying(true);
        return;
      }
      if (playing) {
        seek(transport.current());
        return;
      }
      await transport.play(
        loop
          ? selection[0]
          : cursor >= project.playableEndMs
            ? project.playableStartMs
            : cursor,
        0,
        speed,
      );
      setPlaying(true);
    });
  const apply = (type) => {
    if (readOnly || busy) return;
    modifyTracks((p, assets) =>
      appendOperation(
        p,
        {
          type,
          startMs: selection[0],
          endMs: selection[1],
          playerId: type === "swap" ? null : playerId,
          windowMs: type === "smooth" ? 120 : undefined,
          reason: ["exclude", "approve"].includes(type) ? reason : undefined,
        },
        assets,
      ),
    );
  };
  function jointEdit(id, index, value, commit) {
    if (readOnly || busy) return;
    setPlayerId(id);
    setJoint(index);
    const base =
      compiled.data &&
      sampleSnapshot(compiled.data.samples, cursor).poses.find(
        (p) => p.playerId === id,
      );
    if (!base) return;
    const indices = POINT_GROUPS[pointGroup]?.indices.includes(index)
      ? POINT_GROUPS[pointGroup].indices
      : [index];
    const targets = indices.map((i) => ({
      joint: i,
      value: Object.fromEntries(
        ["x", "y", "z"].map((k) => [
          k,
          base.landmarks[i][k] + value[k] - base.landmarks[index][k],
        ]),
      ),
    }));
    if (!commit) {
      setDraftJoint({ playerId: id, targets });
      return;
    }
    setDraftJoint(null);
    const time = Math.min(cursor, project.playableEndMs);
    modifyTracks((p, assets) =>
      appendOperation(
        p,
        {
          type: "joint",
          playerId: id,
          joint: index,
          timeMs: time,
          startMs: Math.max(p.playableStartMs, time - 150),
          endMs: Math.min(p.playableEndMs, time + 150),
          value: targets.find((t) => t.joint === index).value,
          targets,
        },
        assets,
      ),
    );
  }
  async function attachTake(take) {
    setTakes((map) => new Map([...map, [take.takeId, take]]));
    edit((p) => addTake(p, take));
    selectTake(take.takeId);
    setNotice(
      `Imported ${take.samples.length} samples. Review alignment and confidence before exporting.`,
    );
  }
  async function importFile(file) {
    if (!file) return;
    await execute(async () => {
      if (file.name.endsWith(".zip")) {
        await saveProject();
        const p = await request("/api/restore", {
          method: "POST",
          body: file,
          headers: { "Content-Type": "application/zip" },
        });
        await openProject(p);
        await refresh();
        return;
      }
      const text = await file.text();
      let take;
      if (file.name.endsWith(".ndjson") || file.name.endsWith(".jsonl")) {
        const lines = text.trim().split("\n"),
          records = lines.map((line, i) => {
            const parsed = JSON.parse(line);
            return parsed.record
              ? { ...parsed, ordinal: i }
              : {
                  ordinal: i,
                  receivedBrowserTimeMs:
                    parsed.resultTimeMs ?? parsed.producerTimeMs ?? i,
                  record: parsed,
                };
          });
        const validator = new NdjsonDecoder(() => {});
        for (const e of records)
          if (e.record)
            validator.push(
              new TextEncoder().encode(JSON.stringify(e.record) + "\n"),
            );
        validator.finish();
        take = takeFromRecords(records, {
          takeId: crypto.randomUUID(),
          name: file.name,
          createdAt: new Date().toISOString(),
        });
      } else take = importMotion(JSON.parse(text), file.name);
      await request(`/api/projects/${project.projectId}/import`, {
        method: "POST",
        body: take,
      }).then(attachTake);
    });
  }
  async function importAudio(file) {
    if (!file) return;
    await execute(async () => {
      const p = await saveProject();
      const decoded = await transport.load(await file.arrayBuffer());
      let type = file.type;
      const ext = file.name.split(".").at(-1).toLowerCase();
      if (!type || type === "application/octet-stream")
        type = {
          mp3: "audio/mpeg",
          wav: "audio/wav",
          ogg: "audio/ogg",
          m4a: "audio/mp4",
          flac: "audio/flac",
        }[ext];
      const next = await request(
        `/api/projects/${p.projectId}/audio?durationMs=${decoded.durationMs}&revision=${p.revision}&name=${encodeURIComponent(file.name)}`,
        { method: "POST", body: file, headers: { "Content-Type": type } },
      );
      await openProject(next);
      setNotice(
        "Audio imported. Confirm alignment after reviewing the start and end.",
      );
    });
  }
  async function startRecording() {
    await execute(async () => {
      if (!transport.buffer) throw Error("Import music before recording");
      if (connection.status !== "connected")
        throw Error("Connect a pose source before recording");
      if (!connection.snapshot) throw Error('Wait for fresh camera frames before recording');
      pause();
      setView("live");
      await saveProject();
      recordEnd.current = project.playableEndMs;
      if (!Number.isFinite(recordDelay) || recordDelay < 0 || recordDelay > 60)
        throw Error("Recording delay must be between 0 and 60 seconds");
      await transport.play(project.playableStartMs, recordDelay, 1);
      const r = new Recorder({
        source,
        transport,
        request,
        projectId: project.projectId,
        onFailure: (message) => void stopRecording(message),
      });
      recorder.current = r;
      try {
        await r.start();
      } catch (e) {
        transport.pause();
        throw e;
      }
      recordStopping.current = false;
      recordingRef.current = true;
      setRecording(true);
      setCountdown(recordDelay > 0 ? Math.ceil(recordDelay) : null);
      setPlaying(false);
      setMode("both");
      setRecordCount(0);
      setNotice(
        inputMode === 'webcam'
          ? 'Webcam frames use a browser/audio clock anchor. Review remaining camera buffering and audio output delay before export.'
          : 'Camera processing delay is compensated automatically. Review alignment for remaining camera and network delay before export.',
      );
    });
  }
  async function stopRecording(reason = null) {
    if (!recorder.current?.running || recordStopping.current) return;
    recordStopping.current = true;
    transport.pause();
    recordingRef.current = false;
    setRecording(false);
    setCountdown(null);
    setBusy(true);
    try {
      const take = await recorder.current.stop(reason);
      if (!take) {
        setCursor(projectRef.current.playableStartMs);
        setNotice(
          "Recording cancelled before enough movement was captured. No take added.",
        );
        if (reason) setError(reason);
        return;
      }
      await attachTake(take);
      if (reason)
        setError(
          `Take interrupted: ${reason}. Review the saved prefix before use.`,
        );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
      recordStopping.current = false;
      recorder.current = null;
    }
  }
  async function download(kind) {
    await execute(async () => {
      const p = await saveProject();
      const response = await fetch(`/api/projects/${p.projectId}/${kind}`);
      if (!response.ok) throw Error((await response.json()).error);
      const url = URL.createObjectURL(await response.blob()),
        a = document.createElement("a");
      a.href = url;
      a.download = `${p.songId}${kind === "backup" ? ".aerodance-project.zip" : `-r${p.revision}.aerodance-song.zip`}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }
  async function deleteProject() {
    if (
      !window.confirm(
        `Delete project/song “${project.metadata.title}”? Its music, tracks, takes, and saved project data will be permanently removed.`,
      )
    )
      return;
    await execute(async () => {
      pause();
      // Wait for outstanding writes without trying to save discarded/invalid edits.
      const wasDirty = dirtyRef.current;
      dirtyRef.current = false;
      setDirty(false);
      try {
        const p = await saveProject();
        await request(`/api/projects/${p.projectId}`, {
          method: "DELETE",
          body: { revision: p.revision },
        });
      } catch (e) {
        if (wasDirty) {
          dirtyRef.current = true;
          setDirty(true);
          setSaveStatus("Unsaved");
        }
        throw e;
      }
      dirtyRef.current = false;
      setDirty(false);
      const list = await request("/api/projects");
      const next = list.length
        ? await request(`/api/projects/${list[0].projectId}`)
        : await request("/api/projects", { method: "POST", body: {} });
      await openProject(next);
      await refresh();
      setNotice("Project/song deleted.");
    });
  }
  async function deleteTake(take) {
    if (
      !window.confirm(
        `Delete take “${take.name}”? Assigned P1 and P2 track data will remain intact.`,
      )
    )
      return;
    await execute(async () => {
      pause();
      const p = await saveProject();
      const next = await request(
        `/api/projects/${p.projectId}/takes/${take.takeId}`,
        { method: "DELETE", body: { revision: p.revision } },
      );
      projectRef.current = next;
      dirtyRef.current = false;
      setProject(next);
      setDirty(false);
      setSaveStatus("Saved");
      setTakes((map) => {
        const result = new Map(map);
        result.delete(take.takeId);
        return result;
      });
      if (activeTake === take.takeId) {
        setActiveTake("");
        setTakeCursor(0);
        setView("playback");
      }
      await refresh();
      setNotice("Take deleted. Assigned tracks were preserved.");
    });
  }
  function assignTake(take, ids) {
    pause();
    modifyTracks((p, assets) => overwriteTracks(p, take, ids, assets));
    setView("playback");
    setCursor(
      Math.max(0, take.offsetMs + take.samples[0].takeTimeMs * take.timeScale),
    );
    setNotice(
      `Overwrote ${ids.length === 2 ? "both tracks" : `P${ids[0] + 1} track`}. Review alignment before export.`,
    );
  }
  if (!project)
    return (
      <div className="loading">
        <span className="brand-orb" />
        {error ? 'Unable to open saved projects.' : 'Opening Dance Studio…'}
        {error && <>
          <p role="alert">{error}</p>
          <button disabled={busy} onClick={() => execute(async () => {
            await openProject(await request('/api/projects',{method:'POST',body:{}}));
            await refresh();
          })}>Create new project</button>
          <small>Existing projects are preserved.</small>
        </>}
      </div>
    );
  const displayCursor = showingTake ? takeCursor : cursor;
  const duration = (showingTake ? takeDuration : project.durationMs) || 1000,
    percent = clamp((displayCursor / duration) * 100, 0, 100),
    rangeValid = selection[1] > selection[0];
  return (
    <div className="studio">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Dance Studio">
          <span className="brand-orb" />
          <div>
            AERODANCE <strong>Dance Studio</strong>
          </div>
        </a>
        <div className="project-picker">
          <select
            aria-label="Open project"
            value={project.projectId}
            disabled={recording || busy}
            onChange={(e) => {
              const projectId = e.currentTarget.value;
              return execute(async () => {
                await saveProject();
                await openProject(
                  await request(`/api/projects/${projectId}`),
                );
              });
            }}
          >
            {projects.map((p) => (
              <option value={p.projectId} key={p.projectId} disabled={p.schemaVersion != null && ![1, 2].includes(p.schemaVersion)}>
                {p.title}{p.schemaVersion != null && ![1, 2].includes(p.schemaVersion) ? ` (unsupported project format ${p.schemaVersion})` : ''}
              </option>
            ))}
          </select>
          <button
            disabled={recording || busy}
            onClick={() =>
              execute(async () => {
                await saveProject();
                await openProject(
                  await request("/api/projects", { method: "POST", body: {} }),
                );
                await refresh();
              })
            }
          >
            ＋ New
          </button>
        </div>
        <button
          className="danger"
          disabled={recording || busy}
          onClick={deleteProject}
        >
          Delete project/song
        </button>
        <div className="header-actions">
          <span className={`save-state ${dirty ? "unsaved" : ""}`}>
            {saveStatus}
          </span>
          <button
            disabled={busy || recording}
            onClick={() => execute(saveProject)}
          >
            Save
          </button>
          <button
            disabled={busy || recording}
            onClick={() => download("backup")}
          >
            Backup
          </button>
          <button
            className="primary"
            disabled={busy || recording || !compiled.data}
            onClick={() => download("export")}
          >
            Export song ↗
          </button>
        </div>
      </header>
      {(error || notice || compiled.error) && (
        <div
          className={`message ${error || compiled.error ? "error" : ""}`}
          role={error || compiled.error ? "alert" : "status"}
        >
          {error || compiled.error || notice}
          <button
            aria-label="Dismiss message"
            onClick={() => {
              setError("");
              setNotice("");
            }}
          >
            ×
          </button>
        </div>
      )}
      <div className="workspace">
        <aside className="library panel">
          <div className="panel-title">
            <span>PROJECT ASSETS</span>
            <span className="pill">LOCAL</span>
          </div>
          <h2>{project.metadata.title}</h2>
          <p className="muted">
            {project.metadata.artist || "Add artist in Song details"}
          </p>
          <label className={`upload-button ${recording ? "disabled" : ""}`}>
            <span>♫</span>
            <div>
              {project.audio ? "Replace song audio" : "Import song audio"}
              <small>
                {project.audio?.name || "MP3, WAV, Ogg, M4A or FLAC"}
              </small>
            </div>
            <input
              type="file"
              accept="audio/*,.m4a,.flac"
              disabled={recording || busy}
              aria-label="Import song audio"
              onChange={(e) => {
                importAudio(e.target.files[0]);
                e.target.value = "";
              }}
            />
          </label>
          <label className={`upload-button ${recording ? "disabled" : ""}`}>
            <span>⌁</span>
            <div>
              Import pose recording
              <small>JSON, Android NDJSON or project ZIP</small>
            </div>
            <input
              type="file"
              accept=".json,.ndjson,.jsonl,.zip"
              disabled={recording || busy}
              aria-label="Import pose recording"
              onChange={(e) => {
                importFile(e.target.files[0]);
                e.target.value = "";
              }}
            />
          </label>
          <div className="section-heading">
            TAKES <span>{project.takes.length}</span>
          </div>
          <div className="takes">
            {project.takes.map((t) => {
              const take = takes.get(t.takeId);
              const hasPlayer = (id) =>
                take?.samples.some((s) =>
                  s.poses.some((p) => p.playerId === id),
                );
              return (
                <div
                  className={`take ${activeTake === t.takeId ? "active" : ""}`}
                  key={t.takeId}
                >
                  <button
                    className="take-select"
                    disabled={recording || busy}
                    onClick={() => selectTake(t.takeId)}
                    aria-label={`View take: ${t.name}`}
                  >
                    <span className="take-icon">⌁</span>
                    <span>
                      <strong>{t.name}</strong>
                      <small>
                        {t.source} · {take?.samples.length || 0} samples
                         {t.modelId ? ` · ${t.modelId}${Number.isFinite(t.sourceRateHz) ? ` · ${t.sourceRateHz.toFixed(1)} poses/s` : ""}` : ""}
                      </small>
                    </span>
                  </button>
                  <details className="take-menu">
                    <summary
                      aria-label={`Take actions: ${t.name}`}
                      aria-haspopup="menu"
                    >
                      ⋯
                    </summary>
                    <div role="menu">
                      {[[0], [1], [0, 1]].map((ids) => (
                        <button
                          key={ids.join()}
                          role="menuitem"
                          disabled={recording || busy || !ids.every(hasPlayer)}
                          onClick={(e) => {
                            e.currentTarget.closest("details").open = false;
                            void execute(async () => assignTake(take, ids));
                          }}
                        >
                          {ids.length === 2
                            ? "Overwrite both tracks"
                            : `Overwrite P${ids[0] + 1} track`}
                        </button>
                      ))}
                      <button
                        role="menuitem"
                        className="danger"
                        disabled={recording || busy}
                        onClick={(e) => {
                          e.currentTarget.closest("details").open = false;
                          void deleteTake(t);
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </details>
                </div>
              );
            })}
            {!project.takes.length && (
              <p className="empty-note">
                Import a recording or create a new take below.
              </p>
            )}
          </div>
          <div className="section-heading">PLAYER TRACKS</div>
          <div className="track-tools">
            {project.tracks.map((t) => (
              <div
                className={`track-controls track-${t.playerId}`}
                key={t.playerId}
              >
                <strong>P{t.playerId + 1} track</strong>
                <label>
                  Offset (seconds)
                  <input
                    aria-label={`P${t.playerId + 1} offset (seconds)`}
                    type="number"
                    step=".01"
                    disabled={readOnly || busy || !t.dataId}
                    key={`${t.playerId}-${t.offsetMs}`}
                    defaultValue={t.offsetMs / 1000}
                    onBlur={(e) => {
                      const text = e.currentTarget.value;
                      if (
                        text.trim() &&
                        Number.isFinite(Number(text)) &&
                        Number(text) * 1000 !== t.offsetMs
                      )
                        void execute(async () =>
                          modifyTracks((p) =>
                            offsetTrack(p, t.playerId, Number(text) * 1000),
                          ),
                        );
                    }}
                  />
                </label>
                <button
                  disabled={readOnly || busy || !fillable[t.playerId]}
                  onClick={() =>
                    execute(async () => {
                      let count = 0;
                      modifyTracks((p, assets) => {
                        const result = interpolateTrack(p, assets, t.playerId);
                        count = result.filled;
                        return result.project;
                      });
                      setNotice(
                        `Interpolated ${count} missing interval${count === 1 ? "" : "s"} for P${t.playerId + 1}. Missing starts/ends remain unchanged; review generated poses before scoring.`,
                      );
                    })
                  }
                >
                  Interpolate P{t.playerId + 1} missing intervals
                </button>
                <button
                  className="danger"
                  disabled={recording || busy || !t.dataId}
                  onClick={() => {
                    if (
                      window.confirm(
                        `Delete P${t.playerId + 1} track data? Its poses and edits will be cleared. Library takes and the other track will remain.`,
                      )
                    ) {
                      pause();
                      modifyTracks((p) => clearTrack(p, t.playerId));
                    }
                  }}
                >
                  Delete P{t.playerId + 1} track
                </button>
              </div>
            ))}
          </div>
          <div className="capture">
            <div className="section-heading">
              {inputMode === 'webcam' ? 'WEBCAM CAPTURE' : 'ANDROID CAPTURE'}{" "}
              <i
                className={`dot ${connection.status === "connected" ? "green" : ""}`}
              />
            </div>
            <label>Pose source
              <select aria-label="Pose source" value={inputMode} disabled={recording || busy}
                onChange={e => { source.setMode(e.target.value); setInputMode(e.target.value); }}>
                <option value="android">Android</option><option value="webcam">Webcam</option>
              </select>
            </label>
            {inputMode === 'webcam' ? <WebcamControls source={source} connection={connection} disabled={recording || busy} /> : <label>
              Controller IP
              <input
                aria-label="Android IP address"
                value={ip}
                disabled={recording || busy}
                onChange={(e) => setIp(e.target.value)}
              />
            </label>}
            <button
              disabled={recording || busy}
              onClick={() =>
                execute(async () => {
                  if (
                    [
                      "connected",
                      "connecting",
                      "initializing",
                      "reconnecting",
                    ].includes(connection.status)
                  ) {
                    source.disconnect();
                    return;
                  }
                  await source.setPlayerCount(2);
                  await source.connect(inputMode === 'android' ? ip : undefined);
                })
              }
            >
              {connection.status === "connected"
                ? "Disconnect"
                : ["connecting", "initializing", "reconnecting"].includes(
                      connection.status,
                    )
                  ? "Cancel connection"
                : inputMode === 'webcam' ? 'Start camera' : 'Connect Android'}
            </button>
            <p className="connection-status">
              {connection.status} ·{" "}
              {connection.message || "Two players, one controller"}
            </p>
            {inputMode === 'android' && <small className="origin">
              Allowed Origin: <code>{location.origin}</code>
            </small>}
            <div className="tracking">
              {[0, 1].map((id) => (
                <span key={id}>
                  <i
                    className={`dot ${connection.snapshot?.poses.some((p) => p.playerId === id) ? "green" : ""}`}
                  />
                  P{id + 1}{" "}
                  {connection.snapshot?.poses.some((p) => p.playerId === id)
                    ? "detected"
                    : "waiting"}
                </span>
              ))}
            </div>
            {inputMode === 'webcam' && <div className="body-calibration">
              <button disabled={recording || busy || connection.status !== 'connected'}
                onClick={() => {
                  liveHistory.current.reset();
                  if(connection.snapshot) liveHistory.current.accept(connection.snapshot);
                  setLiveTracks(liveHistory.current.tracks);
                  setCalibrationCounts(liveHistory.current.counts);
                }}>Recalibrate body</button>
              <small role="status">{calibrationCounts.every(count => count >= 20)
                ? 'Body calibration ready · distance compensation on'
                : `Stand upright with feet visible · P1 ${calibrationCounts[0]}/20 · P2 ${calibrationCounts[1]}/20`}</small>
            </div>}
            <label>
              Recording delay (seconds)
              <input
                aria-label="Recording delay (seconds)"
                type="number"
                min="0"
                max="60"
                step="1"
                value={recordDelay}
                disabled={recording || busy}
                onChange={(e) =>
                  setRecordDelay(
                    e.target.value === "" ? "" : Number(e.target.value),
                  )
                }
              />
            </label>
            <button
              className={`record-button ${recording ? "recording" : ""}`}
              disabled={
                busy || (!recording && connection.status !== "connected")
              }
              onClick={() => (recording ? stopRecording() : startRecording())}
            >
              {recording
                ? countdown
                  ? "Cancel countdown"
                  : "■ Stop recording"
                : "● Record new take"}
            </button>
            {recording && countdown !== null && (
              <div
                className="record-countdown"
                role="status"
                aria-live="polite"
                aria-atomic="true"
              >
                <strong>{countdown}</strong>
                <span>Get ready · recording starts in {countdown}s</span>
              </div>
            )}
            {recording && (
              <small>
                {countdown
                  ? "Waiting to record"
                  : `${recordCount} records captured`}
              </small>
            )}
          </div>
        </aside>
        <main className="editor">
          <div className="preview-bar">
            <div>
              <span className="eyebrow">CHOREOGRAPHY PREVIEW</span>
              <h1>Make every move yours.</h1>
            </div>
            <div className="segmented" aria-label="Preview mode">
              {["skeleton", "characters", "both"].map((v) => (
                <button
                  key={v}
                  className={mode === v ? "selected" : ""}
                  aria-pressed={mode === v}
                  onClick={() => setMode(v)}
                >
                  {v === "characters"
                    ? "Frutiger"
                    : v[0].toUpperCase() + v.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <div className="preview-source segmented" aria-label="Preview source">
            <button
              className={!readOnly ? "selected" : ""}
              aria-pressed={!readOnly}
              disabled={recording || busy}
              onClick={() => {
                changeView("playback");
              }}
            >
              Playback
            </button>
            <button
              className={showingTake ? "selected" : ""}
              aria-pressed={showingTake}
              disabled={recording || !selectedTake}
              onClick={() => changeView("take")}
            >
              Take view
            </button>
            <button
              className={showingLive ? "selected" : ""}
              aria-pressed={showingLive}
              disabled={recording || busy}
              onClick={() => {
                changeView("live");
              }}
            >
              Live view
            </button>
          </div>
          <Preview
            snapshot={snapshot}
            raw={
              !readOnly && original
                ? sampleSnapshot(original.samples, cursor)
                : null
            }
            tracks={
              showingLive
                ? liveTracks || (inputMode === "webcam" ? [] : fallbackTracks)
                : showingTake
                  ? previewTracks || fallbackTracks
                  : compiled.data?.tracks || fallbackTracks
            }
            mode={mode}
            playerId={playerId}
            joint={joint}
            selectedJoints={POINT_GROUPS[pointGroup]?.indices || [joint]}
            readOnly={readOnly || busy}
            readOnlyLabel={
              showingTake ? "Take pose skeleton" : "Live pose skeleton"
            }
            mirrored
            emptyMessage={
              showingLive
                ? connection.status === "connected"
                  ? "Waiting for live poses"
                  : "Live view · " + connection.status
                : showingTake
                  ? "No take pose at this time"
                  : undefined
            }
            emptyHint={
              showingLive
                ? connection.status === "disconnected"
                  ? "Connect a pose source in the capture panel to preview your moves."
                  : connection.message || "Step into the camera view."
                : undefined
            }
            onSelect={(id, index) => {
              setPlayerId(id);
              setJoint(index);
              if (
                id !== playerId ||
                !POINT_GROUPS[pointGroup]?.indices.includes(index)
              )
                setPointGroup("single");
              setDraftJoint(null);
              if (!readOnly) setTab("joint");
            }}
            onEdit={jointEdit}
          />
          <div className="preview-footer">
            <span>
              {recording ? (
                <>
                  <i className={`dot ${countdown ? "" : "red"}`} />
                  {countdown ? `GET READY · ${countdown}s` : "LIVE CAPTURE"}
                </>
              ) : showingTake ? (
                <>TAKE VIEW · {selectedTake?.name} · Read-only</>
              ) : view === "live" ? (
                <>
                  <i
                    className={`dot ${connection.status === "connected" ? "green" : ""}`}
                  />
                  LIVE VIEW · Read-only
                </>
              ) : (
                <>↗ Drag a skeleton joint to refine its pose</>
              )}
            </span>
            <span>
              {selectedPose
                ? "33 landmarks · image space"
                : showingLive
                  ? "No live tracking"
                  : "No tracking at cursor"}
            </span>
          </div>
          <section className="timeline panel">
            <div className="transport">
              <div className="transport-left">
                <button
                  aria-label="Previous sample"
                  disabled={recording || busy}
                  onClick={() => {
                    const samples = showingTake
                      ? selectedTake.samples.map((s) => ({
                          songTimeMs:
                            (s.takeTimeMs -
                              selectedTake.samples[0].takeTimeMs) *
                            selectedTake.timeScale,
                        }))
                      : compiled.data?.samples || [];
                    seek(
                      [...samples]
                        .reverse()
                        .find((s) => s.songTimeMs < displayCursor - 0.001)
                        ?.songTimeMs ??
                        (showingTake ? 0 : project.playableStartMs),
                    );
                  }}
                >
                  ❮
                </button>
                <button
                  className="play-button"
                  aria-label={playing ? "Pause playback" : "Play playback"}
                  disabled={
                    recording || (showingTake ? !selectedTake : !project.audio)
                  }
                  onClick={play}
                >
                  {playing ? "Ⅱ" : "▶"}
                </button>
                <button
                  aria-label="Next sample"
                  disabled={recording || busy}
                  onClick={() =>
                    seek(
                      (showingTake
                        ? selectedTake.samples.map((s) => ({
                            songTimeMs:
                              (s.takeTimeMs -
                                selectedTake.samples[0].takeTimeMs) *
                              selectedTake.timeScale,
                          }))
                        : compiled.data?.samples
                      )?.find((s) => s.songTimeMs > displayCursor + 0.001)
                        ?.songTimeMs ??
                        (showingTake ? takeDuration : project.playableEndMs),
                    )
                  }
                >
                  ❯
                </button>
                <span className="timecode">
                  {timeLabel(displayCursor)}{" "}
                  <small>/ {timeLabel(duration)}</small>
                </span>
              </div>
              <div className="transport-right">
                <label className="check">
                  <input
                    type="checkbox"
                    checked={loop}
                    disabled={recording || showingTake}
                    onChange={(e) => setLoop(e.target.checked)}
                  />
                  Loop selection
                </label>
                <select
                  aria-label="Playback speed"
                  value={speed}
                  disabled={recording || busy}
                  onChange={(e) => {
                    seek(displayCursor);
                    setSpeed(Number(e.target.value));
                  }}
                >
                  {[0.25, 0.5, 1].map((v) => (
                    <option key={v} value={v}>
                      {v}×
                    </option>
                  ))}
                </select>
                <button
                  disabled={readOnly || busy || !project.operationCursor}
                  onClick={() => edit((p) => historyStep(p, -1))}
                >
                  ↶ Undo
                </button>
                <button
                  disabled={
                    readOnly ||
                    busy ||
                    project.operationCursor >= project.operations.length
                  }
                  onClick={() => edit((p) => historyStep(p, 1))}
                >
                  ↷ Redo
                </button>
              </div>
            </div>
            <div className="ruler">
              {Array.from({ length: 7 }, (_, i) => (
                <span key={i}>{timeLabel((duration * i) / 6).slice(0, 5)}</span>
              ))}
            </div>
            <div className="timeline-content">
              <div
                className="timeline-playhead"
                style={{ left: `${percent}%` }}
              />
              <div
                className="selected-range"
                hidden={showingTake}
                style={{
                  left: `calc(${(selection[0] / duration) * 100}% + 6px)`,
                  width: `max(0px, calc(${((selection[1] - selection[0]) / duration) * 100}% - 12px))`,
                }}
              />
              {!showingTake &&
                [0, 1].map((bound) => (
                  <button
                    key={bound}
                    className={`range-handle range-handle-${bound}`}
                    role="slider"
                    aria-label={
                      bound === 0 ? "Selection start" : "Selection end"
                    }
                    aria-valuemin={bound === 0 ? 0 : selection[0]}
                    aria-valuemax={bound === 0 ? selection[1] : duration}
                    aria-valuenow={selection[bound]}
                    aria-valuetext={timeLabel(selection[bound])}
                    disabled={recording || busy}
                    style={{ left: `${(selection[bound] / duration) * 100}%` }}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      e.currentTarget.setPointerCapture(e.pointerId);
                    }}
                    onPointerMove={(e) => {
                      if (!e.currentTarget.hasPointerCapture(e.pointerId))
                        return;
                      const rect =
                        e.currentTarget.parentElement.getBoundingClientRect();
                      const time = Math.round(
                        clamp((e.clientX - rect.left) / rect.width, 0, 1) *
                          duration,
                      );
                      setSelection((s) =>
                        bound === 0
                          ? [Math.min(time, s[1]), s[1]]
                          : [s[0], Math.max(time, s[0])],
                      );
                    }}
                    onPointerUp={(e) =>
                      e.currentTarget.releasePointerCapture(e.pointerId)
                    }
                    onKeyDown={(e) => {
                      const delta = {
                        ArrowLeft: -10,
                        ArrowRight: 10,
                        ArrowDown: -10,
                        ArrowUp: 10,
                      }[e.key];
                      if (
                        delta === undefined &&
                        !["Home", "End"].includes(e.key)
                      )
                        return;
                      e.preventDefault();
                      setSelection((s) => {
                        const min = bound === 0 ? 0 : s[0],
                          max = bound === 0 ? s[1] : duration;
                        const time =
                          e.key === "Home"
                            ? min
                            : e.key === "End"
                              ? max
                              : clamp(
                                  s[bound] + delta * (e.shiftKey ? 10 : 1),
                                  min,
                                  max,
                                );
                        return bound === 0 ? [time, s[1]] : [s[0], time];
                      });
                    }}
                    title={
                      bound === 0
                        ? "Drag selection start"
                        : "Drag selection end"
                    }
                  ></button>
                ))}
              <svg
                className="waveform"
                viewBox="0 0 900 55"
                preserveAspectRatio="none"
                aria-label="Audio waveform"
              >
                {peaks.map((peak, i) => (
                  <line
                    key={i}
                    x1={i * 3}
                    x2={i * 3}
                    y1={27 - peak * 25}
                    y2={27 + peak * 25}
                    stroke="#a4cdb8"
                    strokeWidth="1.5"
                  />
                ))}
              </svg>
              {!showingTake &&
                project.tracks.map((t) => {
                  const data = t.dataId && takes.get(t.dataId);
                  const start = data
                    ? data.samples[0].takeTimeMs + t.offsetMs
                    : 0;
                  const end = data
                    ? data.samples.at(-1).takeTimeMs + t.offsetMs
                    : 0;
                  return (
                    <div
                      className={`track-lane track-${t.playerId}`}
                      key={t.playerId}
                    >
                      <span className="lane-label">P{t.playerId + 1}</span>
                      {data && (
                        <div
                          className="clip"
                          style={{
                            left: `${(Math.max(0, start) / duration) * 100}%`,
                            width: `${(Math.max(0, Math.min(duration, end) - Math.max(0, start)) / duration) * 100}%`,
                          }}
                        >
                          {data.sources
                            .map((s) => s.name || s.source)
                            .join(", ")}
                        </div>
                      )}
                      {compiled.data?.samples
                        .filter(
                          (s, i) =>
                            i % 5 === 0 &&
                            !s.poses.some((p) => p.playerId === t.playerId),
                        )
                        .map((s) => (
                          <i
                            key={s.songTimeMs}
                            className="gap-mark"
                            title="Missing pose"
                            style={{
                              left: `${(s.songTimeMs / duration) * 100}%`,
                            }}
                          />
                        ))}
                    </div>
                  );
                })}
              <input
                className="scrubber"
                aria-label={showingTake ? "Take cursor" : "Song cursor"}
                type="range"
                min="0"
                max={duration}
                step="1"
                value={clamp(displayCursor, 0, duration)}
                disabled={recording || busy}
                onChange={(e) => seek(Number(e.target.value))}
              />
            </div>
            <div className="range-controls">
              <span>Selection</span>
              <span aria-live="polite">
                {timeLabel(selection[0])} – {timeLabel(selection[1])}
              </span>
              <small>Drag the handles to set the bounds</small>
              <button
                disabled={recording || showingTake}
                onClick={() =>
                  setSelection([project.playableStartMs, project.playableEndMs])
                }
              >
                Select all
              </button>
              <button
                disabled={readOnly || busy || !rangeValid}
                onClick={() =>
                  edit((p) => ({
                    ...p,
                    playableStartMs: selection[0],
                    playableEndMs: selection[1],
                    alignmentReviewed: false,
                  }))
                }
              >
                Set playable range
              </button>
            </div>
          </section>
        </main>
        <aside className="inspector panel">
          <div className="inspector-tabs">
            {[
              ["joint", "Pose inspector"],
              ["song", "Song details"],
              ["review", "Review"],
            ].map(([id, label]) => (
              <button
                key={id}
                className={tab === id ? "selected" : ""}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </div>
          {tab === "joint" && (
            <>
              <div className="panel-title">
                LANDMARK EDITOR <span className="pill">RAW XYZ</span>
              </div>
              <label>
                Track
                <select
                  aria-label="Selected player"
                  value={playerId}
                  onChange={(e) => {
                    setPlayerId(Number(e.target.value));
                    setDraftJoint(null);
                  }}
                >
                  <option value="0">Player 1 · Cyan</option>
                  <option value="1">Player 2 · Violet</option>
                </select>
              </label>
              <label>
                Point group
                <select
                  aria-label="Selected point group"
                  value={pointGroup}
                  onChange={(e) => {
                    const group = e.target.value;
                    setPointGroup(group);
                    if (POINT_GROUPS[group])
                      setJoint(POINT_GROUPS[group].indices[0]);
                    setDraftJoint(null);
                  }}
                >
                  <option value="single">Single joint</option>
                  {Object.entries(POINT_GROUPS).map(([key, group]) => (
                    <option key={key} value={key}>
                      {group.label}
                    </option>
                  ))}
                </select>
              </label>
              <small>
                Choose a group, then drag any highlighted point to move it
                together.
              </small>
              <label>
                Joint
                <select
                  aria-label="Selected joint"
                  value={joint}
                  onChange={(e) => {
                    setJoint(Number(e.target.value));
                    setPointGroup("single");
                    setDraftJoint(null);
                  }}
                >
                  {JOINT_NAMES.map((name, i) => (
                    <option key={name} value={i}>
                      {i} · {name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="joint-card">
                <span className="eyebrow">SELECTED LANDMARK</span>
                <h2>{JOINT_NAMES[joint]}</h2>
                <small>
                  {readOnly
                    ? `${showingTake ? "Take" : "Live"} pose · read-only`
                    : `at ${timeLabel(cursor)}`}
                </small>
                <div className="coordinates">
                  {["x", "y", "z"].map((k) => (
                    <label key={k}>
                      {k.toUpperCase()}
                      <input
                        aria-label={`Landmark ${k.toUpperCase()}`}
                        type="number"
                        step=".001"
                        disabled={!selectedJoint || readOnly || busy}
                        key={`${playerId}-${joint}-${cursor}-${project.operationCursor}-${selectedJoint?.[k]}`}
                        defaultValue={selectedJoint?.[k]?.toFixed(5) || "0"}
                        onFocus={() => {
                          if (playing) seek(cursor);
                        }}
                        onBlur={(e) => {
                          const text = e.currentTarget.value,
                            v = Number(text);
                          if (
                            text.trim() &&
                            Number.isFinite(v) &&
                            selectedJoint &&
                            Math.abs(v - selectedJoint[k]) > 1e-6
                          )
                            jointEdit(
                              playerId,
                              joint,
                              { ...selectedJoint, [k]: v },
                              true,
                            );
                        }}
                      />
                    </label>
                  ))}
                </div>
                <div className="confidence">
                  <span>
                    Visibility{" "}
                    <strong>
                      {selectedJoint?.visibility === null
                        ? "unknown"
                        : selectedJoint?.visibility?.toFixed(2) || "—"}
                    </strong>
                  </span>
                  <span>
                    Presence{" "}
                    <strong>
                      {selectedJoint?.presence === null
                        ? "unknown"
                        : selectedJoint?.presence?.toFixed(2) || "—"}
                    </strong>
                  </span>
                </div>
              </div>
              <p className="muted small">
                Edits preserve source confidence. Keyframes blend over 150 ms on
                either side; undo restores the previous track data.
              </p>
              <div className="section-heading">SELECTED RANGE</div>
              <div className="edit-actions">
                <button
                  disabled={readOnly || busy || !rangeValid}
                  onClick={() => apply("swap")}
                >
                  ⇄ Swap player tracks
                </button>
                <button
                  disabled={readOnly || busy || !rangeValid}
                  onClick={() => apply("smooth")}
                >
                  ≈ Smooth selected track
                </button>
                <button
                  disabled={
                    readOnly ||
                    !rangeValid ||
                    selection[1] - selection[0] > 1000
                  }
                  onClick={() => apply("repair")}
                >
                  ⌁ Repair short gap
                </button>
              </div>
              <div className="section-heading">
                EDIT HISTORY <span>{project.operationCursor}</span>
              </div>
              <ol className="history">
                {project.operations
                  .slice(0, project.operationCursor)
                  .slice(-8)
                  .map((op) => (
                    <li key={op.operationId}>
                      <strong>{opNames[op.type]}</strong>
                      <small>
                        {Number.isFinite(op.startMs)
                          ? `${timeLabel(op.startMs)}–${timeLabel(op.endMs)}`
                          : op.playerId === null
                            ? "Both tracks"
                            : `P${op.playerId + 1}`}
                      </small>
                    </li>
                  ))}
              </ol>
            </>
          )}
          {tab === "song" && (
            <div className="song-fields">
              <div className="panel-title">SONG METADATA</div>
              {[
                ["title", "Song name"],
                ["artist", "Performing artist"],
                ["description", "Description"],
              ].map(([key, label]) => (
                <label key={key}>
                  {label}
                  <input
                    aria-label={label}
                    disabled={recording || busy}
                    value={project.metadata[key] || ""}
                    onChange={(e) =>
                      edit((p) => {
                        p.metadata[key] = e.target.value;
                        return p;
                      })
                    }
                  />
                </label>
              ))}
              <label>
                Song ID
                <input
                  aria-label="Song ID"
                  disabled={recording || busy}
                  value={project.songId}
                  onChange={(e) =>
                    edit((p) => ({ ...p, songId: e.target.value }))
                  }
                />
              </label>
              {[
                ["songwriters", "Songwriters / composers"],
                ["choreographers", "Choreographers"],
                ["tags", "Tags"],
              ].map(([key, label]) => (
                <label key={key}>
                  {label}
                  <input
                    disabled={recording || busy}
                    aria-label={label}
                    value={project.metadata[key].join(", ")}
                    onChange={(e) =>
                      edit((p) => {
                        p.metadata[key] = e.target.value
                          .split(",")
                          .map((v) => v.trim());
                        return p;
                      })
                    }
                    onBlur={() =>
                      edit((p) => {
                        p.metadata[key] = p.metadata[key].filter(Boolean);
                        return p;
                      })
                    }
                  />
                </label>
              ))}
              <div className="two-cols">
                <label>
                  BPM
                  <input
                    type="number"
                    disabled={recording || busy}
                    value={project.metadata.bpm ?? ""}
                    onChange={(e) =>
                      edit((p) => {
                        p.metadata.bpm = e.target.value
                          ? Number(e.target.value)
                          : null;
                        return p;
                      })
                    }
                  />
                </label>
                <label>
                  Difficulty
                  <select
                    disabled={recording || busy}
                    value={project.metadata.difficulty}
                    onChange={(e) =>
                      edit((p) => {
                        p.metadata.difficulty = e.target.value;
                        return p;
                      })
                    }
                  >
                    <option>easy</option>
                    <option>normal</option>
                    <option>hard</option>
                  </select>
                </label>
              </div>
              <label>
                Stage
                <select
                  disabled={recording || busy}
                  value={project.metadata.stage ?? DEFAULT_STAGE}
                  onChange={(e) =>
                    edit((p) => {
                      p.metadata.stage = e.target.value;
                      return p;
                    })
                  }
                >
                  {STAGE_LIST.map((stage) => (
                    <option key={stage.id} value={stage.id}>
                      {stage.name} — {stage.subtitle}
                    </option>
                  ))}
                </select>
              </label>
              <div className="section-heading">DISTRIBUTION RIGHTS</div>
              {["audio", "choreography"].map((k) => (
                <label key={k}>
                  {k === "audio"
                    ? "Music license / permission"
                    : "Choreography license / permission"}
                  <input
                    disabled={recording || busy}
                    aria-label={`${k} license`}
                    value={project.metadata.rights[k].license}
                    onChange={(e) =>
                      edit((p) => {
                        p.metadata.rights[k].license = e.target.value;
                        return p;
                      })
                    }
                  />
                </label>
              ))}
              <p className="muted small">
                Record the actual license or permission to distribute. “Unknown”
                blocks song export.
              </p>
              <label className="check alignment">
                <input
                  type="checkbox"
                  disabled={recording || busy}
                  checked={project.alignmentReviewed}
                  onChange={(e) =>
                    edit((p) => ({ ...p, alignmentReviewed: e.target.checked }))
                  }
                />
                I reviewed audio/pose alignment near the start and end.
              </label>
              <div className="metadata-note">
                {timeLabel(project.durationMs)} audio length
                <br />
                Playable {timeLabel(project.playableStartMs)}–
                {timeLabel(project.playableEndMs)}
              </div>
            </div>
          )}
          {tab === "review" && (
            <>
              <div className="panel-title">PUBLICATION REVIEW</div>
              <label>
                Review reason
                <textarea
                  aria-label="Review reason"
                  value={reason}
                  disabled={recording || busy}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              <div className="edit-actions">
                <button
                  disabled={readOnly || busy || !rangeValid || !reason.trim()}
                  onClick={() => apply("approve")}
                >
                  ✓ Approve selected references
                </button>
                <button
                  disabled={readOnly || busy || !rangeValid || !reason.trim()}
                  onClick={() => apply("exclude")}
                >
                  ⊘ Exclude range from scoring
                </button>
              </div>
              <p className="muted small">
                Approval is a reference decision. It does not increase measured
                confidence or relax live-input confidence.
              </p>
              {compiled.report?.coverage.map((c) => (
                <div className="coverage" key={c.playerId}>
                  <strong>Player {c.playerId + 1}</strong>
                  <span>
                    {Math.round(
                      (c.eligibleMs /
                        Math.max(
                          1,
                          project.playableEndMs - project.playableStartMs,
                        )) *
                        100,
                    )}
                    % eligible
                  </span>
                  <small>
                    {(c.missingMs / 1000).toFixed(2)} s missing ·{" "}
                    {(c.editedMs / 1000).toFixed(2)} s edited
                  </small>
                </div>
              ))}
              <div className="section-heading">EXPORT CHECKS</div>
              <ul className="review-list">
                {compiled.report?.blockers.map((b, i) => (
                  <li className="blocker" key={i}>
                    ● {b}
                  </li>
                ))}
                {compiled.report?.warnings.map((b, i) => (
                  <li key={i}>△ {b}</li>
                ))}
                {compiled.report && !compiled.report.blockers.length && (
                  <li className="passed">✓ Ready for bundle export</li>
                )}
              </ul>
            </>
          )}
        </aside>
      </div>
      <footer className="statusbar">
        <span>
          <i className="dot green" />
          LOCAL WORKSPACE · {busy ? "Working…" : "Ready"}
        </span>
        <span>
          Immutable takes · MediaPipe image landmarks · Bundle schema v1
        </span>
        <span className="status-version">DANCE STUDIO / 01</span>
      </footer>
    </div>
  );
}
