window.BMUtils = (function () {
  function formatCurrencyINR(amount) {
    const value = Number(amount || 0);
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(value);
  }

  function uid(prefix = 'id') {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function todayISO() {
    return new Date().toISOString().slice(0, 10);
  }

  function startOfMonthISO(date = new Date()) {
    const d = new Date(date.getFullYear(), date.getMonth(), 1);
    return d.toISOString().slice(0, 10);
  }

  function endOfMonthISO(date = new Date()) {
    const d = new Date(date.getFullYear(), date.getMonth() + 1, 0);
    return d.toISOString().slice(0, 10);
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


