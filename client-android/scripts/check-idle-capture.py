#!/usr/bin/env python3
"""Real-board check: idle releases camera/GPU workers; reconnect resumes fresh poses.

Run against the live (non-synthetic) app, with no other stream consumer.
"""
import argparse
import http.client
import json
import subprocess
import time

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('host')
parser.add_argument('--origin', required=True)
parser.add_argument('--serial', default='192.168.43.1:5555')
args = parser.parse_args()


def adb(*command):
    return subprocess.check_output(['adb', '-s', args.serial, 'shell', *command], text=True)


def request(path, body=None):
    connection = http.client.HTTPConnection(args.host, 1337, timeout=8)
    headers = {'Origin': args.origin}
    if body is not None:
        headers['Content-Type'] = 'application/json'
    connection.request('POST' if body is not None else 'GET', path, body, headers)
    response = connection.getresponse()
    assert response.status == 200, (path, response.status)
    data = json.loads(response.read())
    connection.close()
    return data


def camera_owned():
    dump = adb('dumpsys', 'media.camera')
    active = dump.split('Active Camera Clients:', 1)[1].split('Allowed user IDs:', 1)[0]
    return 'tech.aerodance.androidclient' in active


def idle():
    pid = adb('pidof', 'tech.aerodance.androidclient').strip()
    assert pid, 'App is no longer running'
    threads = adb('ps', '-T', '-p', pid)
    return not camera_owned() and 'live-pose' not in threads and 'pose-camera' not in threads


def wait_idle():
    started = time.monotonic()
    while time.monotonic() - started < 95:
        if idle():
            print(f'Camera and inference workers released after {time.monotonic() - started:.2f}s', flush=True)
            return
        time.sleep(0.25)
    raise AssertionError('Capture/inference did not shut down')


def stream():
    # An old writer may need a failed write to notice the previous disconnect.
    started = time.monotonic()
    while time.monotonic() - started < 12:
        connection = http.client.HTTPConnection(args.host, 1337, timeout=8)
        connection.request('GET', '/v1/stream', headers={'Origin': args.origin})
        response = connection.getresponse()
        if response.status == 200:
            return connection, response
        assert response.status == 409, response.status
        response.close()
        connection.close()
        time.sleep(0.25)
    raise AssertionError('Previous stream slot did not release')


def read_poses(response, minimum_seq):
    started = time.monotonic()
    seqs = []
    while time.monotonic() - started < 90 and len(seqs) < 8:
        line = response.readline(16 * 1024 + 2)
        assert line and line.endswith(b'\n'), 'Stream ended or record oversized'
        record = json.loads(line)
        assert record['sessionId'] == session
        if record['type'] == 'heartbeat':
            assert record['pipelineState'] in ('starting', 'running'), record
            continue
        assert record['seq'] > (seqs[-1] if seqs else minimum_seq), record
        assert record['playerCount'] == 2, record
        seqs.append(record['seq'])
    assert len(seqs) == 8, 'No fresh pose results after startup'
    assert camera_owned(), 'No camera owner while streaming'
    print(f'Fresh poses {seqs[0]}..{seqs[-1]} after {time.monotonic() - started:.2f}s', flush=True)
    return seqs[-1]


info = request('/v1/status')
assert info['capabilities']['poseModel'] == 'pose_landmarker_lite', 'Use the live app'
assert info['pipelineState'] == 'running', info
session = info['sessionId']
request('/v1/config', '{"playerCount":2}')
assert idle(), 'Status/config requests started capture'
time.sleep(3)
assert idle(), 'Capture started without a streaming client'
print('Status/config stay available with camera and inference off', flush=True)

last_seq = 0
for cycle in range(2):
    connection, response = stream()
    try:
        last_seq = read_poses(response, last_seq)
    finally:
        response.close()
        connection.close()
    wait_idle()
    assert request('/v1/status')['sessionId'] == session

# Drop the connection during initialization, then reconnect before cleanup ends.
connection, response = stream()
time.sleep(0.5)
response.close()
connection.close()
connection, response = stream()
try:
    last_seq = read_poses(response, last_seq)
finally:
    response.close()
    connection.close()
wait_idle()
assert request('/v1/status')['sessionId'] == session
request('/v1/config', '{"playerCount":1}')
assert idle()
print('PASS: idle shutdown, two live cycles, startup disconnect/reconnect, stable session/mode/sequence', flush=True)
