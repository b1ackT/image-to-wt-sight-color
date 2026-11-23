const {test} = require('node:test');
const assert = require('node:assert/strict');
const {convert,geometry,colorTiles,exportBLK,probe} = require('../dist/core.js');
function image(width,height,fn){return {width,height,data:Uint8ClampedArray.from(Array.from({length:width*height},(_,i)=>fn(i%width,Math.floor(i/width))).flat())};}
test('merging preserves all visible pixels without overlaps, including transparent holes',()=>{
  let seed=12345;
  for(let trial=0;trial<40;trial++){
    const input=image(17,13,()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return [[255,0,0,255],[0,255,0,255],[0,0,255,128],[0,0,0,0]][seed%4];});
    const m=convert(input,{resolution:256,levels:256,budget:20000});
    const restored=new Uint8ClampedArray(input.data.length),coverage=new Uint8Array(17*13);
    for(const r of m.rects)for(let y=r.y;y<r.y+r.h;y++)for(let x=r.x;x<r.x+r.w;x++){
      assert.equal(coverage[y*17+x]++,0);restored.set(r.color,(y*17+x)*4);
    }
    for(let i=0;i<input.data.length;i+=4){if(!input.data[i+3])assert.equal(restored[i+3],0);else{assert.deepEqual([...restored.slice(i,i+3)],[...input.data.slice(i,i+3)]);assert.ok(Math.abs(restored[i+3]-input.data[i+3])<=9);}}
  }
});
test('solid image merges into a single rectangle',()=>{assert.equal(convert(image(128,128,()=>[255,0,0,255])).rects.length,1);});
test('budget reduces entire sampling resolution rather than truncating shapes',()=>{
  const m=convert(image(64,32,(x,y)=>[(x*17+y*13)%256,x*3,y*7,255]),{resolution:64,budget:50,levels:256});
  assert.ok(m.reduced);assert.ok(m.rects.length<=50);assert.ok(m.width/m.height>=1.8);
  assert.equal(m.rects.reduce((s,r)=>s+r.w*r.h,0),m.width*m.height);
});
test('alpha zero always stays transparent, remove-white is opt-in',()=>{
  const i=image(2,1,x=>x?[255,255,255,255]:[255,0,0,0]);
  assert.equal(convert(i,{alphaThreshold:0}).rects.length,1);
  assert.equal(convert(i,{removeWhite:true}).rects.length,0);
});
test('rotation and offsets preserve center and dimensions',()=>{
  const m=convert(image(2,1,()=>[255,0,0,255]));
  const q=geometry(m,{size:1,rotation:90,x:.2,y:.3,opacity:.5})[0];
  assert.ok(Math.abs(q.points[0][0]-.45)<1e-9);assert.ok(Math.abs(q.points[0][1]+.2)<1e-9);
  assert.equal(q.color[3],128);
});
test('color export uses independent RGBA text with backlight disabled',()=>{
  const e=exportBLK(probe(),{glyphScale:20}),c=exportBLK(probe(),{mode:'control'});
  assert.equal((e.match(/  text \{/g)||[]).length,4);
  assert.match(e,/text:t="〓"; align:i=0; pos:p2=-0.48, 0; move:b=false; size:r=4.8; color:c=255, 0, 0, 255; highlight:b=no;/);
  assert.match(e,/color:c=255, 255, 0, 128; highlight:b=no;/);
  assert.doesNotMatch(e,/drawQuads|NaN|Infinity/);
  assert.equal((c.match(/  quad \{/g)||[]).length,4);
  assert.doesNotMatch(c,/drawTexts/);
});
test('text budget counts visible pixels even when they merge into one preview rectangle',()=>{
  const input=image(64,64,(x)=>x<32?[255,0,0,255]:[0,0,0,0]);
  const m=convert(input,{resolution:64,levels:256,budget:100,colorText:true});
  const tiles=colorTiles(m,{size:1,rotation:90,opacity:.5});
  assert.ok(m.reduced);
  assert.ok(tiles.length>0&&tiles.length<=100);
  assert.equal(tiles.length,m.visiblePixels);
  assert.equal(m.rects.length,1);
  assert.ok(tiles.every(q=>q.color.join(',')==='255,0,0,128'));
  assert.equal(new Set(tiles.map(q=>q.points[0].join(','))).size,tiles.length);
});
test('invalid input is rejected',()=>{assert.throws(()=>convert({width:0,height:1,data:[]}));assert.throws(()=>geometry(convert(image(1,1,()=>[0,0,0,255])),{x:NaN,size:0}));});
