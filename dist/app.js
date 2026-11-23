'use strict';
const $ = id => document.getElementById(id);
const samplingIds = ['resolution', 'levels', 'budget', 'alpha', 'white', 'trim', 'encoding', 'tolerance'];
const transformIds = ['size', 'x', 'y', 'vertical', 'rotation', 'opacity'];
let source = null, trimmedSource = null, model = null, quads = [], lines = [], blk = '';
let basename = 'color_sight', timer, loadId = 0, drag = null;
const canvas = $('preview'), ctx = canvas.getContext('2d');
function updateOutputs() {
  document.querySelectorAll('output').forEach(o => { o.value = $(o.htmlFor).value; });
}
function transformOptions() {
  return Object.fromEntries(transformIds.map(id => [id, Number($(id).value)]));
}
function background() {
  const w = canvas.width, h = canvas.height, mode = $('background').value;
  ctx.clearRect(0, 0, w, h);
  if (mode === 'field') {
    const sky = ctx.createLinearGradient(0,0,0,h);
    sky.addColorStop(0,'#526465'); sky.addColorStop(.48,'#88958a'); sky.addColorStop(.49,'#515c40'); sky.addColorStop(1,'#242f25');
    ctx.fillStyle=sky;ctx.fillRect(0,0,w,h);
    for (let i=0;i<3;i++) {
      ctx.fillStyle=['#4d5c4a','#404f3d','#354330'][i];ctx.beginPath();ctx.moveTo(0,h);
      for(let x=0;x<=w;x+=16) ctx.lineTo(x,h*(.44+i*.09)+Math.sin(x*.006+i*2)*h*.045+Math.sin(x*.021+i)*h*.012);
      ctx.lineTo(w,h);ctx.fill();
    }
    // An intentionally abstract scene, not a game screenshot.
    ctx.fillStyle='#303b2b';ctx.fillRect(w*.42,h*.55,w*.13,h*.07);ctx.fillRect(w*.46,h*.52,w*.07,h*.04);ctx.fillRect(w*.52,h*.53,w*.1,h*.009);
  } else if(mode==='grid') {
    for(let y=0;y<h;y+=24)for(let x=0;x<w;x+=24){ctx.fillStyle=(x/24+y/24)%2?'#343b39':'#252b29';ctx.fillRect(x,y,24,24);}
  } else {ctx.fillStyle=mode==='light'?'#c5c9c2':'#111716';ctx.fillRect(0,0,w,h);}
}
function drawQuads(context, shapes, w, h) {
  const pixel = p => [w/2+p[0]*h/2,h/2+p[1]*h/2];
  for (const q of shapes) {
    context.fillStyle=`rgba(${q.color.slice(0,3).join(',')},${q.color[3]/255})`;
    context.beginPath();q.points.forEach((p,i)=>{const v=pixel(p);if(i===0)context.moveTo(...v);else context.lineTo(...v);});context.closePath();context.fill();
  }
}
function drawLines(context, segments, w, h) {
  context.strokeStyle = '#fff';
  context.lineWidth = Math.max(1, h / 480);
  context.beginPath();
  for (const [x1, y1, x2, y2] of segments) {
    context.moveTo(w / 2 + x1 * h / 2, h / 2 + y1 * h / 2);
    context.lineTo(w / 2 + x2 * h / 2, h / 2 + y2 * h / 2);
  }
  context.stroke();
}
function previewGeometry() {
  if (!model) return [];
  const preview = model.greedy ? { ...model, rects: model.tiles } : model;
  return WTSight.geometry(preview, transformOptions());
}
function redraw() {
  background();
  drawQuads(ctx, quads, canvas.width, canvas.height);
  drawLines(ctx, lines, canvas.width, canvas.height);
}
function place() {
  updateOutputs();
  const options = transformOptions();
  quads = previewGeometry();
  lines = WTSight.reticleLines($('preset').value, $('reticleSize').valueAsNumber);
  $('download').disabled = !quads.length && !lines.length;
  $('mono').disabled = !quads.length;
  $('png').disabled = $('download').disabled;
  $('fit').disabled = !quads.length;
  canvas.classList.toggle('editable', !!quads.length);
  const budget = Number($('budget').value).toLocaleString();
  $('count').textContent = `${(model?.textCount ?? 0).toLocaleString()} / ${budget}`;
  const tiles = model ? WTSight.colorTiles(model, options) : [];
  blk = $('download').disabled ? '' : WTSight.exportBLK(tiles, {lines, glyphScale: $('glyphScale').valueAsNumber});
  $('code').textContent = blk;
  $('bytes').textContent = blk ? `${(new Blob([blk]).size/1024).toFixed(1)} KB` : '—';
  redraw();
}
function process() {
  if(!source)return;
  try {
    const input = $('trim').checked ? trimmedSource : source;
    const encoding = $('encoding').value;
    model = WTSight.convert(input, {
      resolution: +$('resolution').value, levels: +$('levels').value, budget: +$('budget').value,
      alphaThreshold: +$('alpha').value, removeWhite: $('white').checked,
      colorText: true, mergeTiles: encoding === 'merge', greedy: encoding === 'greedy',
      tolerance: $('tolerance').valueAsNumber
    });
    model.greedy = encoding === 'greedy';
    $('colors').textContent = model.colors.toLocaleString();
    $('sampling').textContent = `${model.width} × ${model.height}`;
    $('status').textContent = !model.rects.length ? '没有可见像素，请检查透明度过滤。'
      : model.reduced ? `受图元预算限制，已从请求的 ${Math.min(model.requested, Math.max(input.width, input.height))} px 降至 ${Math.max(model.width, model.height)} px。`
      : '已在当前预算内完成采样。';
    place();
  }catch(e){$('status').textContent=`转换失败：${e.message}`;}
}
function schedule(){
  updateOutputs();
  $('greedySettings').hidden = $('encoding').value !== 'greedy';
  clearTimeout(timer);
  timer = setTimeout(flushSampling,140);
}
function setSource(image,name) {
  const factor=Math.min(1,1024/Math.max(image.width,image.height));
  const c=document.createElement('canvas');c.width=Math.max(1,Math.round(image.width*factor));c.height=Math.max(1,Math.round(image.height*factor));
  const context=c.getContext('2d',{willReadFrequently:true});context.drawImage(image,0,0,c.width,c.height);source=context.getImageData(0,0,c.width,c.height);
  trimmedSource = WTSight.trimTransparent(source);
  basename=name.replace(/\.[^.]+$/,'').replace(/[^a-zA-Z_]/g,'_').replace(/_+/g,'_').slice(0,60)||'color_sight';
  $('filename').textContent=`${name} · ${image.width} × ${image.height}`;process();
}
async function load(file) {
  if(!file)return;
  const id=++loadId;
  if(!['image/png','image/jpeg','image/webp'].includes(file.type)){ $('status').textContent='请选择 PNG、JPG 或 WebP 图片。';return; }
  if(file.size>30*1024*1024){$('status').textContent='图片大于 30 MB，请先缩小图片。';return;}
  const url=URL.createObjectURL(file);
  try {
    const img=new Image();img.src=url;await img.decode();
    if(id!==loadId)return;
    if(img.width*img.height>40000000)throw Error('图片超过 4000 万像素，请先缩小');
    setSource(img,file.name);
  }catch(e){if(id===loadId)$('status').textContent=`图片读取失败：${e.message}`;}
  finally{URL.revokeObjectURL(url);$('file').value='';}
}
function save(content,name,type='text/plain;charset=utf-8') {
  const url=URL.createObjectURL(content instanceof Blob?content:new Blob([content],{type}));
  const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
}
$('file').addEventListener('change',e=>load(e.target.files[0]));
['dragenter','dragover'].forEach(event=>$('drop').addEventListener(event,e=>{e.preventDefault();$('drop').classList.add('dragging');}));
['dragleave','drop'].forEach(event=>$('drop').addEventListener(event,e=>{e.preventDefault();$('drop').classList.remove('dragging');if(event==='drop')load(e.dataTransfer.files[0]);}));
samplingIds.forEach(id=>$(id).addEventListener('input',schedule));
transformIds.forEach(id=>$(id).addEventListener('input',place));
$('glyphScale').addEventListener('input',place);
$('preset').addEventListener('change',place);
$('reticleSize').addEventListener('input',place);
$('background').addEventListener('change',redraw);
function applyAspect() {
  const [width, height] = $('aspect').value.split(':').map(Number);
  canvas.width = Math.round(canvas.height * width / height);
  $('viewport').style.aspectRatio = `${width} / ${height}`;
  redraw();
}
$('aspect').addEventListener('change', applyAspect);
$('reset').onclick=()=>{Object.entries({size:.65,x:.65,y:.35,vertical:1,rotation:0,opacity:1,glyphScale:155}).forEach(([k,v])=>$(k).value=v);place();};
$('fit').onclick = () => {
  flushSampling();
  if (!model?.visiblePixels) return;
  const points = WTSight.geometry(model, { ...transformOptions(), size: 1, x: 0, y: 0 }).flatMap(q => q.points);
  const bounds = points.reduce((b, [x, y]) => [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)],
    [Infinity, Infinity, -Infinity, -Infinity]);
  const [left, top, right, bottom] = bounds;
  const fit = Math.min(1.8, 1.8 * canvas.width / canvas.height / (right - left), 1.8 / (bottom - top));
  const scale = Math.floor(fit * 100) / 100;
  $('size').value = scale;
  $('x').value = -(left + right) * scale / 2;
  $('y').value = -(top + bottom) * scale / 2;
  place();
};
canvas.addEventListener('pointerdown', event => {
  if (!quads.length || !event.isPrimary || event.button !== 0) return;
  drag = { id: event.pointerId, x: event.clientX, y: event.clientY, ox: +$('x').value, oy: +$('y').value };
  canvas.setPointerCapture(event.pointerId);
  canvas.classList.add('dragging');
});
canvas.addEventListener('pointermove', event => {
  if (event.pointerId !== drag?.id) return;
  const unit = 2 / canvas.getBoundingClientRect().height;
  $('x').value = drag.ox + (event.clientX - drag.x) * unit;
  $('y').value = drag.oy + (event.clientY - drag.y) * unit;
  quads = previewGeometry();
  updateOutputs();
  redraw();
});
canvas.addEventListener('lostpointercapture', () => {
  drag = null;
  canvas.classList.remove('dragging');
  place();
});
function flushSampling() {
  if (timer === undefined) return;
  clearTimeout(timer);
  timer = undefined;
  process();
}
$('download').onclick=()=>{flushSampling();if(blk)save(blk,quads.length ? `${basename}_color.blk` : `${$('preset').value}_reticle.blk`);};
$('mono').onclick=()=>{
  flushSampling();
  if(quads.length)save(WTSight.exportBLK(WTSight.geometry(model, transformOptions()),{mode:'mono',lines}),`${basename}_mono_control.blk`);
};
$('probe').onclick=()=>save(WTSight.exportBLK(WTSight.probe(),{glyphScale:20}),'color_probe.blk');
$('control').onclick=()=>save(WTSight.exportBLK(WTSight.probe(),{mode:'control'}),'quad_geometry_control.blk');
$('budgetProbe').onclick = () => {
  const count = Number($('probeCount').value);
  save(WTSight.exportBLK(WTSight.budgetProbe(count), {glyphScale: 56}), `budget_probe_${count}.blk`);
};
$('png').onclick=()=>{
  flushSampling();
  if(!quads.length&&!lines.length)return;
  const c=document.createElement('canvas');
  c.height=1080;
  c.width=Math.round(c.height*canvas.width/canvas.height);
  const context=c.getContext('2d');
  drawQuads(context,quads,c.width,c.height);
  drawLines(context,lines,c.width,c.height);
  c.toBlob(blob=>{if(blob)save(blob,`${basename}_preview.png`);});
};
$('demo').onclick=()=>{
  ++loadId;
  const c=document.createElement('canvas');c.width=160;c.height=160;const g=c.getContext('2d');
  // Hand-drawn vector sample: no external assets or generated imagery.
  g.fillStyle='#70c9d0';g.beginPath();g.moveTo(34,64);g.lineTo(27,14);g.lineTo(69,45);g.lineTo(104,45);g.lineTo(142,14);g.lineTo(133,75);g.lineTo(141,118);g.lineTo(110,142);g.lineTo(55,142);g.lineTo(22,115);g.closePath();g.fill();
  g.fillStyle='#e996a7';g.beginPath();g.moveTo(36,31);g.lineTo(57,48);g.lineTo(39,57);g.fill();g.beginPath();g.moveTo(132,31);g.lineTo(114,49);g.lineTo(130,57);g.fill();
  g.fillStyle='#eddfae';g.fillRect(49,99,70,32);g.fillStyle='#172a32';g.fillRect(48,78,12,17);g.fillRect(108,78,12,17);g.fillStyle='#f1f5df';g.fillRect(50,79,4,5);g.fillRect(110,79,4,5);
  g.fillStyle='#e584a1';g.beginPath();g.moveTo(75,105);g.lineTo(94,105);g.lineTo(84,116);g.fill();g.fillStyle='#f0bc57';g.fillRect(60,138,47,10);g.fillStyle='#e584a1';g.fillRect(78,138,12,18);
  setSource(c,'chroma_cat.png');
};
applyAspect();
place();
