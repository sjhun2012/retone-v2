const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const jsQR=require('jsqr');
module.exports=function decodeQrSvg(svg){
  const document=new JSDOM(svg,{contentType:'image/svg+xml'}).window.document;
  const image=document.documentElement;
  const box=image.getAttribute('viewBox').split(/\s+/).map(Number);
  const width=box[2],height=box[3];
  assert.ok(width>0&&height>0&&width<=2048&&height<=2048);
  const rgba=new Uint8ClampedArray(width*height*4);rgba.fill(255);
  let rectangles=0;
  for(const path of document.querySelectorAll('path[fill="#000"]')){
    const d=path.getAttribute('d');
    for(const match of d.matchAll(/M(\d+) (\d+)h(\d+)v(\d+)(?:H\d+|h-\d+)z/g)){
      const [left,top,w,h]=match.slice(1).map(Number);
      assert.ok(left+w<=width&&top+h<=height);
      for(let y=top;y<top+h;y++)for(let x=left;x<left+w;x++){
        const offset=(y*width+x)*4;rgba[offset]=rgba[offset+1]=rgba[offset+2]=0;
      }
      rectangles++;
    }
  }
  assert.ok(rectangles>20,'QR SVG did not contain recognized module rectangles');
  const result=jsQR(rgba,width,height,{inversionAttempts:'attemptBoth'});
  assert.ok(result,'Generated QR must decode in a real QR decoder');
  return result.data;
};
