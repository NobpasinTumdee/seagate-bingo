// Vector PDF export with jsPDF (no html2canvas). Thai font embedded via addFileToVFS.
import type { jsPDF as JsPDF } from 'jspdf';
import { checkCode, formatCardNo, getCard } from '../core/cards';
import type { GameRecord } from '../core/game';
import { columnHeader, imageItem } from '../core/symbols';
import type { SymbolItem } from '../core/types';
import { t } from '../i18n/th';
import { getImageBlob } from '../state/images';
import type { PrintPalette, Theme } from '../themes';
import sarabunRegularUrl from '../assets/fonts/Sarabun-Regular.ttf?url';
import sarabunBoldUrl from '../assets/fonts/Sarabun-Bold.ttf?url';
import kanitBoldUrl from '../assets/fonts/Kanit-Bold.ttf?url';
import trirongBoldUrl from '../assets/fonts/Trirong-Bold.ttf?url';
import { effectiveDpi, LINE_FACTOR, MAX_CANVAS_PX, rasterFontPx } from './textRaster';
import { cardBox, LAYOUTS, pageSlots, perPage, type PageLayout } from './layouts';

export type PdfOptions = {
  from: number;
  to: number;
  style: 'color' | 'ink';
  cutLines: boolean;
  pagesPerFile: number;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
};

const PT_PER_MM = 72 / 25.4;

// ---------- fonts ----------
const fontCache = new Map<string, string>();
async function fontBase64(url: string): Promise<string> {
  const c = fontCache.get(url);
  if (c) return c;
  const buf = new Uint8Array(await (await fetch(url)).arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  const b64 = btoa(bin);
  fontCache.set(url, b64);
  return b64;
}

async function registerFonts(doc: JsPDF, theme: Theme) {
  const heading = theme.id === 'blackGold' ? trirongBoldUrl : kanitBoldUrl;
  const list: [string, string, string, string][] = [
    ['Sarabun-Regular.ttf', sarabunRegularUrl, 'Sarabun', 'normal'],
    ['Sarabun-Bold.ttf', sarabunBoldUrl, 'Sarabun', 'bold'],
    ['Heading-Bold.ttf', heading, 'Heading', 'bold'],
  ];
  for (const [file, url, family, style] of list) {
    doc.addFileToVFS(file, await fontBase64(url));
    doc.addFont(file, family, style);
  }
}

// ---------- images (rasterized once, cached, embedded once per document via alias) ----------
type Raster = { data: string; w: number; h: number };
const rasterCache = new Map<string, Promise<Raster | null>>();

function loadImg(url: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = url;
  });
}

function rasterize(ref: string, maxPx = 600): Promise<Raster | null> {
  const key = ref + '@' + maxPx;
  let p = rasterCache.get(key);
  if (!p) {
    p = (async () => {
      const blob = await getImageBlob(ref);
      if (!blob) return null;
      const url = URL.createObjectURL(blob);
      try {
        const img = await loadImg(url);
        const iw = img.naturalWidth || maxPx;
        const ih = img.naturalHeight || maxPx;
        const s = Math.min(1, maxPx / Math.max(iw, ih)) || 1;
        const w = Math.max(1, Math.round(iw * s));
        const h = Math.max(1, Math.round(ih * s));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
        return { data: canvas.toDataURL('image/png'), w, h };
      } catch {
        return null;
      } finally {
        URL.revokeObjectURL(url);
      }
    })();
    rasterCache.set(key, p);
  }
  return p;
}

// ---------- Thai text ----------
/**
 * jsPDF does not apply OpenType shaping (GPOS/GSUB). Plain Thai renders fine, but stacked marks
 * (upper vowel + tone mark, or marks over ascender consonants) can overlap. Such strings are drawn
 * as a high-resolution image rendered by the browser's own text shaper instead.
 */
export function needsShaping(s: string): boolean {
  return /[ัิ-ื็][่-์]|[่-๋]ำ|[ปฝฟฬ][ัิ-ื็-์]/.test(s);
}

const textRasterCache = new Map<string, Raster>();
/** Lowest effective DPI of any rasterized text in the current export (reported to the UI) */
let minTextDpi = Infinity;

