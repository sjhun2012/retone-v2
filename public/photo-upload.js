(() => {
  'use strict';
  const MAX_INPUT=32*1024*1024, MAX_OUTPUT=1_400_000;
  const read=file=>new Promise((resolve,reject)=>{
    const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('사진 파일을 읽지 못했어요. 다시 선택해 주세요.'));reader.readAsDataURL(file);
  });
  window.retonePrepareImage=async file=>{
    if(!file||file.size>MAX_INPUT)throw new Error('32MB 이하의 사진을 선택해 주세요.');
    if(file.type&&!file.type.startsWith('image/')&&file.type!=='application/octet-stream')throw new Error('사진 파일을 선택해 주세요.');
    const source=await read(file);
    if(/^data:image\/(jpeg|png|webp|gif);base64,/.test(source)&&file.size<=MAX_OUTPUT)return source;
    const image=await new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error('이 사진 형식을 열 수 없어요. JPEG 또는 PNG로 저장한 사진을 선택해 주세요.'));image.src=source;});
    if(!image.naturalWidth||!image.naturalHeight)throw new Error('사진 크기를 읽지 못했어요.');
    let scale=Math.min(1,1920/Math.max(image.naturalWidth,image.naturalHeight));
    const canvas=document.createElement('canvas'),context=canvas.getContext('2d');
    if(!context)throw new Error('사진을 준비하지 못했어요. 앱을 다시 열고 시도해 주세요.');
    for(let attempt=0;attempt<6;attempt++){
      canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
      context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0,canvas.width,canvas.height);
      const result=canvas.toDataURL('image/jpeg',Math.max(.55,.86-attempt*.08));
      const encoded=result.slice(result.indexOf(',')+1),bytes=Math.floor(encoded.length*3/4)-(encoded.endsWith('==')?2:encoded.endsWith('=')?1:0);
      if(result.startsWith('data:image/jpeg;base64,')&&bytes<=MAX_OUTPUT)return result;
      scale*=.8;
    }
    throw new Error('사진을 전송 크기로 줄이지 못했어요. 더 작은 사진을 선택해 주세요.');
  };
})();
