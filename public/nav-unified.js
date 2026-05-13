(function () {
  const ROLE_LABELS = {
    submitter: 'Submitter',
    approver: 'Approver',
    ex: 'Executive',
    managerial: 'Managerial',
    superadmin: 'SuperAdmin',
  };

  const ROLE_LINK_ORDER = {
    submitter: ['/', '/concrete-form.html', '/status.html'],
    approver: ['/approve.html', '/history.html', '/dashboard.html'],
    ex: ['/approve.html', '/history.html', '/dashboard.html'],
    managerial: ['/managerial.html', '/selling.html', '/history.html', '/dashboard.html'],
    superadmin: ['/requests.html', '/admin.html', '/dashboard.html'],
  };

  const PRIMARY_BY_PATH = {
    '/': {
      submitter: '/status.html',
    },
    '/status.html': {
      submitter: '/',
    },
    '/concrete-form.html': {
      submitter: '/status.html',
    },
    '/approve.html': {
      approver: '/history.html',
      ex: '/history.html',
    },
    '/dashboard.html': {
      approver: '/approve.html',
      ex: '/approve.html',
      managerial: '/managerial.html',
      superadmin: '/requests.html',
    },
    '/managerial.html': {
      managerial: '/selling.html',
      superadmin: '/selling.html',
    },
    '/selling.html': {
      managerial: '/managerial.html',
      superadmin: '/managerial.html',
    },
    '/history.html': {
      approver: '/approve.html',
      ex: '/approve.html',
      managerial: '/managerial.html',
      superadmin: '/requests.html',
    },
    '/admin.html': {
      superadmin: '/requests.html',
    },
    '/requests.html': {
      superadmin: '/admin.html',
    },
  };

  function normalizePath(href) {
    try {
      const url = new URL(href, window.location.origin);
      return url.pathname;
    } catch (err) {
      return '';
    }
  }

  function isLogoutControl(el) {
    const text = (el.textContent || '').trim();
    const title = (el.getAttribute('title') || '').trim();
    const onclick = (el.getAttribute('onclick') || '').trim();
    return text.includes('ออก') || title.includes('ออก') || onclick.includes('logout');
  }

  function inferLabel(el) {
    const title = (el.getAttribute('title') || '').trim();
    if (title) return title;
    const label = (el.querySelector('.btn-label')?.textContent || '').trim();
    if (label) return label;
    const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    return text || 'เมนู';
  }

  function setUserChip(actions, user) {
    const chip = actions.querySelector('.app-user-chip');
    if (!chip || !user) return;

    const roleLabel = ROLE_LABELS[user.role] || (user.role || 'User');
    const name = user.fullName || user.employeeId || 'ผู้ใช้งาน';

    chip.replaceChildren();

    const icon = document.createElement('i');
    icon.className = 'fas fa-user';

    const role = document.createElement('span');
    role.className = 'app-user-role';
    role.textContent = `${roleLabel} | `;

    const userName = document.createElement('span');
    userName.className = 'app-user-name';
    userName.textContent = name;

    chip.append(icon, role, userName);
  }

  function setupMobileTooltips(actions) {
    if (!window.matchMedia('(max-width: 575px)').matches) return;
    if (!window.bootstrap || !window.bootstrap.Tooltip) return;

    Array.from(actions.querySelectorAll('.app-nav-btn')).forEach((btn) => {
      const existingToggle = btn.getAttribute('data-bs-toggle');
      if (existingToggle && existingToggle !== 'tooltip') {
        return;
      }

      const label = inferLabel(btn);
      btn.setAttribute('title', label);
      btn.setAttribute('aria-label', label);
      btn.setAttribute('data-bs-toggle', 'tooltip');
      btn.setAttribute('data-bs-placement', 'bottom');
      window.bootstrap.Tooltip.getOrCreateInstance(btn, {
        trigger: 'hover focus',
        container: 'body',
      });
    });
  }

  function filterAndOrderByRole(actions, role) {
    const links = Array.from(actions.querySelectorAll('a.app-nav-btn'));
    if (links.length === 0) return;

    const allowed = ROLE_LINK_ORDER[role] || [];
    if (allowed.length === 0) return;

    const visible = links.filter((el) => !el.classList.contains('d-none'));
    if (visible.length === 0) return;

    const byPath = new Map();
    visible.forEach((el) => {
      const path = normalizePath(el.getAttribute('href') || '');
      if (path) byPath.set(path, el);
    });

    const ordered = [];
    allowed.forEach((path) => {
      const el = byPath.get(path);
      if (el) ordered.push(el);
    });

    visible.forEach((el) => {
      if (!ordered.includes(el)) ordered.push(el);
    });

    const userChip = actions.querySelector('.app-user-chip');
    const logoutControl = Array.from(actions.querySelectorAll('.app-nav-btn')).find(isLogoutControl) || null;
    const anchor = userChip || logoutControl || null;

    ordered.forEach((el) => {
      actions.insertBefore(el, anchor);
    });
  }

  function makeDropdown(actions, extraLinks, insertBeforeEl) {
    const wrapper = document.createElement('div');
    wrapper.className = 'dropdown';

    const btn = document.createElement('button');
    btn.className = 'btn btn-sm btn-outline-light app-nav-btn app-nav-more-btn dropdown-toggle';
    btn.type = 'button';
    btn.dataset.bsToggle = 'dropdown';
    btn.ariaExpanded = 'false';
    btn.innerHTML = '<i class="fas fa-bars me-1"></i><span class="btn-label">เมนู</span>';

    const menu = document.createElement('ul');
    menu.className = 'dropdown-menu dropdown-menu-end app-nav-menu';

    extraLinks.forEach((link) => {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.className = 'dropdown-item';
      a.href = link.getAttribute('href') || '#';
      a.innerHTML = link.innerHTML;
      if (link.classList.contains('is-active')) {
        a.classList.add('active');
      }
      li.appendChild(a);
      menu.appendChild(li);
      link.remove();
    });

    wrapper.appendChild(btn);
    wrapper.appendChild(menu);

    if (insertBeforeEl) {
      actions.insertBefore(wrapper, insertBeforeEl);
    } else {
      actions.appendChild(wrapper);
    }
  }

  function applyPrimaryAction(actions, role) {
    const currentPath = window.location.pathname;
    const rule = PRIMARY_BY_PATH[currentPath] || {};
    const targetPath = rule[role];
    if (!targetPath) return;

    const links = Array.from(actions.querySelectorAll('a.app-nav-btn'));
    const target = links.find((el) => normalizePath(el.getAttribute('href') || '') === targetPath);
    if (!target) return;

    links.forEach((el) => {
      el.classList.remove('app-nav-primary');
    });
    target.classList.add('app-nav-primary');
  }

  function createExecutiveSidebar(actions, user) {
    if (window.matchMedia('(max-width: 991px)').matches) return;
    if (window.location.pathname === '/dashboard.html') return;
    if (document.getElementById('exec-side-rail')) {
      actions.classList.add('side-rail-enabled');
      return;
    }

    const links = Array.from(actions.querySelectorAll('a.app-nav-btn')).filter((el) => !el.classList.contains('d-none'));
    if (links.length === 0) return;

    const rail = document.createElement('aside');
    rail.id = 'exec-side-rail';
    rail.className = 'exec-side-rail';

    const brand = document.createElement('div');
    brand.className = 'exec-side-rail-brand';
    brand.innerHTML = '<i class="fas fa-industry"></i><span>Iron Drop</span>';

    const nav = document.createElement('nav');
    nav.className = 'exec-side-rail-nav';

    links.forEach((el) => {
      const item = document.createElement('a');
      item.className = 'exec-rail-link';
      item.href = el.getAttribute('href') || '#';
      if (el.classList.contains('is-active')) item.classList.add('active');
      if (el.classList.contains('app-nav-primary')) item.classList.add('primary');

      const iconClass = el.querySelector('i')?.className || 'fas fa-circle';
      const icon = document.createElement('i');
      icon.className = iconClass;

      const label = document.createElement('span');
      label.textContent = inferLabel(el);

      item.append(icon, label);
      nav.appendChild(item);
    });

    const footer = document.createElement('div');
    footer.className = 'exec-side-rail-footer';
    const roleLabel = ROLE_LABELS[user?.role] || (user?.role || 'User');
    const name = user?.fullName || user?.employeeId || 'ผู้ใช้งาน';
    footer.textContent = `${roleLabel} | ${name}`;

    rail.append(brand, nav, footer);
    document.body.prepend(rail);
    document.body.classList.add('has-exec-side-rail');
    actions.classList.add('side-rail-enabled');
  }

  function simplifyNavbar(actions) {
    const controls = Array.from(actions.querySelectorAll('.app-nav-btn'));
    if (controls.length === 0) return;

    const currentPath = window.location.pathname;
    controls.forEach((el) => {
      if (el.tagName === 'A') {
        try {
          const url = new URL(el.href, window.location.origin);
          if (url.pathname === currentPath) {
            el.classList.add('is-active');
          }
        } catch (err) {
          // Ignore invalid URLs.
        }
      }
    });

    const logoutControl = controls.find(isLogoutControl) || null;
    const linkControls = controls.filter((el) => el.tagName === 'A' && el !== logoutControl);

    if (linkControls.length > 2) {
      const keep = linkControls.slice(0, 2);
      const extras = linkControls.slice(2);
      const userChip = actions.querySelector('.app-user-chip');
      const anchor = userChip || logoutControl || null;

      // Keep quick links visible and move the rest to dropdown.
      keep.forEach((k) => {
        if (!k.parentElement || k.parentElement !== actions) {
          actions.insertBefore(k, anchor);
        }
      });

      makeDropdown(actions, extras, anchor);
    }
  }

  async function getCurrentUserRole() {
    try {
      const res = await fetch('/api/auth/me', { credentials: 'same-origin' });
      if (!res.ok) return null;
      const user = await res.json();
      return user || null;
    } catch (err) {
      return null;
    }
  }

  document.addEventListener('DOMContentLoaded', async function () {
    const user = await getCurrentUserRole();
    const role = user?.role || null;
    document.querySelectorAll('.app-nav-actions').forEach((actions) => {
      setUserChip(actions, user);
      filterAndOrderByRole(actions, role);
      applyPrimaryAction(actions, role);
      simplifyNavbar(actions);
      setupMobileTooltips(actions);
    });
  });
})();
