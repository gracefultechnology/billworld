const form = document.querySelector('#password-fixture');
const submit = form.querySelector('button');
const result = document.querySelector('#sign-in-result');
const api = '/api/' + form.dataset.family;

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  submit.disabled = true;
  result.textContent = '';
  try {
    const signedIn = await fetch(api + '/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.fromEntries(new FormData(form))),
    });
    if (!signedIn.ok) {
      result.textContent = 'Check the synthetic username and password and try again.';
      return;
    }
    form.reset();
    const account = await fetch(api + '/account');
    if (!account.ok) {
      result.textContent = 'We couldn’t open the synthetic account. Try again.';
      return;
    }
    form.hidden = true;
    document.querySelector('#account').hidden = false;
    document.querySelector('#account-heading').focus();
  } catch {
    result.textContent = 'We couldn’t reach this simulation. Try again.';
  } finally {
    submit.disabled = false;
  }
});
submit.disabled = false;
