/**
 * Evidence image pipeline (BR-V1): auto-rotate, strip all metadata (EXIF incl. GPS), fit within 1600 px,
 * stamp `dd/MM/yyyy HH:mm · 121 · ม.1 Amanah` bottom-right, encode WebP quality 80.
 * sharp never copies metadata to the output unless asked (`withMetadata`), so stripping is the default here.
 */
import path from 'node:path';
import sharp from 'sharp';
import { AppError } from '../errors.ts';

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
export const MAX_EDGE = 1600;
export const WEBP_QUALITY = 80;
/** Refuse decompression bombs: 50 MP is far beyond any phone camera. */
const PIXEL_LIMIT = 50_000_000;
const STAMP_FONT = path.resolve(process.cwd(), 'fonts/ibm-plex-sans-thai/IBMPlexSansThai-SemiBold.woff2');

export const IMAGE_MSG = {
  tooBig: 'ไฟล์ใหญ่เกิน 15 MB',
  heic: 'กรุณาถ่ายรูปใหม่ในแอป',
  unsupported: 'รองรับเฉพาะรูป JPEG PNG หรือ WebP',
  unreadable: 'อ่านรูปนี้ไม่ได้ กรุณาเลือกรูปใหม่',
} as const;

const fail = (message: string) => new AppError('VALIDATION', { field: 'file', message });

/** Pango markup needs XML escaping (class names come from admins). */
const escapeMarkup = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export async function checkImage(data: Uint8Array): Promise<'jpeg' | 'png' | 'webp'> {
  if (data.byteLength > MAX_UPLOAD_BYTES) throw fail(IMAGE_MSG.tooBig);
  let format: string | undefined;
  try {
    format = (await sharp(data, { limitInputPixels: PIXEL_LIMIT }).metadata()).format;
  } catch {
    throw fail(IMAGE_MSG.unreadable);
  }
  if (format === 'heif') throw fail(IMAGE_MSG.heic);
  if (format !== 'jpeg' && format !== 'png' && format !== 'webp') throw fail(IMAGE_MSG.unsupported);
  return format;
}

async function stampOverlay(text: string, imageWidth: number) {
  const fontPx = Math.max(14, Math.round(imageWidth * 0.022));
  const pad = Math.round(fontPx * 0.45);
  const label = await sharp({
    text: {
      text: `<span foreground="white">${escapeMarkup(text)}</span>`,
      font: `IBM Plex Sans Thai SemiBold ${fontPx}`,
      fontfile: STAMP_FONT,
      rgba: true,
      dpi: 72,
    },
  })
    .png()
    .toBuffer({ resolveWithObject: true });
  // never wider than the photo: shrink the label if a very long class name meets a narrow image
  const maxW = imageWidth - 2 * pad - 8;
  let labelBuf = label.data;
  let { width: lw, height: lh } = label.info;
  if (lw > maxW) {
    const scaled = await sharp(labelBuf).resize({ width: maxW }).png().toBuffer({ resolveWithObject: true });
    labelBuf = scaled.data;
    ({ width: lw, height: lh } = scaled.info);
  }
  const box = await sharp({
    create: { width: lw + 2 * pad, height: lh + 2 * pad, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0.55 } },
  })
    .composite([{ input: labelBuf, top: pad, left: pad }])
    .png()
    .toBuffer({ resolveWithObject: true });
  return { data: box.data, width: box.info.width, height: box.info.height };
}

export interface ProcessedImage {
  data: Buffer;
  width: number;
  height: number;
}

export async function processEvidenceImage(data: Uint8Array, stampText: string): Promise<ProcessedImage> {
  await checkImage(data);
  const base = await sharp(data, { limitInputPixels: PIXEL_LIMIT })
    .rotate() // apply the EXIF orientation, then the tag is gone with the rest of the metadata
    .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' }) // PNG transparency → white, like paper
    .toBuffer({ resolveWithObject: true });
  const { width, height } = base.info;
  const stamp = await stampOverlay(stampText, width);
  const margin = Math.round(width * 0.015);
  const out = await sharp(base.data)
    .composite([
      {
        input: stamp.data,
        left: Math.max(0, width - stamp.width - margin),
        top: Math.max(0, height - stamp.height - margin),
      },
    ])
    .webp({ quality: WEBP_QUALITY })
    .toBuffer({ resolveWithObject: true });
  return { data: out.data, width: out.info.width, height: out.info.height };
}

/** Smaller copy of a stored evidence WebP (`/files/{id}?w=320`). */
export async function resizeWebp(data: Uint8Array, width: number): Promise<Buffer> {
  return sharp(data).resize({ width, withoutEnlargement: true }).webp({ quality: WEBP_QUALITY }).toBuffer();
}
