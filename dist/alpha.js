function removeEdgeBackground(pixels,width,height){
 // Remove only pixels connected to the image boundary and close to a corner color.
 const corners=[0,width-1,(height-1)*width,width*height-1].filter(i=>pixels[i*4+3]>=128).map(i=>[pixels[i*4],pixels[i*4+1],pixels[i*4+2]]);
 const visited=new Uint8Array(width*height),queue=new Int32Array(width*height);let head=0,tail=0;
 function push(i){if(visited[i])return;visited[i]=1;const k=i*4;if(pixels[k+3]<128||corners.some(c=>Math.max(Math.abs(c[0]-pixels[k]),Math.abs(c[1]-pixels[k+1]),Math.abs(c[2]-pixels[k+2]))<=18))queue[tail++]=i;}
 for(let x=0;x<width;x++){push(x);push((height-1)*width+x);}for(let y=0;y<height;y++){push(y*width);push(y*width+width-1);}
 while(head<tail){const i=queue[head++];pixels[i*4+3]=0;const x=i%width;if(x>0)push(i-1);if(x<width-1)push(i+1);if(i>=width)push(i-width);if(i<width*(height-1))push(i+width);}
}
function alphaPalette(pixels,mode,colors,threshold,sharedPalette=null){const visible=[];for(let i=0;i<pixels.length;i+=4)if(pixels[i+3]>=128)visible.push(i);if(!visible.length)throw new Error('No visible pixels remain. Turn off edge-background removal.');const compact=new Uint8ClampedArray(visible.length*4);visible.forEach((src,i)=>{compact[i*4]=pixels[src];compact[i*4+1]=pixels[src+1];compact[i*4+2]=pixels[src+2];compact[i*4+3]=255;});let palette,small;if(mode==='bw'){palette=[{r:0,g:0,b:0,a:255},{r:255,g:255,b:255,a:255}];small=new Uint8Array(visible.length);for(let i=0;i<small.length;i++)small[i]=(.2126*compact[i*4]+.7152*compact[i*4+1]+.0722*compact[i*4+2])<threshold?0:1;}else if(sharedPalette?.length){palette=sharedPalette.map(c=>({...c,a:255}));small=labelWithPalette(compact,palette);}else {const q=quantize(compact,colors);palette=q.palette;small=q.labels;}
 // Snap near-white artwork to explicit white; it remains visible geometry.
 for(const c of palette)if(Math.min(c.r,c.g,c.b)>=248)c.r=c.g=c.b=255;
 const transparent=palette.length;palette.push({r:0,g:0,b:0,a:0});const labels=new Uint8Array(pixels.length/4);labels.fill(transparent);visible.forEach((src,i)=>labels[src/4]=small[i]);return {palette,labels,transparent};}
