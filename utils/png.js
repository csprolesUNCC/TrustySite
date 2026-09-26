// Minimal PNG decoder for drawings sent from a browser canvas (8-bit, non-interlaced).
import { inflateSync } from 'node:zlib';

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 }; // grayscale, RGB, grayscale+alpha, RGBA

export function decodePng(buffer, { width: expectedWidth, height: expectedHeight } = {}) {
  if (buffer.length < 8 || SIGNATURE.some((byte, i) => buffer[i] !== byte)) throw new Error('Not a PNG');

  let pos = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  let interlace = 0;
  const idat = [];
  while (pos + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(pos);
    const type = buffer.toString('latin1', pos + 4, pos + 8);
    const data = buffer.subarray(pos + 8, pos + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    pos += 12 + length;
  }

  const channels = CHANNELS[colorType];
  if (!width || !height || (expectedWidth && width !== expectedWidth) || (expectedHeight && height !== expectedHeight)) {
    throw new Error('Unexpected PNG size');
  }
  if (bitDepth !== 8 || !channels || interlace !== 0) throw new Error('Unsupported PNG format');

  // Size is checked before inflating, and the output is capped, so a crafted file can't balloon memory.
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(idat), { maxOutputLength: (stride + 1) * height });
  if (raw.length !== (stride + 1) * height) throw new Error('Truncated PNG');

  const rgba = new Uint8Array(width * height * 4);
  let prev = new Uint8Array(stride);
  let line = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    const filter = raw[rowStart];
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? line[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let value = raw[rowStart + 1 + x];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) {
        throw new Error('Bad PNG filter');
      }
      line[x] = value & 255;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const i = x * channels;
      if (channels === 4) {
        rgba[o] = line[i]; rgba[o + 1] = line[i + 1]; rgba[o + 2] = line[i + 2]; rgba[o + 3] = line[i + 3];
      } else if (channels === 3) {
        rgba[o] = line[i]; rgba[o + 1] = line[i + 1]; rgba[o + 2] = line[i + 2]; rgba[o + 3] = 255;
      } else if (channels === 2) {
        rgba[o] = rgba[o + 1] = rgba[o + 2] = line[i]; rgba[o + 3] = line[i + 1];
      } else {
        rgba[o] = rgba[o + 1] = rgba[o + 2] = line[i]; rgba[o + 3] = 255;
      }
    }
    [prev, line] = [line, prev];
  }
  return { width, height, data: rgba };
}

export function decodePngDataUrl(dataUrl, expected) {
  return decodePng(Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'), expected);
}
