import Module from './vendor/manifold.js';
import {pathContours,signedArea,binarySTL} from './stl-geometry.33a24be249c4.js';
onmessage=async({data:{paths,rimSealPx,edgeRemovedD,perimeterD,perimeterMaskD,perimeterFill,perimeterRimPx,viewWidth,widthMM,baseMM,topMM,includeSTL=true}})=>{
 const owned=[];const keep=x=>{owned.push(x);return x;};const warnings=[];
 try{
 for(const n of [widthMM,baseMM,topMM])if(!Number.isFinite(n)||n<=0)throw Error('Width and layer thicknesses must be greater than zero.');
 if(!(viewWidth>0))throw Error('The SVG has no usable dimensions.');
 const module=await Module({locateFile:name=>new URL('vendor/'+name,import.meta.url).href});module.setup();const {CrossSection,Manifold}=module;
 // The JS wrapper dereferences contours[0] even for an empty array.
 const cross=(contours,rule='NonZero')=>keep(contours.length?new CrossSection(contours,rule):CrossSection.union([]));
 const sharedPerimeter=perimeterD?cross(pathContours(perimeterD,widthMM/viewWidth)):null;
 const rawSections=paths.map(p=>({fill:p.fill,shape:cross(pathContours(p.d,widthMM/viewWidth),p.fillRule==='evenodd'?'EvenOdd':'NonZero')})).map(p=>sharedPerimeter?{fill:p.fill,shape:keep(p.shape.intersect(sharedPerimeter))}:p).filter(p=>!p.shape.isEmpty());
 const byColor=new Map();for(const p of rawSections){if(byColor.has(p.fill))byColor.set(p.fill,keep(byColor.get(p.fill).add(p.shape)));else byColor.set(p.fill,p.shape);}
 if(sharedPerimeter&&perimeterFill&&perimeterRimPx>0&&rawSections.length){const originalUnion=keep(CrossSection.union(rawSections.map(p=>p.shape)));const inset=keep(sharedPerimeter.offset(-perimeterRimPx*widthMM/viewWidth,'Round',2,24));let ring=keep(sharedPerimeter.subtract(inset));if(perimeterMaskD)ring=keep(ring.intersect(cross(pathContours(perimeterMaskD,widthMM/viewWidth))));let patch=keep(ring.subtract(originalUnion));const holes=originalUnion.toPolygons().filter(p=>signedArea(p)<0).map(p=>p.slice().reverse());if(holes.length)patch=keep(patch.subtract(cross(holes,'Positive')));if(!patch.isEmpty())byColor.set(perimeterFill,byColor.has(perimeterFill)?keep(byColor.get(perimeterFill).add(patch)):patch);}
 if(sharedPerimeter&&edgeRemovedD&&perimeterFill){let patch=cross(pathContours(edgeRemovedD,widthMM/viewWidth));patch=keep(patch.offset(.25*widthMM/viewWidth,'Round',2,16));patch=keep(patch.intersect(sharedPerimeter));if(perimeterMaskD)patch=keep(patch.intersect(cross(pathContours(perimeterMaskD,widthMM/viewWidth))));byColor.set(perimeterFill,byColor.has(perimeterFill)?keep(byColor.get(perimeterFill).add(patch)):patch);}
 // A visible final seal, unlike the missing-area underlay above, owns the rim.
 // Subtract it from every other color so long/connected slivers cannot win by paint order.
 if(sharedPerimeter&&rimSealPx>0&&perimeterFill){const inner=keep(sharedPerimeter.offset(-rimSealPx*widthMM/viewWidth,'Round',2,24));let seal=keep(sharedPerimeter.subtract(inner));if(perimeterMaskD)seal=keep(seal.intersect(cross(pathContours(perimeterMaskD,widthMM/viewWidth))));for(const [fill,shape]of byColor)if(fill!==perimeterFill)byColor.set(fill,keep(shape.subtract(seal)));byColor.set(perimeterFill,byColor.has(perimeterFill)?keep(byColor.get(perimeterFill).add(seal)):seal);}
 const sections=[...byColor].filter(([,shape])=>!shape.isEmpty()).map(([fill,shape])=>({fill,shape}));
 if(!sections.length)throw Error('No filled paths to convert.');
 const footprint=keep(CrossSection.union(sections.map(p=>p.shape))),bounds=footprint.bounds();const factor=widthMM/(bounds.max[0]-bounds.min[0]);if(!Number.isFinite(factor))throw Error('The image outline is empty.');
 const normalise=shape=>keep(keep(shape.translate([-bounds.min[0],-bounds.min[1]])).scale(factor));
 const prepare=(shape,tolerance)=>{if(!tolerance)return shape;const inset=keep(shape.offset(-tolerance,'Round',2,12));if(inset.isEmpty())return shape;const opened=keep(inset.offset(tolerance,'Round',2,12));return opened.isEmpty()?shape:opened;};
 const clean=(solid,tolerance)=>keep(keep(solid.asOriginal()).setTolerance(tolerance?Math.max(.002,tolerance*2):1e-6));
 function exportLayer(shape,z,height,label){let lastError;for(const tolerance of [.005,0,.01,.02]){try{const prepared=prepare(shape,tolerance),solid=keep(keep(prepared.extrude(height)).translate([0,0,z]));const output=binarySTL(clean(solid,tolerance),label+'; units mm');if(output.precisionCleanup)warnings.push(label+' removed '+output.precisionCleanup+' collapsed export faces; the repaired mesh passed watertight validation.');if(tolerance>.005)warnings.push(label+' required '+tolerance+' mm cleanup; microscopic features may change.');return {...output,solid};}catch(e){lastError=e;}}
 // A spatially coincident contact can be topologically valid in WASM yet
 // non-manifold after float32 welding. Separate only the failed color's
 // boundary by a micron-scale inset; keep validation fully enabled.
 if(z>0){for(const separation of [.001,.002,.005]){try{const separated=keep(shape.offset(-separation,'Round',2,12));if(separated.isEmpty())continue;const solid=keep(keep(separated.extrude(height)).translate([0,0,z]));const output=binarySTL(clean(solid,0),label+'; units mm');if(output.precisionCleanup)warnings.push(label+' removed '+output.precisionCleanup+' collapsed export faces; the repaired mesh passed watertight validation.');warnings.push(label+' needed '+separation+' mm boundary separation; microscopic regions may shrink or disappear.');return {...output,solid};}catch(e){lastError=e;}}}
 throw Error(label+': '+(lastError.message||String(lastError)));}
 const outerLoops=footprint.toPolygons().filter(p=>signedArea(p)>0);
 const baseShape=normalise(cross(outerLoops,'Positive'));
 postMessage({progress:'Building solid base…'});
 const base=exportLayer(baseShape,0,baseMM,'Solid base');let occupied=null;const layers=[];
 for(let i=sections.length-1;i>=0;i--){postMessage({progress:'Building color layer '+(sections.length-i)+' of '+sections.length+'…'});const section=sections[i],shape=occupied?keep(section.shape.subtract(occupied)):section.shape;occupied=occupied?keep(occupied.add(section.shape)):section.shape;if(shape.isEmpty())continue;const part=exportLayer(normalise(shape),baseMM,topMM,'Color '+(i+1)+' '+section.fill);layers.unshift({fill:section.fill,index:i+1,...part});}
 // The merged STL is optional. A failure here must not suppress validated 3MF parts.
 let combined=null,combinedSolid=null,combinedError='';
 if(includeSTL)postMessage({progress:'Building optional merged STL…'});
 if(includeSTL)for(const tolerance of [.005,0,.01,.02]){try{const topShape=prepare(normalise(footprint),tolerance);const top=keep(keep(topShape.extrude(topMM)).translate([0,0,baseMM]));const solid=keep(Manifold.union([base.solid,top]));combined=binarySTL(clean(solid,tolerance));combinedSolid=solid;if(tolerance>.005)warnings.push('Merged STL required '+tolerance+' mm cleanup.');break;}catch(e){combinedError=e.message||String(e);}}
 if(includeSTL&&!combined)warnings.push('Merged STL unavailable: '+combinedError+'. Validated multipart 3MF and STL parts remain available.');
 const b=base.solid.boundingBox();const dimensions={min:[...b.min],max:[b.max[0],b.max[1],baseMM+topMM]};
 const output={baseFill:perimeterFill||layers[0]?.fill,combined,base:{buffer:base.buffer,triangles:base.triangles},parts:layers.map(({fill,index,buffer,triangles})=>({fill,index,buffer,triangles})),dimensions,baseMM,topMM,widthMM,volume:combinedSolid?combinedSolid.volume():null,warnings};
 const transfer=[output.base.buffer,...output.parts.map(p=>p.buffer)];if(combined)transfer.push(combined.buffer);postMessage(output,transfer);
 }catch(e){postMessage({error:e.message||String(e)});}finally{for(const object of owned.reverse())try{object.delete();}catch{}}
};
