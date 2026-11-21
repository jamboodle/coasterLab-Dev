import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {link, rename, rm, writeFile} from 'node:fs/promises';
import {dirname, extname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const script = fileURLToPath(new URL('./resource-image.py', import.meta.url));
const pngSignature = '89504e470d0a1a0a';
const maxBytes = 20 * 1024 * 1024;

function python(args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn('python3', args, {stdio: ['pipe', 'pipe', 'ignore']});
    const chunks = [];
    let size = 0;
    const timer = setTimeout(() => child.kill('SIGKILL'), 30000);
    child.stdout.on('data', chunk => {
      size += chunk.length;
      if (size > maxBytes) child.kill('SIGKILL');
      else chunks.push(chunk);
    });
    child.stdin.on('error', () => {});
    child.on('error', reject);
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0 && size <= maxBytes) resolve(Buffer.concat(chunks));
      else reject(Error('Resource image could not be decoded as PNG or WebP.'));
    });
    child.stdin.end(input);
  });
}

export async function checkResourceDecoder() {
  await python(['-c', 'from PIL import features; assert features.check("webp")'], Buffer.alloc(0));
}

export async function normalizeResource(root, relative, image, readImage) {
  if (!['image/png', 'image/webp'].includes(image.type)) throw Error('Only PNG and WebP resources are accepted.');
  const png = await python([script], image.bytes);
  const extension = extname(relative);
  if (!png.length && image.type !== 'image/png') throw Error('WebP conversion did not return a PNG.');
  if (!png.length && extension === '.png') return {relative, converted: false, bytes: image.bytes};
  if (png.length && png.subarray(0, 8).toString('hex') !== pngSignature) throw Error('Invalid converted PNG.');
  const output = relative.slice(0, -extension.length) + '.png';
  const path = join(root, relative);
  const temp = join(dirname(path), '.resource-' + randomUUID());
  try {
    await writeFile(temp, png.length ? png : image.bytes, {flag: 'wx', mode: 0o644});
    const current = await readImage(root, relative);
    if (!current.bytes.equals(image.bytes)) throw Error('Resource changed during conversion.');
    if (output === relative) {
      await rename(temp, path);
    } else {
      // Creating the output must never overwrite a different resource with the same stem.
      await link(temp, join(root, output));
      await rm(path);
    }
  } finally {
    await rm(temp, {force: true});
  }
  return {relative: output, converted: png.length > 0, bytes: png.length ? png : image.bytes};
}
