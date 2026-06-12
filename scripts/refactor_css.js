const fs = require('fs');

let css = fs.readFileSync('public/style.css', 'utf8');

// 1. Replace existing token names
const tokenMap = {
  '--bg-color': '--color-bg-base',
  '--surface': '--color-surface-base',
  '--surface-hover': '--color-surface-hover',
  '--border-color': '--color-border-base',
  '--text-main': '--color-text-main',
  '--text-muted': '--color-text-muted',
  '--accent': '--color-accent-base',
  '--accent-hover': '--color-accent-hover',
  '--pos': '--color-sentiment-pos',
  '--neg': '--color-sentiment-neg',
  '--neu': '--color-sentiment-neu',
  '--mixed': '--color-sentiment-mix'
};

for (const [oldName, newName] of Object.entries(tokenMap)) {
  css = css.split(oldName).join(newName);
}

// 2. Replace hardcoded colors that weren't tokenized
css = css.replace(/rgba\(229,\s*255,\s*0,\s*0\.05\)/g, 'var(--color-accent-muted)');
css = css.replace(/rgba\(255,\s*0,\s*85,\s*0\.1\)/g, 'var(--color-error-bg)');
css = css.replace(/#555/g, 'var(--color-border-base)'); // comment border hover

// 3. Replace the old :root block with the new comprehensive one
const newRoot = `:root {
  /* Colors */
  --color-bg-base: #0a0a0a;
  --color-surface-base: #141414;
  --color-surface-hover: #1c1c1c;
  --color-border-base: #595959;
  
  --color-text-main: #f0f0f0;
  --color-text-muted: #959595;
  
  --color-accent-base: #E5FF00;
  --color-accent-hover: #B8CC00;
  --color-accent-muted: rgba(229, 255, 0, 0.05);
  
  --color-sentiment-pos: #00FF66;
  --color-sentiment-neg: #FF0055;
  --color-sentiment-neu: #888888;
  --color-sentiment-mix: #FFBB00;
  --color-error-bg: rgba(255, 0, 85, 0.1);

  /* Spacing Scale */
  --space-2: 0.5rem;
  --space-3: 0.75rem;
  --space-4: 1rem;
  --space-5: 1.15rem;
  --space-6: 1.5rem;
  --space-8: 2rem;
  --space-10: 2.5rem;
  --space-16: 4rem;

  /* Typography Ramp */
  --text-xs: 0.75rem;
  --text-sm: 0.85rem;
  --text-base: 1rem;
  --text-lg: 1.2rem;
  --text-xl: 1.5rem;
  --text-2xl: 2.2rem;
  --text-3xl: 2.5rem;

  /* Radii & Layout */
  --radius-sm: 4px;
  --radius-full: 50%;
  --focus-ring: 2px solid var(--color-accent-base);
  --focus-offset: 2px;
}`;
css = css.replace(/:root\s*\{[\s\S]*?\}/, newRoot);

// 4. Replace hardcoded spacing
const spacingMap = {
  'padding: 2.5rem 4rem;': 'padding: var(--space-10) var(--space-16);',
  'padding: 2.5rem;': 'padding: var(--space-10);',
  'padding: 2rem 1.5rem;': 'padding: var(--space-8) var(--space-6);',
  'margin-bottom: 4rem;': 'margin-bottom: var(--space-16);',
  'margin-bottom: 3rem;': 'margin-bottom: calc(var(--space-16) * 0.75);', // or just use existing tokens
  'margin-bottom: 2rem;': 'margin-bottom: var(--space-8);',
  'margin-bottom: 1.5rem;': 'margin-bottom: var(--space-6);',
  'margin-bottom: 1rem;': 'margin-bottom: var(--space-4);',
  'margin-bottom: 0.75rem;': 'margin-bottom: var(--space-3);',
  'margin-bottom: 0.5rem;': 'margin-bottom: var(--space-2);',
  'margin-top: 2rem;': 'margin-top: var(--space-8);',
  'margin-top: 1.5rem;': 'margin-top: var(--space-6);',
  'margin-top: 1rem;': 'margin-top: var(--space-4);',
  'margin-top: 0.5rem;': 'margin-top: var(--space-2);',
  'padding: 1.5rem;': 'padding: var(--space-6);',
  'padding: 1.15rem;': 'padding: var(--space-5);',
  'padding: 1rem;': 'padding: var(--space-4);',
  'padding: 0.5rem 1rem;': 'padding: var(--space-2) var(--space-4);',
  'padding-bottom: 2rem;': 'padding-bottom: var(--space-8);',
  'padding-bottom: 1rem;': 'padding-bottom: var(--space-4);',
  'gap: 1.5rem;': 'gap: var(--space-6);',
  'gap: 1rem;': 'gap: var(--space-4);',
  'gap: 0.5rem;': 'gap: var(--space-2);',
  'margin-left: 0.5rem;': 'margin-left: var(--space-2);',
};
for (const [oldVal, newVal] of Object.entries(spacingMap)) {
  css = css.split(oldVal).join(newVal);
}

// 5. Replace hardcoded typography
const typoMap = {
  'font-size: 2.5rem;': 'font-size: var(--text-3xl);',
  'font-size: 2.2rem;': 'font-size: var(--text-2xl);',
  'font-size: 1.5rem;': 'font-size: var(--text-xl);',
  'font-size: 1.2rem;': 'font-size: var(--text-lg);',
  'font-size: 1rem;': 'font-size: var(--text-base);',
  'font-size: 0.95rem;': 'font-size: var(--text-base);',
  'font-size: 0.85rem;': 'font-size: var(--text-sm);',
  'font-size: 0.8rem;': 'font-size: var(--text-sm);',
  'font-size: 0.75rem;': 'font-size: var(--text-xs);',
};
for (const [oldVal, newVal] of Object.entries(typoMap)) {
  css = css.split(oldVal).join(newVal);
}

// 6. Replace border radii
css = css.replace(/border-radius: 4px;/g, 'border-radius: var(--radius-sm);');
css = css.replace(/border-radius: 50%;/g, 'border-radius: var(--radius-full);');

fs.writeFileSync('public/style.css', css);
console.log("Refactored style.css");
