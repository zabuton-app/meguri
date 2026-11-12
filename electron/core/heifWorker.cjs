// Decode one local HEIF image off the app thread. The worker is short-lived
// so a damaged file cannot keep the decoder or its WebAssembly memory alive.
const fs = require("node:fs");
const { parentPort, workerData } = require("node:worker_threads");

const MAX_SOURCE_BYTES = 64 * 1024 * 1024;
const MAX_PIXELS = 64_000_000;

function readImage(file) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
  try {
    const stat = fs.fstatSync(fd);
    const { size } = stat;
    if (!stat.isFile() || size <= 0 || size > MAX_SOURCE_BYTES) {
      throw new Error("HEIF source exceeds the decoding limits");
    }
    const data = Buffer.allocUnsafe(size);
    let offset = 0;
    while (offset < size) {
      const read = fs.readSync(fd, data, offset, size - offset);
      if (read === 0) throw new Error("HEIF source changed while reading");
      offset += read;
    }
    return data;
  } finally {
    fs.closeSync(fd);
  }
}

async function decode(file) {
  const bytes = readImage(file);
  const { decodeHeic, init } = await import("@dusrel/image-heic");
  const wasm = fs.readFileSync(
    require.resolve("@dusrel/image-heic/codec/heic_dec.wasm"),
  );
  await init({
    wasmUrl: `data:application/wasm;base64,${wasm.toString("base64")}`,
  });

  // The decoder returns a browser ImageData. Here the pixels only need to
  // cross back to the encoder, so the worker supplies its data-only equivalent.
  globalThis.ImageData = class {
    constructor(data, width, height) {
      if (width <= 0 || height <= 0 || width * height > MAX_PIXELS) {
        throw new Error("HEIF image exceeds the decoding limits");
      }
      this.data = data;
      this.width = width;
      this.height = height;
    }
  };
  const { width, height, data } = await decodeHeic(bytes, {
    nativeFirst: false,
  });
  return { width, height, pixels: data };
}

decode(workerData).then(
  (image) => parentPort.postMessage(image, [image.pixels.buffer]),
  (error) => parentPort.postMessage({ error: error.message }),
);
