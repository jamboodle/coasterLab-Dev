import {stlMeshXML} from '../shared/stl-mesh.js';

const bed = 256, margin = 3;

export function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], {type}));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function zip(files) {
  return new Promise((resolve, reject) => {
    window.fflate.zip(files, {level: 4}, (error, result) => error ? reject(error) : resolve(result));
  });
}

export async function stlZip(parts, notes, map) {
  const files = Object.fromEntries(parts.map(part => [part.name + '.stl', new Uint8Array(part.buffer)]));
  files['ASSEMBLY.txt'] = window.fflate.strToU8(notes);
  if (map) files['assembly-map.png'] = new Uint8Array(await map.arrayBuffer());
  return zip(files);
}

export async function project3MF(parts) {
  const objects = [], placements = [];
  let x = margin, y = margin, row = 0;
  let oversized = false;
  for (const [index, part] of parts.entries()) {
    const {min, max} = part.bounds;
    const width = max[0] - min[0], height = max[1] - min[1];
    if (x !== margin && x + width > bed - margin) {
      x = margin;
      y += row + margin;
      row = 0;
    }
    if (x + width > bed - margin || y + height > bed - margin) oversized = true;
    const id = index + 1;
    const {xml} = stlMeshXML(part.buffer);
    objects.push(`<object id="${id}" name="${part.name}" type="model"><mesh>${xml}</mesh></object>`);
    placements.push(`<item objectid="${id}" transform="1 0 0 0 1 0 0 0 1 ${x - min[0]} ${y - min[1]} 0"/>`);
    x += width + margin;
    row = Math.max(row, height);
    // Large STL conversions run in batches so the page can respond during export.
    if (index % 5 === 4) await new Promise(resolve => setTimeout(resolve, 0));
  }
  const files = {
    '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>',
    '_rels/.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>',
    '3D/3dmodel.model': '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">' +
      '<metadata name="Application">CoasterPrint Suncatcher Maker</metadata><resources>' + objects.join('') +
      '</resources><build>' + placements.join('') + '</build></model>'
  };
  return {oversized, bytes: await zip(Object.fromEntries(Object.entries(files).map(([name, value]) =>
    [name, window.fflate.strToU8('<?xml version="1.0" encoding="UTF-8"?>' + value)])))};
}
