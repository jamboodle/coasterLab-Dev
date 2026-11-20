import {printGuide} from '../shared/plaque-layout.js';

function archive(files) {
  return new Promise((resolve, reject) => {
    window.fflate.zip(files, {level: 4}, (error, bytes) => error ? reject(error) : resolve(bytes));
  });
}

export function downloadFile(name, bytes, type) {
  const url = URL.createObjectURL(new Blob([bytes], {type}));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export function plaqueSTLs(model) {
  const files = Object.fromEntries(model.parts.map(part => [part.name + '.stl', new Uint8Array(part.buffer)]));
  files['FILAMENT-HEIGHTS.txt'] = window.fflate.strToU8(printGuide(model));
  return archive(files);
}

export function preparePlaqueUpload(model) {
  let triangles = 0;
  const parts = model.parts.map(part => {
    triangles += new DataView(part.buffer).getUint32(80, true);
    if (triangles > 400000) throw Error('The plaque is too complex for 3MF. Try Smooth detail or download the free STL.');
    const bytes = new Uint8Array(part.buffer);
    let buffer;
    if (typeof bytes.toBase64 === 'function') buffer = bytes.toBase64();
    else {
      let binary = '';
      for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
      buffer = btoa(binary);
    }
    return {source: part.source, color: part.color, top: part.top, buffer};
  });
  return JSON.stringify({format: 'plaque', parts});
}
