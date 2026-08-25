const fs = require('fs');
const path = require('path');
const ejs = require('ejs');

const root = path.join(__dirname, '..', 'views');
const files = [];
function collect(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collect(full);
    else if (entry.name.endsWith('.ejs')) files.push(full);
  }
}
collect(root);
for (const file of files) {
  ejs.compile(fs.readFileSync(file, 'utf8'), { filename: file });
}
console.log(`Compiled ${files.length} EJS templates successfully.`);
