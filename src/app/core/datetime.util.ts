import { AppDateTime } from './models';

/** Parse PostgREST composite "(y,m,d,h,mi,s,ms)" or object. */
export function parseAppDateTime(value: AppDateTime | string | null | undefined): AppDateTime | null {
  if (value == null || value === '') {
    return null;
  }
  if (typeof value === 'object') {
    return value;
  }
  const m = /^\((\d+),(\d+),(\d+),(\d+),(\d+),(\d+),(\d+)\)$/.exec(value.trim());
  if (!m) {
    return null;
  }
  return {
    year: +m[1],
    month: +m[2],
    day: +m[3],
    hour: +m[4],
    minute: +m[5],
    second: +m[6],
    millisecond: +m[7],
  };
}

export function formatAppDate(value: AppDateTime | string | null | undefined): string {
  const d = parseAppDateTime(value);
  if (!d || (d.year === 0 && d.month === 0 && d.day === 0)) {
    return '';
  }
  const day = d.day === 0 ? '??' : String(d.day).padStart(2, '0');
  const month = d.month === 0 ? '??' : String(d.month).padStart(2, '0');
  if (d.month === 0 && d.day === 0) {
    return String(d.year);
  }
  return `${day}.${month}.${d.year}`;
}
