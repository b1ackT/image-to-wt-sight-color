'use strict';
const $ = id => document.getElementById(id);
const samplingIds = ['resolution', 'levels', 'budget', 'alpha', 'white'];
const transformIds = ['size', 'x', 'y', 'rotation', 'opacity'];
let source = null, model = null, quads = [], blk = '', basename = 'color_sight', timer, loadId = 0;
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
  ctx.strokeStyle=mode==='light'?'#344637aa':'#b6c9a29a';ctx.lineWidth=1.2;
  ctx.beginPath();ctx.moveTo(w/2, h*.18);ctx.lineTo(w/2,h*.46);ctx.moveTo(w/2,h*.54);ctx.lineTo(w/2,h*.84);ctx.moveTo(w*.2,h/2);ctx.lineTo(w*.48,h/2);ctx.moveTo(w*.52,h/2);ctx.lineTo(w*.8,h/2);ctx.stroke();
  ctx.font='14px Consolas,monospace';ctx.fillStyle=ctx.strokeStyle;
  for(let i=1;i<5;i++){const y=h/2+i*32;ctx.beginPath();ctx.moveTo(w/2-12,y);ctx.lineTo(w/2+12,y);ctx.stroke();ctx.fillText(String(i*4),w/2+19,y+5);}
}
function drawQuads(context, shapes, w, h) {
  const pixel = p => [w/2+p[0]*h/2,h/2+p[1]*h/2];
  for (const q of shapes) {
    context.fillStyle=`rgba(${q.color.slice(0,3).join(',')},${q.color[3]/255})`;
    context.beginPath();q.points.forEach((p,i)=>{const v=pixel(p);if(i===0)context.moveTo(...v);else context.lineTo(...v);});context.closePath();context.fill();
  }
}
function redraw() {background();drawQuads(ctx,quads,canvas.width,canvas.height);}
function place() {
  updateOutputs();
  if(model){
    const options = transformOptions();
    quads = WTSight.geometry(model, options);
    blk = WTSight.exportBLK(WTSight.colorTiles(model, options), {glyphScale: $('glyphScale').valueAsNumber});
    $('code').textContent = blk;
    $('bytes').textContent = `${(new Blob([blk]).size/1024).toFixed(1)} KB`;
  }
  redraw();
}
function process() {
  if(!source)return;
  try {
    model=WTSight.convert(source,{resolution:+$('resolution').value,levels:+$('levels').value,budget:+$('budget').value,alphaThreshold:+$('alpha').value,removeWhite:$('white').checked,colorText:true});
    $('count').textContent=model.visiblePixels.toLocaleString();$('colors').textContent=model.colors.toLocaleString();$('sampling').textContent=`${model.width} × ${model.height}`;
    ['download','mono','png'].forEach(id=>$(id).disabled=!model.rects.length);
    $('status').textContent=!model.rects.length?'没有可见像素，请检查透明度过滤或白色背景选项。':model.reduced?'已自动降低采样精度以满足图元预算。':'图片已转换，可以导出彩色 BLK。';
    place();
  }catch(e){$('status').textContent=`转换失败：${e.message}`;}
}
function schedule(){
  updateOutputs();
  clearTimeout(timer);
  timer = setTimeout(flushSampling,140);
}
function setSource(image,name) {
  const factor=Math.min(1,512/Math.max(image.width,image.height));
  const c=document.createElement('canvas');c.width=Math.max(1,Math.round(image.width*factor));c.height=Math.max(1,Math.round(image.height*factor));
  const context=c.getContext('2d',{willReadFrequently:true});context.drawImage(image,0,0,c.width,c.height);source=context.getImageData(0,0,c.width,c.height);
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
$('background').addEventListener('change',redraw);
$('reset').onclick=()=>{Object.entries({size:.65,x:.65,y:.35,rotation:0,opacity:1}).forEach(([k,v])=>$(k).value=v);place();};
function flushSampling() {
  if (timer === undefined) return;
  clearTimeout(timer);
  timer = undefined;
  process();
}
$('download').onclick=()=>{flushSampling();if(model?.visiblePixels)save(blk,`${basename}_color.blk`);};
$('mono').onclick=()=>{
  flushSampling();
  if(quads.length)save(WTSight.exportBLK(quads,{mode:'mono'}),`${basename}_mono_control.blk`);
};
$('probe').onclick=()=>save(WTSight.exportBLK(WTSight.probe(),{glyphScale:20}),'color_probe.blk');
$('control').onclick=()=>save(WTSight.exportBLK(WTSight.probe(),{mode:'control'}),'quad_geometry_control.blk');
$('png').onclick=()=>{
  flushSampling();
  if(!quads.length)return;
  const c=document.createElement('canvas');c.width=1920;c.height=1080;drawQuads(c.getContext('2d'),quads,c.width,c.height);
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
updateOutputs();redraw();
