export function printGuide(model) {
  return [
    'CoasterPrint Plaque Maker', '',
    'The 3MF contains a single assembled plaque. Preserve the relative positions of all tiers.',
    'The STL coordinates are millimeters. Import them together as one multipart object to preserve the Z offsets.',
    'Each listed height is measured from the build plate.',
    'For manual filament swaps, use the slicer preview to pick the first layer of each new tier.',
    '',
    ...model.parts.map(part => `${part.name}: artwork ${part.source}, filament ${part.color}, Z ${part.bottom}–${part.top} mm`)
  ].join('\n');
}

export function bambuPlacement({width, height}) {
  let x = (256 - width) / 2, y = (256 - height) / 2;
  // Reserve 6 mm around the P1S front-left 18 × 28 mm exclusion.
  const xClear = 24, yClear = 34, farEdge = 253;
  if (x < xClear && y < yClear) {
    const canShiftX = xClear + width <= farEdge;
    const canShiftY = yClear + height <= farEdge;
    if (canShiftX && (!canShiftY || xClear - x <= yClear - y)) x = xClear;
    else if (canShiftY) y = yClear;
  }
  return {x, y, checkExclusion: x < xClear && y < yClear};
}
