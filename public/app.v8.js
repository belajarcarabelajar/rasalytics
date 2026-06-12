const WORKER_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' 
  ? 'http://127.0.0.1:8787' 
  : 'https://rasalytics-api.kurniawaniwan7906.workers.dev';

// EXPORT HELPERS (Exposed for Testing)
window.RasalyticsExportHelpers = {
  escapeCsv: function(value) {
    if (value === null || value === undefined) return '';
    let str = String(value);
    if (/^[=+\-@]/.test(str)) {
      str = "'" + str; // Prevent formula injection
    }
    // Always enclose in quotes for robust parsing, and escape inner quotes
    return '"' + str.replace(/"/g, '""') + '"';
  },
  generateReportMarkdown: function(data) {
    const v = data.videoDetails;
    let md = `# Analysis Report: ${v?.title || 'Unknown Video'}\n\n`;
    
    md += `## Video Meta Information\n`;
    md += `- **Channel**: ${v?.channel || 'Unknown'}\n`;
    md += `- **Views**: ${(v?.views || 0).toLocaleString()}\n`;
    md += `- **Likes**: ${(v?.likes || 0).toLocaleString()}\n`;
    md += `- **Comments Analysed**: ${(v?.commentCount || 0).toLocaleString()}\n\n`;

    md += `## Summary Dashboard\n`;
    md += `- **Total Analyzed**: ${(data.total || 0).toLocaleString()}\n`;
    md += `- **Toxicity**: ${(data.toxic || 0).toLocaleString()}\n`;
    md += `- **Spam Flag**: ${(data.spam || 0).toLocaleString()}\n\n`;

    md += `### Sentiment Distribution\n`;
    md += `- **Positive**: ${data.positive}\n`;
    md += `- **Neutral**: ${data.neutral}\n`;
    md += `- **Mixed**: ${data.mixed || 0}\n`;
    md += `- **Negative**: ${data.negative}\n\n`;

    if (data.topPositive && data.topPositive.length > 0) {
      md += `## Top Positive Comments\n`;
      data.topPositive.forEach(c => {
        md += `> **@${c.author}** [${c.sentiment}] (${c.confidence}%)\n`;
        md += `> ${c.text.replace(/\n/g, '\n> ')}\n\n`;
      });
    }

    if (data.topNegative && data.topNegative.length > 0) {
      md += `## Top Negative Comments\n`;
      data.topNegative.forEach(c => {
        md += `> **@${c.author}** [${c.sentiment}] (${c.confidence}%)\n`;
        md += `> ${c.text.replace(/\n/g, '\n> ')}\n\n`;
      });
    }

    if (data.timeSeries && data.timeSeries.length > 0) {
      md += `## Sentiment Over Time\n`;
      md += `| Date | Positive | Negative |\n| --- | --- | --- |\n`;
      data.timeSeries.forEach(ts => {
        md += `| ${ts.date} | ${ts.pos} | ${ts.neg} |\n`;
      });
      md += `\n`;
    }

    md += `## Buzzer Forensics\n`;
    md += `- **Total Buzzer/Copas**: ${(data.buzzer || 0).toLocaleString()}\n\n`;
    
    if (data.buzzerRings && data.buzzerRings.length > 0) {
      md += `### Significant Buzzer Activity (Rings)\n`;
      data.buzzerRings.forEach(r => {
        md += `**Ring Size: ${r.count + 1}** (ID: ${r.id.substring(0,8)})\n`;
        md += `> ${r.text.replace(/\n/g, '\n> ')}\n\n`;
      });
    }

    md += `---\n*Exported from Rasalytics Web UI*\n`;
    return md;
  }
};

document.addEventListener('DOMContentLoaded', () => {
  const analyzeVideoBtn = document.getElementById('analyzeVideoBtn');
  const videoInput = document.getElementById('videoInput');
  const pagesInput = document.getElementById('pagesInput');
  const pagesVal = document.getElementById('pagesVal');
  const errorContainer = document.getElementById('errorContainer');
  
  const emptyState = document.getElementById('emptyState');
  const loadingState = document.getElementById('loadingState');
  const videoResultsSection = document.getElementById('videoResultsSection');

  function escapeHTML(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/[&<>"']/g, function(match) {
      const escape = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      };
      return escape[match];
    });
  }

  // Sync Slider
  pagesInput.addEventListener('input', (e) => {
    const val = parseInt(e.target.value, 10);
    const max = parseInt(e.target.max, 10);
    if (val === max) {
      pagesVal.textContent = `ALL PAGES`;
    } else {
      pagesVal.textContent = `${val} Pages`;
    }
    pagesInput.setAttribute('aria-valuetext', pagesVal.textContent);
  });
  
  // Init slider label
  const initVal = parseInt(pagesInput.value, 10);
  const initMax = parseInt(pagesInput.max, 10);
  pagesVal.textContent = initVal === initMax ? 'ALL PAGES' : `${initVal} Pages`;

  const controlForm = document.getElementById('controlForm');
  controlForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    videoInput.removeAttribute('aria-invalid');
    const rawVid = videoInput.value.trim();
    if (!rawVid) {
      showError('MISSING TARGET ID');
      videoInput.setAttribute('aria-invalid', 'true');
      return;
    }
    
    let videoId = rawVid;
    if (rawVid.includes('v=')) videoId = rawVid.split('v=')[1].split('&')[0];
    else if (rawVid.includes('youtu.be/')) videoId = rawVid.split('youtu.be/')[1].split('?')[0];

    let maxPages = parseInt(pagesInput.value, 10);
    const maxVal = parseInt(pagesInput.max, 10);
    if (maxPages === maxVal) maxPages = 9999;

    await performAnalysis({ videoId, maxPages });
  });

  async function performAnalysis(body) {
    hideError();
    emptyState.style.display = 'none';
    videoResultsSection.style.display = 'none';
    loadingState.style.display = 'flex';
    
    const btnText = analyzeVideoBtn.querySelector('.btn-text');
    const originalText = btnText.textContent;
    btnText.textContent = 'SCANNING...';
    analyzeVideoBtn.disabled = true;
    
    try {
      const response = await fetch(`${WORKER_URL}/api/analyze-video`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'API REJECTED REQUEST');
      }
      
      await displayVideoResults(data);
    } catch (error) {
      showError(error.message);
      emptyState.style.display = 'flex';
      videoInput.setAttribute('aria-invalid', 'true');
    } finally {
      loadingState.style.display = 'none';
      btnText.textContent = originalText;
      analyzeVideoBtn.disabled = false;
    }
  }

  async function displayVideoResults(data) {
    // Populate Meta
    const v = data.videoDetails;
    document.getElementById('vidTitle').textContent = v.title || 'UNKNOWN';
    document.getElementById('vidChannel').textContent = v.channel || 'UNKNOWN';
    document.getElementById('vidViews').textContent = (v.views || 0).toLocaleString();
    document.getElementById('vidLikes').textContent = (v.likes || 0).toLocaleString();
    document.getElementById('vidComments').textContent = (v.commentCount || 0).toLocaleString();

    // Populate Dash
    const total = data.total || 0;
    document.getElementById('resVidTotal').textContent = total.toLocaleString();
    document.getElementById('resVidToxic').textContent = (data.toxic || 0).toLocaleString();
    document.getElementById('resVidSpam').textContent = (data.spam || 0).toLocaleString();

    // Distribution Bars
    document.getElementById('resVidPos').textContent = data.positive;
    document.getElementById('resVidNeu').textContent = data.neutral;
    document.getElementById('resVidNeg').textContent = data.negative;
    document.getElementById('resVidMix').textContent = data.mixed || 0;
    
    document.getElementById('barPos').style.width = total > 0 ? `${(data.positive/total)*100}%` : '0%';
    document.getElementById('barNeu').style.width = total > 0 ? `${(data.neutral/total)*100}%` : '0%';
    document.getElementById('barNeg').style.width = total > 0 ? `${(data.negative/total)*100}%` : '0%';
    document.getElementById('barMix').style.width = total > 0 ? `${((data.mixed || 0)/total)*100}%` : '0%';

    // Pie Chart
    const pieCanvas = document.getElementById('sentimentPieChart');
    if (pieCanvas && typeof Chart !== 'undefined') {
      if (window.sentimentPieChartObj) {
        window.sentimentPieChartObj.destroy();
      }
      window.sentimentPieChartObj = new Chart(pieCanvas.getContext('2d'), {
        type: 'doughnut',
        data: {
          labels: ['Positive', 'Neutral', 'Negative', 'Mixed'],
          datasets: [{
            data: [data.positive, data.neutral, data.negative, data.mixed || 0],
            backgroundColor: ['#00FF66', '#888888', '#FF0055', '#FFBB00'],
            borderWidth: 0,
            hoverOffset: 4
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: '70%',
          plugins: {
            legend: {
              position: 'right',
              labels: { color: 'white', font: { family: 'JetBrains Mono', size: 12 } }
            }
          }
        }
      });
    }

    // Top Comments separated
    function renderList(listId, arr) {
      const list = document.getElementById(listId);
      list.innerHTML = '';
      if (!arr || arr.length === 0) {
        list.innerHTML = '<p style="color: var(--border-color);">NO DATA FRAGMENTS FOUND</p>';
      } else {
        arr.forEach((c, idx) => {
          const el = document.createElement('div');
          el.className = 'comment-item slide-up-item';
          el.style.animationDelay = `${idx * 0.05}s`;
          
          let sentColor = 'var(--neu)';
          if(c.sentiment === 'POSITIVE') sentColor = 'var(--pos)';
          if(c.sentiment === 'NEGATIVE') sentColor = 'var(--neg)';
          if(c.sentiment === 'MIXED') sentColor = 'var(--mixed)';

          el.innerHTML = `
            <div class="comment-header">
              <span class="comment-author">${escapeHTML(c.author).startsWith('@') ? '' : '@'}${escapeHTML(c.author)}</span>
              <div class="comment-stats">
                <span style="color: ${sentColor}; font-weight: 700;" title="Reasoning: ${escapeHTML(c.reasoning || '')}">[${c.sentiment}] (${c.confidence || 0}%)</span>
                <span>♥ ${c.likes}</span>
              </div>
            </div>
            <div class="comment-text">${escapeHTML(c.text)}</div>
          `;
          list.appendChild(el);
        });
      }
    }

    renderList('commentsListPos', data.topPositive);
    renderList('commentsListNeg', data.topNegative);

    // Buzzer count
    document.getElementById('resVidBuzzer').textContent = (data.buzzer || 0).toLocaleString();

    // Buzzer Rings
    const buzzerList = document.getElementById('buzzerRingsList');
    buzzerList.innerHTML = '';
    if (data.buzzerRings && data.buzzerRings.length > 0) {
      data.buzzerRings.forEach((r, idx) => {
          const el = document.createElement('div');
          el.className = 'comment-item slide-up-item';
          el.style.animationDelay = `${idx * 0.05}s`;
          el.innerHTML = `
            <div class="comment-header">
              <span class="comment-author" style="color: var(--neg);">Ring Size: ${r.count + 1}</span>
              <span class="comment-stats">ID: ${r.id.substring(0,8)}</span>
            </div>
            <div class="comment-text">${escapeHTML(r.text)}</div>
          `;
          buzzerList.appendChild(el);
      });
    } else {
      buzzerList.innerHTML = '<p style="color: var(--border-color);">NO SIGNIFICANT BUZZER ACTIVITY DETECTED</p>';
    }

    // Time Series QuickChart Image Embed
    setTimeout(() => {
      const tsContainer = document.getElementById('timeSeriesChartContainer');
      if (tsContainer) {
        if (data.timeSeries && data.timeSeries.length > 0) {
          tsContainer.innerHTML = '<div class="loader-bar"></div><p style="color: var(--border-color); text-align: center; width: 100%;">GENERATING CHART...</p>';
          
          const labels = data.timeSeries.map(d => d.date);
          const posData = data.timeSeries.map(d => d.pos);
          const negData = data.timeSeries.map(d => d.neg);

          if (labels.length === 1) {
            labels.unshift("Start");
            posData.unshift(0);
            negData.unshift(0);
          }

          try {
            const canvas = document.createElement('canvas');
            canvas.width = 800;
            canvas.height = 400;
            const ctx = canvas.getContext('2d');

            new Chart(ctx, {
              type: 'line',
              data: {
                labels: labels,
                datasets: [
                  {
                    label: 'Positive',
                    data: posData,
                    borderColor: '#00FF66',
                    backgroundColor: 'rgba(0, 255, 102, 0.2)',
                    borderWidth: 3,
                    fill: true,
                    tension: 0.3
                  },
                  {
                    label: 'Negative',
                    data: negData,
                    borderColor: '#FF0055',
                    backgroundColor: 'rgba(255, 0, 85, 0.2)',
                    borderWidth: 3,
                    fill: true,
                    tension: 0.3
                  }
                ]
              },
              options: {
                responsive: false,
                animation: {
                  duration: 0,
                  onComplete: function() {
                    const imgUrl = canvas.toDataURL('image/png');
                    tsContainer.innerHTML = `<img src="${imgUrl}" alt="Sentiment Over Time" style="width: 100%; height: 100%; object-fit: contain; border-radius: 4px;">`;
                  }
                },
                scales: {
                  x: { ticks: { color: 'white' }, grid: { color: '#333333' } },
                  y: { ticks: { color: 'white' }, grid: { color: '#333333' }, beginAtZero: true }
                },
                plugins: {
                  legend: { labels: { color: 'white', font: { size: 14 } } }
                }
              },
              plugins: [{
                id: 'customBackground',
                beforeDraw: (chart) => {
                  const ctx = chart.ctx;
                  ctx.save();
                  ctx.globalCompositeOperation = 'destination-over';
                  ctx.fillStyle = '#111111';
                  ctx.fillRect(0, 0, chart.width, chart.height);
                  ctx.restore();
                }
              }]
            });
          } catch (e) {
            console.error(e);
            tsContainer.innerHTML = '<p style="color: var(--neg); width: 100%; text-align: center;">CHART GENERATION FAILED</p>';
          }
        } else {
          tsContainer.innerHTML = '<p style="color: var(--border-color); width: 100%; text-align: center;">NO TEMPORAL DATA FOUND</p>';
        }
      }
    }, 0);

    // WordCloud Generation
    setTimeout(() => {
      if (data.allComments && data.allComments.length > 0 && typeof WordCloud !== 'undefined') {
        const wordMap = new Map();
        const stopwords = ["di", "ke", "dari", "yang", "dan", "untuk", "pada", "adalah", "ini", "itu", "dengan", "saya", "kamu", "dia", "mereka", "kita", "kami", "gak", "tidak", "ya", "yg", "aja", "ada", "bisa", "udah", "kalau", "kalo", "buat", "juga", "lagi", "sama", "kok", "sih", "kan", "pun", "nya", "lebih", "tapi", "dalam", "seperti", "atau", "jadi", "aku", "banyak", "orang", "baru", "satu", "sekarang", "biar", "terus", "apa", "aja", "udah", "bukan", "hanya", "sampai", "wkwk", "wkwkwk", "karena", "karna", "buat", "pas", "masih", "belum", "kalau", "kalo", "udah", "udh", "gitu"];
        
        data.allComments.forEach(c => {
          const text = (c.text || "").toLowerCase();
          const words = text.replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/);
          words.forEach(w => {
            if (w.length > 3 && !stopwords.includes(w)) {
              wordMap.set(w, (wordMap.get(w) || 0) + 1);
            }
          });
        });
        
        const list = Array.from(wordMap.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 100);
          
        if (list.length > 0) {
          // Adjust weight factor to make words fit nicely
          const maxFreq = list[0][1];
          const multiplier = maxFreq > 0 ? (60 / maxFreq) : 1;
          
          WordCloud(document.getElementById('wordcloudCanvas'), {
            list: list,
            weightFactor: function (size) {
              return Math.max(14, size * multiplier);
            },
            fontFamily: 'JetBrains Mono',
            color: function() {
              // Brilliantly vibrant colors for dark mode
              const colors = ['#00FF66', '#FF0055', '#00DDFF', '#FFBB00', '#BB00FF'];
              return colors[Math.floor(Math.random() * colors.length)];
            },
            backgroundColor: '#111111',
            rotateRatio: 0,
            gridSize: 10,
            shape: 'square'
          });
        }
      }
    }, 50);

    window._latestAnalyzeData = data;
    videoResultsSection.style.display = 'block';
  }

  function showError(message) {
    errorContainer.textContent = `ERR: ${message}`;
    errorContainer.style.display = 'block';
  }

  function hideError() {
    errorContainer.style.display = 'none';
  }

  // Export flows
  document.getElementById('exportCsvBtn')?.addEventListener('click', () => {
    const data = window._latestAnalyzeData;
    if(!data || !data.allComments) return;
    
    const escapeCsv = window.RasalyticsExportHelpers.escapeCsv;
    const header = "id,author,sentiment,isSpam,isToxic,isBuzzer,buzzerGroup,text\n";
    const rows = data.allComments.map(c => {
      return [
        escapeCsv(c.id),
        escapeCsv(c.author),
        escapeCsv(c.sentiment),
        c.isSpam ? 1 : 0,
        c.isToxic ? 1 : 0,
        c.isBuzzer ? 1 : 0,
        escapeCsv(c.buzzerGroup),
        escapeCsv(c.text)
      ].join(",");
    }).join("\n");
    
    const bom = new Uint8Array([0xEF, 0xBB, 0xBF]); // UTF-8 BOM
    const blob = new Blob([bom, header + rows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `rasalytics_${data.videoDetails?.title || 'export'}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  });

  document.getElementById('exportReportBtn')?.addEventListener('click', () => {
    const data = window._latestAnalyzeData;
    if(!data) return;
    
    const mdContent = window.RasalyticsExportHelpers.generateReportMarkdown(data);
    const blob = new Blob([mdContent], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `report_${data.videoDetails?.title || 'export'}.md`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  });
});
