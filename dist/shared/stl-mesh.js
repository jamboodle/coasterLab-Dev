export function stlMeshXML(buffer) {
  const view = new DataView(buffer);
  const count = view.getUint32(80, true);
  const vertices = [], triangles = [], indices = new Map();
  for (let triangle = 0; triangle < count; triangle++) {
    const ids = [];
    for (let corner = 0; corner < 3; corner++) {
      const offset = 96 + triangle * 50 + corner * 12;
      const x = view.getFloat32(offset, true);
      const y = view.getFloat32(offset + 4, true);
      const z = view.getFloat32(offset + 8, true);
      const key = [x, y, z].join(',');
      if (!indices.has(key)) {
        indices.set(key, vertices.length);
        vertices.push(`<vertex x="${x}" y="${y}" z="${z}"/>`);
      }
      ids.push(indices.get(key));
    }
    triangles.push(`<triangle v1="${ids[0]}" v2="${ids[1]}" v3="${ids[2]}"/>`);
  }
  return {count, xml: '<vertices>' + vertices.join('') + '</vertices><triangles>' + triangles.join('') + '</triangles>'};
}
