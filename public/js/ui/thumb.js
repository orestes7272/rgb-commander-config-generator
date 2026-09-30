import { radiusOf } from '../core/layouts.js';
import { getControlColor } from '../core/project.js';
import { ledToScreen, cssRgb, isOff } from '../core/color.js';
import { h } from '../dom.js';

/** Small canvas preview of a frame. */
export function drawThumb(canvas, layout, controls, pins, { previewMode = 'led', cssWidth = 120 } = {}) {
  const pad = 8;
  const w = layout.width + pad * 2;
  const hgt = layout.height + pad * 2;
  const cssHeight = Math.round((cssWidth * hgt) / w);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (canvas.width !== Math.round(cssWidth * dpr)) {
    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;
  }
  const ctx = canvas.getContext('2d');
  const k = canvas.width / w;
  ctx.setTransform(k, 0, 0, k, pad * k, pad * k);
  ctx.clearRect(-pad, -pad, w, hgt);
  ctx.fillStyle = '#121318';
  roundRect(ctx, 0, 0, layout.width, layout.height, 14);
  ctx.fill();
  for (const c of controls) {
    const r = radiusOf(c) * (c.kind === 'led' ? 1.4 : 1);
    const rgb = pins && c.pins ? getControlColor(pins, c.pins) : null;
    if (rgb && !isOff(rgb)) {
      const fill = cssRgb(ledToScreen(rgb, previewMode));
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.arc(c.x, c.y, r * 1.7, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = fill;
    } else {
      ctx.fillStyle = c.pins ? '#2f323b' : '#1e2027';
    }
    ctx.beginPath();
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  return canvas;
}

function roundRect(ctx, x, y, w, hgt, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + hgt, r);
  ctx.arcTo(x + w, y + hgt, x, y + hgt, r);
  ctx.arcTo(x, y + hgt, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function thumb(layout, controls, pins, options) {
  return drawThumb(h('canvas.thumb'), layout, controls, pins, options);
}
