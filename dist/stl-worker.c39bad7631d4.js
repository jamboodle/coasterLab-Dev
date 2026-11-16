import Module from './vendor/manifold.js';
import {pathContours,signedArea,binarySTL} from './stl-geometry.b4347e0cda55.js';
onmessage=async({data:{paths,perimeterD,perimeterMaskD,perimeterFill,perimeterRimPx,viewWidth,widthMM,baseMM,topMM}})=>{
 const owned=[];const keep=x=>{owned.push(x);return x;};const warnings=[];
 try{
 for(const n of [widthMM,baseMM,topMM])if(!Number.isFinite(n)||n<=0)throw Error('Width and layer thicknesses must be greater than zero.');
 if(!(viewWidth>0))throw Error('The SVG has no usable dimensions.');
 const module=await Module({locateFile:name=>new URL('vendor/'+name,import.meta.url).href});module.setup();const {CrossSection,Manifold}=module;
 const sharedPerimeter=perimeterD?keep(new CrossSection(pathContours(perimeterD,widthMM/viewWidth),'NonZero')):null;
 const rawSections=paths.map(p=>({fill:p.fill,shape:keep(new CrossSection(pathContours(p.d,widthMM/viewWidth),p.fillRule==='evenodd'?'EvenOdd':'NonZero'))})).map(p=>sharedPerimeter?{fill:p.fill,shape:keep(p.shape.intersect(sharedPerimeter))}:p).filter(p=>!p.shape.isEmpty());
 const byColor=new Map();for(const p of rawSections){if(byColor.has(p.fill))byColor.set(p.fill,keep(byColor.get(p.fill).add(p.shape)));else byColor.set(p.fill,p.shape);}
 if(sharedPerimeter&&perimeterFill&&perimeterRimPx>0&&rawSections.length){const originalUnion=keep(CrossSection.union(rawSections.map(p=>p.shape)));const inset=keep(sharedPerimeter.offset(-perimeterRimPx*widthMM/viewWidth,'Round',2,24));let ring=keep(sharedPerimeter.subtract(inset));if(perimeterMaskD)ring=keep(ring.intersect(keep(new CrossSection(pathContours(perimeterMaskD,widthMM/viewWidth),'NonZero'))));let patch=keep(ring.subtract(originalUnion));const holes=originalUnion.toPolygons().filter(p=>signedArea(p)<0).map(p=>p.slice().reverse());if(holes.length)patch=keep(patch.subtract(keep(new CrossSection(holes,'Positive'))));if(!patch.isEmpty())byColor.set(perimeterFill,byColor.has(perimeterFill)?keep(byColor.get(perimeterFill).add(patch)):patch);}
 const sections=[...byColor].map(([fill,shape])=>({fill,shape}));
 if(!sections.length)throw Error('No filled paths to convert.');
 const footprint=keep(CrossSection.union(sections.map(p=>p.shape))),bounds=footprint.bounds();const factor=widthMM/(bounds.max[0]-bounds.min[0]);if(!Number.isFinite(factor))throw Error('The image outline is empty.');
 const normalise=shape=>keep(keep(shape.translate([-bounds.min[0],-bounds.min[1]])).scale(factor));
 const prepare=(shape,tolerance)=>{if(!tolerance)return shape;const inset=keep(shape.offset(-tolerance,'Round',2,12));if(inset.isEmpty())return shape;const opened=keep(inset.offset(tolerance,'Round',2,12));return opened.isEmpty()?shape:opened;};
 const clean=(solid,tolerance)=>keep(keep(solid.asOriginal()).setTolerance(tolerance?Math.max(.002,tolerance*2):1e-6));
 function exportLayer(shape,z,height,label){let lastError;for(const tolerance of [.005,0,.01,.02]){try{const prepared=prepare(shape,tolerance),solid=keep(keep(prepared.extrude(height)).translate([0,0,z]));const output=binarySTL(clean(solid,tolerance),label+'; units mm');if(tolerance>.005)warnings.push(label+' required '+tolerance+' mm cleanup; microscopic features may change.');return {...output,solid};}catch(e){lastError=e;}}
 // A spatially coincident contact can be topologically valid in WASM yet
 // non-manifold after float32 welding. Separate only the failed color's
 // boundary by a micron-scale inset; keep validation fully enabled.
 if(z>0){for(const separation of [.001,.002,.005]){try{const separated=keep(shape.offset(-separation,'Round',2,12));if(separated.isEmpty())continue;const solid=keep(keep(separated.extrude(height)).translate([0,0,z]));const output=binarySTL(clean(solid,0),label+'; units mm');warnings.push(label+' needed '+separation+' mm boundary separation; microscopic regions may shrink or disappear.');return {...output,solid};}catch(e){lastError=e;}}}
 throw Error(label+': '+(lastError.message||String(lastError)));}
 const outerLoops=footprint.toPolygons().filter(p=>signedArea(p)>0);
 const baseShape=normalise(keep(new CrossSection(outerLoops,'Positive')));
 const base=exportLayer(baseShape,0,baseMM,'Solid base');let occupied=null;const layers=[];
 for(let i=sections.length-1;i>=0;i--){const section=sections[i],shape=occupied?keep(section.shape.subtract(occupied)):section.shape;occupied=occupied?keep(occupied.add(section.shape)):section.shape;if(shape.isEmpty())continue;const part=exportLayer(normalise(shape),baseMM,topMM,'Color '+(i+1)+' '+section.fill);layers.unshift({fill:section.fill,index:i+1,...part});}
 // The merged STL is optional. A failure here must not suppress validated 3MF parts.
 let combined=null,combinedSolid=null,combinedError='';
 for(const tolerance of [.005,0,.01,.02]){try{const topShape=prepare(normalise(footprint),tolerance);const top=keep(keep(topShape.extrude(topMM)).translate([0,0,baseMM]));const solid=keep(Manifold.union([base.solid,top]));combined=binarySTL(clean(solid,tolerance));combinedSolid=solid;if(tolerance>.005)warnings.push('Merged STL required '+tolerance+' mm cleanup.');break;}catch(e){combinedError=e.message||String(e);}}
 if(!combined)warnings.push('Merged STL unavailable: '+combinedError+'. Validated multipart 3MF and STL parts remain available.');
 const b=base.solid.boundingBox();const dimensions={min:[...b.min],max:[b.max[0],b.max[1],baseMM+topMM]};
 const output={combined,base:{buffer:base.buffer,triangles:base.triangles},parts:layers.map(({fill,index,buffer,triangles})=>({fill,index,buffer,triangles})),dimensions,baseMM,topMM,widthMM,volume:combinedSolid?combinedSolid.volume():null,warnings};
 const transfer=[output.base.buffer,...output.parts.map(p=>p.buffer)];if(combined)transfer.push(combined.buffer);postMessage(output,transfer);
 }catch(e){postMessage({error:e.message||String(e)});}finally{for(const object of owned.reverse())try{object.delete();}catch{}}
};
