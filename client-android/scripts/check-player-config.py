#!/usr/bin/env python3
"""Check protocol v2 control and live switches, allowing on-demand GPU startup."""
import argparse
import collections
import concurrent.futures
import http.client
import json
import socket
import threading
import time

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('host')
parser.add_argument('--port', type=int, default=1337)
parser.add_argument('--origin', required=True)
args = parser.parse_args()


def request(method, path, body=None, headers=None, expected=200):
    connection = http.client.HTTPConnection(args.host, args.port, timeout=4)
    values = {'Origin': args.origin}
    values.update(headers or {})
    connection.request(method, path, body=body, headers=values)
    response = connection.getresponse()
    data = response.read()
    assert response.status == expected, (method, path, response.status, data)
    if values.get('Origin') == args.origin:
        assert response.getheader('Access-Control-Allow-Origin') == args.origin
    connection.close()
    return json.loads(data) if data else None


def config(count):
    return request('POST', '/v1/config', json.dumps({'playerCount': count}), {'Content-Type': 'application/json'})


info = request('GET', '/v1/status')
assert info['protocolVersion'] == 2 and info['capabilities']['maxPoses'] == 2
assert info['capabilities']['supportedPlayerCounts'] == [1, 2]
session = info['sessionId']
config(1)
request('OPTIONS', '/v1/config', headers={'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'Content-Type'}, expected=204)
request('OPTIONS', '/v1/config', headers={'Access-Control-Request-Method': 'GET'}, expected=403)
request('OPTIONS', '/v1/config', headers={'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'X-Unknown'}, expected=403)
request('GET', '/v1/config', expected=405)
request('POST', '/v1/config', '{}', {'Origin': 'https://unapproved.invalid', 'Content-Type': 'application/json'}, expected=403)
for body in ['{}', '{"playerCount":0}', '{"playerCount":3}', '{"playerCount":2.0}', '{"playerCount":"2"}',
             '{"playerCount":true}', '{"playerCount":2,"extra":0}', '{"playerCount":1,"playerCount":2}', '{"playerCount":2}{}', '{"playerCount":2}\f', b'\xff']:
    request('POST', '/v1/config', body, {'Content-Type': 'application/json'}, expected=400)
request('POST', '/v1/config', ' ' * 1025, {'Content-Type': 'application/json'}, expected=413)
request('POST', '/v1/config', '{"playerCount":2}', {'Content-Type': 'text/plain'}, expected=415)
request('POST', '/v1/config', '{"playerCount":2}', {'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked'}, expected=400)
# Missing Origin and length are explicit raw HTTP requests.
for extra, expected in [('', 403), (f'Origin: {args.origin}\r\n', 400)]:
    with socket.create_connection((args.host, args.port), timeout=3) as sock:
        sock.sendall((f'POST /v1/config HTTP/1.1\r\nHost: {args.host}\r\nContent-Type: application/json\r\n{extra}\r\n').encode())
        assert f' {expected} '.encode() in sock.recv(4096)
with socket.create_connection((args.host, args.port), timeout=3) as sock:
    body = b'{"playerCount":2}'
    sock.sendall((f'POST /v1/config HTTP/1.1\r\nHost: {args.host}\r\nOrigin: {args.origin}\r\nContent-Type: application/json\r\nContent-Length: {len(body)}\r\n\r\n').encode() + body[:1])
    time.sleep(1.2)
    sock.sendall(body[1:2])
    time.sleep(1.1)
    assert sock.recv(4096) == b'', 'Total request budget must close a trickling body'
assert request('GET', '/v1/status')['playerCount'] == 1

connection = http.client.HTTPConnection(args.host, args.port, timeout=8)
connection.request('GET', '/v1/stream', headers={'Origin': args.origin})
stream_socket = connection.sock
stream = connection.getresponse()
assert stream.status == 200
records = collections.deque(maxlen=1000)
errors = []
condition = threading.Condition()
finished = threading.Event()


def read_stream():
    previous = 0
    try:
        while not finished.is_set():
            line = stream.readline(16386)
            assert line.endswith(b'\n') and len(line) <= 16385
            record = json.loads(line)
            assert record['protocolVersion'] == 2 and record['sessionId'] == session
            if record['type'] != 'pose':
                continue
            assert record['seq'] > previous
            previous = record['seq']
            ids = [pose['playerId'] for pose in record['poses']]
            assert ids == sorted(set(ids)) and all(0 <= i < record['playerCount'] for i in ids)
            for pose in record['poses']:
                assert len(pose['landmarks']) == 33
            with condition:
                records.append(record)
                condition.notify_all()
    except Exception as error:
        if not finished.is_set():
            errors.append(repr(error))
            with condition:
                condition.notify_all()


thread = threading.Thread(target=read_stream, daemon=True)
thread.start()
print('Stream open; waiting up to 90 seconds for camera/pose initialization…', flush=True)
with condition:
    assert condition.wait_for(lambda: records or errors, timeout=90), 'No pose results after startup'
    assert not errors, errors
    assert records, 'No pose results after startup'
latencies = []
for count in [2, 1] * 10:
    started = time.monotonic()
    applied = config(count)
    latencies.append((time.monotonic() - started) * 1000)
    assert applied['sessionId'] == session and applied['playerCount'] == count
    assert config(count) == applied, 'Identical request must not create another boundary'
    boundary = applied['effectiveFromSeq']
    with condition:
        assert condition.wait_for(lambda: any(r['seq'] >= boundary for r in records), timeout=5), errors
        observed = [r for r in records if r['seq'] >= boundary]
        assert all(r['playerCount'] == count for r in observed)
        # Synthetic mode must continue returning complete detected-person fixtures after each clear.
        if info['capabilities']['poseModel'] == 'synthetic':
            assert condition.wait_for(lambda: any(r['seq'] >= boundary and len(r['poses']) == count for r in records), timeout=3)
# Conflicting controls remain bounded and allocate distinct monotonically ordered boundaries.
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
    replies = list(pool.map(config, [2, 1]))
assert all(r['sessionId'] == session for r in replies)
final = config(1)
with condition:
    assert condition.wait_for(lambda: any(r['seq'] >= final['effectiveFromSeq'] for r in records), timeout=5)
assert not errors, errors
finished.set()
# Wake the blocking reader before releasing its response object.
stream_socket.shutdown(socket.SHUT_RDWR)
thread.join(timeout=2)
stream.close()
connection.close()
print(json.dumps({'control_validation': 'pass', 'switches': 20, 'single_open_stream': True,
                  'session': session, 'model': info['capabilities']['poseModel'], 'records': len(records),
                  'max_control_ms': round(max(latencies), 1), 'observed_id_sets': sorted({str([p['playerId'] for p in r['poses']]) for r in records})}))
