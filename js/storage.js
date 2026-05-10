window.BMStorage = (function () {
  function sb() { return window._supabase; }

  var _cache  = null; // { transactions, budgets, goals, recurring, lastRecurringAppliedISO }
  var _userId = null;

  // ── Auth ────────────────────────────────────────────────────────────────────

  async function getActiveSession() {
    const { data } = await sb().auth.getSession();
    return data.session;
  }

  async function clearActiveSession() {
    await sb().auth.signOut();
  }

  // ── Profile helpers ─────────────────────────────────────────────────────────

  async function findUserByEmail(email) {
    const { data } = await sb()
      .from('profiles')
      .select('*')
      .eq('email', String(email).toLowerCase())
      .maybeSingle();
    return data;
  }

  async function addUser(user) {
    const { error } = await sb().from('profiles').insert({
      id:             user.authId,
      email:          user.email,
      full_name:      user.fullName,
      phone:          user.phone || '',
      dob:            user.dob || null,
      gender:         user.gender || '',
      address:        user.address || '',
      job_type:       user.jobType || '',
      monthly_income: Number(user.monthlyIncome) || 0,
    });
    if (error) throw error;
  }

  // ── Data initialisation ─────────────────────────────────────────────────────

  async function initUserData(userId) {
    _userId = userId;
    const [txR, buR, goR, reR, meR] = await Promise.all([
      sb().from('transactions').select('*').eq('user_id', userId).order('date', { ascending: true }),
      sb().from('budgets').select('*').eq('user_id', userId),
      sb().from('goals').select('*').eq('user_id', userId),
      sb().from('recurring').select('*').eq('user_id', userId),
      sb().from('user_meta').select('*').eq('user_id', userId).maybeSingle(),
    ]);
    _cache = {
      transactions:             (txR.data  || []).map(_mapTxn),
      budgets:                  (buR.data  || []).map(_mapBudget),
      goals:                    (goR.data  || []).map(_mapGoal),
      recurring:                (reR.data  || []).map(_mapRecurring),
      lastRecurringAppliedISO:  meR.data?.last_recurring_applied_iso || null,
    };
    return _cache;
  }

  // Returns cached data synchronously – call initUserData first
  function getUserData() {
    return _cache ? JSON.parse(JSON.stringify(_cache)) : null;
  }

  // Updates cache immediately; syncs to Supabase in background
  function setUserData(_email, next) {
    const old = _cache || { transactions: [], budgets: [], goals: [], recurring: [], lastRecurringAppliedISO: null };
    _cache = next;
    _syncToSupabase(old, next).catch(err => console.error('[BMStorage] sync error:', err));
  }

  // ── Supabase sync ───────────────────────────────────────────────────────────

  async function _syncToSupabase(old, next) {
    await Promise.all([
      _syncArray(old.transactions, next.transactions, 'transactions', _mapTxnToRow),
      _syncArray(old.budgets,      next.budgets,      'budgets',      _mapBudgetToRow),
      _syncArray(old.goals,        next.goals,        'goals',        _mapGoalToRow),
      _syncArray(old.recurring,    next.recurring,    'recurring',    _mapRecurringToRow),
    ]);
    if (old.lastRecurringAppliedISO !== next.lastRecurringAppliedISO) {
      await sb().from('user_meta').upsert(
        { user_id: _userId, last_recurring_applied_iso: next.lastRecurringAppliedISO },
        { onConflict: 'user_id' }
      );
    }
  }

  async function _syncArray(oldArr, newArr, table, mapFn) {
    const oldMap = new Map((oldArr || []).map(x => [x.id, x]));
    const newMap = new Map((newArr || []).map(x => [x.id, x]));

    const toInsert = [];
    const toUpdate = [];
    const toDelete = [];

    for (const [id, item] of newMap) {
      if (!oldMap.has(id)) {
        toInsert.push(mapFn(item, _userId));
      } else if (JSON.stringify(oldMap.get(id)) !== JSON.stringify(item)) {
        toUpdate.push({ id, row: mapFn(item, _userId) });
      }
    }
    for (const [id] of oldMap) {
      if (!newMap.has(id)) toDelete.push(id);
    }

    const ops = [];
    if (toInsert.length) ops.push(sb().from(table).insert(toInsert));
    for (const { id, row } of toUpdate) ops.push(sb().from(table).update(row).eq('id', id));
    if (toDelete.length) ops.push(sb().from(table).delete().in('id', toDelete));
    await Promise.all(ops);
  }

  // ── DB → App mappers ────────────────────────────────────────────────────────

  function _mapTxn(r)  { return { id: r.id, type: r.type, amount: Number(r.amount), category: r.category, date: String(r.date), note: r.note || '' }; }
  function _mapBudget(r) { return { id: r.id, period: r.period, category: r.category, limit: Number(r.budget_limit), startISO: r.start_iso ? String(r.start_iso) : null }; }
  function _mapGoal(r)  { return { id: r.id, name: r.name, target: Number(r.target), saved: Number(r.saved) }; }
  function _mapRecurring(r) { return { id: r.id, type: r.type, amount: Number(r.amount), category: r.category, note: r.note || '', day: r.day }; }

  // ── App → DB mappers ────────────────────────────────────────────────────────

  function _mapTxnToRow(item, uid)  { return { id: item.id, user_id: uid, type: item.type, amount: item.amount, category: item.category, date: item.date, note: item.note || '' }; }
  function _mapBudgetToRow(item, uid) { return { id: item.id, user_id: uid, period: item.period, category: item.category, budget_limit: item.limit, start_iso: item.startISO }; }
  function _mapGoalToRow(item, uid)  { return { id: item.id, user_id: uid, name: item.name, target: item.target, saved: item.saved }; }
  function _mapRecurringToRow(item, uid) { return { id: item.id, user_id: uid, type: item.type, amount: item.amount, category: item.category, note: item.note || '', day: item.day }; }

  return {
    getActiveSession,
    clearActiveSession,
    findUserByEmail,
    addUser,
    initUserData,
    getUserData,
    setUserData,
  };
})();
