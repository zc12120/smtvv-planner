'use strict';
const assert = require('node:assert/strict');
const http = require('node:http');

// WSL can reset Chromium's local TLS connections. Forward browser requests to
// the real isolated gateway instead; retain every response, cookie and status.
// This never fabricates an authentication or application response.
module.exports = async function gatewayTransport(context, base, upstream) {
  if (!upstream) return {close() {}};
  const target = new URL(upstream);
  assert(target.protocol === 'http:' && target.hostname === '127.0.0.1');
  const agent = new http.Agent({keepAlive:true, maxSockets:12, maxFreeSockets:4});
  await context.route(base + '/**', async route => {
    const request = route.request(), url = new URL(request.url());
    try {
      const headers = await request.allHeaders();
      headers.host = new URL(base).hostname;headers['accept-encoding'] = 'identity';
      const response = await new Promise((resolve, reject) => {
        const outgoing = http.request({agent, hostname:target.hostname, port:target.port,
          path:url.pathname + url.search, method:request.method(), headers}, incoming => {
          const chunks = [];
          incoming.on('data', chunk => chunks.push(chunk));incoming.on('error', reject);
          incoming.on('end', () => {
            const forwarded = Object.fromEntries(Object.entries(incoming.headers).filter(([,v]) => v !== undefined)
              .map(([key,value]) => [key,Array.isArray(value) ? value.join('\n') : String(value)]));
            delete forwarded['transfer-encoding'];delete forwarded.connection;delete forwarded['content-length'];
            resolve({status:incoming.statusCode, headers:forwarded, body:Buffer.concat(chunks)});
          });
        });
        outgoing.on('error', reject);outgoing.setTimeout(30000, () => outgoing.destroy(Error('Test gateway timeout')));
        outgoing.end(request.postDataBuffer() || undefined);
      });
      await route.fulfill(response);
    } catch {await route.abort('failed').catch(() => {});}
  });
  return {close() {agent.destroy();}};
};
