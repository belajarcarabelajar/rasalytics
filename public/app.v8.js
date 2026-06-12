const WORKER_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' 
  ? 'http://127.0.0.1:8787' 
  : 'https://rasalytics-api.kurniawaniwan7906.workers.dev';

document.addEventListener('DOMContentLoaded', () => {
  const analyzeVideoBtn = document.getElementById('analyzeVideoBtn');
  const videoInput = document.getElementById('videoInput');
  const pagesInput = document.getElementById('pagesInput');
  const pagesVal = document.getElementById('pagesVal');
  const errorContainer = document.getElementById('errorContainer');
  
  const emptyState = document.getElementById('emptyState');
  const loadingState = document.getElementById('loadingState');
  const videoResultsSection = document.getElementById('videoResultsSection');

  // Sync Slider
  pagesInput.addEventListener('input', (e) => {
    const val = parseInt(e.target.value, 10);
    const max = parseInt(e.target.max, 10);
    if (val === max) {
      pagesVal.textContent = `ALL PAGES`;
    } else {
      pagesVal.textContent = `${val} Pages`;
    }
  });
  
  // Init slider label
  const initVal = parseInt(pagesInput.value, 10);
  const initMax = parseInt(pagesInput.max, 10);
  pagesVal.textContent = initVal === initMax ? 'ALL PAGES' : `${initVal} Pages`;

  analyzeVideoBtn.addEventListener('click', async () => {
    const rawVid = videoInput.value.trim();
    if (!rawVid) {
      showError('MISSING TARGET ID');
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
              <span class="comment-author">@${c.author}</span>
              <div class="comment-stats">
                <span style="color: ${sentColor}; font-weight: 700;" title="Reasoning: ${c.reasoning || ''}">[${c.sentiment}] (${c.confidence || 0}%)</span>
                <span>♥ ${c.likes}</span>
              </div>
            </div>
            <div class="comment-text">${c.text}</div>
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
            <div class="comment-text">${r.text}</div>
          `;
          buzzerList.appendChild(el);
      });
    } else {
      buzzerList.innerHTML = '<p style="color: var(--border-color);">NO SIGNIFICANT BUZZER ACTIVITY DETECTED</p>';
    }

    // Time Series QuickChart Image Embed
    const tsContainer = document.getElementById('timeSeriesChartContainer');
    if (tsContainer) {
      if (data.timeSeries && data.timeSeries.length > 0) {
        tsContainer.innerHTML = '<div class="loader-bar"></div><p style="color: var(--border-color); text-align: center; width: 100%;">GENERATING CHART...</p>';
        
        const labels = data.timeSeries.map(d => d.date);
        const posData = data.timeSeries.map(d => d.pos);
        const negData = data.timeSeries.map(d => d.neg);

        try {
          const canvas = document.createElement('canvas');
          canvas.width = 800;
          canvas.height = 400;
          const ctx = canvas.getContext('2d');
          
          // Draw dark background
          ctx.fillStyle = '#111111';
          ctx.fillRect(0, 0, canvas.width, canvas.height);

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
              animation: false,
              scales: {
                x: { ticks: { color: 'white' }, grid: { color: '#333333' } },
                y: { ticks: { color: 'white' }, grid: { color: '#333333' }, beginAtZero: true }
              },
              plugins: {
                legend: { labels: { color: 'white', font: { size: 14 } } }
              }
            }
          });

          // Extract to image
          const imgUrl = canvas.toDataURL('image/png');
          tsContainer.innerHTML = `<img src="${imgUrl}" alt="Sentiment Over Time" style="width: 100%; height: 100%; object-fit: contain; border-radius: 4px;">`;
        } catch (e) {
          console.error(e);
          tsContainer.innerHTML = '<p style="color: var(--neg); width: 100%; text-align: center;">CHART GENERATION FAILED</p>';
        }
      } else {
        tsContainer.innerHTML = '<p style="color: var(--border-color); width: 100%; text-align: center;">NO TEMPORAL DATA FOUND</p>';
      }
    }

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
    const csvContent = "data:text/csv;charset=utf-8," 
      + "id,author,sentiment,isSpam,isToxic,isBuzzer,buzzerGroup,text\n"
      + data.allComments.map(c => `"${c.id || ''}","${c.author}","${c.sentiment}",${c.isSpam ? 1 : 0},${c.isToxic ? 1 : 0},${c.isBuzzer ? 1 : 0},"${c.buzzerGroup || ''}","${c.text.replace(/"/g, '""')}"`).join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `rasalytics_${data.videoDetails?.title}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  });

  document.getElementById('exportReportBtn')?.addEventListener('click', () => {
    const data = window._latestAnalyzeData;
    if(!data) return;
    const mdContent = `# Analysis Report: ${data.videoDetails?.title}\n\nTotal: ${data.total}\nPositive: ${data.positive}\nNegative: ${data.negative}\nNeutral: ${data.neutral}\nMixed: ${data.mixed}\nSpam: ${data.spam}\nToxic: ${data.toxic}\nBuzzer: ${data.buzzer}\n\n*Exported from Rasalytics Web UI*`;
    const blob = new Blob([mdContent], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `report_${data.videoDetails?.title}.md`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  });
});
