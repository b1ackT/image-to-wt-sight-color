(function (root) {
  'use strict';
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  function convert(image, options = {}) {
    const { width: sw, height: sh, data } = image;
    if (!Number.isInteger(sw) || !Number.isInteger(sh) || sw < 1 || sh < 1 || data.length !== sw * sh * 4) throw Error('无效的图片像素数据');
    const requested = clamp(Math.round(options.resolution || 128), 1, 512);
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
      result.tiles = options.colorText && options.mergeTiles ? squareTiles(rects) : null;
      result.textCount = result.tiles?.length ?? visiblePixels;
      const count = options.colorText ? result.textCount : rects.length;
      if (count <= budget || resolution === 1) return result;
      resolution = Math.max(1, Math.min(resolution - 1, Math.floor(resolution * Math.max(.85, Math.sqrt(budget / count)))));
    } while (true);
  }
  // Fill flat regions with square tiles so enlarged glyphs preserve their aspect ratio.
  function squareTiles(rects) {
    const tiles = [];
    function add(x, y, width, height, color) {
      if (!width || !height) return;
      const step = Math.min(width, height, 4);
      const cols = Math.floor(width / step) * step;
      const rows = Math.floor(height / step) * step;
      for (let dy = 0; dy < rows; dy += step) {
        for (let dx = 0; dx < cols; dx += step) {
          tiles.push({ x: x + dx, y: y + dy, w: step, h: step, color });
        }
      }
      add(x + cols, y, width - cols, rows, color);
      add(x, y + rows, width, height - rows, color);
    }
    for (const rect of rects) add(rect.x, rect.y, rect.w, rect.h, rect.color);
    return tiles;
  }

  function trimTransparent(image) {
    const { width, height, data } = image;
    let left = width, right = -1, top = height, bottom = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (!data[(y * width + x) * 4 + 3]) continue;
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    }
    if (right < 0 || (left === 0 && top === 0 && right === width - 1 && bottom === height - 1)) return image;
    const croppedWidth = right - left + 1, croppedHeight = bottom - top + 1;
    const cropped = new Uint8ClampedArray(croppedWidth * croppedHeight * 4);
    for (let y = 0; y < croppedHeight; y++) {
      const start = ((top + y) * width + left) * 4;
      cropped.set(data.subarray(start, start + croppedWidth * 4), y * croppedWidth * 4);
    }
    return { width: croppedWidth, height: croppedHeight, data: cropped };
  }

  // Coordinates use screen-height units: [-1, 1] vertically, [-aspect, aspect] horizontally.
  function geometry(model, options = {}) {
    const size = Number(options.size ?? .65), rotation = Number(options.rotation || 0) * Math.PI / 180;
    const ox = Number(options.x || 0), oy = Number(options.y || 0);
    const opacity = clamp(Number(options.opacity ?? 1), 0, 1);
    const vertical = Number(options.vertical ?? 1);
    if (![size, rotation, ox, oy, opacity, vertical].every(Number.isFinite) || size <= 0 || vertical <= 0) throw Error('无效的变换参数');
    const unit = size / Math.max(model.width, model.height);
    const cos = Math.cos(rotation), sin = Math.sin(rotation);
    const point = (x, y) => {
      x = (x - model.width / 2) * unit; y = (y - model.height / 2) * unit;
      return [x * cos - y * sin + ox, (x * sin + y * cos) * vertical + oy];
    };
    return model.rects.map(r => {
      const alpha = r.color[3] && opacity ? Math.max(1, Math.round(r.color[3] * opacity)) : 0;
      return {
        points: [point(r.x, r.y), point(r.x + r.w, r.y), point(r.x + r.w, r.y + r.h), point(r.x, r.y + r.h)],
        color: [...r.color.slice(0, 3), alpha]
      };
    });
  }
  function colorTiles(model, options = {}) {
    let rects = model.tiles;
    if (!rects) {
      rects = [];
      for (const rect of model.rects) {
        for (let y = rect.y; y < rect.y + rect.h; y++) {
          for (let x = rect.x; x < rect.x + rect.w; x++) {
            rects.push({ x, y, w: 1, h: 1, color: rect.color });
          }
        }
      }
    }
    // Spread early entries across the image in case the game stops reading mid-block.
    const cells = Array.from({length: 64}, () => []);
    for (const rect of rects) {
      const col = Math.floor((rect.x + rect.w / 2) * 8 / model.width);
      const row = Math.floor((rect.y + rect.h / 2) * 8 / model.height);
      cells[row * 8 + col].push(rect);
    }
    const occupied = cells.filter(cell => cell.length);
    const interleaved = [];
    for (let i = 0; interleaved.length < rects.length; i++) {
      for (const cell of occupied) {
        if (cell[i]) interleaved.push(cell[i]);
      }
    }
    return geometry({ ...model, rects: interleaved }, options);
  }
  const fmt = n => n.toFixed(7).replace(/\.?0+$/, '').replace(/^-0$/, '0');
  function reticleLines(preset, size = 1) {
    const presets = {
      none: [],
      cross: [[-.19,0,-.032,0],[.032,0,.19,0],[0,-.16,0,-.032],[0,.032,0,.16]],
      post: [[-.25,0,-.045,0],[.045,0,.25,0],[0,.035,0,.23],[-.05,.19,.05,.19]],
      frame: [[-.14,-.1,-.09,-.1],[-.14,-.1,-.14,-.05],[.14,-.1,.09,-.1],[.14,-.1,.14,-.05],
        [-.14,.1,-.09,.1],[-.14,.1,-.14,.05],[.14,.1,.09,.1],[.14,.1,.14,.05],
        [-.018,0,.018,0],[0,-.018,0,.018]]
    };
    if (!Object.hasOwn(presets, preset) || !Number.isFinite(size) || size <= 0) throw Error('无效的基础准星');
    return presets[preset].map(line => line.map(value => value * size));
  }
  function exportBLK(quads, options = {}) {
    const mode = options.mode || 'color';
    if (!['color', 'mono', 'control'].includes(mode)) throw Error('未知导出模式');
    let content = '// Image to WT Sight Color\n';
    content += 'drawCentralLineVert:b=no\ndrawCentralLineHorz:b=no\ndrawSightMask:b=no\ndrawDistanceCorrection:b=no\n';
    content += 'crosshairColor:c=255, 255, 255, 255\ncrosshairLightColor:c=255, 255, 255, 255\n';
    content += 'matchExpClass { exp_tank:b=yes; exp_heavy_tank:b=yes; exp_tank_destroyer:b=yes; exp_SPAA:b=yes; }\n';
    content += 'crosshair_distances {}\ncrosshair_hor_ranges {}\n';
    const lines = options.lines ?? [];
    if (lines.length) {
      content += 'drawLines {\n';
      for (const line of lines) {
        content += `  line { line:p4=${line.map(fmt).join(', ')}; move:b=no; thousandth:b=no; }\n`;
      }
      content += '}\n';
    }
    if (mode === 'color') {
      const glyphScale = Number(options.glyphScale ?? 155);
      if (!Number.isFinite(glyphScale) || glyphScale <= 0) throw Error('无效的文字倍率');
      if (!quads.length) return content;
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

  function budgetProbe(count) {
    if (![256, 512, 1024, 2048, 4096, 7900].includes(count)) throw Error('无效的诊断数量');
    function square(x, y, size, color) {
      const half = size / 2;
      return {
        points: [[x-half,y-half],[x+half,y-half],[x+half,y+half],[x-half,y+half]],
        color
      };
    }
    const corners = [[-1,-.62],[1,-.62],[-1,.62],[1,.62]];
    const early = corners.map(([x,y]) => square(x,y,.09,[0,255,80,255]));
    const late = corners.map(([x,y]) => square(x*.86,y,.09,[255,90,20,255]));
    const bodyCount = count - early.length - late.length;
    const cols = Math.ceil(Math.sqrt(bodyCount * 1.75));
    const rows = Math.ceil(bodyCount / cols);
    const body = Array.from({length:bodyCount}, (_,i) => {
      const x = ((i % cols + .5) / cols - .5) * 1.2;
      const y = ((Math.floor(i / cols) + .5) / rows - .5) * .7;
      return square(x,y,Math.min(.034,.7 / rows),[170,210,255,255]);
    });
    return [...early, ...body, ...late];
  }
  const api = { convert, trimTransparent, geometry, colorTiles, reticleLines, exportBLK, probe, budgetProbe };
  if (typeof module !== 'undefined') module.exports = api;
  else root.WTSight = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
