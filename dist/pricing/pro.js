'use strict';
(() => {
  const tier = document.getElementById('pro');
  const signup = tier.querySelector('[data-pro-signup]');
  const manage = tier.querySelector('[data-pro-manage]');
  const signin = tier.querySelector('[data-pro-signin]');
  const status = tier.querySelector('[role=status]');
  let generation = 0;
  let redirected = false;
  const returned = new URLSearchParams(location.search).get('pro') === 'returned';

  async function refresh() {
    const current = ++generation;
    signup.hidden = manage.hidden = signin.hidden = true;
    status.textContent = 'Checking subscription status…';
    for (let attempt = 0; attempt < (returned ? 8 : 1); attempt++) {
      try {
        const response = await fetch('/api/pro', {signal: AbortSignal.timeout(15000)});
        if (current !== generation) return;
        if (response.status === 401) {
          signin.hidden = false;
          status.textContent = 'Sign in or create an account to subscribe.';
          return;
        }
        if (!response.ok) throw Error('Pro subscription status is unavailable right now.');
        const subscription = await response.json();
        if (current !== generation) return;
        if (returned && !subscription.active && attempt < 7) {
          status.textContent = 'Waiting for Stripe to confirm your subscription…';
          await new Promise(resolve => setTimeout(resolve, 1500));
          if (current !== generation) return;
          continue;
        }
        signup.hidden = !subscription.canSubscribe || (returned && !subscription.active);
        manage.hidden = !subscription.canManage;
        signup.textContent = subscription.mode === 'test' ? 'Open Pro test checkout' : 'Subscribe to Pro';
        status.textContent = subscription.active ? (subscription.complimentaryUntil ?
          'Complimentary Pro is active through ' + new Date(subscription.complimentaryUntil).toLocaleString() + '.' :
          'Pro is active on your account.') :
          returned ? 'Stripe confirmation is still pending. Refresh this page in a moment.' :
          subscription.canManage ? 'Manage your subscription or update your payment method in Stripe.' :
          subscription.canSubscribe ? (subscription.mode === 'test' ? 'Sandbox checkout. No real money is charged.' : '') : 'Subscriptions are currently unavailable.';
        return;
      } catch (error) {
        if (current === generation) status.textContent = error.message;
        return;
      }
    }
  }

  for (const [button, endpoint] of [[signup, 'checkout'], [manage, 'portal']]) {
    button.onclick = async () => {
      button.disabled = true;
      status.textContent = 'Opening Stripe…';
      try {
        const response = await fetch('/api/pro/' + endpoint, {method: 'POST', signal: AbortSignal.timeout(20000)});
        const data = await response.json();
        if (!response.ok) throw Error(data.error || 'Could not open Stripe.');
        redirected = true;
        location.assign(data.url);
      } catch (error) {status.textContent = error.message;}
      finally {if (!redirected) button.disabled = false;}
    };
  }
  window.addEventListener('coasterprint-account', refresh);
  window.addEventListener('pageshow', event => {
    if (!event.persisted) return;
    redirected = signup.disabled = manage.disabled = false;
    void refresh();
  });
  void refresh();
})();
