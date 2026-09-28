'use strict';
// Subset the vendored MIT-licensed Lucide release; no network or new icon artwork.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname,'..');
const lucide = require('../web/assets/lucide.min.js');
const source = [];
function scan(directory) {
  for (const entry of fs.readdirSync(directory,{withFileTypes:true})) {
    const file = path.join(directory,entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'assets' && entry.name !== 'fonts') scan(file);
    } else if (/\.(html|js)$/.test(entry.name)) source.push(fs.readFileSync(file,'utf8'));
  }
}
scan(path.join(root,'web'));
const words = new Set(source.join('\n').match(/[A-Za-z][A-Za-z0-9]*/g));
const icons = Object.fromEntries(Object.entries(lucide.icons).filter(([name])=>words.has(name)));
const code = `/* Lucide icon subset. Copyright Lucide Contributors. MIT License.
 * Generated from assets/lucide.min.js by scripts/build_icons.cjs. */
'use strict';
(()=>{
const icons=${JSON.stringify(icons)};
function createElement([tag,attributes,children=[]]) {
  const node=document.createElementNS('http://www.w3.org/2000/svg',tag);
  for(const [name,value] of Object.entries(attributes))node.setAttribute(name,String(value));
  for(const child of children)node.append(createElement(child));
  return node;
}
window.lucide={icons,createElement};
})();
`;
const destination = path.join(root,'web/assets/icons.js');
fs.writeFileSync(destination,code);
console.log(JSON.stringify({icons:Object.keys(icons).length,bytes:Buffer.byteLength(code),sourceBytes:fs.statSync(path.join(root,'web/assets/lucide.min.js')).size}));
