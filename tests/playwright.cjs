'use strict';
const {chromium: browserType} = require('playwright');

// Use Playwright's installed browser by default; allow an explicit local one.
const chromium = {
  launch(options = {}) {
    const args = [...(options.args || [])];
    if (process.env.SMTVV_DIRECT_LOOPBACK === '1') {
      const target = new URL(process.env.SMTVV_URL || 'http://127.0.0.1:8766');
      if (!['localhost','127.0.0.1','[::1]'].includes(target.hostname)) {
        throw new Error('SMTVV_DIRECT_LOOPBACK is restricted to local test URLs');
      }
      args.push('--no-proxy-server');
    }
    return browserType.launch({
      ...options,
      args,
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
    });
  },
};
module.exports = {chromium};
