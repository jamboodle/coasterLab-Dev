"""Validate resource PNGs and decode single-frame WebP files to PNG."""
import io
import sys
import warnings

from PIL import Image

Image.MAX_IMAGE_PIXELS = 32_000_000
warnings.simplefilter('error', Image.DecompressionBombWarning)

source = io.BytesIO(sys.stdin.buffer.read())
with Image.open(source, formats=['PNG', 'WEBP']) as image:
    kind = image.format
    image.verify()
source.seek(0)
with Image.open(source, formats=[kind]) as image:
    image.load()
    if kind == 'WEBP':
        if getattr(image, 'is_animated', False):
            raise ValueError('Animated WebP needs a manual PNG export.')
        result = io.BytesIO()
        image.convert('RGBA').save(result, 'PNG')
        sys.stdout.buffer.write(result.getvalue())