/** Render text at a resolution derived from its printed height (>= MIN_TEXT_DPI guaranteed). */
function rasterText(text: string, family: string, weight: number, color: string, heightMm: number): Raster {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  let px = rasterFontPx(heightMm);
  const fontFor = (p: number) => `${weight} ${p}px ${family}, Sarabun, sans-serif`;
  ctx.font = fontFor(px);
  // keep the canvas within browser limits; only very long strings would ever hit this
  const widthAt = (p: number) => (ctx.measureText(text).width * p) / px;
  const tooWide = widthAt(px) + px * 0.2 > MAX_CANVAS_PX;
  if (tooWide) px = Math.floor((px * (MAX_CANVAS_PX - px * 0.2)) / widthAt(px));
  const key = [text, family, weight, color, px].join('|');
  const cached = textRasterCache.get(key);
  if (cached) return cached;
  ctx.font = fontFor(px);
  const pad = Math.ceil(px * 0.05);
  const w = Math.ceil(ctx.measureText(text).width) + 2 * pad;
  const h = Math.ceil(px * LINE_FACTOR);
  canvas.width = w;
  canvas.height = h;
  ctx.font = fontFor(px);
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, pad, h / 2);
  const r = { data: canvas.toDataURL('image/png'), w, h };
  textRasterCache.set(key, r);
  return r;
}

type Ctx = {
  doc: JsPDF;
  game: GameRecord;
  pal: PrintPalette;
  theme: Theme;
  images: Map<string, Raster | null>;
  aliases: Set<string>;
};

function aliasFor(ref: string) {
  return 'img_' + ref.replace(/[^a-zA-Z0-9]/g, '_').slice(-60);
}

function drawImage(ctx: Ctx, ref: string | undefined, x: number, y: number, w: number, h: number): boolean {
  if (!ref) return false;
  const r = ctx.images.get(ref);
  if (!r) return false;
  const s = Math.min(w / r.w, h / r.h);
  const dw = r.w * s;
  const dh = r.h * s;
  ctx.doc.addImage(r.data, 'PNG', x + (w - dw) / 2, y + (h - dh) / 2, dw, dh, aliasFor(ref), 'FAST');
  return true;
}

/** Text that shrinks to fit maxW; Thai with stacked marks is rasterized */
function fitText(
  ctx: Ctx,
  text: string,
  x: number,
  y: number,
  opts: { size: number; maxW: number; family: string; style: string; color: string; align?: 'left' | 'center' | 'right'; cssFamily?: string },
) {
  const { doc } = ctx;
  if (!text) return;
  doc.setFont(opts.family, opts.style);
  let size = opts.size;
  doc.setFontSize(size);
  let w = doc.getTextWidth(text);
  if (w > opts.maxW) {
    size = (size * opts.maxW) / w;
    doc.setFontSize(size);
    w = opts.maxW;
  }
  const align = opts.align ?? 'left';
  if (needsShaping(text)) {
    const hMm = (size / PT_PER_MM) * LINE_FACTOR; // printed line-box height
    const r = rasterText(text, opts.cssFamily ?? 'Sarabun', opts.style === 'bold' ? 700 : 400, opts.color, hMm);
    minTextDpi = Math.min(minTextDpi, effectiveDpi(r.h, hMm));
    const wMm = (r.w / r.h) * hMm;
    const left = align === 'center' ? x - wMm / 2 : align === 'right' ? x - wMm : x;
    doc.addImage(r.data, 'PNG', left, y - hMm / 2, wMm, hMm, 'txt_' + Math.abs(hash(text + opts.color + r.h)), 'FAST');
    return;
  }
  doc.setTextColor(opts.color);
  doc.text(text, x, y, { align, baseline: 'middle' });
}

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}

function drawSymbolBadge(ctx: Ctx, item: SymbolItem | undefined, x: number, y: number, w: number, h: number, color: string) {
  if (drawImage(ctx, item?.image, x, y, w, h)) return;
  fitText(ctx, item?.label ?? '?', x + w / 2, y + h / 2, { size: h * PT_PER_MM * 0.55, maxW: w * 0.92, family: 'Heading', style: 'bold', color, align: 'center', cssFamily: ctx.theme.headingFont });
}

