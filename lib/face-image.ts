import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { AvatarSize } from "@/lib/boson-avatar";

/**
 * Reference images for the avatar renderer.
 *
 * The image is sent inline on every render, so its size is pure latency. The bundled faces
 * are 1086x1448 PNGs — about 2.7 MB once base64-encoded — and measurably delay the first
 * video frame: streaming the same 3-second turn took 15.0s to its first chunk with the full
 * PNG versus 4.9s with the image downscaled to the output size. Nothing is lost by
 * downscaling, since the renderer only ever produces 640x640 or smaller.
 */

const cache = new Map<string, string>();

function dimensions(size: AvatarSize) {
  const [width, height] = size.split("x").map(Number);
  return { width, height };
}

function assertFaceName(face: string) {
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(face)) throw new Error(`Unsupported face name: ${face}`);
  return face;
}

function facePath(face: string) {
  return path.join(process.cwd(), "public", "assets", `${assertFaceName(face)}.png`);
}

/** The face downscaled to the output size and JPEG-encoded, base64. */
export async function readFaceReference(face: string, size: AvatarSize = "480x640") {
  const key = `${face}@${size}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const { width, height } = dimensions(size);
  const encoded = (await sharp(facePath(face))
    .resize(width, height, { fit: "cover", position: "top" })
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer()).toString("base64");

  cache.set(key, encoded);
  return encoded;
}

/** The untouched PNG, for the self-hosted renderer which is told to expect `.png`. */
const pngCache = new Map<string, string>();

export async function readFacePng(face: string) {
  const cached = pngCache.get(face);
  if (cached) return cached;
  const encoded = (await readFile(facePath(face))).toString("base64");
  pngCache.set(face, encoded);
  return encoded;
}

/* ------------------------------------------------------------- uploaded faces --- */

/**
 * An uploaded face has no file on the server, so the browser sends the pixels with the
 * render request as a JPEG data URI (already downscaled — see `lib/face-upload.ts`).
 *
 * These are deliberately not cached: an upload is used for as long as it is on screen and
 * then replaced, so a cache keyed on megabytes of image data would only ever grow.
 */

/** Guard against a caller pasting a whole camera roll into a JSON body. */
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

function decodeDataUri(dataUri: string) {
  const match = /^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/i.exec(dataUri.trim());
  if (!match) throw new Error("The uploaded face must be a PNG, JPEG, or WebP data URI.");
  const buffer = Buffer.from(match[2], "base64");
  if (!buffer.byteLength) throw new Error("The uploaded face is empty.");
  if (buffer.byteLength > MAX_UPLOAD_BYTES) throw new Error("The uploaded face is too large.");
  return buffer;
}

/** An uploaded face downscaled to the output size and JPEG-encoded, base64. */
export async function referenceFromDataUri(dataUri: string, size: AvatarSize = "480x640") {
  const { width, height } = dimensions(size);
  return (await sharp(decodeDataUri(dataUri))
    .resize(width, height, { fit: "cover", position: "top" })
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer()).toString("base64");
}

/** The same image as PNG, for the self-hosted renderer which is told to expect `.png`. */
export async function pngFromDataUri(dataUri: string) {
  return (await sharp(decodeDataUri(dataUri)).png().toBuffer()).toString("base64");
}

/**
 * The reference image for a render, whichever kind of face it is: `faceImage` wins when the
 * caller uploaded one, otherwise the bundled PNG named by `face` is used.
 */
export async function resolveFaceReference(face: string | undefined, faceImage: string | undefined, size: AvatarSize) {
  return faceImage ? referenceFromDataUri(faceImage, size) : readFaceReference(face ?? "Maya", size);
}

export async function resolveFacePng(face: string | undefined, faceImage: string | undefined) {
  return faceImage ? pngFromDataUri(faceImage) : readFacePng(face ?? "Maya");
}
