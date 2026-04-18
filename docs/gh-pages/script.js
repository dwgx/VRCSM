// ── Smooth scroll nav highlighting ──
document.addEventListener('DOMContentLoaded', () => {
  const navItems = document.querySelectorAll('.nav-item[data-section]');
  const sections = [];
  navItems.forEach(item => {
    const id = item.getAttribute('data-section');
    const el = document.getElementById(id);
    if (el) sections.push({ id, el, nav: item });
  });

  const content = document.getElementById('content');
  if (!content) return;

  function updateActive() {
    const scrollTop = content.scrollTop;
    const scrollHeight = content.scrollHeight;
    const clientHeight = content.clientHeight;

    // If scrolled to the bottom, activate the last section
    if (scrollTop + clientHeight >= scrollHeight - 30) {
      navItems.forEach(item => item.classList.remove('active'));
      const lastNav = sections[sections.length - 1]?.nav;
      if (lastNav) lastNav.classList.add('active');
      return;
    }

    let current = sections[0]?.id;
    for (const s of sections) {
      if (s.el.offsetTop - 80 <= scrollTop) current = s.id;
    }
    navItems.forEach(item => {
      item.classList.toggle('active', item.getAttribute('data-section') === current);
    });
  }

  content.addEventListener('scroll', updateActive, { passive: true });
  updateActive();

  // Smooth scroll on nav click
  navItems.forEach(item => {
    item.addEventListener('click', e => {
      e.preventDefault();
      const id = item.getAttribute('data-section');
      const target = document.getElementById(id);
      if (target) {
        content.scrollTo({ top: target.offsetTop - 20, behavior: 'smooth' });
      }
    });
  });

  // Stagger section animations
  const allSections = document.querySelectorAll('.section');
  allSections.forEach((sec, i) => {
    sec.style.animationDelay = `${i * 80}ms`;
  });

  // ── Ctrl+K Easter Egg Command Palette ──
  const overlay = document.getElementById('cmdOverlay');
  if (!overlay) return;

  function openPalette() {
    overlay.classList.add('open');
  }
  function closePalette() {
    overlay.classList.remove('open');
  }

  // Keyboard shortcut
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      if (overlay.classList.contains('open')) {
        closePalette();
      } else {
        openPalette();
      }
    }
    if (e.key === 'Escape' && overlay.classList.contains('open')) {
      closePalette();
    }
  });

  // Click overlay to close
  overlay.addEventListener('click', e => {
    if (e.target === overlay) closePalette();
  });

  // Also open when clicking the toolbar search bar
  const toolbarSearch = document.querySelector('.toolbar-search');
  if (toolbarSearch) {
    toolbarSearch.addEventListener('click', () => openPalette());
  }
});
