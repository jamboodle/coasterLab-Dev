import {stlMeshXML} from '../shared/stl-mesh.js';
import {assignProjectPalette} from '../shared/bambu-palette.js';

const margin = 3;
const farEdge = 253;
const gap = 6;

function arrange(parts, placed = []) {
  if (!parts.length) return placed;
  const xs = [margin, 24, ...placed.map(part => part.x + part.w + gap)];
  const ys = [margin, 34, ...placed.map(part => part.y + part.h + gap)];
  for (const part of parts) {
    for (const rotated of [false, true]) {
      const [w, h] = rotated ? [part.height, part.width] : [part.width, part.height];
      for (const y of ys) for (const x of xs) {
        if (x + w > farEdge || y + h > farEdge || (x < 24 && y < 34)) continue;
        if (placed.some(other => x < other.x + other.w + gap && x + w + gap > other.x &&
          y < other.y + other.h + gap && y + h + gap > other.y)) continue;
        const next = arrange(parts.filter(candidate => candidate !== part), [...placed, {...part, x, y, w, h, rotated}]);
        if (next) return next;
      }
    }
  }
}

export async function cookieProject(cutter) {
  const parts = [{...cutter, title: 'Cookie cutter'}];
  if (cutter.stamp) parts.push({...cutter.stamp, title: 'Embossing stamp'},
    {...cutter.stamp.handle, title: 'Ring handle'});
  const placed = arrange(parts);
  if (!placed) throw Error('These parts do not fit together on one P1S plate. Reduce the cookie size or download the individual STLs.');

  const response = await fetch('/presets/bambu-p1s-04.json');
  if (!response.ok) throw Error('The Bambu printer preset could not be loaded. Try again or download STL.');
  const settings = await response.json();
  assignProjectPalette(settings, [settings.filament_colour[0]]);
  settings.enable_prime_tower = '0';

  const objects = [], build = [], configs = [], instances = [], assemblies = [];
  for (const [index, part] of placed.entries()) {
    const id = index + 1;
    const meshId = id + 3;
    const {xml, count} = stlMeshXML(part.buffer);
    const transform = part.rotated
      ? `0 1 0 -1 0 0 0 0 1 ${part.x + part.w} ${part.y} 0`
      : `1 0 0 0 1 0 0 0 1 ${part.x} ${part.y} 0`;
    objects.push(`<object id="${meshId}" type="model" name="${part.title}"><mesh>${xml}</mesh></object>` +
      `<object id="${id}" type="model" name="${part.title}"><components><component objectid="${meshId}"/></components></object>`);
    build.push(`<item objectid="${id}" transform="${transform}"/>`);
    configs.push(`<object id="${id}"><metadata key="name" value="${part.title}"/><metadata key="extruder" value="1"/>` +
      `<part id="${meshId}" subtype="normal_part"><metadata key="name" value="${part.title}"/><metadata key="extruder" value="1"/>` +
      `<mesh_stat face_count="${count}" edges_fixed="0" degenerate_facets="0" facets_removed="0" facets_reversed="0" backwards_edges="0"/></part></object>`);
    instances.push(`<model_instance><metadata key="object_id" value="${id}"/><metadata key="instance_id" value="0"/></model_instance>`);
    assemblies.push(`<assemble_item object_id="${id}" instance_id="0" transform="${transform}" offset="0 0 0"/>`);
  }

  const header = '<?xml version="1.0" encoding="UTF-8"?>';
  const entries = {
    '[Content_Types].xml': header + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/><Default Extension="config" ContentType="application/xml"/></Types>',
    '_rels/.rels': header + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>',
    '3D/3dmodel.model': header + '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021">' +
      '<metadata name="Application">BambuStudio-02.08.02.61</metadata><metadata name="BambuStudio:3mfVersion">1</metadata>' +
      '<metadata name="Description">CoasterPrint Cookie Cutter Maker</metadata><resources>' + objects.join('') +
      '</resources><build>' + build.join('') + '</build></model>',
    'Metadata/model_settings.config': header + '<config>' + configs.join('') +
      '<plate><metadata key="plater_id" value="1"/><metadata key="plater_name" value="Cookie cutter set"/>' +
      instances.join('') + '</plate><assemble>' + assemblies.join('') + '</assemble></config>',
    'Metadata/project_settings.config': JSON.stringify(settings)
  };
  const files = Object.fromEntries(Object.entries(entries).map(([name, value]) => [name, window.fflate.strToU8(value)]));
  return new Promise((resolve, reject) => window.fflate.zip(files, {level: 4}, (error, bytes) =>
    error ? reject(error) : resolve(bytes)));
}
