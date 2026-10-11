"""Offline two-person capture. Run via uv run --locked --project scripts/pose."""
import argparse
import hashlib
import itertools
import json
from pathlib import Path
import urllib.request

import cv2
import mediapipe as mp
import numpy as np
from scipy.ndimage import gaussian_filter1d

MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task'
MODEL_SHA = '5134a3aad27a58b93da0088d431f366da362b44e3ccfbe3462b3827a839011b1'
CORE = [11, 12, 23, 24]
EDGES = [(11,12),(11,13),(13,15),(12,14),(14,16),(11,23),(12,24),(23,24),(23,25),(25,27),(24,26),(26,28),(27,31),(28,32)]


def sha(path):
    with open(path, 'rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()


def descriptor(pose, aspect):
    xy = pose[:, :2] * [aspect, 1]
    center = xy[CORE].mean(axis=0)
    size = np.linalg.norm(xy[[11,12]].mean(axis=0) - xy[[23,24]].mean(axis=0))
    return center, max(size, 0.01)


def assign(candidates, previous, aspect):
    """Global one-to-one association; reject background-sized people and big jumps."""
    if previous is None:
        if len(candidates) < 2:
            return [None, None]
        largest = sorted(candidates, key=lambda p: descriptor(p, aspect)[1], reverse=True)[:2]
        return sorted(largest, key=lambda p: descriptor(p, aspect)[0][0])
    best, best_cost = [None, None], float('inf')
    for indices in itertools.product(range(-1, len(candidates)), repeat=2):
        if indices[0] == indices[1] and indices[0] != -1:
            continue
        cost = 0
        for person, index in enumerate(indices):
            if index == -1:
                cost += 1.5
                continue
            center, size = descriptor(candidates[index], aspect)
            old_center, old_size = descriptor(previous[person], aspect)
            distance = np.linalg.norm(center - old_center) / old_size
            ratio = size / old_size
            cost += distance + abs(np.log(ratio)) * 2 if distance < 1.5 and 0.6 < ratio < 1.65 else 100
        if cost < best_cost:
            best_cost = cost
            best = [candidates[i] if i >= 0 else None for i in indices]
    return best


def clean(raw, times, threshold, sigma):
    """Interpolate unreliable joints, then symmetric (zero-lag) Gaussian smoothing."""
    result = raw.copy()
    for person in range(2):
        for joint in range(33):
            valid = np.isfinite(raw[:,person,joint,0]) & (raw[:,person,joint,3] >= threshold)
            if valid.sum() < 2:
                raise ValueError(f'Insufficient confident samples: person {person}, joint {joint}')
            for axis in range(3):
                result[:,person,joint,axis] = np.interp(times, times[valid], raw[valid,person,joint,axis])
            result[:,person,joint,:3] = gaussian_filter1d(result[:,person,joint,:3], sigma, axis=0, mode='nearest')
    result[:,:,:,3] = np.nan_to_num(raw[:,:,:,3])
    return result


def build_samples(raw, poses, times, threshold):
    samples = []
    for i, time in enumerate(times):
        snapshot, quality = [], []
        for person in range(2):
            if not np.isfinite(raw[i,person,0,0]):
                continue  # Whole-person absence stays explicit in new exports.
            landmarks = []
            for joint in range(33):
                xyz = np.round(poses[i,person,joint,:3],5)
                scores = raw[i,person,joint,4:6]
                landmarks.append(dict(x=float(xyz[0]),y=float(xyz[1]),z=float(xyz[2]),
                    visibility=float(scores[0]) if np.isfinite(scores[0]) else None,
                    presence=float(scores[1]) if np.isfinite(scores[1]) else None))
            snapshot.append(dict(playerId=person,landmarks=landmarks))
            # Offline interpolation/smoothing requires author review before scoring.
            quality.append(dict(playerId=person,landmarkOrigins=[
                'resampled' if raw[i,person,j,3] >= threshold else 'gap-repaired'
                for j in range(33)],scoreEligible=[False]*33,reviewed=False))
        samples.append(dict(takeTimeMs=round(float(time)*1000,6),poses=snapshot,quality=quality))
    return samples


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('video', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--diagnostics', type=Path, required=True)
    parser.add_argument('--model', type=Path, default=Path(__file__).parent / '.cache/pose_landmarker_full.task')
    parser.add_argument('--start', type=float, default=0)
    parser.add_argument('--end', type=float, default=None)
    parser.add_argument('--fps', type=int, default=30)
    parser.add_argument('--width', type=int, default=960)
    parser.add_argument('--confidence', type=float, default=0.5)
    parser.add_argument('--smooth-seconds', type=float, default=0.045)
    args = parser.parse_args()
    if args.fps <= 0 or args.width < 64 or args.smooth_seconds <= 0 or not 0 < args.confidence < 1:
        parser.error('Invalid sampling, size, confidence or smoothing parameter')
    if args.start < 0 or (args.end is not None and args.end <= args.start):
        parser.error('Require 0 <= start < end')
    args.model.parent.mkdir(parents=True, exist_ok=True)
    if not args.model.exists():
        urllib.request.urlretrieve(MODEL_URL, args.model)
    if sha(args.model) != MODEL_SHA:
        raise ValueError('Model checksum mismatch; remove the model and download it again')
    cap = cv2.VideoCapture(str(args.video))
    if not cap.isOpened():
        raise ValueError(f'Cannot open {args.video}')
    source_fps = cap.get(cv2.CAP_PROP_FPS)
    width, height = [int(cap.get(p)) for p in [cv2.CAP_PROP_FRAME_WIDTH, cv2.CAP_PROP_FRAME_HEIGHT]]
    aspect = width / height
    options = mp.tasks.vision.PoseLandmarkerOptions(
        base_options=mp.tasks.BaseOptions(model_asset_path=str(args.model)),
        running_mode=mp.tasks.vision.RunningMode.VIDEO, num_poses=4,
        min_pose_detection_confidence=0.5, min_pose_presence_confidence=0.5,
        min_tracking_confidence=0.5)
    frames, times, missing = [], [], [0, 0]
    previous, frame_index, last_sample = None, 0, -1
    last_timestamp = -1
    with mp.tasks.vision.PoseLandmarker.create_from_options(options) as detector:
        while True:
            ok, image = cap.read()
            if not ok:
                break
            timestamp = cap.get(cv2.CAP_PROP_POS_MSEC) / 1000
            # Use decoder presentation timestamps (the supplied MOV is variable-rate).
            if frame_index and timestamp <= last_timestamp:
                timestamp = frame_index / source_fps
            last_timestamp = timestamp
            frame_index += 1
            if timestamp < args.start:
                continue
            if args.end is not None and timestamp >= args.end:
                break
            timestamp -= args.start
            sample = int(timestamp * args.fps + 1e-4)
            if sample <= last_sample:
                continue
            last_sample = sample
            image = cv2.resize(image, (args.width, round(args.width / aspect)))
            result = detector.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(image, cv2.COLOR_BGR2RGB)), round(timestamp * 1000))
            candidates = [np.array([[p.x,p.y,p.z,min(p.visibility,p.presence),p.visibility,p.presence] for p in pose]) for pose in result.pose_landmarks]
            selected = assign(candidates, previous, aspect)
            if previous is None and any(p is None for p in selected):
                raise ValueError('Both dancers must be visible in the first frame; trim the input first')
            if previous is None:
                previous = selected.copy()
            frame = np.full((2,33,6), np.nan)
            for person, pose in enumerate(selected):
                if pose is None:
                    missing[person] += 1
                else:
                    frame[person] = pose
                    previous[person] = pose
            frames.append(frame)
            times.append(timestamp)
            if len(frames) % 60 == 0:
                print(f'Tracked {len(frames)} frames ({timestamp:.2f}s)', flush=True)
    cap.release()
    if len(frames) < 2:
        raise ValueError('Need at least two frames')
    raw, times = np.array(frames), np.array(times)
    poses = clean(raw, times, args.confidence, args.smooth_seconds * args.fps)
    duration = float(times[-1] + np.median(np.diff(times)))
    if args.end is not None:
        duration = min(duration, args.end - args.start)
    gaps = []
    for person in range(2):
        bad = ~np.isfinite(raw[:,person,0,0])
        gaps.append(max((len(list(group)) for value, group in itertools.groupby(bad) if value), default=0))
    report = dict(frames=len(frames), duration=duration, missingFrames=missing, longestMissingRun=gaps,
        reliableJointFraction=[float(np.mean(raw[:,p,:,3] >= args.confidence)) for p in range(2)])
    if max(gaps) > args.fps:
        raise ValueError(f'Tracking lost a dancer for >1 second: {report}')
    samples = build_samples(raw, poses, times, args.confidence)
    data = dict(schema='aerodance.take',schemaVersion=1,takeId='video-'+sha(args.video)[:16],
        name='Imported video',source='video',
        input=dict(width=args.width,height=round(args.width/aspect),mirrored=False),
        durationMs=round(duration*1000,6),offsetMs=0,timeScale=1,samples=samples,
        provenance=dict(source=dict(sha256=sha(args.video),width=width,height=height),
            model=dict(url=MODEL_URL,sha256=MODEL_SHA,mediapipe=mp.__version__),
            settings=dict(start=args.start,end=args.end,fps=args.fps,width=args.width,
                confidence=args.confidence,smoothSeconds=args.smooth_seconds),report=report,
            offlineSmoothed=True))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(data, separators=(',',':'), allow_nan=False) + '\n')
    args.diagnostics.mkdir(parents=True, exist_ok=True)
    (args.diagnostics / 'report.json').write_text(json.dumps(data | {'samples': 'omitted'}, indent=2) + '\n')
    np.savez_compressed(args.diagnostics / 'raw.npz', times=times, poses=raw)
    # Silent review copy. The input video remains local and is never copied to public/.
    cap = cv2.VideoCapture(str(args.video))
    writer = cv2.VideoWriter(str(args.diagnostics / 'overlay.mp4'), cv2.VideoWriter_fourcc(*'mp4v'), args.fps, (args.width, round(args.width / aspect)))
    if not writer.isOpened():
        raise RuntimeError('Cannot create diagnostic video')
    for timestamp in np.arange(0, duration, 1 / args.fps):
        cap.set(cv2.CAP_PROP_POS_MSEC, (timestamp + args.start) * 1000)
        ok, image = cap.read()
        if not ok:
            break
        image = cv2.resize(image, (args.width, round(args.width / aspect)))
        index = min(np.searchsorted(times, timestamp), len(times)-1)
        for person, color in enumerate([(255,220,0),(210,80,255)]):
            points = (poses[index,person,:,:2] * [image.shape[1],image.shape[0]]).astype(int)
            for a,b in EDGES:
                cv2.line(image, tuple(points[a]), tuple(points[b]), color, 2)
            for point in points:
                cv2.circle(image, tuple(point), 3, color, -1)
            cv2.putText(image, f'Dancer {person+1}', tuple(points[0] - [30,25]), cv2.FONT_HERSHEY_SIMPLEX, .6, color, 2)
        cv2.putText(image, f'{timestamp:.2f}s', (15,30), cv2.FONT_HERSHEY_SIMPLEX, .7, (255,255,255), 2)
        writer.write(image)
    cap.release()
    writer.release()
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
