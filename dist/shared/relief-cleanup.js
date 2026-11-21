// Measure printable fragments after scaling the artwork to millimeters.
export function removeReliefSpecks(CrossSection, keep, shape, minimumArea) {
  const parts = shape.decompose().map(keep);
  const areas = parts.map(part => part.area());
  const minimum = typeof minimumArea === 'function' ? minimumArea(Math.max(0, ...areas)) : minimumArea;
  const retained = parts.filter((_, index) => areas[index] >= minimum);
  const removed = parts.length - retained.length;
  return {shape: removed ? keep(CrossSection.union(retained)) : shape, removed};
}
