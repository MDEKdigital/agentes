export const ALLOWED_AUDIO_MIME_TYPES = new Set([
  "audio/ogg",
  "audio/mp4",
  "audio/mpeg",
  "audio/wav",
  "audio/webm",
  "audio/aac",
  "audio/x-m4a",
]);

export const ALLOWED_IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/heic",
  "image/heif",
]);

export const ALLOWED_MEDIA_MIME_TYPES = new Set([
  ...ALLOWED_AUDIO_MIME_TYPES,
  ...ALLOWED_IMAGE_MIME_TYPES,
]);

// ~10 MB in binary terms when base64-decoded
export const MAX_MEDIA_BASE64_CHARS = 10 * 1024 * 1024;

export function validateMediaPayload(base64: string, mimeType: string): void {
  const baseMime = mimeType.split(";")[0].trim().toLowerCase();

  if (!ALLOWED_MEDIA_MIME_TYPES.has(baseMime)) {
    throw new Error("Media validation failed: unsupported media type");
  }

  if (base64.length > MAX_MEDIA_BASE64_CHARS) {
    throw new Error("Media validation failed: payload exceeds size limit");
  }
}
