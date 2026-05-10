window.BMUtils = (function () {
  function formatCurrencyINR(amount) {
    const value = Number(amount || 0);
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(value);
  }

  function uid(prefix = 'id') {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function toLocalISOString(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function todayISO() {
    return toLocalISOString(new Date());
  }

  function startOfMonthISO(date = new Date()) {
    const d = new Date(date.getFullYear(), date.getMonth(), 1);
    return toLocalISOString(d);
  }

  function endOfMonthISO(date = new Date()) {
    const d = new Date(date.getFullYear(), date.getMonth() + 1, 0);
    return toLocalISOString(d);
  }

  function parseNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  function groupBy(array, keyFn) {
    const map = {};
    for (const item of array) {
      const key = keyFn(item);
      map[key] = map[key] || [];
      map[key].push(item);
    }
    return map;
  }

  function sum(array, selector = (x) => x) {
    return array.reduce((acc, item) => acc + Number(selector(item) || 0), 0);
  }

  function clamp(value, min, max) { return Math.min(Math.max(value, min), max); }

  return {
    formatCurrencyINR,
    uid,
    todayISO,
    startOfMonthISO,
    endOfMonthISO,
    parseNumber,
    groupBy,
    sum,
    clamp,
  };
})();


