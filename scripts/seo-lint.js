import { readFileSync } from 'fs';
import { join } from 'path';

const indexPath = join(process.cwd(), 'public', 'index.html');
let content;

try {
  content = readFileSync(indexPath, 'utf-8');
} catch (err) {
  console.error(`[SEO LINT] Error reading index.html: ${err.message}`);
  process.exit(1);
}

const rules = [
  { name: 'Title Tag', regex: /<title>.*<\/title>/i },
  { name: 'Meta Description', regex: /<meta\s+name="description"\s+content="[^"]+"/i },
  { name: 'Canonical Link', regex: /<link\s+rel="canonical"\s+href="[^"]+"/i },
  { name: 'Open Graph Type', regex: /<meta\s+property="og:type"\s+content="[^"]+"/i },
  { name: 'Open Graph URL', regex: /<meta\s+property="og:url"\s+content="[^"]+"/i },
  { name: 'Twitter Card', regex: /<meta\s+name="twitter:card"\s+content="[^"]+"/i },
  { name: 'JSON-LD', regex: /<script\s+type="application\/ld\+json">/i },
  { name: 'H1 Tag without breaks', regex: /<h1[^>]*>[^<]+<\/h1>/i },
];

let failed = false;

for (const rule of rules) {
  if (!rule.regex.test(content)) {
    console.error(`[SEO LINT] Failed: Missing or invalid ${rule.name}`);
    failed = true;
  }
}

if (failed) {
  console.error('[SEO LINT] Verification failed. Please ensure SEO tags are present in index.html.');
  process.exit(1);
} else {
  console.log('[SEO LINT] Passed: All critical SEO tags present.');
}
