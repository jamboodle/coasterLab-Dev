import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {handler} from '../server/app.mjs';
import {Ledger} from '../server/ledger.mjs';
import {withStatic} from '../server/static.mjs';

const {chromium, devices} = createRequire(import.meta.url)('playwright');
const ledger = new Ledger(':memory:');
const account = ledger.registerIdentity('member@example.test', 'salt', 'digest');
ledger.saveSettings(account,{billingEnabled:true});
ledger.savePro(account,'test','sub_browser','cus_browser','active',Date.now()+3600000);
const session = ledger.createSession(account);
const startingBalance = ledger.balance(account);
let origin, browser;
const server = createServer(withStatic((req,res) => handler({ledger,origin,customerAccounts:true,
  secretKey:'sk_test_12345',webhookSecret:'whsec_browser'})(req,res),fileURLToPath(new URL('../dist/',import.meta.url))));
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
origin = 'http://127.0.0.1:' + server.address().port;

try {
  browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox','--enable-unsafe-swiftshader']});
  const context = await browser.newContext(devices['iPhone 13']);
  await context.addCookies([{name:'cl_session',value:session,url:origin}]);
  await context.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args);
        this.addEventListener('message', ({data}) => {
          const result = data.stamp || data.result || data;
          if (typeof result.imprinted === 'boolean') window.lastImprinted = result.imprinted;
        });
      }
    };
  });
  const page = await context.newPage();
  page.setDefaultTimeout(60000);
  await page.goto(origin + '/pricing/#pro');
  await page.getByText('Pro is active on your account.', {exact:true}).waitFor();
  await page.getByRole('button',{name:'Manage subscription'}).waitFor();

  for (const {maker, path, size, build, download, trigger, value, other} of [
    {maker:'coaster',path:'/',size:'#modelWidth',build:'#trace',download:'#download3MF',value:'90',other:'100'},
    {maker:'plaque',path:'/plaque/',size:'#width',build:'#build',download:'#project',trigger:'#sample',value:'85',other:'100'},
    {maker:'cutter',path:'/cookie-cutter/',size:'#width',build:'#build',download:'#download-project',trigger:'#sample',value:'70',other:'80'}
  ]) {
    await page.goto(origin + path);
    const projects = page.locator('.pro-projects');
    const presets = page.locator('.pro-presets');
    const gallery = page.getByRole('dialog',{name:'Saved projects'});
    const browse = projects.getByRole('button',{name:'Browse saved projects'});
    const blockTwo = {coaster:'#customize-coaster',plaque:'section[aria-labelledby="height-title"]',
      cutter:'section[aria-labelledby="size-title"]'}[maker];
    await page.locator(blockTwo + ' + .pro-library').waitFor();
    await projects.locator('summary').click();
    await presets.locator('summary').click();
    if (trigger) {
      await page.locator(trigger).click();
      await page.locator(build).and(page.locator(':enabled')).waitFor();
    } else {
      const png = await page.evaluate(() => {
        const canvas = Object.assign(document.createElement('canvas'), {width:100,height:100});
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0,0,100,100);
        ctx.fillStyle = '#122258'; ctx.fillRect(20,20,60,60);
        return canvas.toDataURL().split(',')[1];
      });
      await page.locator('#files').setInputFiles({name:'Pro.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
      await page.locator('#queue .card').waitFor();
    }
    await page.locator(size).fill(value);
    const projectName = projects.getByRole('textbox',{name:'Project name'});
    await projectName.fill('Saved ' + maker);
    await projects.getByRole('button',{name:'Save new project'}).click();
    await projects.getByText('Project saved.',{exact:true}).waitFor();
    await gallery.waitFor({state:'hidden'});
    assert.equal(await projects.locator('img').count(),0);
    await browse.click();
    const image = gallery.locator('.pro-project-preview img');
    await image.scrollIntoViewIfNeeded();
    await page.waitForFunction(() => document.querySelector('.pro-project-preview img')?.naturalWidth > 0);
    assert.ok(await image.evaluate(img => Math.max(img.naturalWidth,img.naturalHeight) <= 240));
    await page.keyboard.press('Escape');
    await gallery.waitFor({state:'hidden'});
    assert.equal(await browse.evaluate(button => button === document.activeElement),true);
    await projectName.fill('Updated ' + maker);
    await projects.getByRole('button',{name:'Save project changes'}).click();
    await projects.getByText('Project saved.',{exact:true}).waitFor();

    await presets.getByRole('textbox',{name:'Preset name'}).fill('Preset ' + maker);
    await presets.getByRole('button',{name:'Save new preset'}).click();
    await presets.getByText('Preset saved.',{exact:true}).waitFor();
    await page.locator(size).fill(other);
    await presets.getByRole('button',{name:'Apply preset'}).click();
    await presets.getByText('Preset applied.',{exact:true}).waitFor();
    assert.equal(await page.locator(size).inputValue(),value);

    await page.reload();
    await projects.locator('summary').click();
    await browse.click();
    await gallery.getByRole('searchbox',{name:'Find a project'}).fill('unmatched');
    await gallery.getByText('No projects match your search.',{exact:true}).waitFor();
    await gallery.getByRole('searchbox',{name:'Find a project'}).fill('updated');
    await gallery.getByRole('button',{name:'Open project Updated ' + maker,exact:true}).click();
    await gallery.waitFor({state:'hidden'});
    await projects.getByText('Project opened.',{exact:true}).waitFor();
    assert.equal(await page.locator(size).inputValue(),value);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, maker + ' horizontal overflow');

    await page.locator(build).click();
    await page.waitForFunction(() => window.lastImprinted === false);
    await page.locator(download).click();
    await page.getByText('No credits will be deducted for this download.').waitFor();
    await page.getByRole('button',{name:'Prepare free download'}).click();
    const downloadReady = page.getByRole('button',{name:'Download Ready'});
    const finished = page.waitForEvent('download');
    await downloadReady.click();
    assert.match((await finished).suggestedFilename(), /\.3mf$/);
    assert.equal(ledger.balance(account),startingBalance);
    console.log('PASS Pro ' + maker + ' project, preset, watermark-free mesh and zero-credit 3MF');
  }
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
  ledger.close();
}
