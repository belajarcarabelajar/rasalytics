function generateChartSVG(labels, posData, negData) {
  const width = 600;
  const height = 300;
  const pad = 40;
  
  const chartW = width - pad * 2;
  const chartH = height - pad * 2;
  
  const maxVal = Math.max(...posData, ...negData, 1);
  
  const getX = (index) => pad + (index * (chartW / Math.max(1, labels.length - 1)));
  const getY = (val) => height - pad - ((val / maxVal) * chartH);
  
  let posPoints = posData.map((val, i) => `${getX(i)},${getY(val)}`).join(' ');
  let negPoints = negData.map((val, i) => `${getX(i)},${getY(val)}`).join(' ');
  
  let posArea = `${getX(0)},${height-pad} ${posPoints} ${getX(labels.length-1)},${height-pad}`;
  let negArea = `${getX(0)},${height-pad} ${negPoints} ${getX(labels.length-1)},${height-pad}`;
  
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%">
    <!-- Grid -->
    <line x1="${pad}" y1="${pad}" x2="${pad}" y2="${height-pad}" stroke="#333333" stroke-width="1"/>
    <line x1="${pad}" y1="${height-pad}" x2="${width-pad}" y2="${height-pad}" stroke="#333333" stroke-width="1"/>
    
    <!-- Y-Axis Labels -->
    <text x="${pad-10}" y="${pad}" fill="white" font-size="12" font-family="monospace" text-anchor="end" dominant-baseline="middle">${maxVal}</text>
    <text x="${pad-10}" y="${height-pad}" fill="white" font-size="12" font-family="monospace" text-anchor="end" dominant-baseline="middle">0</text>
    
    <!-- Areas -->
    <polygon points="${posArea}" fill="rgba(0, 255, 102, 0.2)" />
    <polygon points="${negArea}" fill="rgba(255, 0, 85, 0.2)" />
    
    <!-- Lines -->
    <polyline points="${posPoints}" fill="none" stroke="#00FF66" stroke-width="2" />
    <polyline points="${negPoints}" fill="none" stroke="#FF0055" stroke-width="2" />
    
    <!-- X-Axis Labels (first and last to avoid clutter) -->
    <text x="${getX(0)}" y="${height-pad+15}" fill="white" font-size="10" font-family="monospace" text-anchor="middle">${labels[0] || ''}</text>
    <text x="${getX(labels.length-1)}" y="${height-pad+15}" fill="white" font-size="10" font-family="monospace" text-anchor="middle">${labels[labels.length-1] || ''}</text>
    
    <!-- Legend -->
    <rect x="${pad}" y="10" width="10" height="10" fill="#00FF66"/>
    <text x="${pad+15}" y="20" fill="white" font-size="12" font-family="monospace">Positive</text>
    
    <rect x="${pad+80}" y="10" width="10" height="10" fill="#FF0055"/>
    <text x="${pad+95}" y="20" fill="white" font-size="12" font-family="monospace">Negative</text>
  </svg>`;
  
  return svg;
}

const svg = generateChartSVG(['2026-06-11', '2026-06-12'], [28, 8], [2, 1]);
console.log(svg.length);
