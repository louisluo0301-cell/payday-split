export function wireWalkthrough() {
  const dialog = document.querySelector('#walkthrough-dialog');
  if (typeof dialog?.showModal !== 'function') return;

  const demo = new URLSearchParams(location.search).has('demo');
  const panels = [...dialog.querySelectorAll('[data-walkthrough-panel]')];
  const title = dialog.querySelector('#walkthrough-title');
  const workspaceAction = document.querySelector('#workspace-next-action');
  const workspaceTitle = document.querySelector('#workspace-next-title');
  let opener;

  dialog.querySelectorAll('[data-walkthrough-demo]').forEach(button => { button.hidden = !demo; });
  dialog.querySelector('[data-walkthrough-external]').hidden = demo;
  dialog.querySelector('[data-walkthrough-testnet]').hidden = demo;

  function show(view) {
    const active = panels.find(panel => panel.dataset.walkthroughPanel === view);
    if (!active) return;
    panels.forEach(panel => { panel.hidden = panel !== active; });
    if (!dialog.open) dialog.showModal();
    dialog.scrollTop = 0;
    (active.querySelector('h3') || title).focus({ preventScroll: true });
  }

  function handoff(target, activate = false) {
    opener = null;
    dialog.close();
    if (!target) return;
    target.focus({ preventScroll: true });
    if (activate) target.click();
    else target.scrollIntoView({ block: 'start' });
  }

  function availableWorkspaceAction() {
    return !workspaceAction.hidden && !workspaceAction.disabled ? workspaceAction : workspaceTitle;
  }

  dialog.addEventListener('close', () => {
    if (dialog.open) return;
    opener?.focus({ preventScroll: true });
    opener = null;
  });

  dialog.addEventListener('click', event => {
    const view = event.target.closest('[data-walkthrough-view]')?.dataset.walkthroughView;
    if (view) show(view);
    switch (event.target.closest('[data-walkthrough-action]')?.dataset.walkthroughAction) {
      case 'destinations':
        handoff(document.querySelector('#buckets-list [data-destination]') || document.querySelector('#add-bucket'));
        break;
      case 'preview':
        handoff(document.querySelector('#sample-input'));
        break;
      case 'sample': {
        const target = availableWorkspaceAction();
        const canSample = demo && target.dataset.action === 'sample';
        handoff(target, canSample);
        break;
      }
      case 'deployment':
        handoff(document.querySelector('#open-deployment'), true);
        break;
      case 'next':
        handoff(availableWorkspaceAction());
        break;
    }
  });

  document.querySelectorAll('[data-open-walkthrough]').forEach(trigger => {
    trigger.hidden = false;
    trigger.setAttribute('aria-haspopup', 'dialog');
    trigger.setAttribute('aria-controls', dialog.id);
    trigger.addEventListener('click', event => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      event.preventDefault();
      if (dialog.open) return;
      opener = trigger;
      show('start');
    });
  });
}
