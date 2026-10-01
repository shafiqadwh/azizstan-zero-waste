/** Browser-side photo handling shared by the evaluation form and request sheets. */

/** Phones send 12 MP photos; shrink to ≤ 2000 px JPEG 0.85 before upload (07-frontend §3.4). The server re-encodes. */
export async function shrink(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/jpeg', 0.85));
    return blob ?? file;
  } catch {
    return file; // the server explains what is wrong with the file
  }
}

export async function upload(blob: Blob, kind: 'site' | 'signature', target: string) {
  const fd = new FormData();
  fd.set('file', blob, 'photo.jpg');
  fd.set('kind', kind);
  fd.set('targetRef', target);
  const res = await fetch('/api/v1/uploads', { method: 'POST', body: fd });
  const body = (await res.json().catch(() => null)) as
    { evidenceId: string; url: string } | { error: { message: string } } | null;
  if (!res.ok || !body || 'error' in body) {
    throw new Error(body && 'error' in body ? body.error.message : 'อัปโหลดไม่สำเร็จ ลองใหม่อีกครั้ง');
  }
  return body;
}
