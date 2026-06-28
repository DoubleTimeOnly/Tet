export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export function randomRgb(): Rgb {
  return {
    r: Math.floor(Math.random() * 256),
    g: Math.floor(Math.random() * 256),
    b: Math.floor(Math.random() * 256),
  };
}

/** Standard RGB → HSV, all components in [0, 1]. */
function rgbToHsv({ r, g, b }: Rgb): { h: number; s: number; v: number } {
  const rr = r / 255, gg = g / 255, bb = b / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const d = max - min;
  const s = max === 0 ? 0 : d / max;
  const v = max;
  let h = 0;
  if (d !== 0) {
    if (max === rr) h = ((gg - bb) / d + (gg < bb ? 6 : 0)) / 6;
    else if (max === gg) h = ((bb - rr) / d + 2) / 6;
    else h = ((rr - gg) / d + 4) / 6;
  }
  return { h, s, v };
}

/** Scalar sort key: hue primary, saturation secondary, value tertiary. */
export function hsvSortKey(rgb: Rgb): number {
  const { h, s, v } = rgbToHsv(rgb);
  return h * 1_000_000 + s * 1_000 + v;
}

export function rgbToHex({ r, g, b }: Rgb): string {
  return (
    "#" +
    r.toString(16).padStart(2, "0") +
    g.toString(16).padStart(2, "0") +
    b.toString(16).padStart(2, "0")
  );
}
