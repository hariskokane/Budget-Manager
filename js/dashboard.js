(async function () {
  // ── Supabase session guard ──────────────────────────────────────────────────
  const session = await BMStorage.getActiveSession();
  if (!session) {
    window.location.replace('login.html');
    return;
  }

  const userId = session.user.id;
  const email  = session.user.email;

  // Show loading immediately
  const viewContainer = document.getElementById('viewContainer');
  viewContainer.innerHTML = '<div class="loading-overlay"><div class="spinner"></div><p>Loading your data…</p></div>';

  // Load profile + all user data in parallel
  const [profileRes] = await Promise.all([
    window._supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
    BMStorage.initUserData(userId),
  ]);
  const activeUser = profileRes.data || {};
  const sidebar = document.querySelector('.sidebar');
  const openBtn = document.getElementById('openSidebar');
  const backdrop = document.getElementById('backdrop');

  // Navigation
  document.getElementById('navLogout').addEventListener('click', async () => {
    await BMStorage.clearActiveSession();
    window.location.replace('login.html');
  });
  const navButtons = [
    ['navOverview', renderOverview],
    ['navTransactions', renderTransactions],
    ['navDaily', renderDaily],
    ['navBudgets', renderBudgets],
    ['navGoals', renderGoals],
    ['navRecurring', renderRecurring],
    ['navReports', renderReports],
    ['navProfile', renderProfile],
  ];
  let currentNavId = null;
  function refreshBudgetsIfActive() {
    if (currentNavId === 'navBudgets') {
      renderBudgets();
    }
  }
  function setActiveNav(id) {
    navButtons.forEach(([nid]) => {
      const el = document.getElementById(nid);
      if (!el) return;
      if (nid === id) el.classList.add('active'); else el.classList.remove('active');
    });
    currentNavId = id;
    // Sync bottom mobile nav
    document.querySelectorAll('.bottom-nav-btn').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-nav') === id);
    });
  }
  navButtons.forEach(([id, fn]) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('click', () => { closeDrawer(); setActiveNav(id); fn(); });
  });

  // Mobile drawer controls
  function openDrawer() {
    sidebar.classList.add('is-open');
    backdrop.classList.add('is-visible');
  }
  function closeDrawer() {
    sidebar.classList.remove('is-open');
    backdrop.classList.remove('is-visible');
  }
  if (openBtn) openBtn.addEventListener('click', openDrawer);
  if (backdrop) backdrop.addEventListener('click', closeDrawer);
  window.addEventListener('resize', () => { if (!isMobile()) closeDrawer(); });

  // Data helpers – readData is sync (returns from in-memory cache);
  // writeData fires async Supabase sync in the background
  function readData() { return BMStorage.getUserData(); }
  function writeData(next) { BMStorage.setUserData(email, next); }

  // ── Category emoji map ───────────────────────────────────────────────────
  const CATEGORY_ICONS = {
    'Salary':'💰','Business':'🏢','Freelance':'💻','Investments':'📈',
    'Gifts':'🎁','Other Income':'💵','Food':'🍔','Rent':'🏠',
    'Bills':'⚡','Travel':'🚗','Shopping':'🛒','Entertainment':'🎬',
    'Health':'💊','Education':'📚','Other Expense':'💸',
  };
  function catIcon(cat) { return CATEGORY_ICONS[cat] || '📋'; }

  // ── Toast system ─────────────────────────────────────────────────────────
  function showToast(msg, type = 'success', duration = 3500) {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const icons = { success:'✅', error:'❌', info:'ℹ️', warning:'⚠️' };
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `<span>${icons[type] || '💬'}</span><span>${msg}</span>`;
    container.appendChild(el);
    setTimeout(() => {
      el.style.cssText += ';opacity:0;transform:translateY(10px);transition:.3s';
      setTimeout(() => el.remove(), 320);
    }, duration);
  }

  // ── Dark mode toggle ─────────────────────────────────────────────────────
  (function initTheme() {
    const html = document.documentElement;
    const saved = localStorage.getItem('bm_theme') || 'light';
    html.setAttribute('data-theme', saved);

    function applyTheme(val) {
      html.setAttribute('data-theme', val);
      localStorage.setItem('bm_theme', val);
      const emoji = val === 'dark' ? '☀️' : '🌙';
      const label = val === 'dark' ? '☀️ Light Mode' : '🌙 Dark Mode';
      const mobileBtn  = document.getElementById('themeToggle');
      const sidebarBtn = document.getElementById('sidebarThemeToggle');
      if (mobileBtn)  mobileBtn.textContent  = emoji;
      if (sidebarBtn) sidebarBtn.textContent = label;
    }

    applyTheme(saved);

    [document.getElementById('themeToggle'), document.getElementById('sidebarThemeToggle')]
      .filter(Boolean)
      .forEach(btn => btn.addEventListener('click', () => {
        const next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        applyTheme(next);
      }));
  })();

  // ── Bottom mobile nav wiring ─────────────────────────────────────────────
  document.querySelectorAll('.bottom-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const navId = btn.getAttribute('data-nav');
      const fn = navButtons.find(([id]) => id === navId)?.[1];
      if (fn) { closeDrawer(); setActiveNav(navId); fn(); }
    });
  });
  // Bottom nav wiring – active state is handled inside setActiveNav above

  // Budget window helper: derive active window for a budget on a reference date,
  // clamped to start at the budget's own start date
  function computeBudgetWindow(budget, referenceISO) {
    const ref = new Date(referenceISO);
    let fromISO;
    let toISO;
    if (budget.period === 'weekly') {
      const end = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
      const start = new Date(end); start.setDate(start.getDate() - 6);
      fromISO = start.toISOString().slice(0, 10);
      toISO = end.toISOString().slice(0, 10);
    } else {
      fromISO = BMUtils.startOfMonthISO(ref);
      toISO = BMUtils.endOfMonthISO(ref);
    }
    const startClamp = String(budget.startISO || fromISO);
    if (startClamp > fromISO) fromISO = startClamp;
    return { fromISO, toISO };
  }

  // Recurring processing (monthly on chosen day)
  function applyRecurringIfNeeded() {
    const data = readData();
    const today = BMUtils.todayISO();
    if (data.lastRecurringAppliedISO === today) return;
    const t = new Date();
    const day = t.getDate();
    let added = 0;
    for (const r of data.recurring) {
      if (r.day === day) {
        data.transactions.push({
          id: BMUtils.uid('txn'),
          type: r.type,
          amount: Number(r.amount),
          category: r.category,
          date: today,
          note: r.note || 'Recurring',
        });
        added++;
      }
    }
    if (added > 0) {
      data.lastRecurringAppliedISO = today;
      writeData(data);
    }
  }

  // Render functions
  function renderOverview() {
    applyRecurringIfNeeded();
    const data = readData();
    const txns = data.transactions;
    const income = BMUtils.sum(txns.filter(t => t.type === 'income'), t => t.amount);
    const expenses = BMUtils.sum(txns.filter(t => t.type === 'expense'), t => t.amount);
    const balance = income - expenses;
    const savingsRate = income > 0 ? Math.round(((income - expenses) / income) * 100) : 0;
    const plannedMonthlyIncome = activeUser && typeof activeUser.monthly_income === 'number' ? activeUser.monthly_income : null;

    // Get Top 3 Categories
    const currentMonthPrefix = BMUtils.todayISO().slice(0, 7);
    const currentMonthExpenses = txns.filter(t => t.type === 'expense' && t.date.startsWith(currentMonthPrefix));
    const catTotals = {};
    currentMonthExpenses.forEach(t => { catTotals[t.category] = (catTotals[t.category] || 0) + t.amount; });
    const topCategories = Object.entries(catTotals).sort((a,b) => b[1] - a[1]).slice(0, 3);

    viewContainer.innerHTML = `
      <section class="grid cards section texture-soft">
        <div class="card stat income"><div class="stat-label">Income</div><div class="stat-value">${BMUtils.formatCurrencyINR(income)}</div></div>
        <div class="card stat expenses"><div class="stat-label">Expenses</div><div class="stat-value">${BMUtils.formatCurrencyINR(expenses)}</div></div>
        <div class="card stat balance"><div class="stat-label">Balance</div><div class="stat-value">${BMUtils.formatCurrencyINR(balance)}</div></div>
        <div class="card stat savings"><div class="stat-label">Savings Rate</div><div class="stat-value">${savingsRate}%</div></div>
      </section>

      <section class="section" style="display:grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 16px;">
        <div class="card">
          <h2>Top Expenses This Month</h2>
          ${topCategories.length ? `
            <div class="list">
              ${topCategories.map(([cat, amt]) => `
                <div class="list-row" style="padding: 4px 0; border-bottom: 1px solid var(--border);">
                  <span class="list-label">${catIcon(cat)} ${cat}</span>
                  <span class="list-value">${BMUtils.formatCurrencyINR(amt)}</span>
                </div>
              `).join('')}
            </div>
          ` : '<p class="muted">No expenses recorded yet.</p>'}
        </div>
        <div class="card" style="min-width:0;">
          <h2>6-Month Trend</h2>
          <canvas id="miniTrendChart" style="width:100%; height: 120px; display:block;"></canvas>
        </div>
      </section>

      <section class="section texture-mint">
        <h2>Recent Transactions</h2>
        <div class="card table-wrap" id="recentContainer">
          ${isMobile() ? renderReportResponsive(txns.slice(-5).reverse()) : renderTransactionsTable(txns.slice(-5).reverse(), { showActions: false })}
        </div>
      </section>
    `;

    // Render trend chart after HTML is mounted
    setTimeout(() => {
      const canvas = document.getElementById('miniTrendChart');
      if (canvas && txns.length) {
        // Prepare data for the last 6 months
        const monthsMap = {};
        const d = new Date();
        for(let i=5; i>=0; i--) {
            const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
            const key = m.toISOString().slice(0,7);
            monthsMap[key] = { income: 0, expense: 0 };
        }
        txns.forEach(t => {
            const k = t.date.slice(0,7);
            if(monthsMap[k]) {
                if(t.type === 'income') monthsMap[k].income += t.amount;
                if(t.type === 'expense') monthsMap[k].expense += t.amount;
            }
        });
        
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        const cssW = canvas.getBoundingClientRect().width || 300;
        canvas.width = cssW * window.devicePixelRatio;
        canvas.height = 120 * window.devicePixelRatio;
        const ctx = canvas.getContext('2d');
        ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
        ctx.clearRect(0,0,cssW,120);
        
        const keys = Object.keys(monthsMap);
        const maxVal = Math.max(1, ...keys.flatMap(k => [monthsMap[k].income, monthsMap[k].expense]));
        const barW = Math.max(6, (cssW / keys.length) * 0.3);
        const spacing = cssW / keys.length;
        
        keys.forEach((k, i) => {
            const incH = (monthsMap[k].income / maxVal) * 100;
            const expH = (monthsMap[k].expense / maxVal) * 100;
            const cx = (i * spacing) + (spacing / 2);
            
            ctx.fillStyle = '#10b981'; // Income green
            ctx.beginPath(); ctx.roundRect(cx - barW - 1, 100 - incH, barW, incH, 3); ctx.fill();
            
            ctx.fillStyle = '#f43f5e'; // Expense red
            ctx.beginPath(); ctx.roundRect(cx + 1, 100 - expH, barW, expH, 3); ctx.fill();
            
            ctx.fillStyle = isDark ? '#94a3b8' : '#64748b';
            ctx.font = '10px Inter';
            ctx.textAlign = 'center';
            ctx.fillText(k.slice(5), cx, 115);
        });
      }
    }, 50);
  }

  function renderTransactions() {
    applyRecurringIfNeeded();
    const data = readData();
    const txns = data.transactions.slice().reverse();
    const defaultDateStart = BMUtils.startOfMonthISO();
    const defaultDateEnd = BMUtils.endOfMonthISO();
    viewContainer.innerHTML = `
      <section class="section texture-soft">
        <div class="toolbar">
          <select id="filterType">
            <option value="all">All</option>
            <option value="income">Income</option>
            <option value="expense">Expense</option>
          </select>
          <input id="filterQuery" placeholder="Search note/category" />
          <input id="dateFrom" type="date" value="${defaultDateStart}" />
          <input id="dateTo" type="date" value="${defaultDateEnd}" />
          <button id="applyFilters" class="btn">Apply</button>
          <button id="clearFilters" class="btn">Reset</button>
          <button id="exportCSV" class="btn">⬇️ CSV</button>
        </div>
      </section>
      <section class="section texture-sun">
        <div class="card">
          <form id="txnForm" class="form">
            <div id="txnNotice" class="notice error" role="alert"></div>
            <div class="form-row two-col">
              <div>
                <label>Type</label>
                <select name="type" required>
                  <option value="income">Income</option>
                  <option value="expense">Expense</option>
                </select>
              </div>
              <div>
                <label>Amount (₹)</label>
                <input name="amount" type="number" min="0" step="0.01" required />
              </div>
            </div>
            <div class="form-row two-col">
              <div>
                <label>Category</label>
                <select name="category" id="txnCategory" required>
                  <optgroup label="Income">
                    <option value="Salary">Salary</option>
                    <option value="Business">Business</option>
                    <option value="Freelance">Freelance</option>
                    <option value="Investments">Investments</option>
                    <option value="Gifts">Gifts</option>
                    <option value="Other Income">Other Income</option>
                  </optgroup>
                  <optgroup label="Expense">
                    <option value="Food">Food</option>
                    <option value="Rent">Rent</option>
                    <option value="Bills">Bills</option>
                    <option value="Travel">Travel</option>
                    <option value="Shopping">Shopping</option>
                    <option value="Entertainment">Entertainment</option>
                    <option value="Health">Health</option>
                    <option value="Education">Education</option>
                    <option value="Other Expense">Other Expense</option>
                  </optgroup>
                </select>
              </div>
              <div>
                <label>Date</label>
                <input name="date" type="date" value="${BMUtils.todayISO()}" required />
              </div>
            </div>
            <div class="form-row">
              <label>Note</label>
              <input name="note" placeholder="Optional note" />
            </div>
            <button class="btn primary" type="submit">Add Transaction</button>
          </form>
        </div>
      </section>
      <section class="section">
        <div id="txnTableContainer">${renderTxnResponsive(txns)}</div>
      </section>
    `;

    // Wire handlers
    document.getElementById('txnForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const form = e.target;
      const fd = new FormData(form);
      const txn = {
        id: BMUtils.uid('txn'),
        type: fd.get('type'),
        amount: BMUtils.parseNumber(fd.get('amount')),
        category: String(fd.get('category')).trim(),
        date: fd.get('date'),
        note: String(fd.get('note') || '').trim(),
      };
      
      // Prevent expense exceeding available balance
      const d = readData();
      const income = BMUtils.sum(d.transactions.filter(t => t.type === 'income'), t => t.amount);
      const expenses = BMUtils.sum(d.transactions.filter(t => t.type === 'expense'), t => t.amount);
      const balance = income - expenses;
      
      if (txn.type === 'expense' && txn.amount > balance) {
        const n = document.getElementById('txnNotice');
        if (n) {
          n.textContent = 'Expense exceeds available balance. Please adjust the amount.';
          n.classList.add('is-visible');
          n.classList.remove('success');
          n.classList.add('error');
        }
        return;
      }
      
      // Enforce category budget (if present) for current period
      if (txn.type === 'expense') {
        const iso = txn.date || BMUtils.todayISO();
        const normalizedCategory = txn.category.trim().toLowerCase();
        // Helper to get window for the iso date
        const getWindow = (bdg) => computeBudgetWindow(bdg, iso);
        // Find any budgets for this category
        const candidateBudgets = d.budgets.filter(b => String(b.category || '').trim().toLowerCase() === normalizedCategory);
        
        // Only validate budget if there are budgets for this category
        if (candidateBudgets.length > 0) {
          for (const b of candidateBudgets) {
            const { fromISO, toISO } = getWindow(b);
            if (iso < fromISO || iso > toISO) continue; // not in this window
            
            const spent = BMUtils.sum(
              d.transactions.filter(t => t.type==='expense' && String(t.category || '').trim().toLowerCase()===normalizedCategory && t.date >= fromISO && t.date <= toISO),
              t=>t.amount
            );
            
            const remaining = Math.max(Number(b.limit) - spent, 0);
            if (txn.amount > remaining) {
              const n = document.getElementById('txnNotice');
              if (n) {
                n.textContent = `This expense exceeds your ${b.period} budget for ${b.category}. Remaining: ${BMUtils.formatCurrencyINR(remaining)}`;
                n.classList.add('is-visible');
                n.classList.remove('success');
                n.classList.add('error');
              }
              return;
            }
          }
        }
      }
      
      const n = document.getElementById('txnNotice');
      if (n) { n.textContent = ''; n.classList.remove('is-visible'); }
      d.transactions.push(txn);
      writeData(d);
      showToast(`${catIcon(txn.category)} ${txn.type === 'income' ? 'Income' : 'Expense'} added!`, 'success');

      // Budget alert: warn if now at ≥ 80% of any budget
      if (txn.type === 'expense') {
        const iso = txn.date || BMUtils.todayISO();
        const cat = txn.category.trim().toLowerCase();
        for (const b of d.budgets.filter(b => String(b.category||'').trim().toLowerCase() === cat)) {
          const { fromISO, toISO } = computeBudgetWindow(b, iso);
          if (iso < fromISO || iso > toISO) continue;
          const spent = BMUtils.sum(
            d.transactions.filter(t => t.type==='expense' && String(t.category||'').trim().toLowerCase()===cat && t.date>=fromISO && t.date<=toISO),
            t => t.amount
          );
          const pct = b.limit > 0 ? (spent / b.limit) * 100 : 0;
          if (pct >= 100) showToast(`⚠️ ${b.category} budget exceeded!`, 'error', 5000);
          else if (pct >= 80) showToast(`⚠️ ${Math.round(pct)}% of ${b.category} budget used`, 'warning', 5000);
        }
      }

      // If budgets view is currently mounted, refresh spent/remaining there too after adding
      refreshBudgetsIfActive();
      renderTransactions();
    });

    document.getElementById('applyFilters').addEventListener('click', () => applyTxnFilters());
    document.getElementById('clearFilters').addEventListener('click', () => {
      document.getElementById('filterType').value = 'all';
      document.getElementById('filterQuery').value = '';
      document.getElementById('dateFrom').value = BMUtils.startOfMonthISO();
      document.getElementById('dateTo').value = BMUtils.endOfMonthISO();
      applyTxnFilters();
    });

    document.getElementById('exportCSV').addEventListener('click', () => {
      const type = document.getElementById('filterType').value;
      const q    = document.getElementById('filterQuery').value.toLowerCase();
      const from = document.getElementById('dateFrom').value || '0000-01-01';
      const to   = document.getElementById('dateTo').value   || '9999-12-31';
      const d = readData();
      let rows = d.transactions.slice().sort((a,b) => a.date.localeCompare(b.date));
      if (type !== 'all') rows = rows.filter(t => t.type === type);
      rows = rows.filter(t => t.date >= from && t.date <= to);
      if (q) rows = rows.filter(t => `${t.category} ${t.note}`.toLowerCase().includes(q));
      const headers = ['Date','Type','Category','Note','Amount'];
      const csv = [headers, ...rows.map(t => [t.date,t.type,t.category,t.note||'',t.amount])]
        .map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
      const a = Object.assign(document.createElement('a'), {
        href: URL.createObjectURL(new Blob([csv], { type:'text/csv' })),
        download: `transactions_${from}_to_${to}.csv`,
      });
      a.click();
      showToast('CSV downloaded! ⬇️', 'success');
    });

    function applyTxnFilters() {
      const type = document.getElementById('filterType').value;
      const q = document.getElementById('filterQuery').value.toLowerCase();
      const from = document.getElementById('dateFrom').value || '0000-01-01';
      const to = document.getElementById('dateTo').value || '9999-12-31';
      const d = readData();
      let filtered = d.transactions.slice().reverse();
      if (type !== 'all') filtered = filtered.filter(t => t.type === type);
      filtered = filtered.filter(t => t.date >= from && t.date <= to);
      if (q) filtered = filtered.filter(t => `${t.category} ${t.note}`.toLowerCase().includes(q));
      document.getElementById('txnTableContainer').innerHTML = renderTxnResponsive(filtered);
      wireRowButtons();
    }

    function wireRowButtons() {
      // Reveal actions on row/card selection
      document.querySelectorAll('#txnTableContainer tr').forEach(row => {
        row.addEventListener('click', () => {
          document.querySelectorAll('#txnTableContainer tr.active').forEach(r => r.classList.remove('active'));
          row.classList.add('active');
        });
      });
      document.querySelectorAll('#txnTableContainer .list-card').forEach(card => {
        card.addEventListener('click', () => {
          document.querySelectorAll('#txnTableContainer .list-card.active').forEach(c => c.classList.remove('active'));
          card.classList.add('active');
        });
      });
      document.querySelectorAll('[data-action="delete-txn"]').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = btn.getAttribute('data-id');
          const d = readData();
          d.transactions = d.transactions.filter(t => t.id !== id);
          writeData(d);
          refreshBudgetsIfActive();
          applyTxnFilters();
        });
      });
      document.querySelectorAll('[data-action="edit-txn"]').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = btn.getAttribute('data-id');
          const d = readData();
          const tx = d.transactions.find(t => t.id === id);
          if (!tx) return;
          // If desktop table, turn row into editable inputs
          const row = btn.closest('tr');
          if (row) {
            row.innerHTML = `
              <td><input class="inline-input" type="date" value="${tx.date}" data-field="date" /></td>
              <td>
                <select class="inline-input" data-field="type">
                  <option value="income" ${tx.type==='income'?'selected':''}>income</option>
                  <option value="expense" ${tx.type==='expense'?'selected':''}>expense</option>
                </select>
              </td>
              <td><input class="inline-input" type="text" value="${tx.category}" data-field="category" /></td>
              <td><input class="inline-input" type="text" value="${tx.note || ''}" data-field="note" /></td>
              <td><input class="inline-input" type="number" step="0.01" value="${tx.amount}" data-field="amount" /></td>
              <td class="edit-actions">
                <button class="btn primary" data-action="save-txn" data-id="${tx.id}">Save</button>
                <button class="btn" data-action="cancel-txn" data-id="${tx.id}">Cancel</button>
              </td>`;

            row.querySelector('[data-action="save-txn"]').addEventListener('click', () => {
              const next = { ...tx };
              row.querySelectorAll('.inline-input').forEach(inp => {
                const field = inp.getAttribute('data-field');
                let val = inp.value;
                if (field === 'amount') val = BMUtils.parseNumber(val);
                next[field] = val;
              });
              Object.assign(tx, next);
              writeData(d);
              refreshBudgetsIfActive();
              applyTxnFilters();
            });
            row.querySelector('[data-action="cancel-txn"]').addEventListener('click', () => {
              applyTxnFilters();
            });
            return;
          }

          // Mobile card: swap card to small form
          const card = btn.closest('.list-card');
          if (card) {
            card.innerHTML = `
              <div class="form mini-form">
                <div class="form-row two-col">
                  <div>
                    <label>Date</label>
                    <input class="inline-input" type="date" value="${tx.date}" data-field="date" />
                  </div>
                  <div>
                    <label>Type</label>
                    <select class="inline-input" data-field="type">
                      <option value="income" ${tx.type==='income'?'selected':''}>income</option>
                      <option value="expense" ${tx.type==='expense'?'selected':''}>expense</option>
                    </select>
                  </div>
                </div>
                <div class="form-row two-col">
                  <div>
                    <label>Category</label>
                    <input class="inline-input" type="text" value="${tx.category}" data-field="category" />
                  </div>
                  <div>
                    <label>Amount (₹)</label>
                    <input class="inline-input" type="number" step="0.01" value="${tx.amount}" data-field="amount" />
                  </div>
                </div>
                <div class="form-row">
                  <label>Note</label>
                  <input class="inline-input" type="text" value="${tx.note || ''}" data-field="note" />
                </div>
                <div class="list-actions">
                  <button class="btn primary" data-action="save-txn" data-id="${tx.id}">Save</button>
                  <button class="btn" data-action="cancel-txn" data-id="${tx.id}">Cancel</button>
                </div>
              </div>`;
            card.querySelector('[data-action="save-txn"]').addEventListener('click', () => {
              const next = { ...tx };
              card.querySelectorAll('.inline-input').forEach(inp => {
                const field = inp.getAttribute('data-field');
                let val = inp.value;
                if (field === 'amount') val = BMUtils.parseNumber(val);
                next[field] = val;
              });
              Object.assign(tx, next);
              writeData(d);
              refreshBudgetsIfActive();
              applyTxnFilters();
            });
            card.querySelector('[data-action="cancel-txn"]').addEventListener('click', () => {
              applyTxnFilters();
            });
          }
        });
      });
    }

    wireRowButtons();
  }

  function renderBudgets() {
    const d = readData();
    const budgets = d.budgets;
    viewContainer.innerHTML = `
      <section class="section texture-sun">
        <div class="card">
          <form id="budgetForm" class="form">
            <div class="form-row two-col">
              <div>
                <label>Period</label>
                <select name="period">
                  <option value="monthly">Monthly</option>
                  <option value="weekly">Weekly</option>
                </select>
              </div>
              <div>
                <label>Category</label>
                <select name="category" required>
                  <option value="Food">Food</option>
                  <option value="Rent">Rent</option>
                  <option value="Bills">Bills</option>
                  <option value="Travel">Travel</option>
                  <option value="Shopping">Shopping</option>
                  <option value="Entertainment">Entertainment</option>
                  <option value="Health">Health</option>
                  <option value="Education">Education</option>
                  <option value="Other Expense">Other Expense</option>
                </select>
              </div>
            </div>
            <div class="form-row two-col">
              <div>
                <label>Limit (₹)</label>
                <input name="limit" type="number" min="0" step="0.01" required />
              </div>
              <div>
                <label>Start Date</label>
                <input name="startISO" type="date" value="${BMUtils.todayISO()}" />
              </div>
            </div>
            <button class="btn primary" type="submit">Add Budget</button>
          </form>
        </div>
      </section>
      <section class="section">
        <div id="budgetListContainer">${renderBudgetsResponsive(budgets, d.transactions)}</div>
      </section>
    `;

    document.getElementById('budgetForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const b = {
        id: BMUtils.uid('bdg'),
        period: fd.get('period'),
        category: String(fd.get('category')).trim(),
        limit: BMUtils.parseNumber(fd.get('limit')),
        startISO: fd.get('startISO'),
      };
      const d0 = readData();
      d0.budgets.push(b);
      writeData(d0);
      renderBudgets(); // ensure remaining/spent refresh immediately
    });

    document.querySelectorAll('[data-action="delete-budget"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        const d0 = readData();
        d0.budgets = d0.budgets.filter(b => b.id !== id);
        writeData(d0);
        renderBudgets();
      });
    });
  }

  function renderBudgetRow(b, txns) {
    const row = budgetComputed(b, txns);
    return `
      <tr>
        <td>${b.category}</td>
        <td>${b.period}</td>
        <td>${BMUtils.formatCurrencyINR(row.limit)}</td>
        <td>${BMUtils.formatCurrencyINR(row.spent)}</td>
        <td>${BMUtils.formatCurrencyINR(row.remaining)}</td>
        <td><button class="btn" data-action="delete-budget" data-id="${b.id}">Delete</button></td>
      </tr>
    `;
  }

  function renderGoals() {
    const d = readData();
    viewContainer.innerHTML = `
      <section class="section">
        <div class="card">
          <form id="goalForm" class="form">
            <div class="form-row two-col">
              <div>
                <label>Name</label>
                <input name="name" required placeholder="Emergency Fund" />
              </div>
              <div>
                <label>Target (₹)</label>
                <input name="target" type="number" min="0" step="0.01" required />
              </div>
            </div>
            <div class="form-row">
              <label>Saved so far (₹)</label>
              <input name="saved" type="number" min="0" step="0.01" value="0" />
            </div>
            <button class="btn primary" type="submit">Add Goal</button>
          </form>
        </div>
      </section>

      <section class="section">
        <div class="grid">
          ${d.goals.map(renderGoalCard).join('') || '<p class="muted">No goals yet</p>'}
        </div>
      </section>
    `;

    document.getElementById('goalForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const g = {
        id: BMUtils.uid('goal'),
        name: String(fd.get('name')).trim(),
        target: BMUtils.parseNumber(fd.get('target')),
        saved: BMUtils.parseNumber(fd.get('saved')),
      };
      const d0 = readData();
      d0.goals.push(g);
      writeData(d0);
      renderGoals();
    });

    document.querySelectorAll('[data-action="delete-goal"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        const d0 = readData();
        d0.goals = d0.goals.filter(g => g.id !== id);
        writeData(d0);
        renderGoals();
      });
    });

    document.querySelectorAll('[data-action="edit-goal"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        const d0 = readData();
        const g = d0.goals.find(x => x.id === id);
        if (!g) return;
        const card = btn.closest('.card');
        if (!card) return;
        card.innerHTML = `
          <h3 style="margin-top:0">Edit Goal</h3>
          <div class="form mini-form">
            <div class="form-row two-col">
              <div>
                <label>Name</label>
                <input class="inline-input" type="text" data-field="name" value="${g.name}" />
              </div>
              <div>
                <label>Target (₹)</label>
                <input class="inline-input" type="number" step="0.01" data-field="target" value="${g.target}" />
              </div>
            </div>
            <div class="form-row">
              <label>Saved (₹)</label>
              <input class="inline-input" type="number" step="0.01" data-field="saved" value="${g.saved}" />
            </div>
            <div class="toolbar">
              <button class="btn primary" data-action="save-goal" data-id="${g.id}">Save</button>
              <button class="btn" data-action="cancel-goal">Cancel</button>
            </div>
          </div>`;
        card.querySelector('[data-action="save-goal"]').addEventListener('click', () => {
          const next = { ...g };
          card.querySelectorAll('.inline-input').forEach(inp => {
            const field = inp.getAttribute('data-field');
            let val = inp.value;
            if (field === 'target' || field === 'saved') val = BMUtils.parseNumber(val);
            next[field] = val;
          });
          Object.assign(g, next);
          writeData(d0);
          renderGoals();
        });
        card.querySelector('[data-action="cancel-goal"]').addEventListener('click', () => {
          renderGoals();
        });
      });
    });
  }

  function renderGoalCard(g) {
    const pct = g.target > 0 ? Math.round(BMUtils.clamp((g.saved / g.target) * 100, 0, 100)) : 0;
    return `
      <div class="card">
        <h3 style="margin-top:0">${g.name}</h3>
        <p class="muted">Target: ${BMUtils.formatCurrencyINR(g.target)}</p>
        <div style="height:10px;background:#f1f5f9;border-radius:999px;overflow:hidden;margin:8px 0 6px 0;">
          <div style="width:${pct}%;height:100%;background:var(--primary);"></div>
        </div>
        <p><strong>${pct}%</strong> saved • ${BMUtils.formatCurrencyINR(g.saved)}</p>
        <div class="toolbar">
          <button class="btn" data-action="edit-goal" data-id="${g.id}">Edit</button>
          <button class="btn" data-action="delete-goal" data-id="${g.id}">Delete</button>
        </div>
      </div>
    `;
  }

  function renderRecurring() {
    const d = readData();
    viewContainer.innerHTML = `
      <section class="section texture-mint">
        <div class="card">
          <h2 style="margin-top:0">Add Recurring Transaction</h2>
          <form id="recurringForm" class="form">
            <div class="form-row two-col">
              <div>
                <label>Day of Month (1-31)</label>
                <input name="day" type="number" min="1" max="31" required placeholder="e.g. 1" />
              </div>
              <div>
                <label>Type</label>
                <select name="type" required>
                  <option value="income">Income</option>
                  <option value="expense">Expense</option>
                </select>
              </div>
            </div>
            <div class="form-row two-col">
              <div>
                <label>Category</label>
                <input name="category" type="text" required placeholder="e.g. Salary or Rent" />
              </div>
              <div>
                <label>Amount (₹)</label>
                <input name="amount" type="number" min="0" step="0.01" required />
              </div>
            </div>
            <div class="form-row">
              <label>Note (Optional)</label>
              <input name="note" type="text" placeholder="e.g. Monthly Rent" />
            </div>
            <button class="btn primary" type="submit">Save Recurring Rule</button>
          </form>
        </div>
      </section>

      <section class="section">
        <div class="grid">
          ${d.recurring.map(r => `
            <div class="card">
              <h3 style="margin-top:0">On Day ${r.day}: ${r.category}</h3>
              <p class="muted">${r.type.toUpperCase()} • ${BMUtils.formatCurrencyINR(r.amount)}</p>
              ${r.note ? `<p style="font-size:13px;">${r.note}</p>` : ''}
              <div class="toolbar" style="margin-top:12px;">
                <button class="btn danger" data-action="delete-recurring" data-id="${r.id}">Delete</button>
              </div>
            </div>
          `).join('') || '<p class="muted">No recurring transactions set up.</p>'}
        </div>
      </section>
    `;

    document.getElementById('recurringForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const r = {
        id: BMUtils.uid('rec'),
        day: parseInt(fd.get('day'), 10),
        type: fd.get('type'),
        category: String(fd.get('category')).trim(),
        amount: BMUtils.parseNumber(fd.get('amount')),
        note: String(fd.get('note')).trim()
      };
      const d0 = readData();
      d0.recurring.push(r);
      writeData(d0);
      renderRecurring();
      showToast('Recurring rule saved', 'success');
    });

    document.querySelectorAll('[data-action="delete-recurring"]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!confirm('Delete this recurring rule?')) return;
        const id = btn.getAttribute('data-id');
        const d0 = readData();
        d0.recurring = d0.recurring.filter(r => r.id !== id);
        writeData(d0);
        renderRecurring();
        showToast('Rule deleted', 'success');
      });
    });
  }

  function renderReports() {
    const d = readData();
    const txns = d.transactions.slice();
    viewContainer.innerHTML = `
      <section class="section">
        <div class="toolbar">
          <input id="rFrom" type="date" value="${BMUtils.startOfMonthISO()}" />
          <input id="rTo" type="date" value="${BMUtils.endOfMonthISO()}" />
          <button id="rApply" class="btn">Update</button>
          <button id="rExport" class="btn">Export PDF</button>
        </div>
      </section>
      <section class="section texture-soft">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
          <div class="card" style="min-width:0;">
            <h3 style="margin:0 0 12px">By Category</h3>
            <canvas id="catChart" style="width:100%;display:block;"></canvas>
          </div>
          <div class="card" style="min-width:0;">
            <h3 style="margin:0 0 12px">Income vs Expense</h3>
            <canvas id="pieChart" style="width:100%;display:block;"></canvas>
            <div id="pieLegend" style="margin-top:12px;"></div>
          </div>
        </div>
      </section>
      <section class="section">
        <div id="reportTable">${renderReportResponsive(txns.slice().reverse())}</div>
      </section>
    `;

    function updateCharts() {
      const from = document.getElementById('rFrom').value;
      const to = document.getElementById('rTo').value;
      const filtered = d.transactions.filter(t => t.date >= from && t.date <= to);
      const byCat = BMUtils.groupBy(filtered, t => `${t.type}:${t.category}`);
      const catCanvas = document.getElementById('catChart');
      const pieCanvas = document.getElementById('pieChart');
      drawBarChart(catCanvas, byCat);
      drawIncomeExpensePie(pieCanvas, filtered);
      document.getElementById('reportTable').innerHTML = renderReportResponsive(filtered.slice().reverse());
    }

    document.getElementById('rApply').addEventListener('click', updateCharts);
    updateCharts();
    // Redraw charts on resize to keep responsive sizing
    const onResize = () => updateCharts();
    window.addEventListener('resize', onResize);

    document.getElementById('rExport').addEventListener('click', () => {
      // Create printable view and trigger print dialog (user can save as PDF)
      const w = window.open('', '_blank');
      const from = document.getElementById('rFrom').value;
      const to = document.getElementById('rTo').value;
      const filtered = d.transactions.filter(t => t.date >= from && t.date <= to).sort((a,b)=>a.date.localeCompare(b.date));
      const totalIncome = BMUtils.sum(filtered.filter(t=>t.type==='income'), t=>t.amount);
      const totalExpense = BMUtils.sum(filtered.filter(t=>t.type==='expense'), t=>t.amount);
      const balance = totalIncome - totalExpense;
      // Prepare chart images to embed at end
      const byCat = BMUtils.groupBy(filtered, t => `${t.type}:${t.category}`);
      const tempCat = document.createElement('canvas'); tempCat.width = 800; tempCat.height = 300; drawBarChart(tempCat, byCat);
      const tempPie = document.createElement('canvas'); tempPie.width = 300; tempPie.height = 300; drawIncomeExpensePie(tempPie, filtered);
      const catImg = tempCat.toDataURL('image/png');
      const pieImg = tempPie.toDataURL('image/png');
      const html = `
        <html><head><title>Transactions Report</title>
        <style>
          :root{--text:#0f172a;--muted:#64748b;--border:#e2e8f0;--primary:#1d4ed8;}
          body{font-family:Segoe UI,Arial;padding:32px;color:var(--text)}
          header{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;border-bottom:2px solid var(--border);padding-bottom:12px}
          .brand{display:flex;align-items:center;gap:10px;font-weight:700}
          .brand .logo{background:#eef2ff;color:var(--primary);width:36px;height:36px;border-radius:10px;display:grid;place-items:center}
          .meta{color:var(--muted)}
          .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:16px 0}
          .card{border:1px solid var(--border);border-radius:10px;padding:12px}
          .label{color:var(--muted);font-size:12px}
          .value{font-weight:700}
          table{width:100%;border-collapse:collapse;margin-top:8px}
          th,td{border:1px solid var(--border);padding:8px;text-align:left;font-size:13px}
          th{background:#f8fafc}
          .charts{page-break-before:always; margin-top:16px}
          .charts h3{margin:8px 0}
          .charts img{max-width:100%; height:auto; border:1px solid var(--border); border-radius:8px}
        </style></head>
        <body>
          <header>
            <div class="brand"><div class="logo">₹</div> Budget Manager — Report</div>
            <div class="meta">Range: ${from} to ${to}</div>
          </header>
          <section class="grid">
            <div class="card"><div class="label">Total Income</div><div class="value">${BMUtils.formatCurrencyINR(totalIncome)}</div></div>
            <div class="card"><div class="label">Total Expense</div><div class="value">${BMUtils.formatCurrencyINR(totalExpense)}</div></div>
            <div class="card"><div class="label">Balance</div><div class="value">${BMUtils.formatCurrencyINR(balance)}</div></div>
          </section>
          ${renderTransactionsTable(filtered, { showActions: false })}
          <section class="charts">
            <h3>By Category</h3>
            <img id="imgCat" alt="By Category" />
            <h3>Income vs Expense</h3>
            <img id="imgPie" alt="Income vs Expense" />
          </section>
          <script>
            (function(){
              const imgCat = document.getElementById('imgCat');
              const imgPie = document.getElementById('imgPie');
              let loaded = 0;
              function done(){ loaded++; if(loaded === 2){ setTimeout(function(){ window.focus(); window.print(); }, 50); } }
              imgCat.addEventListener('load', done);
              imgPie.addEventListener('load', done);
              imgCat.src = '${catImg}';
              imgPie.src = '${pieImg}';
              window.onafterprint = function(){ window.close(); };
            })();
          </script>
        </body></html>`;
      w.document.write(html);
      w.document.close();
      // printing is triggered from inside the new window after images load
    });
  }

  function renderTransactionsTable(txns, opts = { showActions: true }) {
    if (!txns.length) {
      return '<p class="muted">No transactions found</p>';
    }
    const showActions = !!opts.showActions;
    return `
      <table class="table">
        <thead><tr><th>Date</th><th>Type</th><th>Category</th><th>Note</th><th>Amount</th>${showActions ? '<th style="width:1%"></th>' : ''}</tr></thead>
        <tbody>
          ${txns.map(t => `
            <tr>
              <td>${t.date}</td>
              <td><span class="chip ${t.type}">${t.type}</span></td>
              <td>${t.category}</td>
              <td>${t.note || ''}</td>
              <td>${BMUtils.formatCurrencyINR(t.amount)}</td>
              ${showActions ? `<td>
                <span class="row-actions">
                  <button class="btn" data-action="edit-txn" data-id="${t.id}">Edit</button>
                  <button class="btn" data-action="delete-txn" data-id="${t.id}">Delete</button>
                </span>
              </td>` : ''}
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  // ── By-Category: horizontal bar chart ──────────────────────────────────
  function drawBarChart(canvas, byCatMap) {
    // Aggregate by category name (merge income: and expense: prefixes)
    const totals = {};
    const types  = {};
    Object.entries(byCatMap).forEach(([key, arr]) => {
      const [type, cat] = key.split(':');
      const amount = BMUtils.sum(arr, t => t.amount);
      totals[cat] = (totals[cat] || 0) + amount;
      types[cat]  = type; // last wins; use for color
    });
    const cats = Object.keys(totals).sort((a, b) => totals[b] - totals[a]).slice(0, 10);
    if (!cats.length) { canvas.height = 60; const ctx = canvas.getContext('2d'); ctx.clearRect(0,0,canvas.width,canvas.height); ctx.fillStyle='#94a3b8'; ctx.font='13px Arial'; ctx.fillText('No data', 10, 30); return; }

    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const textColor = isDark ? '#e2e8f0' : '#1f2937';
    const mutedColor = isDark ? '#94a3b8' : '#64748b';

    const ROW_H = 36;
    const PAD_LEFT = 90;
    const PAD_RIGHT = 70;
    const PAD_TOP = 10;
    const PAD_BOT = 10;

    // Set canvas pixel size to match CSS width
    const cssW = canvas.getBoundingClientRect().width || 360;
    canvas.width  = cssW * window.devicePixelRatio;
    canvas.height = (PAD_TOP + cats.length * ROW_H + PAD_BOT) * window.devicePixelRatio;
    canvas.style.height = (PAD_TOP + cats.length * ROW_H + PAD_BOT) + 'px';

    const ctx = canvas.getContext('2d');
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    ctx.clearRect(0, 0, cssW, canvas.height);

    const W = cssW - PAD_LEFT - PAD_RIGHT;
    const maxVal = Math.max(...cats.map(c => totals[c]), 1);

    const INCOME_COLORS  = ['#059669','#0d9488','#0891b2','#0284c7','#2563eb'];
    const EXPENSE_COLORS = ['#ef4444','#f97316','#e11d48','#db2777','#c026d3'];

    cats.forEach((cat, i) => {
      const y      = PAD_TOP + i * ROW_H;
      const val    = totals[cat];
      const barW   = Math.max(4, (val / maxVal) * W);
      const isExp  = byCatMap[`expense:${cat}`] && !byCatMap[`income:${cat}`];
      const color  = isExp ? EXPENSE_COLORS[i % EXPENSE_COLORS.length] : INCOME_COLORS[i % INCOME_COLORS.length];

      // Label
      ctx.fillStyle = textColor;
      ctx.font = '12px -apple-system,Arial';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(cat.length > 12 ? cat.slice(0, 11) + '…' : cat, PAD_LEFT - 8, y + ROW_H / 2);

      // Background track
      ctx.fillStyle = isDark ? '#334155' : '#f1f5f9';
      const trackH = 14;
      const trackY = y + (ROW_H - trackH) / 2;
      ctx.beginPath();
      ctx.roundRect(PAD_LEFT, trackY, W, trackH, 7);
      ctx.fill();

      // Bar
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect(PAD_LEFT, trackY, barW, trackH, 7);
      ctx.fill();

      // Amount label
      ctx.fillStyle = mutedColor;
      ctx.textAlign = 'left';
      ctx.font = '11px -apple-system,Arial';
      ctx.fillText(new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(val), PAD_LEFT + W + 6, y + ROW_H / 2);
    });
    ctx.setTransform(1,0,0,1,0,0);
  }

  // ── Income vs Expense: donut chart with legend ───────────────────────────
  function drawIncomeExpensePie(canvas, txns) {
    const income  = BMUtils.sum(txns.filter(t => t.type === 'income'),  t => t.amount);
    const expense = BMUtils.sum(txns.filter(t => t.type === 'expense'), t => t.amount);
    const total   = income + expense;
    const fmt = v => new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(v);
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const textColor = isDark ? '#e2e8f0' : '#1f2937';

    const SIZE = 180;
    canvas.width  = SIZE * window.devicePixelRatio;
    canvas.height = SIZE * window.devicePixelRatio;
    canvas.style.width  = SIZE + 'px';
    canvas.style.height = SIZE + 'px';
    canvas.style.margin = '0 auto';
    canvas.style.display = 'block';

    const ctx = canvas.getContext('2d');
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    ctx.clearRect(0, 0, SIZE, SIZE);

    const cx = SIZE / 2, cy = SIZE / 2;
    const outerR = 76, innerR = 46;

    if (!total) {
      ctx.fillStyle = isDark ? '#334155' : '#e2e8f0';
      ctx.beginPath(); ctx.arc(cx, cy, outerR, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = isDark ? '#1e293b' : '#fff';
      ctx.beginPath(); ctx.arc(cx, cy, innerR, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = isDark ? '#64748b' : '#94a3b8';
      ctx.font = '12px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('No data', cx, cy);
    } else {
      const segments = [
        { val: income,  color: '#059669', label: 'Income'  },
        { val: expense, color: '#ef4444', label: 'Expense' },
      ];
      let start = -Math.PI / 2;
      segments.forEach(seg => {
        if (!seg.val) return;
        const sweep = (seg.val / total) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, outerR, start, start + sweep);
        ctx.fillStyle = seg.color;
        ctx.fill();
        start += sweep;
      });
      // Donut hole
      ctx.beginPath(); ctx.arc(cx, cy, innerR, 0, Math.PI * 2);
      ctx.fillStyle = isDark ? '#1e293b' : '#fff'; ctx.fill();
      // Center label
      ctx.fillStyle = textColor; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = 'bold 12px Arial'; ctx.fillText('Total', cx, cy - 9);
      ctx.font = '11px Arial'; ctx.fillText(fmt(total), cx, cy + 9);
    }
    ctx.setTransform(1,0,0,1,0,0);

    // Legend below canvas
    const legend = document.getElementById('pieLegend');
    if (legend) {
      const pct = v => total ? Math.round((v/total)*100) : 0;
      legend.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:8px;font-size:13px;">
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="width:12px;height:12px;border-radius:3px;background:#059669;flex-shrink:0;"></span>
            <span style="flex:1;color:${textColor}">Income</span>
            <span style="font-weight:700;color:#059669">${fmt(income)}</span>
            <span style="color:${isDark?'#94a3b8':'#64748b'}">${pct(income)}%</span>
          </div>
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="width:12px;height:12px;border-radius:3px;background:#ef4444;flex-shrink:0;"></span>
            <span style="flex:1;color:${textColor}">Expense</span>
            <span style="font-weight:700;color:#ef4444">${fmt(expense)}</span>
            <span style="color:${isDark?'#94a3b8':'#64748b'}">${pct(expense)}%</span>
          </div>
        </div>`;
    }
  }

  function drawMonthlySummary(canvas, txns) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!txns.length) return;
    // Group by year-month
    const byMonth = BMUtils.groupBy(txns.slice(), t => t.date.slice(0,7));
    const months = Object.keys(byMonth).sort();
    const incomeSeries = months.map(m => BMUtils.sum(byMonth[m].filter(t=>t.type==='income'), t=>t.amount));
    const expenseSeries = months.map(m => BMUtils.sum(byMonth[m].filter(t=>t.type==='expense'), t=>t.amount));
    const maxVal = Math.max(1, ...incomeSeries, ...expenseSeries);
    const padding = 30; const height = canvas.height - padding * 2; const width = canvas.width - padding * 2;
    const groupWidth = months.length ? width / months.length : width;
    const barWidth = Math.max(10, (groupWidth - 10) / 2);

    // Grid
    ctx.strokeStyle = '#e2e8f0';
    ctx.beginPath();
    for (let i = 0; i <= 4; i++) {
      const y = canvas.height - padding - (height / 4) * i;
      ctx.moveTo(padding, y);
      ctx.lineTo(padding + width, y);
    }
    ctx.stroke();

    // Bars per month: income (green), expense (red)
    months.forEach((m, i) => {
      const baseX = padding + i * groupWidth + 5;
      const incVal = incomeSeries[i];
      const expVal = expenseSeries[i];
      const incH = (incVal / maxVal) * height;
      const expH = (expVal / maxVal) * height;
      const x1 = baseX;
      const y1 = canvas.height - padding - incH;
      ctx.fillStyle = '#059669';
      ctx.fillRect(x1, y1, barWidth, incH);
      const x2 = baseX + barWidth + 6;
      const y2 = canvas.height - padding - expH;
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(x2, y2, barWidth, expH);
      // X labels
      ctx.fillStyle = '#111827';
      ctx.font = '12px Arial';
      ctx.fillText(m, baseX, canvas.height - padding + 14);
    });
  }

  // default view
  setActiveNav('navOverview');
  renderOverview();

  // ── Real-time sync ───────────────────────────────────────────────────────
  (function setupRealtime() {
    let _t = null;
    function scheduleRefresh() {
      clearTimeout(_t);
      _t = setTimeout(async () => {
        await BMStorage.initUserData(userId);
        const fn = navButtons.find(([id]) => id === currentNavId)?.[1];
        if (fn) fn();
        showToast('Data synced 🔄', 'info');
      }, 900);
    }
    ['transactions','budgets','goals','recurring'].forEach(table => {
      window._supabase.channel(`${table}-${userId}`)
        .on('postgres_changes', { event:'*', schema:'public', table, filter:`user_id=eq.${userId}` }, scheduleRefresh)
        .subscribe();
    });
  })();

  // ── Profile page ─────────────────────────────────────────────────────────
  function renderProfile() {
    const g = (id) => `${activeUser[id] || ''}`;
    viewContainer.innerHTML = `
      <section class="section">
        <div class="card" style="max-width:560px;margin:0 auto;">
          <h2 style="margin-top:0">👤 My Profile</h2>
          <p class="muted">Email: ${email}</p>
          <form id="profileForm" class="form">
            <div class="form-row two-col">
              <div><label>Full Name</label><input id="pName" type="text" value="${g('full_name')}" placeholder="Your name" /></div>
              <div><label>Phone</label><input id="pPhone" type="tel" value="${g('phone')}" placeholder="9876543210" /></div>
            </div>
            <div class="form-row two-col">
              <div><label>Date of Birth</label><input id="pDob" type="date" value="${g('dob')}" /></div>
              <div><label>Gender</label>
                <select id="pGender">
                  <option value="">Select</option>
                  ${['Female','Male','Non-binary','Prefer not to say'].map(v =>
                    `<option ${activeUser.gender===v?'selected':''}>${v}</option>`).join('')}
                </select>
              </div>
            </div>
            <div class="form-row">
              <label>Address</label>
              <input id="pAddress" type="text" value="${g('address')}" placeholder="Street, City, PIN" />
            </div>
            <div class="form-row two-col">
              <div><label>Job Type</label>
                <select id="pJobType">
                  ${['business','job','freelancer','student','unemployed','other'].map(v =>
                    `<option value="${v}" ${activeUser.job_type===v?'selected':''}>${v[0].toUpperCase()+v.slice(1)}</option>`).join('')}
                </select>
              </div>
              <div><label>Monthly Income (₹)</label>
                <input id="pIncome" type="number" min="0" step="0.01" value="${activeUser.monthly_income || 0}" />
              </div>
            </div>
            <button class="btn primary" type="submit">Save Changes</button>
          </form>
        </div>
      </section>

      <section class="section">
        <div class="card" style="max-width:560px;margin:0 auto;">
          <h2 style="margin-top:0">🔒 Change Password</h2>
          <form id="passwordForm" class="form">
            <div class="form-row">
              <label>New Password</label>
              <input id="newPassword" type="password" minlength="6" required placeholder="At least 6 characters" />
            </div>
            <button class="btn" type="submit">Update Password</button>
          </form>
        </div>
      </section>`;
    document.getElementById('profileForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button[type="submit"]');
      btn.disabled = true; btn.textContent = 'Saving…';
      const updates = {
        full_name: document.getElementById('pName').value.trim(),
        phone:     document.getElementById('pPhone').value.trim(),
        dob:       document.getElementById('pDob').value || null,
        gender:    document.getElementById('pGender').value,
        address:   document.getElementById('pAddress').value.trim(),
        job_type:  document.getElementById('pJobType').value,
        monthly_income: Number(document.getElementById('pIncome').value) || 0,
      };
      const { error } = await window._supabase.from('profiles').update(updates).eq('id', userId);
      if (error) { showToast('Failed to save profile.', 'error'); }
      else { Object.assign(activeUser, updates); showToast('Profile saved! ✅', 'success'); }
      btn.disabled = false; btn.textContent = 'Save Changes';
    });

    document.getElementById('passwordForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button[type="submit"]');
      btn.disabled = true; btn.textContent = 'Updating…';
      const newPassword = document.getElementById('newPassword').value;
      const { error } = await window._supabase.auth.updateUser({ password: newPassword });
      if (error) {
        showToast(error.message || 'Failed to update password', 'error');
      } else {
        showToast('Password updated successfully! 🔒', 'success');
        document.getElementById('newPassword').value = '';
      }
      btn.disabled = false; btn.textContent = 'Update Password';
    });
  }

  // Responsive render helpers
  function isMobile() { return window.matchMedia('(max-width: 600px)').matches; }

  function renderTxnResponsive(txns) {
    if (!isMobile()) {
      return `<div class="card table-wrap">${renderTransactionsTable(txns, { showActions: true })}</div>`;
    }
    return `
      <div class="list">
        ${txns.map(t => `
          <div class="list-card">
            <div class="list-row"><span class="list-label">Date</span><span class="list-value">${t.date}</span></div>
            <div class="list-row"><span class="list-label">Type</span><span class="list-value"><span class="chip ${t.type}">${t.type}</span></span></div>
            <div class="list-row"><span class="list-label">Category</span><span class="list-value">${t.category}</span></div>
            <div class="list-row"><span class="list-label">Note</span><span class="list-value">${t.note || ''}</span></div>
            <div class="list-row"><span class="list-label">Amount</span><span class="list-value">${BMUtils.formatCurrencyINR(t.amount)}</span></div>
            <div class="list-actions">
              <button class="btn" data-action="edit-txn" data-id="${t.id}">Edit</button>
              <button class="btn" data-action="delete-txn" data-id="${t.id}">Delete</button>
            </div>
          </div>
        `).join('')}
      </div>`;
  }

  function renderBudgetsResponsive(budgets, txns) {
    if (!isMobile()) {
      return `
        <div class="card table-wrap">
          <table class="table">
            <thead><tr><th>Category</th><th>Period</th><th>Limit</th><th>Spent</th><th>Remaining</th><th></th></tr></thead>
            <tbody>${budgets.map(b => renderBudgetRow(b, txns)).join('')}</tbody>
          </table>
        </div>`;
    }
    return `
      <div class="list">
        ${budgets.map(b => {
          const row = budgetComputed(b, txns);
    return `
            <div class="list-card">
              <div class="list-row"><span class="list-label">Category</span><span class="list-value">${b.category}</span></div>
              <div class="list-row"><span class="list-label">Period</span><span class="list-value">${b.period}</span></div>
              <div class="list-row"><span class="list-label">Limit</span><span class="list-value">${BMUtils.formatCurrencyINR(b.limit)}</span></div>
              <div class="list-row"><span class="list-label">Spent</span><span class="list-value">${BMUtils.formatCurrencyINR(row.spent)}</span></div>
              <div class="list-row"><span class="list-label">Remaining</span><span class="list-value">${BMUtils.formatCurrencyINR(row.remaining)}</span></div>
              <div class="list-actions"><button class="btn" data-action="delete-budget" data-id="${b.id}">Delete</button></div>
            </div>`;
        }).join('')}
      </div>`;
  }

  function renderReportResponsive(txns) {
    if (!isMobile()) {
      return `<div class="card table-wrap">${renderTransactionsTable(txns, { showActions: false })}</div>`;
    }
    return `
      <div class="list">
        ${txns.map(t => `
          <div class="list-card">
            <div class="list-row"><span class="list-label">Date</span><span class="list-value">${t.date}</span></div>
            <div class="list-row"><span class="list-label">Type</span><span class="list-value"><span class="chip ${t.type}">${t.type}</span></span></div>
            <div class="list-row"><span class="list-label">Category</span><span class="list-value">${t.category}</span></div>
            <div class="list-row"><span class="list-label">Note</span><span class="list-value">${t.note || ''}</span></div>
            <div class="list-row"><span class="list-label">Amount</span><span class="list-value">${BMUtils.formatCurrencyINR(t.amount)}</span></div>
          </div>
        `).join('')}
      </div>`;
  }

  function budgetComputed(b, txns) {
    const nowISO = BMUtils.todayISO();
    const { fromISO, toISO } = computeBudgetWindow(b, nowISO);
    const normalizedCategory = String(b.category || '').trim().toLowerCase();
    const limit = Number(b.limit) || 0;
    const spent = BMUtils.sum(
      txns.filter(t => {
        const cat = String(t.category || '').trim().toLowerCase();
        return t.type === 'expense' && cat === normalizedCategory && t.date >= fromISO && t.date <= toISO;
      }),
      t => t.amount
    );
    const remaining = Math.max(limit - spent, 0);
    return { limit, spent, remaining };
  }

  // New: Daily view to filter by a single date quickly
  function renderDaily() {
    applyRecurringIfNeeded();
    const d = readData();
    const defaultDate = BMUtils.todayISO();
    viewContainer.innerHTML = `
      <section class="section texture-soft">
        <div class="toolbar">
          <input id="dailyDate" type="date" value="${defaultDate}" />
          <button id="dailyApply" class="btn">Show</button>
          <button id="dailyToday" class="btn">Today</button>
        </div>
      </section>
      <section class="section">
        <div id="dailyContainer"></div>
      </section>
    `;

    function renderForDate(iso) {
      const filtered = d.transactions.filter(t => t.date === iso).sort((a,b)=>b.date.localeCompare(a.date));
      document.getElementById('dailyContainer').innerHTML = renderTxnResponsive(filtered);
      // Wire up inline edit/delete in the rendered list/table
      const tmpApplyButtons = () => {
        const container = document.getElementById('dailyContainer');
        container.querySelectorAll('[data-action="delete-txn"]').forEach(btn => {
          btn.addEventListener('click', () => {
            const id = btn.getAttribute('data-id');
            const d0 = readData();
            d0.transactions = d0.transactions.filter(t => t.id !== id);
            writeData(d0);
            renderForDate(iso);
          });
        });
        container.querySelectorAll('[data-action="edit-txn"]').forEach(btn => {
          // Reuse transactions inline editing by simulating in-place editing
          btn.addEventListener('click', () => {
            // delegate to transactions page behavior by crafting handlers
            // Minimal duplication: re-render via transactions renderer helpers
            const applyTxnFilters = () => renderForDate(iso);
            // Temporarily use the same inline edit logic by invoking a fake wire
            // We duplicate minimal logic here for simplicity
            const id = btn.getAttribute('data-id');
            const d1 = readData();
            const tx = d1.transactions.find(t => t.id === id);
            if (!tx) return;
            const row = btn.closest('tr');
            if (row) {
              row.innerHTML = `
                <td><input class="inline-input" type="date" value="${tx.date}" data-field="date" /></td>
                <td><select class="inline-input" data-field="type"><option value="income" ${tx.type==='income'?'selected':''}>income</option><option value="expense" ${tx.type==='expense'?'selected':''}>expense</option></select></td>
                <td><input class="inline-input" type="text" value="${tx.category}" data-field="category" /></td>
                <td><input class="inline-input" type="text" value="${tx.note || ''}" data-field="note" /></td>
                <td><input class="inline-input" type="number" step="0.01" value="${tx.amount}" data-field="amount" /></td>
                <td class="edit-actions"><button class="btn primary" data-action="save-txn" data-id="${tx.id}">Save</button><button class="btn" data-action="cancel-txn" data-id="${tx.id}">Cancel</button></td>`;
              row.querySelector('[data-action="save-txn"]').addEventListener('click', () => {
                const next = { ...tx };
                row.querySelectorAll('.inline-input').forEach(inp => {
                  const field = inp.getAttribute('data-field');
                  let val = inp.value;
                  if (field === 'amount') val = BMUtils.parseNumber(val);
                  next[field] = val;
                });
                Object.assign(tx, next);
                writeData(d1);
                renderForDate(iso);
              });
              row.querySelector('[data-action="cancel-txn"]').addEventListener('click', () => renderForDate(iso));
              return;
            }
            const card = btn.closest('.list-card');
            if (card) {
              card.innerHTML = `
                <div class="form mini-form">
                  <div class="form-row two-col"><div><label>Date</label><input class="inline-input" type="date" value="${tx.date}" data-field="date" /></div><div><label>Type</label><select class="inline-input" data-field="type"><option value="income" ${tx.type==='income'?'selected':''}>income</option><option value="expense" ${tx.type==='expense'?'selected':''}>expense</option></select></div></div>
                  <div class="form-row two-col"><div><label>Category</label><input class="inline-input" type="text" value="${tx.category}" data-field="category" /></div><div><label>Amount (₹)</label><input class="inline-input" type="number" step="0.01" value="${tx.amount}" data-field="amount" /></div></div>
                  <div class="form-row"><label>Note</label><input class="inline-input" type="text" value="${tx.note || ''}" data-field="note" /></div>
                  <div class="list-actions"><button class="btn primary" data-action="save-txn">Save</button><button class="btn" data-action="cancel-txn">Cancel</button></div>
                </div>`;
              card.querySelector('[data-action="save-txn"]').addEventListener('click', () => {
                const next = { ...tx };
                card.querySelectorAll('.inline-input').forEach(inp => {
                  const field = inp.getAttribute('data-field');
                  let val = inp.value;
                  if (field === 'amount') val = BMUtils.parseNumber(val);
                  next[field] = val;
                });
                Object.assign(tx, next);
                writeData(d1);
                renderForDate(iso);
              });
              card.querySelector('[data-action="cancel-txn"]').addEventListener('click', () => renderForDate(iso));
            }
          });
        });
      };
      tmpApplyButtons();
    }

    document.getElementById('dailyApply').addEventListener('click', () => {
      const iso = document.getElementById('dailyDate').value;
      renderForDate(iso);
    });
    document.getElementById('dailyToday').addEventListener('click', () => {
      const iso = BMUtils.todayISO();
      document.getElementById('dailyDate').value = iso;
      renderForDate(iso);
    });
    renderForDate(defaultDate);
  }
})();

