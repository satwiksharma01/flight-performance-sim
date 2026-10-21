import { describe, expect, it } from 'vitest';
import { chartCsv, fileName, type CsvInput } from '../src/app/chart-export.js';

const rows = (csv: string) => csv.split('\r\n').slice(0, -1);

const base: CsvInput = {
  xLabel: 'TAS (kt)',
  yLabel: 'Power (kW)',
  x: [40, 60, 80],
  series: [
    { label: 'Power required', values: [50.123456789, 40, null], colorVar: '--series-1' },
    { label: 'Power available, full throttle', values: [90, 100, 110], colorVar: '--series-2' },
  ],
};

describe('chart CSV', () => {
  it('puts each series in a column, in the units on the y-axis, to six figures', () => {
    expect(rows(chartCsv(base))).toEqual([
      'TAS (kt),Power required (kW),"Power available, full throttle (kW)"',
      '40,50.1235,90',
      '60,40,100',
      '80,,110',
    ]);
  });

  it('ends every line with CRLF and quotes what needs it', () => {
    const csv = chartCsv({ ...base, series: [{ label: 'The "best" line', values: [1, 2, 3], colorVar: '--a' }] });
    expect(csv.endsWith('\r\n')).toBe(true);
    expect(rows(csv)[0]).toBe('TAS (kt),"The ""best"" line (kW)"');
  });

  it('merges the comparison aircraft on x, with blanks where a series has no sample', () => {
    const csv = chartCsv({ ...base, overlay: { x: [50, 60], series: [{ label: 'Power required, Jet', values: [70, 75], colorVar: '--compare' }] } });
    expect(rows(csv)).toEqual([
      'TAS (kt),Power required (kW),"Power available, full throttle (kW)","Power required, Jet (kW)"',
      '40,50.1235,90,',
      '50,,,70',
      '60,40,100,75',
      '80,,110,',
    ]);
  });

  it('adds a filled region as two columns, and leaves out a unit the axis lacks', () => {
    const csv = chartCsv({ ...base, yLabel: 'Load factor n', series: [base.series[0]!], fill: { upper: [1, 2, 3], lower: [-1, -1, NaN], colorVar: '--e' } });
    expect(rows(csv)).toEqual([
      'TAS (kt),Power required,"Shaded region, upper","Shaded region, lower"',
      '40,50.1235,1,-1',
      '60,40,2,-1',
      '80,,3,',
    ]);
  });

  it('lists a contour chart’s points, a row each', () => {
    const csv = chartCsv({
      xLabel: 'TAS (kt)',
      yLabel: 'Pressure altitude (ft)',
      x: [0, 200],
      series: [],
      paths: [
        { label: 'Pₛ = 0', colorVar: '--ink', lines: [[[100, 0], [90, 5000]], [[120, 0]]] },
        { colorVar: '--muted', lines: [[[1, 2]]] },
      ],
    });
    expect(rows(csv)).toEqual(['Line,Piece,TAS (kt),Pressure altitude (ft)', 'Pₛ = 0,1,100,0', 'Pₛ = 0,1,90,5000', 'Pₛ = 0,2,120,0', ',1,1,2']);
  });

  it('names the file after the chart', () => {
    expect(fileName('Takeoff distance', 'csv')).toBe('takeoff-distance.csv');
    expect(fileName('V-n diagram', 'png')).toBe('v-n-diagram.png');
    expect(fileName('Pₛ', 'png')).toBe('p.png');
  });
});