function drawCard(ctx: Ctx, cardNo: number, slot: { x: number; y: number; w: number; h: number }) {
  const { doc, game, pal } = ctx;
  const cfg = game.config;
  const n = cfg.size;
  const card = getCard(cfg, game.seed!, game.attempts, cardNo);
  const b = cardBox(slot, n);
  const lw = 0.35 * pal.lineWeight;

  // body
  doc.setLineDashPattern([], 0);
  doc.setDrawColor(pal.border);
  doc.setFillColor(pal.cardBg);
  doc.setLineWidth(lw * 2);
  doc.roundedRect(b.x, b.y, b.w, b.h, 3, 3, 'FD');
  if (ctx.theme.decor === 'deco') {
    doc.setLineWidth(lw * 0.6);
    doc.roundedRect(b.x + 1.2, b.y + 1.2, b.w - 2.4, b.h - 2.4, 2, 2, 'S');
  }

  // head: logo + event name + date
  const gx = b.x + b.pad;
  const gw = b.w - 2 * b.pad;
  let hy = b.y + b.pad;
  const logoSize = b.head * 0.9;
  let tx = gx;
  if (cfg.eventLogo && drawImage(ctx, cfg.eventLogo, gx, hy, logoSize, logoSize)) tx = gx + logoSize + b.pad * 0.6;
  const titleSize = b.head * PT_PER_MM * (cfg.eventDate ? 0.38 : 0.46);
  fitText(ctx, cfg.eventName, tx, hy + b.head * (cfg.eventDate ? 0.33 : 0.45), { size: titleSize, maxW: gx + gw - tx, family: 'Heading', style: 'bold', color: pal.title, cssFamily: ctx.theme.headingFont });
  if (cfg.eventDate)
    fitText(ctx, cfg.eventDate, tx, hy + b.head * 0.72, { size: titleSize * 0.55, maxW: gx + gw - tx, family: 'Sarabun', style: 'normal', color: pal.muted });

  // column headers
  hy = b.y + b.pad + b.head;
  doc.setFillColor(pal.headerBg);
  doc.rect(gx, hy, gw, b.colHead, 'F');
  if (cfg.mode === 'image') {
    fitText(ctx, 'B I N G O', gx + gw / 2, hy + b.colHead / 2, { size: b.colHead * PT_PER_MM * 0.6, maxW: gw * 0.9, family: 'Heading', style: 'bold', color: pal.headerText, align: 'center' });
  } else {
    for (let c = 0; c < n; c++) {
      const h = columnHeader(cfg, c);
      const cx = gx + c * b.cell;
      if (cfg.mode === 'columnLogo') drawSymbolBadge(ctx, h, cx + b.cell * 0.08, hy + b.colHead * 0.1, b.cell * 0.84, b.colHead * 0.8, pal.headerText);
      else fitText(ctx, h.label, cx + b.cell / 2, hy + b.colHead / 2, { size: b.colHead * PT_PER_MM * 0.72, maxW: b.cell * 0.9, family: 'Heading', style: 'bold', color: pal.headerText, align: 'center' });
    }
  }

  // grid
  const gy = hy + b.colHead;
  const numSize = b.cell * PT_PER_MM * 0.5;
  card.cells.forEach((v, i) => {
    const r = Math.floor(i / n);
    const c = i % n;
    const x = gx + c * b.cell;
    const y = gy + r * b.cell;
    if (v === 0) {
      doc.setFillColor(pal.freeBg);
      doc.rect(x, y, b.cell, b.cell, 'F');
      const drew = cfg.mode === 'number' && cfg.eventLogo && drawImage(ctx, cfg.eventLogo, x + b.cell * 0.12, y + b.cell * 0.12, b.cell * 0.76, b.cell * 0.76);
      if (!drew) fitText(ctx, 'FREE', x + b.cell / 2, y + b.cell / 2, { size: numSize * 0.5, maxW: b.cell * 0.8, family: 'Heading', style: 'bold', color: pal.freeText, align: 'center' });
    } else if (cfg.mode === 'image') {
      drawSymbolBadge(ctx, imageItem(cfg, v), x + b.cell * 0.1, y + b.cell * 0.1, b.cell * 0.8, b.cell * 0.8, pal.number);
    } else {
      doc.setFont('Heading', 'bold');
      doc.setFontSize(numSize);
      doc.setTextColor(pal.number);
      doc.text(String(v), x + b.cell / 2, y + b.cell / 2 + b.cell * 0.02, { align: 'center', baseline: 'middle' });
    }
  });
  doc.setDrawColor(pal.grid);
  doc.setLineWidth(lw);
  for (let k = 0; k <= n; k++) {
    doc.line(gx + k * b.cell, gy, gx + k * b.cell, gy + n * b.cell);
    doc.line(gx, gy + k * b.cell, gx + gw, gy + k * b.cell);
  }
  doc.setDrawColor(pal.border);
  doc.setLineWidth(lw * 1.8);
  doc.rect(gx, hy, gw, b.colHead + n * b.cell, 'S');

  // foot: rules hint + card number + check code
  const fy = gy + n * b.cell + b.foot * 0.62;
  fitText(ctx, t.print.rulesOnScreen, gx, fy, { size: b.foot * PT_PER_MM * 0.42, maxW: gw * 0.4, family: 'Sarabun', style: 'normal', color: pal.muted });
  const code = checkCode(game.seed!, cardNo);
  const codeSize = b.foot * PT_PER_MM * 0.55;
  doc.setFont('Heading', 'bold');
  doc.setFontSize(codeSize);
  const codeW = doc.getTextWidth(code) + 2.4;
  const codeX = gx + gw - codeW;
  doc.setDrawColor(pal.grid);
  doc.setLineWidth(lw);
  doc.roundedRect(codeX, fy - b.foot * 0.36, codeW, b.foot * 0.72, 0.8, 0.8, 'S');
  doc.setTextColor(pal.number);
  doc.text(code, codeX + codeW / 2, fy, { align: 'center', baseline: 'middle' });
  doc.setFontSize(b.foot * PT_PER_MM * 0.66);
  doc.setTextColor(pal.title);
  doc.text(formatCardNo(cardNo), codeX - 2, fy, { align: 'right', baseline: 'middle' });
}

