// Pure helpers the viz components share: linear scales, an SVG line path, number and share formatting.

export const linear =
  (domainMax: number, rangeMax: number) =>
  (v: number): number =>
    domainMax <= 0 ? 0 : (v / domainMax) * rangeMax;

export function path(values: number[], width: number, height: number, max?: number): string {
  if (!values.length) return "";
  const top = max ?? Math.max(...values, 0);
  const y = linear(top, height);
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  return values
    .map((v, i) => `${i ? "L" : "M"}${Math.round(i * step)},${Math.round(height - y(v))}`)
    .join(" ");
}

export const fmt = (v: number): string =>
  (Math.round(v * 10) / 10).toLocaleString("en-US", { maximumFractionDigits: 1 });

export const share = (part: number, whole: number): string =>
  whole <= 0 ? "–" : `${Math.round((part / whole) * 100)}%`;
