const fs = require('fs');
const data = JSON.parse(fs.readFileSync('data/fixtures/benchmark.json', 'utf8'));
const dist = {};
data.forEach(item => {
  dist[item.expected] = (dist[item.expected] || 0) + 1;
});
console.log(dist);
