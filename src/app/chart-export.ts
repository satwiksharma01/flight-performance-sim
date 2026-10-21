/**
 * A chart's export: its data as CSV, and the picture as PNG.
 *
 * The CSV holds what the chart plots, in the units on its axes, so a
 * spreadsheet draws the same curves from it. Series share the x column; the
 * comparison aircraft's samples are merged in, with blanks where a series has
 * no value. A chart drawn only as polylines (the P_s contours) lists their
 * points instead, a row each.
 *
 * The PNG is the chart's own canvas on the card's background, with its title,
 * a key to its lines, and the scenario's link, so the image says what it shows.
 */

import type { ChartProps } from './components/Chart.js';

export type CsvInput = Pick<ChartProps, 'xLabel' | 'yLabel' | 'x' | 'series' | 'overlay' | 'fill' | 'paths'>;

/** Significant figures a CSV number keeps: past the model's own accuracy. */
const FIGURES = 6;

function cell(value: string | number | null | undefined): string {
  if (typeof value === 'number') return Number.isFinite(value) ? String(Number(value.toPrecision(FIGURES))) : '';
  if (value == null) return '';
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

const row = (cells: readonly (string | number | null | undefined)[]) => cells.map(cell).join(',');

/** The unit an axis label ends with, as " (ft/min)"; empty when it has none. */
const unitOf = (label: string) => / \([^()]*\)$/.exec(label)?.[0] ?? '';

/** RFC 4180 lines: comma-separated, CRLF-terminated. */
export function chartCsv(c: CsvInput): string {
  const lines: string[] = [];
  if (c.series.length === 0 && c.paths?.length) {
    lines.push(row(['Line', 'Piece', c.xLabel, c.yLabel]));
    for (const path of c.paths) {
      path.lines.forEach((line, piece) => line.forEach(([x, y]) => lines.push(row([path.label ?? '', piece + 1, x, y]))));
    }
  } else {
    const unit = unitOf(c.yLabel);
    const columns = [
      ...c.series.map((s) => ({ label: s.label, x: c.x, values: s.values })),
      ...(c.fill
        ? [
            { label: 'Shaded region, upper', x: c.x, values: c.fill.upper },
            { label: 'Shaded region, lower', x: c.x, values: c.fill.lower },
          ]
        : []),
      ...(c.overlay?.series.map((s) => ({ label: s.label, x: c.overlay!.x, values: s.values })) ?? []),
    ];
    const at = columns.map((col) => new Map(col.x.map((x, i) => [x, col.values[i]])));
    const xs = [...new Set([...c.x, ...(c.overlay?.x ?? [])])].sort((a, b) => a - b);
    lines.push(row([c.xLabel, ...columns.map((col) => `${col.label}${unit}`)]));
    for (const x of xs) lines.push(row([x, ...at.map((values) => values.get(x))]));
  }
  return lines.map((line) => `${line}\r\n`).join('');
}

/** A file name from a chart's title: "Takeoff distance" → "takeoff-distance". */
export function fileName(title: string, extension: 'csv' | 'png'): string {
  const base = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${base || 'chart'}.${extension}`;
}

/** Save a blob under a name, through a temporary link. */
export function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function downloadCsv(c: CsvInput, title: string): void {
  // The byte-order mark makes Excel read the file as UTF-8, so °, μ and subscripts survive.
  download(new Blob(['﻿', chartCsv(c)], { type: 'text/csv;charset=utf-8' }), fileName(title, 'csv'));
}

export interface KeyEntry {
  readonly label: string;
  readonly color: string;
  readonly dash?: readonly number[] | undefined;
  readonly points?: boolean | undefined;
}

export interface PngInput {
  /** The chart's canvas, drawn at `ratio` canvas pixels per CSS pixel */
  readonly canvas: HTMLCanvasElement;
  readonly ratio: number;
  readonly title: string;
  readonly key: readonly KeyEntry[];
  readonly footer: string;
  readonly font: string;
  readonly colors: { readonly surface: string; readonly ink: string; readonly muted: string };
}

/** The chart as an image: title, key, the plot, and a footer. */
export function chartPng({ canvas, ratio: r, title, key, footer, font, colors }: PngInput): Promise<Blob | null> {
  const pad = 16 * r;
  const width = canvas.width + 2 * pad;
  const swatch = 22 * r;
  const keyRow = 18 * r;

  const out = document.createElement('canvas');
  const ctx = out.getContext('2d')!;
  // Lay the key out first, wrapping at the plot's width, to know how tall it is.
  ctx.font = `500 ${12 * r}px ${font}`;
  const placed: { entry: KeyEntry; x: number; row: number }[] = [];
  let x = 0;
  let rows = key.length > 0 ? 1 : 0;
  for (const entry of key) {
    const w = swatch + 6 * r + ctx.measureText(entry.label).width + 18 * r;
    if (x > 0 && x + w > canvas.width) {
      x = 0;
      rows++;
    }
    placed.push({ entry, x, row: rows - 1 });
    x += w;
  }

  const plotTop = pad + 24 * r + rows * keyRow + (rows ? 6 * r : 0);
  out.width = width;
  out.height = plotTop + canvas.height + 28 * r;

  ctx.fillStyle = colors.surface;
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = colors.ink;
  ctx.font = `650 ${15 * r}px ${font}`;
  ctx.fillText(title, pad, pad + 14 * r);

  ctx.font = `500 ${12 * r}px ${font}`;
  for (const { entry, x: kx, row: kr } of placed) {
    const cy = pad + 30 * r + kr * keyRow;
    ctx.strokeStyle = entry.color;
    ctx.fillStyle = entry.color;
    if (entry.points) {
      ctx.beginPath();
      ctx.arc(pad + kx + swatch / 2, cy, 3.5 * r, 0, 2 * Math.PI);
      ctx.lineWidth = 1.5 * r;
      ctx.stroke();
    } else {
      ctx.lineWidth = 2 * r;
      ctx.setLineDash(entry.dash ? entry.dash.map((d) => d * r) : []);
      ctx.beginPath();
      ctx.moveTo(pad + kx, cy);
      ctx.lineTo(pad + kx + swatch, cy);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.fillStyle = colors.ink;
    ctx.fillText(entry.label, pad + kx + swatch + 6 * r, cy + 4 * r);
  }

  ctx.drawImage(canvas, pad, plotTop);

  ctx.fillStyle = colors.muted;
  ctx.font = `${11 * r}px ${font}`;
  ctx.fillText(footer, pad, out.height - 10 * r, canvas.width);
  return new Promise((resolve) => out.toBlob(resolve, 'image/png'));
}
