/**
 * Theme-native styles, injected as a plugin-owned <style> tag (the web boot
 * loader claims and removes tags carrying data-plugin on unload).
 *
 * Every color comes from the harness's REAL design-token alias layer
 * (`--dsw-alias-*`), which the ui-theme plugin flips between light and dark —
 * so this dialog follows the active theme automatically. Token names mirror
 * those the shipped packages use (session-log-export, settings-general, …);
 * no invented names, no hardcoded light-theme fallbacks.
 */

export const STYLES = `
.dshshare-btn {
  border: 1px solid var(--dsw-alias-border-l2);
  min-width: 0;
  height: 32px;
  color: var(--dsw-alias-label-primary);
  font-family: var(--dsw-font-family, inherit);
  cursor: pointer;
  background: transparent;
  border-radius: 18px;
  justify-content: center;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  font-size: 13px;
  font-weight: 400;
  line-height: 20px;
  display: inline-flex;
  white-space: nowrap;
}
.dshshare-btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.dshshare-btn:disabled { color: var(--dsw-alias-label-dimmed); cursor: wait; }

.dshshare-overlay {
  position: fixed; inset: 0; z-index: 1000;
  display: flex; align-items: center; justify-content: center;
  padding: 20px;
}
.dshshare-mask {
  position: absolute; inset: 0;
  background: var(--dsw-alias-bg-mask-1);
  backdrop-filter: var(--dsw-mask-blur);
}
.dshshare-card {
  position: relative; z-index: 1;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 16px;
  width: 100%; max-width: 460px;
  max-height: 80vh; overflow: auto;
  box-shadow: var(--dsw-shadow-lv3);
  padding: 20px;
  font-family: var(--dsw-font-family, inherit);
  font-size: 14px;
}
.dshshare-card h3 { margin: 0 0 12px; font-size: 16px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.dshshare-card h4 { margin: 18px 0 8px; font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-secondary); }

.dshshare-row { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.dshshare-redact { align-items: flex-start; }
.dshshare-redact input { margin-top: 3px; }
.dshshare-redact label { font-size: 12px; color: var(--dsw-alias-label-secondary); line-height: 1.4; cursor: pointer; }
.dshshare-redact-note { font-size: 12px; color: var(--dsw-alias-state-warning-primary, #d97706); margin-bottom: 8px; }
.dshshare-expiry { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 4px; }
.dshshare-seg {
  border: 1px solid var(--dsw-alias-border-l2);
  background: transparent; color: var(--dsw-alias-label-primary);
  border-radius: 999px; padding: 4px 10px; font-size: 12px; cursor: pointer;
}
.dshshare-seg:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dshshare-seg-on {
  background: var(--dsw-alias-interactive-bg-hover);
  border-color: var(--dsw-alias-label-secondary);
}

.dshshare-primary {
  border: none;
  background: var(--dsw-alias-button-primary-fill);
  color: var(--dsw-alias-label-primary-foreground);
  border-radius: 8px; padding: 7px 14px; font-size: 13px; font-weight: 500; cursor: pointer;
}
.dshshare-primary:disabled { opacity: .6; cursor: wait; }
.dshshare-ghost {
  border: 1px solid var(--dsw-alias-border-l2); background: transparent;
  color: var(--dsw-alias-label-primary); border-radius: 8px;
  padding: 6px 12px; font-size: 12px; cursor: pointer;
}
.dshshare-ghost:hover { background: var(--dsw-alias-interactive-bg-hover); }

.dshshare-url { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.dshshare-url input {
  flex: 1; min-width: 0;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 6px; padding: 6px 8px; font-size: 12px;
  font-family: ui-monospace, "Cascadia Code", Consolas, monospace;
}
.dshshare-url .tag { font-size: 11px; color: var(--dsw-alias-label-dimmed); min-width: 40px; }

.dshshare-item {
  display: flex; align-items: center; gap: 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px; padding: 8px 10px; margin-bottom: 8px;
}
.dshshare-item .info { flex: 1; min-width: 0; }
.dshshare-item .title {
  font-size: 13px; font-weight: 500; color: var(--dsw-alias-label-primary);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dshshare-item .sub { font-size: 11px; color: var(--dsw-alias-label-dimmed); }
.dshshare-err { color: var(--dsw-alias-state-error-primary); font-size: 12px; margin-top: 8px; }
.dshshare-close {
  position: absolute; top: 12px; right: 12px; border: none; background: transparent;
  color: var(--dsw-alias-label-secondary); font-size: 18px; cursor: pointer; line-height: 1;
}

/* ---- settings card: directory mounts ---- */
.dshshare-card { display: flex; flex-direction: column; gap: 10px; }
/* label-dimmed resolves to #e1e5ee in the light theme — invisible on the card
   surface — so hint copy uses the tertiary label token instead. */
.dshshare-card-hint { margin: 0; font-size: 12px; line-height: 1.6; color: var(--dsw-alias-label-tertiary); }
.dshshare-card-note { margin: 0; font-size: 11px; line-height: 1.6; color: var(--dsw-alias-label-tertiary); }
.dshshare-card-domain { display: flex; align-items: center; gap: 8px; margin-top: 12px; }
.dshshare-card-domain > span { white-space: nowrap; }
.dshshare-domain-input { flex: 1; min-width: 0; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12.5px; padding: 6px 8px; border-radius: 6px; }
.dshshare-card-toggle {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 13px; font-weight: 500; color: var(--dsw-alias-label-primary); cursor: pointer;
}
.dshshare-card-error { margin: 0; font-size: 12px; color: var(--dsw-alias-state-error-primary); }
.dshshare-mount {
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px; padding: 10px;
  display: flex; flex-direction: column; gap: 8px;
}
.dshshare-mount-fields { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.dshshare-input {
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 6px; padding: 6px 8px; font-size: 12px;
  font-family: var(--dsw-font-family, inherit);
}
.dshshare-mount-name { width: 120px; }
.dshshare-mount-path {
  flex: 1; min-width: 200px;
  font-family: ui-monospace, "Cascadia Code", Consolas, monospace;
}
.dshshare-mount-token { width: 150px; }
.dshshare-mount-flag {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 12px; color: var(--dsw-alias-label-secondary); cursor: pointer; white-space: nowrap;
}
.dshshare-mount-url {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  font-size: 11px; color: var(--dsw-alias-label-dimmed);
}
.dshshare-mount-url code {
  font-family: ui-monospace, "Cascadia Code", Consolas, monospace;
  background: var(--dsw-alias-bg-layer-1);
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 4px; padding: 2px 6px;
  word-break: break-all;
}
.dshshare-card-actions { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.dshshare-link {
  border: none; background: transparent; cursor: pointer; padding: 4px 6px;
  color: var(--dsw-alias-label-secondary); font-size: 12px;
  font-family: var(--dsw-font-family, inherit); border-radius: 4px;
}
.dshshare-link:hover { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-1); }
.dshshare-link:disabled { opacity: .5; cursor: default; }
`