function drawCutLines(doc: JsPDF, l: PageLayout) {
  doc.setLineDashPattern([1.5, 1.5], 0);
  doc.setDrawColor('#9a9a9a');
  doc.setLineWidth(0.15);
  for (let c = 1; c < l.cols; c++) {
    const x = l.margin + c * ((l.pageW - 2 * l.margin + l.gap) / l.cols) - l.gap / 2;
    doc.line(x, 2, x, l.pageH - 2);
  }
  for (let r = 1; r < l.rows; r++) {
    const y = l.margin + r * ((l.pageH - 2 * l.margin + l.gap) / l.rows) - l.gap / 2;
    doc.line(2, y, l.pageW - 2, y);
  }
  doc.setLineDashPattern([], 0);
}

export function pdfFileName(g: GameRecord, from: number, to: number) {
  const base = g.config.eventName.replace(/[^\p{L}\p{M}\p{N}]+/gu, '') || 'Bingo';
  return `${base}_cards_${String(from).padStart(4, '0')}-${String(to).padStart(4, '0')}.pdf`;
}

export type PdfResult = {
  files: number;
  /** lowest effective DPI of Thai text drawn as images (null if no string needed rasterizing) */
  textDpiMin: number | null;
};

/** Export cards [from..to]. Files are handed to `save` as they finish. */
export async function exportPdf(game: GameRecord, theme: Theme, opts: PdfOptions, save: (name: string, blob: Blob) => void): Promise<PdfResult> {
  minTextDpi = Infinity;
  if (!game.seed) throw new Error('cards not generated');
  const { jsPDF } = await import('jspdf');
  const cfg = game.config;
  const layout = LAYOUTS[cfg.size];
  const per = perPage(layout);
  const slots = pageSlots(layout);
  const pal = theme.print[opts.style];

  // pre-rasterize every image used (logo, column logos, item images)
  const refs = new Set<string>();
  if (cfg.eventLogo) refs.add(cfg.eventLogo);
  cfg.columns.forEach((c) => c.image && refs.add(c.image));
  if (cfg.mode === 'image') cfg.items.forEach((c) => c.image && refs.add(c.image));
  const images = new Map<string, Raster | null>();
  for (const r of refs) images.set(r, await rasterize(r, cfg.mode === 'image' ? 360 : 600));
  try {
    await document.fonts.load(`700 40px ${theme.headingFont}`);
    await document.fonts.load('400 40px Sarabun');
  } catch {
    /* system font fallback */
  }

  const total = opts.to - opts.from + 1;
  const totalPages = Math.ceil(total / per);
  const cardsPerFile = opts.pagesPerFile * per;
  let done = 0;
  let files = 0;
  for (let fileStart = opts.from; fileStart <= opts.to; fileStart += cardsPerFile) {
    const fileEnd = Math.min(opts.to, fileStart + cardsPerFile - 1);
    const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
    doc.setProperties({ title: `${cfg.eventName} — BINGO ${formatCardNo(fileStart)}-${formatCardNo(fileEnd)}`, creator: 'Bingo Host' });
    await registerFonts(doc, theme);
    const ctx: Ctx = { doc, game, pal, theme, images, aliases: new Set() };
    let first = true;
    for (let pageStart = fileStart; pageStart <= fileEnd; pageStart += per) {
      if (opts.signal?.aborted) throw new DOMException('aborted', 'AbortError');
      if (!first) doc.addPage();
      first = false;
      if (pal.pageBg !== '#ffffff') {
        doc.setFillColor(pal.pageBg);
        doc.rect(0, 0, layout.pageW, layout.pageH, 'F');
      }
      for (let k = 0; k < per && pageStart + k <= fileEnd; k++) drawCard(ctx, pageStart + k, slots[k]);
      if (opts.cutLines) drawCutLines(doc, layout);
      done++;
      opts.onProgress?.(done, totalPages);
      // yield to keep the UI responsive
      if (done % 2 === 0) await new Promise((r) => setTimeout(r, 0));
    }
    save(pdfFileName(game, fileStart, fileEnd), doc.output('blob'));
    files++;
    await new Promise((r) => setTimeout(r, 30));
  }
  return { files, textDpiMin: Number.isFinite(minTextDpi) ? Math.round(minTextDpi) : null };
}
