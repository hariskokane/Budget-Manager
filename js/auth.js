(function () {
  const sb = window._supabase;
  const isLogin  = document.getElementById('loginForm')  != null;
  const isSignup = document.getElementById('signupForm') != null;

  // ── Forgot password ──────────────────────────────────────────────────────
  const showForgotBtn = document.getElementById('showForgot');
  if (showForgotBtn) {
    showForgotBtn.addEventListener('click', () => {
      const sec = document.getElementById('forgotSection');
      sec.style.display = sec.style.display === 'none' ? 'block' : 'none';
    });
    document.getElementById('sendReset').addEventListener('click', async () => {
      const email = document.getElementById('forgotEmail').value.trim();
      const msg   = document.getElementById('forgotMsg');
      if (!email) { msg.style.color = 'var(--danger)'; msg.textContent = 'Enter your email first.'; return; }
      const btn = document.getElementById('sendReset');
      btn.disabled = true; btn.textContent = 'Sending…';
      const { error } = await sb.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + '/dashboard.html',
      });
      if (error) {
        msg.style.color = 'var(--danger)';
        msg.textContent = 'Error sending reset email. Try again.';
      } else {
        msg.style.color = 'var(--success)';
        msg.textContent = '✅ Reset link sent! Check your inbox.';
      }
      btn.disabled = false; btn.textContent = 'Send Reset Link';
    });
  }
  // ── Login ───────────────────────────────────────────────────────────────────
  if (isLogin) {
    const form    = document.getElementById('loginForm');
    const errorEl = document.getElementById('loginError');
    const btn     = form.querySelector('button[type="submit"]');

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      errorEl.textContent = '';
      btn.disabled    = true;
      btn.textContent = 'Logging in…';

      const email    = String(form.email.value).trim().toLowerCase();
      const password = String(form.password.value);

      // Clear any existing session first
      await sb.auth.signOut();

      const { error } = await sb.auth.signInWithPassword({ email, password });

      if (error) {
        errorEl.textContent = 'Invalid email or password.';
        btn.disabled    = false;
        btn.textContent = 'Login';
        return;
      }

      window.location.href = 'dashboard.html';
    });
  }

  // ── Signup ──────────────────────────────────────────────────────────────────
  if (isSignup) {
    const form    = document.getElementById('signupForm');
    const errorEl = document.getElementById('signupError');
    const btn     = form.querySelector('button[type="submit"]');

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      errorEl.textContent = '';

      const data     = Object.fromEntries(new FormData(form).entries());
      const email    = String(data.email || '').trim().toLowerCase();
      const password = String(data.password || '');
      const confirm  = String(data.confirmPassword || '');

      if (password.length < 6) { errorEl.textContent = 'Password must be at least 6 characters.'; return; }
      if (password !== confirm) { errorEl.textContent = 'Passwords do not match.'; return; }

      btn.disabled    = true;
      btn.textContent = 'Creating account…';

      // 1. Clear any existing session (fixes issue where previous user stays logged in)
      await sb.auth.signOut();

      // 2. Create auth user
      const { data: authData, error: authError } = await sb.auth.signUp({ email, password });
      if (authError) {
        errorEl.textContent = authError.message || 'Sign-up failed. Try again.';
        btn.disabled    = false;
        btn.textContent = 'Create Account';
        return;
      }

      // 2. Insert profile row
      try {
        await BMStorage.addUser({
          authId:        authData.user.id,
          email,
          fullName:      data.fullName,
          phone:         data.phone,
          dob:           data.dob,
          gender:        data.gender,
          address:       data.address,
          jobType:       data.jobType,
          monthlyIncome: BMUtils.parseNumber(data.monthlyIncome),
        });
      } catch (profileErr) {
        console.warn('[auth.js] profile insert error (non-fatal):', profileErr);
      }

      window.location.href = 'dashboard.html';
    });
  }
})();
