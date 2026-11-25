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
    const panel = page.locator('.pro-library');
    await panel.locator('summary').click();
    const status = panel.getByRole('status');
    const select = panel.locator('select');
    const name = panel.getByRole('textbox',{name:'Name'});
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
    await name.fill('Saved ' + maker);
    await panel.getByRole('button',{name:'Save new project'}).click();
    await status.getByText('Project saved.').waitFor();
    await name.fill('Preset ' + maker);
    await panel.getByRole('button',{name:'Save new preset'}).click();
    await status.getByText('Preset saved.').waitFor();
    await page.locator(size).fill(other);
    await panel.getByRole('button',{name:'Open / apply'}).click();
    await status.getByText('Preset applied.').waitFor();
    assert.equal(await page.locator(size).inputValue(),value);

    await page.reload();
    await panel.locator('summary').click();
    await select.selectOption({label:'Project · Saved ' + maker});
    await panel.getByRole('button',{name:'Open / apply'}).click();
    await status.getByText('Project opened.').waitFor();
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
