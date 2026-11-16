// Flatten generated SVG curves to a bounded 0.0075 mm chord error for extrusion.
export function pathContours(d,scale,tolerance=.0075){
 const tokens=d.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:e[-+]?\d+)?/gi)||[];
 let i=0,cmd='',point=[0,0],start=[0,0],contour=[],contours=[],total=0;
 const same=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1])<1e-9;
 function add(p){if(!contour.length||!same(p,contour[contour.length-1])){contour.push(p);if(++total>300000)throw Error('Artwork is too complex for STL export. Trace with fewer details.');}}
 function finish(){if(contour.length>1&&same(contour[0],contour[contour.length-1]))contour.pop();if(contour.length>=3)contours.push(contour);contour=[];}
 function number(){const n=Number(tokens[i++]);if(!Number.isFinite(n))throw Error('Invalid SVG coordinates.');return n;}
 function pair(){return [number()*scale,-number()*scale];}
 const mid=(a,b)=>[(a[0]+b[0])/2,(a[1]+b[1])/2];
 function distance(p,a,b){const dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy||1)));return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);}
 function quad(a,b,c,depth=0){if(depth>=20||distance(b,a,c)<=tolerance){add(c);return;}const ab=mid(a,b),bc=mid(b,c),m=mid(ab,bc);quad(a,ab,m,depth+1);quad(m,bc,c,depth+1);}
 function cubic(a,b,c,d,depth=0){if(depth>=20||Math.max(distance(b,a,d),distance(c,a,d))<=tolerance){add(d);return;}const ab=mid(a,b),bc=mid(b,c),cd=mid(c,d),abc=mid(ab,bc),bcd=mid(bc,cd),m=mid(abc,bcd);cubic(a,ab,abc,m,depth+1);cubic(m,bcd,cd,d,depth+1);}
 while(i<tokens.length){if(/^[a-z]$/i.test(tokens[i]))cmd=tokens[i++];switch(cmd){case 'M':finish();point=pair();start=point;add(point);cmd='L';break;case 'L':point=pair();add(point);break;case 'Q':{const c=pair(),end=pair();quad(point,c,end);point=end;break;}case 'C':{const a=pair(),b=pair(),end=pair();cubic(point,a,b,end);point=end;break;}case 'Z':case 'z':finish();point=start;cmd='';break;default:throw Error('Unsupported SVG path command: '+cmd);}}
 finish();return contours;
}
export function signedArea(p){let area=0;for(let i=0;i<p.length;i++){const a=p[i],b=p[(i+1)%p.length];area+=a[0]*b[1]-b[0]*a[1];}return area/2;}
export function binarySTL(manifold,label='CoasterLab STL; units mm'){
 if(manifold.status()!=='NoError')throw Error('The 3D geometry could not be made watertight.');
 const mesh=manifold.getMesh(),{triVerts,vertProperties,numProp}=mesh,triangles=triVerts.length/3;
 if(triangles===0)throw Error('This part has no printable geometry.');if(triangles>3000000)throw Error('STL is too complex. Reduce tracing detail.');
 validateExportMesh(mesh);
 const buffer=new ArrayBuffer(84+triangles*50),view=new DataView(buffer),bytes=new Uint8Array(buffer);bytes.set(new TextEncoder().encode(label).slice(0,80));view.setUint32(80,triangles,true);let offset=84;
 for(let i=0;i<triVerts.length;i+=3){const points=[0,1,2].map(k=>{const v=triVerts[i+k]*numProp;return [vertProperties[v],vertProperties[v+1],vertProperties[v+2]];});const [a,b,c]=points,u=b.map((v,k)=>v-a[k]),v=c.map((n,k)=>n-a[k]);let normal=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],len=Math.hypot(...normal)||1;normal=normal.map(n=>n/len);for(const n of [...normal,...a,...b,...c]){view.setFloat32(offset,n,true);offset+=4;}view.setUint16(offset,0,true);offset+=2;}
 return {buffer,triangles};
}

// Validate the float32 coordinates that STL actually stores, not only WASM topology.
export function validateExportMesh(mesh){
 const {triVerts,vertProperties,numProp}=mesh,ids=new Map(),welded=new Uint32Array(vertProperties.length/numProp),edges=new Map();
 for(let i=0;i<welded.length;i++){const point=[vertProperties[i*numProp],vertProperties[i*numProp+1],vertProperties[i*numProp+2]];if(point.some(n=>!Number.isFinite(n)))throw Error('The export contains invalid coordinates.');const key=point.join(',');if(!ids.has(key))ids.set(key,ids.size);welded[i]=ids.get(key);}
 for(let i=0;i<triVerts.length;i+=3){const v=[triVerts[i],triVerts[i+1],triVerts[i+2]],w=v.map(i=>welded[i]);if(new Set(w).size!==3)throw Error('A triangle collapsed at export precision. Try smoother tracing.');const a=v.map(i=>[vertProperties[i*numProp],vertProperties[i*numProp+1],vertProperties[i*numProp+2]]),u=a[1].map((n,k)=>n-a[0][k]),b=a[2].map((n,k)=>n-a[0][k]);if(Math.hypot(u[1]*b[2]-u[2]*b[1],u[2]*b[0]-u[0]*b[2],u[0]*b[1]-u[1]*b[0])<1e-14)throw Error('An export triangle has zero area. Try smoother tracing.');
 for(let k=0;k<3;k++){const x=w[k],y=w[(k+1)%3],key=x<y?x+','+y:y+','+x;const edge=edges.get(key)||{count:0,direction:0};edge.count++;edge.direction+=x<y?1:-1;edges.set(key,edge);}}
 for(const edge of edges.values())if(edge.count!==2||edge.direction!==0)throw Error('The model has a non-manifold edge at export precision. Try smoother tracing or fewer colors.');
}
