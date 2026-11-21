// Uploaded images live in IndexedDB (idb-keyval). Refs look like `idb:<key>`.
import { del, get, set } from 'idb-keyval';
import { useEffect, useState } from 'react';
import { bytesToDataUrl, dataUrlToBytes, sha256, toHex } from '../core/bytes';
import { MISSING_PREFIX, shaKey, shaRef } from '../core/frozen';
import { newId } from '../core/rng';

const urlCache = new Map<string, string>();
const pending = new Map<string, Promise<string | null>>();

export const isIdbRef = (s?: string) => !!s && s.startsWith('idb:');
/** an image that could not be loaded when the card set was frozen: always rendered as its text badge */
export const isMissingRef = (s?: string) => !!s && s.startsWith(MISSING_PREFIX);

/** Resize big raster images so storage and PDFs stay small. SVG is kept as-is. */
async function normalizeImage(file: Blob): Promise<Blob> {
  if (file.type === 'image/svg+xml') return file;
  try {
    const bmp = await createImageBitmap(file);
    const max = 800;
    if (bmp.width <= max && bmp.height <= max) return file;
    const scale = max / Math.max(bmp.width, bmp.height);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((res) => canvas.toBlob((b) => res(b ?? file), 'image/png'));
  } catch {
    return file;
  }
}

export async function saveImage(file: Blob): Promise<string> {
  const blob = await normalizeImage(file);
  const key = newId('img_');
  await set(key, blob);
  return 'idb:' + key;
}

export async function saveImageWithKey(key: string, blob: Blob) {
  await set(key, blob);
  urlCache.delete(key);
}

export async function deleteImage(ref: string) {
  if (!isIdbRef(ref)) return;
  const key = ref.slice(4);
  try {
    await del(key);
  } catch {
    /* ignore */
  }
  const url = urlCache.get(key);
  if (url) URL.revokeObjectURL(url);
  urlCache.delete(key);
}

export async function getImageBlob(ref: string): Promise<Blob | null> {
  if (isMissingRef(ref)) return null;
  if (isIdbRef(ref)) {
    try {
      return ((await get(ref.slice(4))) as Blob | undefined) ?? null;
    } catch {
      return null;
    }
  }
  try {
    const r = await fetch(ref);
    if (!r.ok) return null;
    const ct = r.headers.get('content-type') ?? '';
    if (ct.includes('text/html')) return null; // SPA fallback => missing file
    return await r.blob();
  } catch {
    return null;
  }
}

/** Resolve a ref (url or idb:key) to something usable in <img src> */
export async function resolveImage(ref?: string): Promise<string | null> {
  if (!ref || isMissingRef(ref)) return null;
  if (!isIdbRef(ref)) return ref;
  const key = ref.slice(4);
  const cached = urlCache.get(key);
  if (cached) return cached;
  let p = pending.get(key);
  if (!p) {
    p = (async () => {
      const blob = await getImageBlob(ref);
      if (!blob) return null;
      const url = URL.createObjectURL(blob);
      urlCache.set(key, url);
      return url;
    })();
    pending.set(key, p);
  }
  const res = await p;
  pending.delete(key);
  return res;
}

export function useImageUrl(ref?: string): string | null {
  const [url, setUrl] = useState<string | null>(() =>
    !ref || isMissingRef(ref) ? null : isIdbRef(ref) ? urlCache.get(ref.slice(4)) ?? null : ref,
  );
  useEffect(() => {
    let alive = true;
    if (!ref || isMissingRef(ref)) {
      setUrl(null);
      return;
    }
    resolveImage(ref).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [ref]);
  return url;
}

export async function blobToDataURL(b: Blob): Promise<string> {
  return bytesToDataUrl(new Uint8Array(await b.arrayBuffer()), b.type);
}

export async function dataURLToBlob(d: string): Promise<Blob> {
  const { mime, bytes } = dataUrlToBytes(d);
  return new Blob([bytes], { type: mime });
}

/** Store bytes under their content hash; returns the sha256 hex */
export async function saveContentImage(bytes: Uint8Array, mime: string): Promise<string> {
  const hex = toHex(await sha256(bytes));
  await saveImageWithKey(shaKey(hex), new Blob([bytes], { type: mime }));
  return hex;
}

/**
 * Freeze one image ref: load its bytes on this machine and store them content-addressed.
 * Returns `idb:sha_<hex>`, or `missing:<ref>` when the image cannot be loaded here.
 */
export async function freezeImageRef(ref: string): Promise<string> {
  if (isMissingRef(ref) || ref.startsWith('idb:sha_')) return ref;
  const blob = await getImageBlob(ref);
  if (!blob) return MISSING_PREFIX + ref;
  const hex = await saveContentImage(new Uint8Array(await blob.arrayBuffer()), blob.type);
  return shaRef(hex);
}
