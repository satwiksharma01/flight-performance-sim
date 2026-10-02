/**
 * One performance chart, drawn with uPlot.
 *
 * uPlot draws to canvas and redraws in well under a frame, which is what keeps
 * a slider drag at 60 fps with three charts on screen. The instance is created
 * once and fed new data on every render; it is rebuilt only when the chart's
 * structure changes (its series, labels, or the colour scheme).
 *
 * Everything uPlot doesn't draw natively is painted in its hooks:
 * - under the series: shaded bands (below stall, beyond the model) and the
 *   characteristic-speed hairlines
 * - over them: marker labels in the top padding, the selected point, and
 *   direct labels placed where each line is furthest from its neighbours
 */

import { useEffect, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';

export interface ChartSeries {
  readonly label: string;
  readonly values: readonly number[];
  /** CSS custom property holding the stroke colour, e.g. `--series-1` */
  readonly colorVar: string;
  /** Dash pattern in CSS pixels; solid when omitted */
  readonly dash?: readonly number[];
  /** Text drawn beside the line. Omit for single-series charts, where the title names it */
  readonly directLabel?: string;
}

export interface ChartMarker {
  readonly x: number;
  /** Rendered as a symbol with a subscript: V + md */
  readonly symbol: string;
  readonly subscript: string;
  /** Unattainable markers are drawn dashed and muted */
  readonly attainable: boolean;
}

export interface ChartBand {
  readonly from: number;
  readonly to: number;
  readonly label: string;
}

export interface ChartProps {
  readonly title: string;
  /** One sentence on what the chart shows; also the canvas's accessible name */
  readonly description: string;
  readonly x: readonly number[];
  readonly series: readonly ChartSeries[];
  readonly xMax: number;
  readonly yMax: number;
  readonly xLabel: string;
  readonly yLabel: string;
  readonly formatX: (value: number) => string;
  readonly formatY: (value: number) => string;
  readonly markers: readonly ChartMarker[];
  readonly bands: readonly ChartBand[];
  /** Selected speed on the x-axis, and each series' value there */
  readonly selectedX: number;
  readonly selectedY: readonly number[];
  readonly emptyReason: string | null;
  readonly height: number;
  /** Changing this rebuilds the chart with freshly read colours */
  readonly theme: string;
  /** Called with an x-axis value when the chart is clicked or dragged */
  readonly onPick: (x: number) => void;
  readonly wide?: boolean;
}

interface Theme {
  readonly ink: string;
  readonly ink2: string;
  readonly muted: string;
  readonly grid: string;
  readonly axis: string;
  readonly surface: string;
  readonly band: string;
  readonly series: readonly string[];
}

const FONT_FAMILY = 'system-ui, -apple-system, "Segoe UI", sans-serif';
/** Room above the plot for two staggered rows of marker labels [CSS px] */
const TOP_PADDING = 42;
const LABEL_ROW = 17;

function readTheme(series: readonly ChartSeries[]): Theme {
  const style = getComputedStyle(document.documentElement);
  const v = (name: string) => style.getPropertyValue(name).trim();
  return {
    ink: v('--ink'),
    ink2: v('--ink-2'),
    muted: v('--muted'),
    grid: v('--grid'),
    axis: v('--axis'),
    surface: v('--surface'),
    band: v('--band'),
    series: series.map((s) => v(s.colorVar)),
  };
}

function toData(props: ChartProps): uPlot.AlignedData {
  return [props.x as number[], ...props.series.map((s) => s.values as number[])];
}

/** Text with a halo in the surface colour, so it stays legible over lines. */
function haloText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, surface: string) {
  ctx.lineWidth = 3 * uPlot.pxRatio;
  ctx.strokeStyle = surface;
  ctx.lineJoin = 'round';
  ctx.strokeText(text, x, y);
  ctx.fillText(text, x, y);
}

