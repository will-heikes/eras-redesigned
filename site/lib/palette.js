// Pick an accent color from an album cover so each era's page matches its artwork.
// Reads the image through a canvas (upload.wikimedia.org sends CORS headers), finds
// the strongest saturated hue, and darkens it enough to read as text on white.

const KEY = "eras:palette:";

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

export const hsl = (h, s, l) => `hsl(${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`;

export function pickAccent(data) {
  const bins = Array.from({ length: 24 }, () => ({ w: 0, h: 0, s: 0, l: 0 }));
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const [h, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
    if (s < 0.2 || l < 0.12 || l > 0.92) continue;
    const w = s * (1 - Math.abs(l - 0.5) * 1.4);
    const b = bins[Math.floor(h / 15) % 24];
    b.w += w; b.h += h * w; b.s += s * w; b.l += l * w;
  }
  const best = bins.reduce((a, b) => (b.w > a.w ? b : a));
  if (best.w < 1) return null;
  const h = best.h / best.w, s = best.s / best.w;
  // text-safe on white: saturated, mid-dark
  return { h, s: Math.max(0.55, Math.min(0.9, s)), l: 0.44 };
}

export function coverAccent(url) {
  return new Promise((resolve) => {
    if (!url) return resolve(null);
    try { const c = localStorage.getItem(KEY + url); if (c) return resolve(JSON.parse(c)); } catch {}
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const c = document.createElement("canvas");
        c.width = c.height = 48;
        const ctx = c.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, 48, 48);
        const a = pickAccent(ctx.getImageData(0, 0, 48, 48).data);
        try { if (a) localStorage.setItem(KEY + url, JSON.stringify(a)); } catch {}
        resolve(a);
      } catch { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

// Set the page's accent (and everything derived from it) from a {h,s,l} color.
export function applyAccent(a, prop = "--accent") {
  if (!a) return;
  document.documentElement.style.setProperty(prop, hsl(a.h, a.s, a.l));
}
