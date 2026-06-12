const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
pkg.scripts['lint:html'] = 'markuplint public/index.html';
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
console.log('Updated package.json');
