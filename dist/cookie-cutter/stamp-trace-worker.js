self.onmessage = async ({data: {image, mode, colors, threshold, invert, smoothing, scripts}}) => {
  try {
    importScripts('/vendor/imagetracer.js');
    if (mode === 'color') importScripts('/' + scripts['palette.js'], '/' + scripts['alpha.js']);
    const [{detectColorBoundaries, detectStamp}, {pathContours}] = await Promise.all([
      import('./trace.js'), import('/' + scripts['stl-geometry.js'])
    ]);
    const paths = mode === 'color'
      ? detectColorBoundaries(image, colors, smoothing, pathContours)
      : detectStamp(image, threshold, invert, smoothing, pathContours);
    self.postMessage({paths});
  } catch (error) {
    self.postMessage({error: error.message || 'Could not trace the stamp.'});
  }
};
