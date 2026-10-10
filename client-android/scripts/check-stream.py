#!/usr/bin/env python3
"""Exercise an already-started synthetic server; uses only Python's standard library."""
import argparse
import http.client
import json
import socket
import statistics
import time

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("host")
parser.add_argument("--port", type=int, default=1337)
parser.add_argument("--origin", required=True, help="Exact origin configured in the Android UI")
parser.add_argument("--expect-stopped", action="store_true", help="Verify the listening socket is closed")
args = parser.parse_args()

if args.expect_stopped:
    try:
        with socket.create_connection((args.host, args.port), timeout=3):
            raise AssertionError("Server is still listening")
    except ConnectionRefusedError:
        print("PASS: server socket closed")
    raise SystemExit(0)


def request(path, method="GET", origin=None, extra=None):
    connection = http.client.HTTPConnection(args.host, args.port, timeout=3)
    headers = {"Origin": origin or args.origin}
    headers.update(extra or {})
    connection.request(method, path, headers=headers)
    return connection, connection.getresponse()


for method, path, expected, origin, extra in [
    ("GET", "/v1/status", 200, args.origin, {}),
    ("OPTIONS", "/v1/stream", 204, args.origin, {"Access-Control-Request-Method": "GET"}),
    ("GET", "/v1/status", 403, "https://unapproved.invalid", {}),
    ("GET", "/missing", 404, args.origin, {}),
    ("POST", "/v1/status", 405, args.origin, {}),
    ("OPTIONS", "/v1/stream", 403, args.origin, {"Access-Control-Request-Method": "POST"}),
]:
    connection, response = request(path, method, origin, extra)
    assert response.status == expected, (method, path, response.status)
    if origin == args.origin:
        assert response.getheader("Access-Control-Allow-Origin") == args.origin
    else:
        assert response.getheader("Access-Control-Allow-Origin") is None
    body = response.read()
    if path == "/v1/status" and expected == 200:
        status = json.loads(body)
        assert status["capabilities"]["poseModel"] == "synthetic"
        session = status["sessionId"]
    connection.close()

connection, response = request("/v1/stream")
assert response.status == 200
assert response.getheader("Content-Type") == "application/x-ndjson"
other, conflict = request("/v1/stream")
assert conflict.status == 409
conflict.read()
other.close()
arrivals, sizes, empty, previous = [], [], False, 0
started = time.monotonic()
while time.monotonic() - started < 11:
    line = response.readline(16386)
    assert line.endswith(b"\n") and len(line) <= 16385
    record = json.loads(line)
    assert record["protocolVersion"] == 1 and record["sessionId"] == session
    if record["type"] != "pose":
        continue
    assert record["seq"] > previous
    previous = record["seq"]
    assert record["resultTimeMs"] >= record["frameReceivedTimeMs"]
    assert record["input"] == {"width": 480, "height": 640, "mirrored": False}
    assert len(record["poses"]) <= 1
    for pose in record["poses"]:
        assert len(pose["landmarks"]) == 33
    empty |= not record["poses"]
    arrivals.append(time.monotonic())
    sizes.append(len(line))
assert empty, "No empty-pose fixture received"
assert len(arrivals) > 200, "Synthetic delivery unexpectedly slow"
response.close()
connection.close()
time.sleep(.3)

# Advertise a tiny receive window, then never consume output. A stalled writer must release its slot.
slow = socket.socket()
slow.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 1024)
slow.settimeout(3)
slow.connect((args.host, args.port))
slow.sendall((f"GET /v1/stream HTTP/1.1\r\nHost: {args.host}\r\nOrigin: {args.origin}\r\n\r\n").encode())
assert b"200 OK" in slow.recv(512)
started = time.monotonic()
recovered = False
while time.monotonic() - started < 10:
    time.sleep(.3)
    fresh, reply = request("/v1/stream")
    if reply.status == 200:
        assert json.loads(reply.readline())["sessionId"] == session
        reply.close()
        fresh.close()
        recovered = True
        break
    assert reply.status == 409
    reply.read()
    fresh.close()
slow.close()
assert recovered, "Blocked writer did not release stream slot within 10 seconds"
intervals = [(b - a) * 1000 for a, b in zip(arrivals, arrivals[1:])]
print(f"PASS: CORS, OPTIONS, JSON, empty pose, single client, disconnect and blocked-write recovery")
print(f"{len(arrivals)} poses; mean {len(arrivals)/(arrivals[-1]-arrivals[0]):.1f} Hz; "
      f"median interval {statistics.median(intervals):.1f} ms; max record {max(sizes)} bytes")
print(f"Slow-reader slot released in {time.monotonic()-started:.2f}s; clocks were not calibrated")
