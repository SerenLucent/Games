(function () {
  const config = window.PUBLIC_RANKING_CONFIG;
  const stage = document.getElementById('stage');
  const title = document.getElementById('titleScreen');
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'public-ranking-button'; button.textContent = 'RANKING';
  const overlay = document.createElement('section');
  overlay.className = 'public-ranking-overlay'; overlay.hidden = true;
  overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'TOP 10 Ranking');
  overlay.innerHTML = '<div class="public-ranking-header"><h2>TOP 10 RANKING</h2><button type="button" class="public-ranking-close" aria-label="Close ranking">&times;</button></div>'
    + '<div class="public-ranking-score" hidden></div><form class="public-ranking-form" hidden><label for="rankingName">NAME</label><input id="rankingName" maxlength="20" autocomplete="nickname" required><button type="submit">REGISTER SCORE</button></form>'
    + '<div class="public-ranking-tabs" role="tablist"><button role="tab" aria-selected="true" data-board="weekly">주간</button><button role="tab" aria-selected="false" data-board="allTime">전체 기간</button></div>'
    + '<div class="public-ranking-status" role="status" aria-live="polite"></div><table class="public-ranking-table" hidden><thead><tr><th>#</th><th>NAME</th><th>SCORE</th></tr></thead><tbody></tbody></table><div class="public-ranking-empty" hidden></div>';
  stage.append(button, overlay);
  const form = overlay.querySelector('form'), input = form.querySelector('input');
  const submit = form.querySelector('button'), close = overlay.querySelector('.public-ranking-close');
  const status = overlay.querySelector('.public-ranking-status');
  const tbody = overlay.querySelector('tbody'), empty = overlay.querySelector('.public-ranking-empty');
  let data = { allTime: [], weekly: [] }, board = 'weekly', pending = null;
  let busy = false, requestId = 0, previousFocus = null, savedRunId = null;

  function weekStart(now) {
    const kst = new Date(now.getTime() + 9 * 3600000);
    return new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate() - (kst.getUTCDay() + 6) % 7) - 9 * 3600000).toISOString();
  }
  function acceptData(value) {
    data = { allTime: value.allTime || [], weekly: value.weekStart === weekStart(new Date()) ? value.weekly || [] : [] };
    render();
  }
  function render() {
    overlay.querySelectorAll('[data-board]').forEach(tab => tab.setAttribute('aria-selected', String(tab.dataset.board === board)));
    tbody.replaceChildren();
    const entries = data[board];
    overlay.querySelector('.public-ranking-table').hidden = entries.length === 0;
    entries.slice(0, 10).forEach((entry, index) => {
      const row = document.createElement('tr');
      row.dataset.current = String(entry.runId === savedRunId);
      [index + 1, entry.name, Number(entry.score).toLocaleString('en-US')].forEach(value => {
        const cell = document.createElement('td'); cell.textContent = value; row.append(cell);
      });
      tbody.append(row);
    });
    empty.hidden = entries.length > 0;
    empty.textContent = '등록된 기록이 없습니다.';
  }
  function api(parameters) {
    return new Promise((resolve, reject) => {
      if (!config.endpoint) { reject(new Error('랭킹 서버 연결 준비 중입니다.')); return; }
      const callback = `publicRanking_${crypto.randomUUID().replaceAll('-', '')}`;
      const script = document.createElement('script');
      let timer;
      const finish = (error, value) => {
        clearTimeout(timer); script.remove(); delete window[callback];
        if (error) reject(error); else resolve(value);
      };
      window[callback] = value => value.ok ? finish(null, value) : finish(new Error(value.error || '랭킹 요청 실패'));
      script.onerror = () => finish(new Error('랭킹 서버에 연결할 수 없습니다.'));
      const url = new URL(config.endpoint);
      Object.entries({ ...parameters, callback, t: Date.now() }).forEach(([key, value]) => url.searchParams.set(key, value));
      script.src = url.href;
      timer = setTimeout(() => finish(new Error('랭킹 서버 응답이 지연됩니다. 다시 시도해주세요.')), 20000);
      document.head.append(script);
    });
  }
  function open() {
    if (overlay.hidden) previousFocus = document.activeElement;
    overlay.hidden = false; close.focus();
  }
  function dismiss() {
    if (busy) return;
    ++requestId; overlay.hidden = true;
    previousFocus?.focus();
  }
  async function showRanking(result) {
    board = 'weekly';
    open();
    const id = ++requestId;
    if (result) pending = { ...result, runId: window.astGameRunId };
    form.hidden = true;
    const score = overlay.querySelector('.public-ranking-score');
    score.hidden = !pending;
    if (pending) score.textContent = `TOTAL SCORE ${pending.totalScore.toLocaleString('en-US')}`;
    status.textContent = '랭킹을 확인하고 있습니다.';
    try {
      if (!config.endpoint) {
        const response = await fetch(config.fallbackUrl, { cache: 'no-store' });
        if (!response.ok) throw new Error('랭킹 데이터를 불러오지 못했습니다.');
        const fallback = await response.json();
        if (id !== requestId) return;
        acceptData(fallback); status.textContent = '랭킹 서버 연결 준비 중입니다. 현재는 점수를 등록할 수 없습니다.';
        return;
      }
      const value = await api({ action: 'leaderboard', score: pending?.totalScore ?? '' });
      if (id !== requestId) return;
      acceptData(value);
      if (pending && !savedRunId && (value.qualifies.allTime || value.qualifies.weekly)) {
        form.hidden = false; input.focus();
        status.textContent = 'TOP 10 진입! 이름을 입력해주세요.';
      } else status.textContent = pending && !savedRunId ? '이번 점수는 TOP 10에 들지 못했습니다.' : '주간 랭킹은 월요일 00:00에 초기화됩니다.';
    } catch (error) {
      if (id === requestId) status.textContent = error.message;
    }
  }
  async function register(event) {
    event.preventDefault();
    if (busy || !pending) return;
    const name = input.value.trim().replace(/\s+/g, ' ');
    if (!name || [...name].length > 20 || /[<>\u0000-\u001f\u007f]/.test(name)) {
      status.textContent = '이름은 1~20자로 입력해주세요. 특수 태그는 사용할 수 없습니다.'; return;
    }
    busy = true; submit.disabled = true; close.disabled = true;
    status.textContent = '점수를 등록하고 있습니다.';
    try {
      await fetch(config.endpoint, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ action: 'submit', name, result: pending }) });
      let response;
      for (let attempt = 0; attempt < 12; attempt++) {
        response = await api({ action: 'status', runId: pending.runId });
        if (response.receipt) break;
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
      if (!response.receipt) throw new Error('저장을 확인하지 못했습니다. 같은 이름으로 다시 시도해주세요.');
      savedRunId = pending.runId;
      acceptData(response); form.hidden = true;
      status.textContent = response.receipt.accepted ? '점수가 등록되었습니다!' : '등록 중 순위가 바뀌어 TOP 10에 들지 못했습니다.';
    } catch (error) { status.textContent = error.message; }
    finally { busy = false; submit.disabled = false; close.disabled = false; }
  }
  button.addEventListener('click', () => showRanking());
  close.addEventListener('click', dismiss);
  form.addEventListener('submit', register);
  overlay.querySelectorAll('[data-board]').forEach(tab => tab.addEventListener('click', () => { board = tab.dataset.board; render(); }));
  overlay.addEventListener('pointerdown', event => event.stopPropagation());
  overlay.addEventListener('click', event => event.stopPropagation());
  document.addEventListener('keydown', event => {
    if (overlay.hidden) return;
    event.stopImmediatePropagation();
    if (event.key === 'Escape') { event.preventDefault(); dismiss(); }
    if (event.key === 'Tab') {
      const targets = [...overlay.querySelectorAll('button:not(:disabled), input')].filter(element => element.getClientRects().length);
      const first = targets[0], last = targets.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  }, true);
  const updateTitleButton = () => { button.hidden = title.classList.contains('hidden'); };
  new MutationObserver(updateTitleButton).observe(title, { attributes: true, attributeFilter: ['class'] });
  updateTitleButton();
  // Keep the native AST submission hook untouched; this is only the public build.
  window.addEventListener('public-stage-clear', event => showRanking(event.detail));
})();
