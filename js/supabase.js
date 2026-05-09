// ── Supabase Client ──────────────────────────────────────────────────────────
// Replace these two values with your own from:
// Supabase Dashboard → Settings → API
// ─────────────────────────────────────────────────────────────────────────────
(function () {
  var SUPABASE_URL  = 'https://alzcjhmdcwucszdwlyox.supabase.co';
  var SUPABASE_ANON = 'sb_publishable_sB0kDIY7x0r2o-uZZVN3ww_Yob7zX9_';

  if (!window.supabase) {
    console.error('[supabase.js] Supabase SDK not loaded. Check the CDN script tag.');
    return;
  }
  window._supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
})();
