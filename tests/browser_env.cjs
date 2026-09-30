const fs = require('node:fs/promises');
const path = require('node:path');

// Optional fixture for WSL hosts whose loopback stack resets browser navigation
// connections. Only static delivery is replaced; calculation/catalog HTTP calls
// and each test's explicit network-failure simulations remain active.
async function useStaticFixture(context, base) {
  if (process.env.SMTVV_STATIC_FROM_DISK !== '1') return;
  const origin = new URL(base);
  if (!['localhost','127.0.0.1','[::1]'].includes(origin.hostname)) throw Error('Static fixtures are restricted to local test URLs');
  const root = path.resolve(__dirname, '../web');
  const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml','.woff2':'font/woff2'};
  await context.route(origin.origin+'/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.startsWith('/api/') || !['GET','HEAD'].includes(request.method())) return route.continue();
    const filename = path.resolve(root, '.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
    if (!filename.startsWith(root+path.sep)) return route.fulfill({status:404,body:''});
    try {
      const body = await fs.readFile(filename);
      return route.fulfill({status:200,contentType:types[path.extname(filename)]||'application/octet-stream',headers:{'Cache-Control':'no-store'},body:request.method()==='HEAD'?'':body});
    } catch (error) {
      if (error.code==='ENOENT'||error.code==='EISDIR') return route.fulfill({status:404,body:''});
      throw error;
    }
  });
  console.log('Local static fixture enabled; API requests still use '+origin.origin);
}

async function fillSearch(page, id, value) {
  const input = page.locator('#'+id);
  if (!await input.isVisible()) {
    const trigger = id === 'global-search' ? '.header-search-button' : '[aria-controls="'+id.replace('-filter','-query')+'"]';
    await page.locator(trigger).click();
  }
  await input.fill(value);
}

module.exports = {useStaticFixture,fillSearch};
