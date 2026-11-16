'use strict';
const byId = id => document.getElementById(id);
const dialog = byId('credit-preview');
let balance = 0;
function quantity() {
  const input = byId('quantity');
  return input.validity.valid && input.value !== '' ? Number(input.value) : null;
}
function update() {
  byId('balance').textContent = balance;
  const count = quantity();
  byId('cost').textContent = count === null ? 'Choose a whole number from 1 to 10.' : `Cost: ${count} demo credit${count === 1 ? '' : 's'}`;
}
byId('open-preview').addEventListener('click', () => dialog.showModal());
byId('quantity').addEventListener('input', update);
byId('add-credits').addEventListener('click', () => {
  balance += 10;
  update();
  byId('credit-status').textContent = '10 demo credits added. No purchase was made.';
});
byId('export-preview').addEventListener('click', () => {
  const count = quantity();
  if (count === null) {
    byId('credit-status').textContent = 'Enter a whole number of coasters from 1 to 10.';
    byId('quantity').focus();
    return;
  }
  if (count > balance) {
    byId('credit-status').textContent = `Not enough demo credits. This export needs ${count}; your balance is ${balance}. Add a demo pack to continue.`;
    return;
  }
  balance -= count;
  update();
  byId('credit-status').textContent = `Export simulation complete. ${count} demo credit${count === 1 ? '' : 's'} used. No file was generated.`;
});
byId('reset-preview').addEventListener('click', () => {
  balance = 0;
  byId('quantity').value = '1';
  update();
  byId('credit-status').textContent = 'Demo reset. Add a demo pack to try the flow.';
});
