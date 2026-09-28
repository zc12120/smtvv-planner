'use strict';
// Test-only TLS termination for an isolated, loopback-bound Compose gateway.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const {execFileSync} = require('node:child_process');

module.exports = async function tlsProxy(hostname, upstream) {
  const target = new URL(upstream);
  if (target.protocol !== 'http:' || !['127.0.0.1','localhost','[::1]'].includes(target.hostname)) {
    throw Error('The test upstream must be an HTTP loopback address');
  }
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'smtvv-tls-'));
  const key = path.join(directory,'key.pem'), cert = path.join(directory,'cert.pem');
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1',
    '-keyout',key,'-out',cert,'-subj','/CN='+hostname],{stdio:'ignore'});
  const server = https.createServer({key:fs.readFileSync(key),cert:fs.readFileSync(cert)},(request,response)=>{
    const proxy = http.request({hostname:target.hostname,port:target.port,path:request.url,
      method:request.method,headers:request.headers}, remote=>{
      response.writeHead(remote.statusCode,remote.headers);
      remote.pipe(response);
    });
    proxy.on('error',()=>{response.writeHead(502);response.end('Test upstream unavailable');});
    request.pipe(proxy);
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  return {port:server.address().port, async close() {
    server.closeAllConnections();
    await new Promise(resolve=>server.close(resolve));
    fs.rmSync(directory,{recursive:true,force:true});
  }};
};
