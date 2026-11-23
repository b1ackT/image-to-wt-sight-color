(function (root) {
  'use strict';
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  function convert(image, options = {}) {
    const { width: sw, height: sh, data } = image;
    if (!Number.isInteger(sw) || !Number.isInteger(sh) || sw < 1 || sh < 1 || data.length !== sw * sh * 4) throw Error('无效的图片像素数据');
    const requested = clamp(Math.round(options.resolution || 128), 1, 256);
    const budget = clamp(Math.round(options.budget || 2000), 1, 20000);
    const levels = clamp(Math.round(options.levels || 8), 2, 256);
    const alphaThreshold = clamp(options.alphaThreshold ?? 16, 0, 255);
    const whiteThreshold = options.removeWhite ? clamp(options.whiteThreshold ?? 245, 0, 255) : 256;
    const quant = (v, n) => Math.round(Math.round(v * (n - 1) / 255) * 255 / (n - 1));
    let resolution = requested, result;
    do {
      const scale = Math.min(1, resolution / Math.max(sw, sh));
      const width = Math.max(1, Math.round(sw * scale)), height = Math.max(1, Math.round(sh * scale));
      const pixels = new Array(width * height);
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const sx = Math.min(sw - 1, Math.floor((x + .5) * sw / width));
        const sy = Math.min(sh - 1, Math.floor((y + .5) * sh / height));
        const i = (sy * sw + sx) * 4;
        const rgba = Array.from(data.slice(i, i + 4));
        if (rgba[3] === 0 || rgba[3] < alphaThreshold || rgba.slice(0, 3).every(v => v >= whiteThreshold)) continue;
        const c = rgba.slice(0, 3).map(v => quant(v, levels));
        c.push(Math.max(1, quant(rgba[3], 16)));
        pixels[y * width + x] = c.join(',');
      }
      const rects = [], colors = new Set();
      let previous = new Map();
      for (let y = 0; y < height; y++) {
        const current = new Map();
        for (let x = 0; x < width;) {
          const color = pixels[y * width + x];
          if (!color) { x++; continue; }
          const start = x++;
          while (x < width && pixels[y * width + x] === color) x++;
          const key = `${start}:${x}:${color}`;
          let rect = previous.get(key);
          if (rect) rect.h++;
          else { rect = { x: start, y, w: x - start, h: 1, color: color.split(',').map(Number) }; rects.push(rect); }
          current.set(key, rect); colors.add(color);
        }
        previous = current;
      }
      const visiblePixels = rects.reduce((sum, rect) => sum + rect.w * rect.h, 0);
      result = { width, height, rects, visiblePixels, colors: colors.size, requested, resolution, reduced: resolution < requested };
      const count = options.colorText ? visiblePixels : rects.length;
      if (count <= budget || resolution === 1) return result;
      resolution = Math.max(1, Math.min(resolution - 1, Math.floor(resolution * .85)));
    } while (true);
  }
  // Coordinates use screen-height units: [-1, 1] vertically, [-aspect, aspect] horizontally.
  function geometry(model, options = {}) {
    const size = Number(options.size ?? .65), rotation = Number(options.rotation || 0) * Math.PI / 180;
    const ox = Number(options.x || 0), oy = Number(options.y || 0);
    const opacity = clamp(Number(options.opacity ?? 1), 0, 1);
    if (![size, rotation, ox, oy, opacity].every(Number.isFinite) || size <= 0) throw Error('无效的变换参数');
    const unit = size / Math.max(model.width, model.height);
    const point = (x, y) => {
      x = (x - model.width / 2) * unit; y = (y - model.height / 2) * unit;
      return [x * Math.cos(rotation) - y * Math.sin(rotation) + ox, x * Math.sin(rotation) + y * Math.cos(rotation) + oy];
    };
    return model.rects.map(r => ({ points: [point(r.x, r.y), point(r.x + r.w, r.y), point(r.x + r.w, r.y + r.h), point(r.x, r.y + r.h)], color: [...r.color.slice(0, 3), Math.round(r.color[3] * opacity)] }));
  }
  function colorTiles(model, options = {}) {
    const rects = [];
    for (const rect of model.rects) {
      for (let y = rect.y; y < rect.y + rect.h; y++) {
        for (let x = rect.x; x < rect.x + rect.w; x++) {
          rects.push({ x, y, w: 1, h: 1, color: rect.color });
        }
      }
    }
    return geometry({ ...model, rects }, options);
  }
  const fmt = n => n.toFixed(7).replace(/\.?0+$/, '').replace(/^-0$/, '0');
  function exportBLK(quads, options = {}) {
    const mode = options.mode || 'color';
    if (!['color', 'mono', 'control'].includes(mode)) throw Error('未知导出模式');
    let content = '// Image to WT Sight Color\n';
    content += 'drawCentralLineVert:b=no\ndrawCentralLineHorz:b=no\ndrawSightMask:b=no\ndrawDistanceCorrection:b=no\n';
    content += 'crosshairColor:c=255, 255, 255, 255\ncrosshairLightColor:c=255, 255, 255, 255\n';
    content += 'matchExpClass { exp_tank:b=yes; exp_heavy_tank:b=yes; exp_tank_destroyer:b=yes; exp_SPAA:b=yes; }\n';
    content += 'crosshair_distances {}\ncrosshair_hor_ranges {}\n';
    if (mode === 'color') {
      const glyphScale = Number(options.glyphScale ?? 155);
      if (!Number.isFinite(glyphScale) || glyphScale <= 0) throw Error('无效的文字倍率');
      content += 'fontSizeMult:r=1\ndrawTexts {\n';
      for (const { points, color } of quads) {
        const [a, b, c] = points;
        if (color[3] === 0) continue;
        const x = (a[0] + c[0]) / 2, y = (a[1] + c[1]) / 2;
        const size = Math.hypot(b[0] - a[0], b[1] - a[1]) * glyphScale;
        content += `  text {text:t="〓"; align:i=0; pos:p2=${fmt(x)}, ${fmt(y)}; move:b=false; size:r=${fmt(size)}; color:c=${color.join(', ')}; highlight:b=no;}\n`;
      }
      return content + '}\n';
    }
    content += 'drawQuads {\n';
    for (const q of quads) {
      if (q.points.length !== 4 || !q.points.flat().every(Number.isFinite)) throw Error('无效的四边形');
      content += '  quad {\n';
      ['tl', 'tr', 'br', 'bl'].forEach((k, i) => { content += `    ${k}:p2=${q.points[i].map(fmt).join(', ')}\n`; });
      content += '    thousandth:b=no\n    move:b=no\n';
      content += '  }\n';
    }
    return content + '}\n';
  }
  function probe() {
    return [{ points: [[-.6,-.12],[-.36,-.12],[-.36,.12],[-.6,.12]], color:[255,0,0,255] },
      { points: [[-.28,-.12],[-.04,-.12],[-.04,.12],[-.28,.12]], color:[0,255,0,255] },
      { points: [[.04,-.12],[.28,-.12],[.28,.12],[.04,.12]], color:[0,0,255,255] },
      { points: [[.36,-.12],[.6,-.12],[.6,.12],[.36,.12]], color:[255,255,0,128] }];
  }
  const api = { convert, geometry, colorTiles, exportBLK, probe };
  if (typeof module !== 'undefined') module.exports = api;
  else root.WTSight = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
