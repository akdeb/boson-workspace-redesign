"use client";

/**
 * Preparing an uploaded face in the browser.
 *
 * The reference image is sent inline on every render, so its size is pure latency — the
 * same reason the bundled faces are downscaled server-side (see lib/face-image.ts). A
 * phone photo is several megabytes and would also be far too big to keep in a database
 * row, so it is cropped and re-encoded here, once, before it is ever stored.
 *
 * The crop is square and anchored to the top, matching what the render routes do to the
 * bundled faces: the renderer wants a head, and a head is at the top of a portrait.
 */

export const ACCEPTED_IMAGES = "image/png,image/jpeg,image/webp";

/** Square, and at least the largest output dimension the renderer offers (640). */
const STORED_SIZE = 768;
const QUALITY = 0.9;

/** Anything bigger than this is a photo library, not a portrait. */
const MAX_FILE_BYTES = 25 * 1024 * 1024;

export type PreparedFace = {
  dataUri: string;
  /** Bytes of the encoded JPEG, for the "…KB" line in the upload dialog. */
  bytes: number;
  /** The original file's dimensions, so we can warn when a face is tiny. */
  sourceWidth: number;
  sourceHeight: number;
};

export function faceProblem(face: PreparedFace | null) {
  if (!face) return null;
  if (Math.min(face.sourceWidth, face.sourceHeight) < 256) {
    return "That image is under 256px on its short side. The renderer will look soft — use a larger photo.";
  }
  return null;
}

export function faceAdvice(face: PreparedFace | null) {
  if (!face) return null;
  return "Best results: one person, facing the camera, head and shoulders, evenly lit.";
}

/** Decode, cover-crop to a top-anchored square, and re-encode as JPEG. */
export async function prepareFace(file: File): Promise<PreparedFace> {
  if (file.size > MAX_FILE_BYTES) throw new Error("That image is too large. Try one under 25 MB.");

  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error("That image could not be decoded. Try a PNG, JPEG, or WebP.");
  });

  try {
    const scale = STORED_SIZE / Math.min(bitmap.width, bitmap.height);
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = STORED_SIZE;
    canvas.height = STORED_SIZE;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser cannot process images.");
    // Centred horizontally, flush to the top — the face is never in the bottom third.
    context.drawImage(bitmap, Math.round((STORED_SIZE - width) / 2), 0, width, height);

    const dataUri = canvas.toDataURL("image/jpeg", QUALITY);
    return {
      dataUri,
      bytes: Math.round((dataUri.length - dataUri.indexOf(",") - 1) * 3 / 4),
      sourceWidth: bitmap.width,
      sourceHeight: bitmap.height,
    };
  } finally {
    bitmap.close();
  }
}
