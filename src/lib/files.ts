import { MAX_IMAGE_BYTES } from './types';

export function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function timestamp() {
  return new Date().toISOString();
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (file.size > MAX_IMAGE_BYTES) {
      reject(new Error(`Image too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max ${(MAX_IMAGE_BYTES / 1024 / 1024).toFixed(0)} MB.`));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function isTextEditingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return tagName === 'input' || tagName === 'textarea' || tagName === 'select' || target.isContentEditable;
}

const CARD_MAX_SIDE = 320;
const CARD_MIN_SIDE = 48;

export function computeImageCardSize(naturalWidth: number, naturalHeight: number) {
  if (!naturalWidth || !naturalHeight) return { width: 260, height: 180 };
  const longest = Math.max(naturalWidth, naturalHeight);
  const scale = CARD_MAX_SIDE / longest;
  const width = Math.max(CARD_MIN_SIDE, Math.round(naturalWidth * scale));
  const height = Math.max(CARD_MIN_SIDE, Math.round(naturalHeight * scale));
  return { width, height };
}

export function readImageDimensions(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    if (typeof Image === 'undefined') {
      resolve({ width: 0, height: 0 });
      return;
    }
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ width: 0, height: 0 });
    img.src = dataUrl;
  });
}
