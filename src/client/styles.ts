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
`
