'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {buildSync}=require('esbuild');
const root=path.resolve(__dirname,'..');
const output=path.join(root,'web/admin/vendor');
fs.mkdirSync(output,{recursive:true});
buildSync({entryPoints:[path.join(root,'scripts/analytics-charts.mjs')],outfile:path.join(output,'echarts.min.js'),
  bundle:true,minify:true,format:'iife',target:['es2020'],legalComments:'none',
  banner:{js:'/*! Apache ECharts 6.1.0 + zrender. Apache-2.0 / BSD-3-Clause. See ECHARTS-LICENSE.txt. */'}});
const notices=[['echarts','LICENSE'],['echarts','NOTICE'],['zrender','LICENSE'],['tslib','CopyrightNotice.txt'],['tslib','LICENSE.txt']];
const text=notices.map(([name,file])=>name+'/'+file+'\n'+fs.readFileSync(path.join(root,'node_modules',name,file),'utf8')).join('\n\n');
fs.writeFileSync(path.join(output,'ECHARTS-LICENSE.txt'),text);
console.log(JSON.stringify({chartRuntimeBytes:fs.statSync(path.join(output,'echarts.min.js')).size}));