export function Chart(props: ChartProps) {
  const host = useRef<HTMLDivElement>(null);
  const plot = useRef<uPlot | null>(null);
  const latest = useRef(props);
  latest.current = props;

  const structure = [
    props.theme,
    props.height,
    props.xLabel,
    props.yLabel,
    ...props.series.map((s) => `${s.label}|${s.colorVar}|${s.dash?.join(',') ?? ''}|${s.directLabel ?? ''}`),
  ].join('§');

  useEffect(() => {
    const el = host.current;
    if (!el) return;

    const theme = readTheme(latest.current.series);
    // Canvas pixels per CSS pixel are read on every draw, never cached here:
    // the ratio changes when the window moves to a screen of another density.
    const font = (size: number, weight = 400) =>
      `${weight} ${Math.round(size * uPlot.pxRatio)}px ${FONT_FAMILY}`;
    const cssFont = (size: number, weight = 400) => `${weight} ${size}px ${FONT_FAMILY}`;

    const axisStyle = {
      stroke: theme.muted,
      font: cssFont(11),
      labelFont: cssFont(12),
      grid: { stroke: theme.grid, width: 1 },
      ticks: { stroke: theme.axis, width: 1, size: 4 },
    };

    /** Bands and characteristic-speed hairlines, under everything else. */
    function drawUnder(u: uPlot) {
      const { ctx, bbox } = u;
      const px = uPlot.pxRatio;
      const p = latest.current;
      ctx.save();

      for (const band of p.bands) {
        const x0 = Math.max(u.valToPos(band.from, 'x', true), bbox.left);
        const x1 = Math.min(u.valToPos(band.to, 'x', true), bbox.left + bbox.width);
        if (x1 <= x0) continue;
        ctx.fillStyle = theme.band;
        ctx.fillRect(x0, bbox.top, x1 - x0, bbox.height);
      }

      ctx.lineWidth = px;
      for (const m of p.markers) {
        const x = Math.round(u.valToPos(m.x, 'x', true)) + 0.5;
        if (x < bbox.left || x > bbox.left + bbox.width) continue;
        ctx.strokeStyle = m.attainable ? theme.ink2 : theme.muted;
        ctx.setLineDash(m.attainable ? [] : [3 * px, 3 * px]);
        ctx.beginPath();
        ctx.moveTo(x, bbox.top - 4 * px);
        ctx.lineTo(x, bbox.top + bbox.height);
        ctx.stroke();
      }

      ctx.restore();
    }

    /** Labels, the selected point and direct labels, over the series. */
    function drawOver(u: uPlot) {
      const { ctx, bbox } = u;
      const px = uPlot.pxRatio;
      const p = latest.current;
      const right = bbox.left + bbox.width;
      ctx.save();
      // uPlot leaves its own text state on the context; set ours explicitly.
      ctx.textBaseline = 'alphabetic';
      ctx.textAlign = 'left';

      // Marker labels, in the top padding: V with a subscript, staggered into
      // rows so labels for close speeds (V_s and V_mp often are) never overlap.
      const rowEnds: number[] = [];
      const sorted = [...p.markers].sort((a, b) => a.x - b.x);
      for (const m of sorted) {
        const x = u.valToPos(m.x, 'x', true);
        if (x < bbox.left || x > right) continue;

        ctx.font = font(12, 600);
        const wMain = ctx.measureText(m.symbol).width;
        ctx.font = font(9.5, 600);
        const wSub = ctx.measureText(m.subscript).width;
        const width = wMain + wSub + px;
        const start = Math.min(Math.max(x - width / 2, bbox.left), right - width);

        let row = rowEnds.findIndex((end) => start > end + 6 * px);
        if (row === -1) row = rowEnds.length;
        rowEnds[row] = start + width;

        const y = bbox.top - (8 + row * LABEL_ROW) * px;
        ctx.fillStyle = m.attainable ? theme.ink : theme.muted;
        ctx.font = font(12, 600);
        ctx.fillText(m.symbol, start, y);
        ctx.font = font(9.5, 600);
        ctx.fillText(m.subscript, start + wMain + px, y + 3 * px);
      }

      // Band labels, at the bottom of their band.
      ctx.font = font(11);
      ctx.fillStyle = theme.ink2;
      for (const band of p.bands) {
        const x0 = Math.max(u.valToPos(band.from, 'x', true), bbox.left);
        const x1 = Math.min(u.valToPos(band.to, 'x', true), right);
        const w = ctx.measureText(band.label).width;
        if (x1 - x0 < w + 12 * px) continue;
        ctx.textAlign = 'left';
        haloText(ctx, band.label, x0 + 6 * px, bbox.top + bbox.height - 7 * px, theme.surface);
      }

      // Direct labels: for each line, try a spread of positions and keep the
      // one furthest from every other line, then sit on the far side from the
      // nearest neighbour. Positions near the selected point are skipped, so a
      // label never sits on its dots.
      const n = p.x.length;
      const selectedPx = u.valToPos(p.selectedX, 'x', true);
      if (n > 1) {
        ctx.font = font(11.5, 500);
        ctx.fillStyle = theme.ink2;
        p.series.forEach((s, i) => {
          if (!s.directLabel) return;
          const w = ctx.measureText(s.directLabel).width;
          let best: { gap: number; x: number; y: number; above: boolean } | null = null;

          for (let f = 0.12; f <= 0.9; f += 0.06) {
            const idx = Math.round(f * (n - 1));
            const xv = p.x[idx];
            const yv = s.values[idx];
            if (xv === undefined || yv === undefined) continue;
            const x = u.valToPos(xv, 'x', true);
            const y = u.valToPos(yv, 'y', true);
            if (x - w / 2 < bbox.left || x + w / 2 > right || y < bbox.top || y > bbox.top + bbox.height) continue;
            if (Math.abs(x - selectedPx) < w / 2 + 10 * px) continue;

            let gap = Infinity;
            let above = true;
            p.series.forEach((other, j) => {
              const ov = other.values[idx];
              if (j === i || ov === undefined) return;
              const oy = u.valToPos(ov, 'y', true);
              if (Math.abs(oy - y) < gap) {
                gap = Math.abs(oy - y);
                above = oy > y; // neighbour below on screen, so label goes above
              }
            });
            if (!best || gap > best.gap) best = { gap, x, y, above };
          }

          if (best) {
            // Keep the text inside the plot: flip sides rather than spill onto
            // the axis tick labels.
            const aboveY = best.y - 8 * px;
            const belowY = best.y + 17 * px;
            const fitsAbove = aboveY - 12 * px >= bbox.top;
            const fitsBelow = belowY <= bbox.top + bbox.height - 3 * px;
            const ty = (best.above && fitsAbove) || !fitsBelow ? aboveY : belowY;
            ctx.textAlign = 'center';
            haloText(ctx, s.directLabel, best.x, ty, theme.surface);
          }
        });
      }

      // The selected point: a hairline and a ringed dot on each line.
      const sx = u.valToPos(p.selectedX, 'x', true);
      if (sx >= bbox.left && sx <= right) {
        ctx.strokeStyle = theme.ink;
        ctx.lineWidth = 1.5 * px;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(sx, bbox.top);
        ctx.lineTo(sx, bbox.top + bbox.height);
        ctx.stroke();

        p.selectedY.forEach((yv, i) => {
          const sy = u.valToPos(yv, 'y', true);
          if (sy < bbox.top || sy > bbox.top + bbox.height) return;
          ctx.beginPath();
          ctx.arc(sx, sy, 4.5 * px, 0, 2 * Math.PI);
          ctx.fillStyle = theme.series[i] ?? theme.ink;
          ctx.lineWidth = 2 * px;
          ctx.strokeStyle = theme.surface;
          ctx.fill();
          ctx.stroke();
        });
      }

      ctx.restore();
    }

    const options: uPlot.Options = {
      width: el.clientWidth || 600,
      height: latest.current.height,
      padding: [TOP_PADDING, 12, 0, 0],
      scales: {
        x: { time: false, auto: false, range: () => [0, latest.current.xMax] },
        y: { auto: false, range: () => [0, latest.current.yMax] },
      },
      axes: [
        {
          ...axisStyle,
          label: latest.current.xLabel,
          labelSize: 22,
          values: (_u, splits) => splits.map((v) => latest.current.formatX(v)),
        },
        {
          ...axisStyle,
          label: latest.current.yLabel,
          labelSize: 22,
          size: 52,
          values: (_u, splits) => splits.map((v) => latest.current.formatY(v)),
        },
      ],
      series: [
        {
          label: latest.current.xLabel,
          value: (_u, v) => (v == null ? '–' : latest.current.formatX(v)),
        },
        ...latest.current.series.map((s, i) => ({
          label: s.label,
          stroke: theme.series[i] ?? theme.ink,
          width: 2,
          ...(s.dash ? { dash: [...s.dash] } : {}),
          points: { show: false },
          value: (_u: uPlot, v: number | null) => (v == null ? '–' : latest.current.formatY(v)),
        })),
      ],
      cursor: {
        sync: { key: 'performance' },
        drag: { x: false, y: false, setScale: false },
        points: {
          size: 9,
          width: 2,
          fill: (_u, i) => theme.series[i - 1] ?? theme.ink,
          stroke: () => theme.surface,
        },
      },
      legend: { live: true },
      hooks: { drawClear: [drawUnder], draw: [drawOver] },
    };

    const u = new uPlot(options, toData(latest.current), el);
    u.setScale('x', { min: 0, max: latest.current.xMax });
    u.setScale('y', { min: 0, max: latest.current.yMax });
    plot.current = u;

    // Click or drag anywhere on the plot to choose the selected speed.
    const over = u.over;
    let dragging = false;
    const pick = (e: PointerEvent) => {
      const rect = over.getBoundingClientRect();
      const { xMax, onPick } = latest.current;
      const x = u.posToVal(e.clientX - rect.left, 'x');
      onPick(Math.min(Math.max(x, xMax / 1000), xMax));
    };
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      dragging = true;
      over.setPointerCapture(e.pointerId);
      pick(e);
    };
    const move = (e: PointerEvent) => {
      if (dragging) pick(e);
    };
    const up = (e: PointerEvent) => {
      dragging = false;
      if (over.hasPointerCapture(e.pointerId)) over.releasePointerCapture(e.pointerId);
    };
    over.addEventListener('pointerdown', down);
    over.addEventListener('pointermove', move);
    over.addEventListener('pointerup', up);
    over.addEventListener('pointercancel', up);

    let width = el.clientWidth;
    const resize = new ResizeObserver(() => {
      if (el.clientWidth === width) return;
      width = el.clientWidth;
      u.setSize({ width, height: latest.current.height });
    });
    resize.observe(el);

    return () => {
      resize.disconnect();
      u.destroy();
      plot.current = null;
    };
  }, [structure]);

  // Every render: new data, same instance.
  useEffect(() => {
    const u = plot.current;
    if (!u) return;
    u.batch(() => {
      u.setData(toData(props), false);
      u.setScale('x', { min: 0, max: props.xMax });
      u.setScale('y', { min: 0, max: props.yMax });
    });
  });

  return (
    <figure className={props.wide ? 'card chart chart--wide' : 'card chart'}>
      <figcaption>
        <h3>{props.title}</h3>
        <p>{props.description}</p>
      </figcaption>
      <div className="chart-host" ref={host} role="img" aria-label={`${props.title}. ${props.description}`} />
      {props.emptyReason && <p className="chart-empty">{props.emptyReason}</p>}
    </figure>
  );
}
