import { inflateRawSync } from "node:zlib";
const table = Array.from({ length: 256 }, (_, i) => {
  let n = i;
  for (let j = 0; j < 8; j++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc(buffer) {
  let n = 0xffffffff;
  for (const byte of buffer) n = table[(n ^ byte) & 255] ^ (n >>> 8);
  return (n ^ 0xffffffff) >>> 0;
}
export function safePath(name) {
  return (
    typeof name === "string" &&
    name.length <= 240 &&
    !name.startsWith("/") &&
    !name.includes("\\") &&
    !name.includes("\0") &&
    name.split("/").every((p) => p && p !== "." && p !== "..") &&
    !name.includes(":")
  );
}
// Stored ZIP entries with fixed DOS timestamp; no external process or package required.
export function makeZip(files) {
  const local = [],
    central = [];
  let offset = 0;
  for (const [name, value] of files) {
    if (!safePath(name)) throw Error("Unsafe archive path");
    const data = Buffer.from(value),
      filename = Buffer.from(name),
      checksum = crc(data);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50);
    h.writeUInt16LE(20, 4);
    h.writeUInt16LE(0x800, 6);
    h.writeUInt16LE(33, 12);
    h.writeUInt32LE(checksum, 14);
    h.writeUInt32LE(data.length, 18);
    h.writeUInt32LE(data.length, 22);
    h.writeUInt16LE(filename.length, 26);
    local.push(h, filename, data);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x800, 8);
    c.writeUInt16LE(33, 14);
    c.writeUInt32LE(checksum, 16);
    c.writeUInt32LE(data.length, 20);
    c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(filename.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, filename);
    offset += h.length + filename.length + data.length;
  }
  const directory = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(files.size, 8);
  end.writeUInt16LE(files.size, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}
export function readZip(buffer, maxBytes = 256 * 1024 * 1024) {
  let end = buffer.length - 22;
  while (
    end >= Math.max(0, buffer.length - 65557) &&
    buffer.readUInt32LE(end) !== 0x06054b50
  )
    end--;
  if (end < 0 || buffer.readUInt32LE(end) !== 0x06054b50)
    throw Error("Invalid ZIP");
  const count = buffer.readUInt16LE(end + 10);
  if (count > 500) throw Error("Too many archive entries");
  let cursor = buffer.readUInt32LE(end + 16),
    total = 0;
  const files = new Map();
  for (let i = 0; i < count; i++) {
    if (
      cursor + 46 > buffer.length ||
      buffer.readUInt32LE(cursor) !== 0x02014b50
    )
      throw Error("Invalid ZIP directory");
    const method = buffer.readUInt16LE(cursor + 10),
      compressed = buffer.readUInt32LE(cursor + 20),
      size = buffer.readUInt32LE(cursor + 24),
      len = buffer.readUInt16LE(cursor + 28),
      extra = buffer.readUInt16LE(cursor + 30),
      comment = buffer.readUInt16LE(cursor + 32),
      offset = buffer.readUInt32LE(cursor + 42);
    const name = buffer
      .subarray(cursor + 46, cursor + 46 + len)
      .toString("utf8");
    if (
      !safePath(name) ||
      files.has(name) ||
      ((buffer.readUInt32LE(cursor + 38) >>> 16) & 0xf000) === 0xa000
    )
      throw Error("Unsafe/duplicate ZIP entry");
    total += size;
    if (total > maxBytes) throw Error("Archive exceeds expanded limit");
    if (
      offset + 30 > buffer.length ||
      buffer.readUInt32LE(offset) !== 0x04034b50
    )
      throw Error("Invalid ZIP entry");
    const begin =
      offset +
      30 +
      buffer.readUInt16LE(offset + 26) +
      buffer.readUInt16LE(offset + 28);
    if (begin + compressed > buffer.length) throw Error("Truncated ZIP");
    const source = buffer.subarray(begin, begin + compressed);
    const data =
      method === 0
        ? source
        : method === 8
          ? inflateRawSync(source, { maxOutputLength: size || 1 })
          : null;
    if (
      !data ||
      data.length !== size ||
      crc(data) !== buffer.readUInt32LE(cursor + 16)
    )
      throw Error("Invalid ZIP content/checksum");
    files.set(name, data);
    cursor += 46 + len + extra + comment;
  }
  return files;
}
