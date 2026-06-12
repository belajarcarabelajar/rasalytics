const fs = require('fs');

let css = fs.readFileSync('public/style.css', 'utf8');

// Fix typo
css = css.replace(/var\(--color-surface-base-hover\)/g, 'var(--color-surface-hover)');

// Add missing focus visibility globally
const focusCss = `
*:focus-visible {
  outline: var(--focus-ring);
  outline-offset: var(--focus-offset);
}

.brutal-input:hover {
  border-color: var(--color-text-muted);
}

.brutal-input:disabled {
  background: var(--color-surface-hover);
  color: var(--color-text-muted);
  cursor: not-allowed;
  border-color: var(--color-border-base);
}

.brutal-input[aria-invalid="true"] {
  border-color: var(--color-sentiment-neg);
}
`;

// Modify slider thumb css
const thumbCssOld = `.brutal-slider::-webkit-slider-thumb {
  appearance: none;
  width: 16px;
  height: 16px;
  background: var(--color-accent-base);
  cursor: pointer;
  border-radius: 0;
}`;

const thumbCssNew = `.brutal-slider::-webkit-slider-thumb {
  appearance: none;
  width: 44px;
  height: 44px;
  background: var(--color-accent-base);
  cursor: pointer;
  border-radius: var(--radius-sm);
  border: 2px solid var(--color-bg-base);
  transition: transform 0.2s;
}

.brutal-slider::-moz-range-thumb {
  width: 44px;
  height: 44px;
  background: var(--color-accent-base);
  cursor: pointer;
  border-radius: var(--radius-sm);
  border: 2px solid var(--color-bg-base);
}

.brutal-slider:focus-visible::-webkit-slider-thumb {
  outline: var(--focus-ring);
  outline-offset: var(--focus-offset);
}`;

css = css.replace(thumbCssOld, thumbCssNew);
css += focusCss;

// Add responsive media queries
const responsiveCss = `
@media (max-width: 1024px) {
  .top-comments-section {
    grid-template-columns: 1fr !important;
  }
}

@media (max-width: 480px) {
  .content-area {
    padding: var(--space-4) var(--space-2);
  }
  .brand {
    margin-bottom: var(--space-8);
  }
  .video-stats {
    flex-direction: column;
  }
}
`;

css += responsiveCss;

fs.writeFileSync('public/style.css', css);
console.log("Updated style.css");
