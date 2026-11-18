import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp, mkdir, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {handler} from '../server/app.mjs';
import {artworkLibrary} from '../server/artwork.mjs';
import {Ledger} from '../server/ledger.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4ioAAAAASUVORK5CYII=', 'base64');

test('artwork access, reindexing, changed images, and persistent tag reuse', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'coaster-artwork-'));
  const ledger = new Ledger(':memory:');
  const admin = ledger.registerIdentity('admin@example.com', 'salt', 'digest');
  const user = ledger.registerIdentity('user@example.com', 'salt', 'digest');
  ledger.makeAdmin('admin@example.com');
  const adminCookie = 'cl_session=' + ledger.createSession(admin);
  const userCookie = 'cl_session=' + ledger.createSession(user);
  let requests = 0;
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  const options = {
    dataDir, key: 'fixture-key',
    async fetchImpl(url, options) {
      requests++;
      assert.equal(url, 'https://api.openai.com/v1/chat/completions');
      assert.equal(options.headers.Authorization, 'Bearer fixture-key');
      assert.match(JSON.parse(options.body).messages[0].content[1].image_url.url, /^data:image\/png;base64,/);
      await blocked;
      return Response.json({choices: [{message: {content: '{"tags":["Fox"," orange ","fox"]}'}}]});
    }
  };
  let artwork = artworkLibrary(options);
  const server = createServer((req, res) => handler({ledger, origin, artwork})(req, res));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const root = join(dataDir, 'artwork');
  const file = join(root, 'Forest-life', 'Orange_Fox.png');
  const list = () => fetch(origin + '/api/artwork').then(response => response.json()).then(data => data.artwork);
  const adminRequest = (reindex = false, cookie = adminCookie, requestOrigin = origin) =>
    fetch(origin + '/api/admin/artwork' + (reindex ? '/reindex' : ''), {
      method: reindex ? 'POST' : 'GET', headers: {Cookie: cookie, Origin: requestOrigin}
    });
  async function waitForIndex() {
    for (let i = 0; i < 100; i++) {
      const status = await adminRequest().then(response => response.json());
      if (!status.running) return status;
      await delay(20);
    }
    assert.fail('Index did not finish');
  }
  try {
    await mkdir(join(root, 'Forest-life'), {recursive: true});
    await writeFile(file, png);
    await writeFile(join(root, 'invalid.png'), 'plain text');
    await writeFile(join(dataDir, 'outside.png'), png);
    await symlink(join(dataDir, 'outside.png'), join(root, 'linked.png'));
    assert.equal((await adminRequest(false, '')).status, 401);
    assert.equal((await adminRequest(true, userCookie)).status, 403);
    assert.equal((await adminRequest(true, adminCookie, 'https://other.example')).status, 403);
    assert.deepEqual(await list(), []);
    assert.equal((await adminRequest(true)).status, 202);
    assert.equal((await adminRequest(true)).status, 409);
    release();
    const status = await waitForIndex();
    assert.equal(status.tagged, 1);
    assert.equal(status.skipped, 1);
    assert.equal(status.failed, 0);
    assert.equal(requests, 1);
    const [design] = await list();
    assert.deepEqual(Object.keys(design).sort(), ['category', 'id', 'tags', 'title', 'url']);
    assert.equal(design.title, 'Orange Fox');
    assert.equal(design.category, 'Forest life');
    assert.deepEqual(design.tags, ['fox', 'orange']);
    const image = await fetch(origin + design.url);
    assert.equal(image.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await image.arrayBuffer()), png);

    artwork = artworkLibrary(options);
    assert.deepEqual(await list(), [design]);
    assert.equal((await adminRequest(true)).status, 202);
    await waitForIndex();
    assert.equal(requests, 1);

    await writeFile(file, Buffer.concat([png, Buffer.from([0])]));
    assert.equal((await fetch(origin + design.url)).status, 404);
    assert.equal((await adminRequest(true)).status, 202);
    assert.equal((await waitForIndex()).tagged, 1);
    assert.equal(requests, 2);

    await rm(file);
    assert.equal((await adminRequest(true)).status, 202);
    assert.equal((await waitForIndex()).indexed, 0);
    assert.deepEqual(await list(), []);
  } finally {
    release();
    await waitForIndex();
    await new Promise(resolve => server.close(resolve));
    ledger.close();
    await rm(dataDir, {recursive: true, force: true});
  }
});
