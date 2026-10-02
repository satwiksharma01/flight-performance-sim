/**
 * Display formatting. SI stays inside the physics; this is where numbers meet
 * the units a pilot reads.
 */

import type { AirspeedSet } from '../physics/index.js';
import { axisValue, toUnit, type SpeedAxis, type SpeedUnit, type ViewSettings } from './model.js';

const FT_PER_M = 1 / 0.3048;
const HP_PER_KW = 1 / 0.745699872;

export const AXIS_NAME: Record<SpeedAxis, string> = {
  tas: 'TAS',
  eas: 'EAS',
  cas: 'CAS',
  mach: 'Mach',
};

export const UNIT_NAME: Record<SpeedUnit, string> = {
  kt: 'kt',
  mps: 'm/s',
  kmh: 'km/h',
};

/** Fixed decimals with thousands separators. Negative zero prints as 0. */
export function num(value: number, decimals = 0): string {
  const rounded = Number(value.toFixed(decimals));
  return (Object.is(rounded, -0) ? 0 : rounded).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** Signed, for deviations: +15, −3, 0. Uses a true minus sign. */
export function signed(value: number, decimals = 0): string {
  const text = num(Math.abs(value), decimals);
  if (Number(text.replace(/,/g, '')) === 0) return text;
  return value > 0 ? `+${text}` : `−${text}`;
}

export function feet(metres: number): string {
  return `${num(metres * FT_PER_M)} ft`;
}

export function horsepower(kilowatts: number): string {
  return `${num(kilowatts * HP_PER_KW)} hp`;
}

/** Decimals that suit a speed unit: whole knots, tenths of m/s. */
function speedDecimals(unit: SpeedUnit): number {
  return unit === 'mps' ? 1 : 0;
}

/** One speed in a unit, e.g. "72 kt". Mach is formatted by {@link mach}. */
export function speed(metresPerSecond: number, unit: SpeedUnit): string {
  return `${num(toUnit(metresPerSecond, unit), speedDecimals(unit))} ${UNIT_NAME[unit]}`;
}

export function mach(value: number): string {
  return `M ${num(value, 3)}`;
}

/** A speed as the x-axis shows it, e.g. "72 kt TAS" or "M 0.412". */
export function axisSpeed(speeds: AirspeedSet, view: ViewSettings): string {
  if (view.axis === 'mach') return mach(speeds.mach);
  return `${num(axisValue(speeds, view), speedDecimals(view.unit))} ${UNIT_NAME[view.unit]} ${AXIS_NAME[view.axis]}`;
}

/** The x-axis label. */
export function axisLabel(view: ViewSettings): string {
  if (view.axis === 'mach') return 'Mach number';
  return `${AXIS_NAME[view.axis]} (${UNIT_NAME[view.unit]})`;
}

/** Tick text for the x-axis. */
export function axisTick(value: number, view: ViewSettings): string {
  return view.axis === 'mach' ? num(value, 2) : num(value);
}

/** Compact tick text for a y-axis: 1,500 / 12k / 0.5. */
export function tick(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 10000) return `${num(value / 1000)}k`;
  if (abs >= 100 || Number.isInteger(value)) return num(value);
  return num(value, abs >= 10 ? 0 : 1);
}
