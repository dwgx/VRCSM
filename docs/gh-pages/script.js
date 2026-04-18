/* =====================================================================
 * VRCSM landing — fake-app interactivity + Ctrl+K palette + easter eggs
 * No build step, no deps. Plain ES2020+.
 * ===================================================================== */

(() => {
  'use strict';

  // ─── State ─────────────────────────────────────────────────────────
  const state = {
    route: 'dashboard',
    rainbow: false,
    sidebarHidden: false,
    iconClicks: 0,
    iconClickTimer: null,
    konamiBuffer: [],
    typedBuffer: '',
    typedTimer: null,
  };

  const KONAMI = ['ArrowUp','ArrowUp','ArrowDown','ArrowDown','ArrowLeft','ArrowRight','ArrowLeft','ArrowRight','b','a'];

  // ─── DOM helpers ───────────────────────────────────────────────────
  const $ = (sel, root=document) => root.querySelector(sel);
  const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

  // ─── Toast ─────────────────────────────────────────────────────────
  function toast(title, desc, icon='✦') {
    const stack = $('#toastStack');
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = `<span class="ic">${icon}</span><div class="body"><div class="title">${title}</div>${desc?`<div class="desc">${desc}</div>`:''}</div>`;
    stack.appendChild(el);
    setTimeout(() => {
      el.classList.add('removing');
      setTimeout(() => el.remove(), 220);
    }, 3200);
  }

  // ─── Routing (page swap) ───────────────────────────────────────────
  function navigateTo(route) {
    const target = $(`#page-${route}`);
    if (!target) return;
    state.route = route;

    $$('.page').forEach(p => p.classList.remove('active'));
    target.classList.add('active');

    $$('.nav-item[data-route]').forEach(n =>
      n.classList.toggle('active', n.dataset.route === route));

    const tabbar = $('#tabbar');
    const label = capitalize(route);
    tabbar.innerHTML = `<div class="tab active" data-tab="${route}">${label} <span class="tab-close" data-cmd="close-tab">×</span></div>`;
    $('#crumb').textContent = label;

    $('#content').scrollTo({top:0, behavior:'smooth'});
  }
  const capitalize = s => s.charAt(0).toUpperCase() + s.slice(1);

  // ─── Side nav clicks ───────────────────────────────────────────────
  $$('.nav-item[data-route]').forEach(item => {
    item.addEventListener('click', () => navigateTo(item.dataset.route));
  });

  // ─── Title bar buttons (easter eggs) ───────────────────────────────
  $$('.titlebar-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const what = btn.dataset.easter;
      if (what === 'minimize') toast('这是网页 :)', '没法真的最小化哈', '🙃');
      else if (what === 'maximize') {
        document.documentElement.requestFullscreen?.().catch(()=>{});
        toast('Fullscreen', '按 F11 或 Esc 退出', '⛶');
      }
      else if (what === 'close') {
        toast('再见！', '别真关嘛… 这页面挺不错的吧？', '👋');
      }
    });
  });

  // ─── App icon click counter (7 = secret) ───────────────────────────
  $('#appIconTop')?.addEventListener('click', e => {
    e.preventDefault();
    state.iconClicks++;
    clearTimeout(state.iconClickTimer);
    state.iconClickTimer = setTimeout(() => state.iconClicks = 0, 1500);
    if (state.iconClicks === 7) {
      state.iconClicks = 0;
      toast('七连击！', '你真的很喜欢这个图标，是不是？', '🌀');
      const img = $('#appIconTop');
      img.style.transform = 'rotate(360deg)';
      img.style.transition = 'transform .8s';
      setTimeout(() => { img.style.transform=''; img.style.transition=''; }, 900);
    }
  });

  // ─── About portrait spin ───────────────────────────────────────────
  $('#aboutPortrait')?.addEventListener('click', e => {
    e.target.classList.add('spinning');
    setTimeout(() => e.target.classList.remove('spinning'), 1100);
  });

  // ─── Menu bar dropdowns ────────────────────────────────────────────
  function closeAllMenus() {
    $$('.menu-popover').forEach(p => p.classList.remove('open'));
    $$('.menubar-trigger').forEach(t => t.classList.remove('open'));
  }
  $$('.menubar-trigger').forEach(trigger => {
    trigger.addEventListener('click', e => {
      e.stopPropagation();
      const menu = trigger.dataset.menu;
      const popover = $(`.menu-popover[data-popover="${menu}"]`);
      const wasOpen = popover?.classList.contains('open');
      closeAllMenus();
      if (!wasOpen && popover) {
        const rect = trigger.getBoundingClientRect();
        const menubar = $('#menubar').getBoundingClientRect();
        popover.style.left = (rect.left - menubar.left) + 'px';
        popover.classList.add('open');
        trigger.classList.add('open');
      }
    });
    trigger.addEventListener('mouseenter', () => {
      const anyOpen = $$('.menu-popover.open').length > 0;
      if (anyOpen) trigger.click();
    });
  });
  document.addEventListener('click', closeAllMenus);

  // ─── Generic command dispatch ──────────────────────────────────────
  function runCmd(cmd, dataset = {}) {
    closeAllMenus();
    switch (cmd) {
      case 'nav':         navigateTo(dataset.route); break;
      case 'palette':     openPalette(); break;
      case 'rescan':      toast('Rescan triggered', '24.7 GB across 8 categories — 0 broken links', '↻'); break;
      case 'toggle-sidebar':
        state.sidebarHidden = !state.sidebarHidden;
        $('.sidebar').style.display = state.sidebarHidden ? 'none' : '';
        toast(state.sidebarHidden ? 'Sidebar hidden' : 'Sidebar shown', 'Ctrl+B 再次切换', '◀');
        break;
      case 'toggle-rainbow':
        state.rainbow = !state.rainbow;
        document.body.classList.toggle('secret-rainbow', state.rainbow);
        toast(state.rainbow ? '🌈 Rainbow ON' : 'Rainbow OFF', '左侧导航栏', '✨');
        break;
      case 'zoom-in':     adjustZoom(0.1); break;
      case 'zoom-out':    adjustZoom(-0.1); break;
      case 'zoom-reset':  document.body.style.zoom='1'; toast('Zoom reset', '100%', '⌖'); break;
      case 'external':    window.open(dataset.url, '_blank', 'noreferrer'); break;
      case 'close-tab':   toast('Tab closed', '…开个玩笑，只有一个 tab 哈', '✕'); break;
      case 'exit':        toast('再见 — 不过这是网页', '关掉浏览器标签即可', '👋'); break;
      case 'konami':      triggerKonami(); break;
      case 'about':       navigateTo('about'); break;
    }
  }
  function adjustZoom(delta) {
    const cur = parseFloat(document.body.style.zoom || '1') || 1;
    const next = Math.max(0.6, Math.min(1.8, cur + delta));
    document.body.style.zoom = String(next);
    toast(`Zoom ${Math.round(next*100)}%`, 'Ctrl+0 重置', '⌖');
  }

  // Wire dropdown menu items + any other [data-cmd] elements
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-cmd]');
    if (!el) return;
    runCmd(el.dataset.cmd, el.dataset);
  });

  // ─── Konami sequence ───────────────────────────────────────────────
  function triggerKonami() {
    state.rainbow = true;
    document.body.classList.add('secret-rainbow');
    $('#konamiOverlay').classList.add('open');
  }
  $('#konamiClose')?.addEventListener('click', () => {
    $('#konamiOverlay').classList.remove('open');
  });

  // ─── Typed-buzzword detector (in addition to palette query) ───────
  const TYPED_TRIGGERS = {
    'sudo':    () => toast('Permission denied', '不是真的 sudo 啊…', '🔒'),
    'help':    () => { openPalette(); $('#cmdInput').value='help'; doSearch('help'); },
    'rm -rf':  () => toast('NICE TRY', 'Safe Delete: 检测到删根命令，已阻断 :)', '🛡️'),
    'vrcsm':   () => toast('That\'s us!', 'v0.7.1 · 你已经在它的网页上了', '✨'),
    'matrix':  () => toggleMatrix(),
  };
  document.addEventListener('keydown', e => {
    // Don't capture when palette open or typing in input
    if ($('#cmdOverlay').classList.contains('open')) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key.length !== 1) return;
    state.typedBuffer = (state.typedBuffer + e.key).slice(-20);
    clearTimeout(state.typedTimer);
    state.typedTimer = setTimeout(() => state.typedBuffer = '', 1200);
    for (const [trigger, fn] of Object.entries(TYPED_TRIGGERS)) {
      if (state.typedBuffer.toLowerCase().endsWith(trigger)) {
        state.typedBuffer = '';
        fn();
        break;
      }
    }
  });

  // ─── Matrix mode ────────────────────────────────────────────────────
  let matrixCanvas = null, matrixRaf = 0;
  function toggleMatrix() {
    if (matrixCanvas) { stopMatrix(); return; }
    matrixCanvas = document.createElement('canvas');
    Object.assign(matrixCanvas.style, {
      position:'fixed', inset:0, zIndex:9997,
      pointerEvents:'none', mixBlendMode:'screen', opacity:'.55'
    });
    document.body.appendChild(matrixCanvas);
    const resize = () => { matrixCanvas.width = innerWidth; matrixCanvas.height = innerHeight; };
    resize();
    addEventListener('resize', resize);
    const ctx = matrixCanvas.getContext('2d');
    const cols = Math.floor(innerWidth / 14);
    const drops = Array(cols).fill(1);
    const chars = 'ＶＲＣＳＭ01アイウエオカキクケコサシスセソタチツテト';
    function draw() {
      ctx.fillStyle = 'rgba(28,28,28,.07)';
      ctx.fillRect(0,0,matrixCanvas.width,matrixCanvas.height);
      ctx.fillStyle = '#3b8fd6';
      ctx.font = '14px JetBrains Mono';
      drops.forEach((y,i) => {
        ctx.fillText(chars[Math.floor(Math.random()*chars.length)], i*14, y*14);
        if (y*14 > matrixCanvas.height && Math.random() > 0.975) drops[i]=0;
        drops[i]++;
      });
      matrixRaf = requestAnimationFrame(draw);
    }
    draw();
    toast('Matrix mode ON', '再次输入 "matrix" 关闭', '◉');
  }
  function stopMatrix() {
    cancelAnimationFrame(matrixRaf);
    matrixCanvas?.remove();
    matrixCanvas = null;
    toast('Matrix mode OFF', '回到普通世界', '◌');
  }

  // ─── Konami listener (anywhere) ────────────────────────────────────
  document.addEventListener('keydown', e => {
    if ($('#cmdOverlay').classList.contains('open')) return;
    state.konamiBuffer.push(e.key);
    if (state.konamiBuffer.length > KONAMI.length) state.konamiBuffer.shift();
    if (state.konamiBuffer.length === KONAMI.length &&
        state.konamiBuffer.every((k,i) => k === KONAMI[i])) {
      state.konamiBuffer = [];
      triggerKonami();
    }
  });

  // ─── Language pill cycle ───────────────────────────────────────────
  const LANGS = ['中文','English','日本語','한국어','ภาษาไทย','हिन्दी','Русский'];
  let langIdx = 0;
  $('#langPill')?.addEventListener('click', () => {
    langIdx = (langIdx + 1) % LANGS.length;
    $('#langPill').textContent = LANGS[langIdx];
    toast(`Language → ${LANGS[langIdx]}`, '真 app 里有 7 种语言哦', '🌐');
  });

  // ═══════════════════════════════════════════════════════════════════
  // Command Palette
  // ═══════════════════════════════════════════════════════════════════

  const COMMANDS = [
    // — Navigate —
    { id:'nav-dashboard',    section:'Navigate', label:'Go to Dashboard',    icon:'⊟', shortcut:'Ctrl+1', action:()=>navigateTo('dashboard') },
    { id:'nav-features',     section:'Navigate', label:'Go to Features',     icon:'◇', shortcut:'Ctrl+2', action:()=>navigateTo('features') },
    { id:'nav-architecture', section:'Navigate', label:'Go to Architecture', icon:'◈', shortcut:'Ctrl+3', action:()=>navigateTo('architecture') },
    { id:'nav-download',     section:'Navigate', label:'Go to Download',     icon:'↓', shortcut:'Ctrl+4', action:()=>navigateTo('download') },
    { id:'nav-about',        section:'Navigate', label:'Go to About',        icon:'ⓘ', shortcut:'Ctrl+5', action:()=>navigateTo('about') },
    // — Actions —
    { id:'a-rescan',     section:'Actions', label:'Rescan Cache',         icon:'↻', shortcut:'F5',     action:()=>runCmd('rescan') },
    { id:'a-sidebar',    section:'Actions', label:'Toggle Sidebar',       icon:'◧', shortcut:'Ctrl+B', action:()=>runCmd('toggle-sidebar') },
    { id:'a-rainbow',    section:'Actions', label:'Toggle Rainbow Mode',  icon:'🌈', action:()=>runCmd('toggle-rainbow') },
    { id:'a-zoomin',     section:'Actions', label:'Zoom In',              icon:'+', shortcut:'Ctrl++', action:()=>runCmd('zoom-in') },
    { id:'a-zoomout',    section:'Actions', label:'Zoom Out',             icon:'−', shortcut:'Ctrl+-', action:()=>runCmd('zoom-out') },
    { id:'a-zoomreset',  section:'Actions', label:'Reset Zoom',           icon:'⌖', shortcut:'Ctrl+0', action:()=>runCmd('zoom-reset') },
    // — Open external —
    { id:'l-github',  section:'Links', label:'Open GitHub Repository',  icon:'⎘', action:()=>open('https://github.com/dwgx/VRCSM','_blank') },
    { id:'l-release', section:'Links', label:'Latest Release on GitHub', icon:'⎘', action:()=>open('https://github.com/dwgx/VRCSM/releases/latest','_blank') },
    { id:'l-issues',  section:'Links', label:'Report an Issue',          icon:'⎘', action:()=>open('https://github.com/dwgx/VRCSM/issues/new','_blank') },
    // — Easter eggs (only show on direct match) —
    { id:'e-konami',  section:'Easter Eggs', label:'Konami Code',  hint:'↑↑↓↓←→←→BA', icon:'✦', keywords:'secret konami code', action:triggerKonami },
    { id:'e-matrix',  section:'Easter Eggs', label:'Matrix Mode',  hint:'data rain',  icon:'◉', keywords:'matrix rain neo', action:toggleMatrix },
    { id:'e-help',    section:'Easter Eggs', label:'Show All Easter Eggs', hint:'see what\'s hidden', icon:'?', keywords:'help easter eggs hidden', action:showHelp },
    { id:'e-who',     section:'Easter Eggs', label:'Who is dwgx?', hint:'meet the author', icon:'✶', keywords:'who dwgx author about', action:()=>{ navigateTo('about'); closePalette(); } },
    { id:'e-cn',      section:'Easter Eggs', label:'Random Chinese phrase', icon:'语', keywords:'phrase fortune chinese random', action:randomFortune },
  ];

  function showHelp() {
    closePalette();
    toast('Easter eggs found', '在搜索框输入 sudo / help / rm -rf / vrcsm / matrix；或按 Konami Code；或点 7 次图标', '?');
  }

  const FORTUNES = [
    '我觉得这个工具很好用了 — 不需要问什么',
    '今天的缓存比昨天小，恭喜你',
    '别犹豫，删了它',
    'VRChat 在跑就别迁移',
    '世界 ID 不会因你而改变',
    '没听说过的化身，多半是私的',
    '默认 dry-run，请认真看',
    'NTFS junction 是你最好的朋友',
    '清缓存不会让你脸更好看，但会让 SSD 更舒服',
    '如果一切正常，就什么都不用动',
  ];
  function randomFortune() {
    closePalette();
    toast(FORTUNES[Math.floor(Math.random()*FORTUNES.length)], '— VRCSM Fortune', '✦');
  }

  function fuzzyScore(haystack, query) {
    if (!query) return 1;
    const h = haystack.toLowerCase();
    const q = query.toLowerCase();
    if (h === q) return 1000;
    if (h.startsWith(q)) return 500;
    if (h.includes(q)) return 100;
    let i = 0;
    for (const ch of h) {
      if (ch === q[i]) i++;
      if (i === q.length) return 50;
    }
    return 0;
  }

  let cmdActiveIdx = 0;
  let cmdFiltered = [];

  function doSearch(query) {
    const list = $('#cmdList');
    const count = $('#cmdCount');
    cmdFiltered = COMMANDS
      .map(c => ({ c, score: Math.max(
        fuzzyScore(c.label, query),
        c.keywords ? fuzzyScore(c.keywords, query) : 0,
        c.section ? fuzzyScore(c.section, query) * 0.5 : 0,
      )}))
      .filter(({score, c}) => {
        if (c.section === 'Easter Eggs' && !query) return false;
        return score > 0;
      })
      .sort((a,b) => b.score - a.score)
      .map(({c}) => c);

    cmdActiveIdx = 0;
    count.textContent = `${cmdFiltered.length} ${cmdFiltered.length === 1 ? 'result' : 'results'}`;

    if (cmdFiltered.length === 0) {
      list.innerHTML = `<div class="cmd-empty">没找到 "${escapeHtml(query)}" — 试试 Konami code？<div class="hint">↑ ↑ ↓ ↓ ← → ← → B A</div></div>`;
      return;
    }

    let html = '';
    let lastSection = null;
    cmdFiltered.forEach((c, i) => {
      if (c.section !== lastSection) {
        html += `<div class="cmd-section">${c.section}</div>`;
        lastSection = c.section;
      }
      html += `<div class="cmd-item${i === cmdActiveIdx ? ' active' : ''}" data-idx="${i}">
        <span class="ic">${c.icon || '·'}</span>
        <span class="label">${escapeHtml(c.label)}</span>
        ${c.hint ? `<span class="hint">${escapeHtml(c.hint)}</span>` : ''}
        ${c.shortcut ? `<span class="keys"><kbd>${c.shortcut.replace(/\+/g,'</kbd><kbd>')}</kbd></span>` : ''}
      </div>`;
    });
    list.innerHTML = html;

    list.querySelectorAll('.cmd-item').forEach(el => {
      el.addEventListener('click', () => {
        const idx = parseInt(el.dataset.idx, 10);
        executeCmd(idx);
      });
      el.addEventListener('mouseenter', () => {
        cmdActiveIdx = parseInt(el.dataset.idx, 10);
        updateActive();
      });
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
  }

  function updateActive() {
    $$('.cmd-item').forEach((el, i) => el.classList.toggle('active', i === cmdActiveIdx));
    const active = $$('.cmd-item')[cmdActiveIdx];
    active?.scrollIntoView({block:'nearest'});
  }

  function executeCmd(idx) {
    const c = cmdFiltered[idx];
    if (!c) return;
    closePalette();
    setTimeout(() => c.action(), 50);
  }

  function openPalette() {
    $('#cmdOverlay').classList.add('open');
    const input = $('#cmdInput');
    input.value = '';
    input.focus();
    doSearch('');
  }
  function closePalette() {
    $('#cmdOverlay').classList.remove('open');
  }

  $('#cmdTrigger').addEventListener('click', openPalette);
  $('#cmdTrigger').addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPalette(); }
  });

  $('#cmdInput').addEventListener('input', e => doSearch(e.target.value));
  $('#cmdInput').addEventListener('keydown', e => {
    if (e.key === 'Escape') { closePalette(); }
    else if (e.key === 'ArrowDown') {
      e.preventDefault();
      cmdActiveIdx = Math.min(cmdActiveIdx + 1, cmdFiltered.length - 1);
      updateActive();
    }
    else if (e.key === 'ArrowUp') {
      e.preventDefault();
      cmdActiveIdx = Math.max(cmdActiveIdx - 1, 0);
      updateActive();
    }
    else if (e.key === 'Enter') {
      e.preventDefault();
      executeCmd(cmdActiveIdx);
    }
  });

  $('#cmdOverlay').addEventListener('click', e => {
    if (e.target.id === 'cmdOverlay') closePalette();
  });

  // ─── Global keyboard shortcuts ─────────────────────────────────────
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      const isOpen = $('#cmdOverlay').classList.contains('open');
      isOpen ? closePalette() : openPalette();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'b') { e.preventDefault(); runCmd('toggle-sidebar'); }
    if ((e.ctrlKey || e.metaKey) && e.key === '1') { e.preventDefault(); navigateTo('dashboard'); }
    if ((e.ctrlKey || e.metaKey) && e.key === '2') { e.preventDefault(); navigateTo('features'); }
    if ((e.ctrlKey || e.metaKey) && e.key === '3') { e.preventDefault(); navigateTo('architecture'); }
    if ((e.ctrlKey || e.metaKey) && e.key === '4') { e.preventDefault(); navigateTo('download'); }
    if ((e.ctrlKey || e.metaKey) && e.key === '5') { e.preventDefault(); navigateTo('about'); }
    if (e.key === 'F5') {
      // Don't block real reload — but show toast first
      if (!e.ctrlKey) {
        // soft refresh: just animate the rescan
        e.preventDefault();
        runCmd('rescan');
      }
    }
  });

  // ─── Console banner for the curious ────────────────────────────────
  console.log('%c VRCSM ', 'background:#3b8fd6;color:#fff;padding:4px 12px;border-radius:3px;font-weight:bold;font-size:14px');
  console.log('%cv0.7.1 · github.com/dwgx/VRCSM', 'color:#949494;font-family:monospace');
  console.log('%c彩蛋提示：', 'color:#5da6e8;font-weight:bold');
  console.log('%c · Ctrl+K 打开命令面板', 'color:#dbdbdb');
  console.log('%c · 输入 "matrix" / "sudo" / "help" / "rm -rf" / "vrcsm"', 'color:#dbdbdb');
  console.log('%c · 输入 Konami code (↑↑↓↓←→←→BA)', 'color:#dbdbdb');
  console.log('%c · 连续点 7 次左上角的图标', 'color:#dbdbdb');
  console.log('%c · 还有更多 — 自己发现吧', 'color:#6b6b6b;font-style:italic');

})();
