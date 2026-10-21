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
/* ---- dialog card (modal) ---- */
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

/* ---- settings page view (full width, clean sectioned layout) ---- */
.dshshare-settings-view {
  display: flex;
  flex-direction: column;
  gap: 24px;
  width: 100%;
  font-family: var(--dsw-font-family, inherit);
  font-size: 13px;
  color: var(--dsw-alias-label-primary);
}

.dshshare-settings-section {
  background: var(--dsw-alias-bg-layer-2);
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 12px;
  padding: 18px 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.dshshare-settings-section-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.dshshare-setting-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.dshshare-card-hint {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--dsw-alias-label-tertiary);
}

.dshshare-card-note {
  margin: 0;
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--dsw-alias-label-tertiary);
}

.dshshare-card-domain {
  display: flex;
  align-items: center;
  gap: 12px;
}

.dshshare-card-domain > span {
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  min-width: 80px;
}

.dshshare-domain-input {
  flex: 1;
  min-width: 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 13px;
  padding: 7px 10px;
}

.dshshare-card-toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 500;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  user-select: none;
}

.dshshare-card-error {
  margin: 0;
  font-size: 12px;
  color: var(--dsw-alias-state-error-primary);
  padding: 6px 10px;
  border-radius: 6px;
  background: var(--dsw-alias-state-error-subtle, rgba(239, 68, 68, 0.1));
}

.dshshare-mounts-empty {
  margin: 0;
  font-size: 12.5px;
  color: var(--dsw-alias-label-tertiary);
  padding: 16px 0;
  text-align: center;
}

.dshshare-mount-card {
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 10px;
  padding: 14px 16px;
  background: var(--dsw-alias-bg-layer-1);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.dshshare-mount-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.dshshare-mount-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.dshshare-mount-badge {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 999px;
  text-transform: uppercase;
}

.dshshare-mount-badge.serving {
  background: var(--dsw-alias-state-success-subtle, rgba(34, 197, 94, 0.15));
  color: var(--dsw-alias-state-success-primary, #16a34a);
}

.dshshare-mount-badge.invalid {
  background: var(--dsw-alias-state-error-subtle, rgba(239, 68, 68, 0.15));
  color: var(--dsw-alias-state-error-primary, #dc2626);
}

.dshshare-mount-grid {
  display: grid;
  grid-template-columns: 140px 1fr 180px;
  gap: 12px;
  align-items: start;
}

@media (max-width: 768px) {
  .dshshare-mount-grid {
    grid-template-columns: 1fr;
  }
}

.dshshare-mount-field-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.dshshare-mount-field-group label {
  font-size: 11px;
  font-weight: 500;
  color: var(--dsw-alias-label-secondary);
}

.dshshare-input {
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 6px;
  padding: 7px 10px;
  font-size: 12.5px;
  font-family: var(--dsw-font-family, inherit);
  transition: border-color 0.15s ease;
}

.dshshare-input:focus {
  outline: none;
  border-color: var(--dsw-alias-interactive-focus, var(--dsw-alias-border-l1, #3b82f6));
}

.dshshare-mount-path {
  font-family: ui-monospace, "Cascadia Code", Menlo, Consolas, monospace;
}

.dshshare-mount-options {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
  padding-top: 2px;
}

.dshshare-mount-flag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  user-select: none;
}

.dshshare-mount-urls-card {
  margin-top: 4px;
  padding: 8px 12px;
  background: var(--dsw-alias-bg-layer-2);
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 6px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.dshshare-mount-url {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11.5px;
}

.dshshare-mount-url code {
  flex: 1;
  min-width: 0;
  font-family: ui-monospace, "Cascadia Code", Menlo, Consolas, monospace;
  word-break: break-all;
  color: var(--dsw-alias-label-primary);
}

.dshshare-card-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-top: 8px;
}

.dshshare-actions-left,
.dshshare-actions-right {
  display: flex;
  align-items: center;
  gap: 10px;
}

.dshshare-link {
  border: 1px solid transparent;
  background: transparent;
  cursor: pointer;
  padding: 6px 12px;
  color: var(--dsw-alias-label-secondary);
  font-size: 12.5px;
  font-weight: 500;
  font-family: var(--dsw-font-family, inherit);
  border-radius: 6px;
  transition: all 0.15s ease;
}

.dshshare-link:hover {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-layer-1);
}

.dshshare-btn-add {
  border: 1px dashed var(--dsw-alias-border-l1, #888);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  padding: 7px 14px;
  font-size: 13px;
  font-weight: 500;
  border-radius: 6px;
  cursor: pointer;
}

.dshshare-btn-add:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  border-color: var(--dsw-alias-label-secondary);
}

.dshshare-btn-danger {
  color: var(--dsw-alias-state-error-primary, #dc2626);
  border: none;
  background: transparent;
  cursor: pointer;
  padding: 4px 8px;
  font-size: 12px;
  border-radius: 4px;
}

.dshshare-btn-danger:hover {
  background: var(--dsw-alias-state-error-subtle, rgba(239, 68, 68, 0.1));
}
`
