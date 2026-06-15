/**
 * bodymap/photo.ts — client-side photo downscaling.
 *
 * Captured/selected photos can be large; we never want to encrypt and upload a
 * multi-megabyte original. This downscales on-device via a canvas to a bounded
 * longest edge and re-encodes as JPEG, returning raw bytes ready to be encrypted
 * under the record DEK and attached via the existing blob flow. Everything stays
 * in memory in the browser — no network, no plaintext leaves the device here.
 *
 * PRIVACY: every captured/selected photo is ALWAYS re-encoded through an
 * HTMLCanvasElement before encryption. A canvas re-encode produces fresh image
 * bytes from the decoded pixels only, which STRIPS all EXIF/metadata — including
 * GPS location, capture timestamps and device identifiers. This is guaranteed
 * even when a downscale is skipped for already-small images (the scale is clamped
 * to 1, but the image is still drawn to the canvas and re-encoded), so no
 * original-file metadata can ever reach storage or upload.
 */

export interface DownscaleOptions {
  /** longest edge in px (default 1280). */
  maxEdge?: number;
  /** JPEG quality 0..1 (default 0.8). */
  quality?: number;
  /** output media type (default image/jpeg). */
  mediaType?: string;
}

export interface DownscaledImage {
  data: Uint8Array;
  mediaType: string;
  width: number;
  height: number;
}

/** Load a File/Blob into an HTMLImageElement via an object URL. */
function loadImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('image-decode-failed'));
    };
    img.src = url;
  });
}

function canvasToBytes(
  canvas: HTMLCanvasElement,
  mediaType: string,
  quality: number,
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (out) => {
        if (!out) {
          reject(new Error('encode-failed'));
          return;
        }
        out
          .arrayBuffer()
          .then((buf) => resolve(new Uint8Array(buf)))
          .catch(reject);
      },
      mediaType,
      quality,
    );
  });
}

/**
 * Downscale `file` so its longest edge ≤ maxEdge, re-encoding as JPEG. Smaller
 * images are still re-encoded (normalises EXIF orientation handling across the
 * decode path and, crucially, STRIPS all EXIF/metadata including GPS — see the
 * file header). The canvas re-encode below is the single, guaranteed strip point.
 */
export async function downscaleImage(
  file: Blob,
  opts: DownscaleOptions = {},
): Promise<DownscaledImage> {
  const maxEdge = opts.maxEdge ?? 1280;
  const quality = opts.quality ?? 0.8;
  const mediaType = opts.mediaType ?? 'image/jpeg';

  const img = await loadImage(file);
  const longest = Math.max(img.naturalWidth, img.naturalHeight) || 1;
  const scale = Math.min(1, maxEdge / longest);
  const width = Math.max(1, Math.round(img.naturalWidth * scale));
  const height = Math.max(1, Math.round(img.naturalHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas-unavailable');
  // Drawing the decoded pixels onto the canvas and re-encoding below yields fresh
  // image bytes WITHOUT any source EXIF/metadata (GPS, timestamps, device ids).
  // This runs unconditionally — even when scale === 1 — so stripping is guaranteed.
  ctx.drawImage(img, 0, 0, width, height);

  const data = await canvasToBytes(canvas, mediaType, quality);
  return { data, mediaType, width, height };
}
