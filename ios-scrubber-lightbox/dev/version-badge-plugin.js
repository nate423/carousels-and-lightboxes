// A badge fixed in the corner of every page saying which version of the code
// it is: branch, commit, whether the working tree has changes on top of it,
// an optional description (VERSION_LABEL in the environment, for an
// experiment), and the page's own ?switches. Several versions are often
// served side by side for testing on a phone, and a screenshot then says
// exactly which one it was.
//
// Read from git on every page load, so a commit made while the server runs
// shows on the next reload.
import { execSync } from "node:child_process";

function git(cwd, args) {
  try {
    return execSync(`git ${args}`, { cwd, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "";
  }
}

function versionLabel(cwd) {
  const branch = git(cwd, "rev-parse --abbrev-ref HEAD");
  const commit = git(cwd, "rev-parse --short HEAD");
  const changed = git(cwd, "status --porcelain -- .") ? " +changes" : "";
  return [branch === "HEAD" ? "detached" : branch, commit + changed, process.env.VERSION_LABEL]
    .filter(Boolean)
    .join(" · ");
}

export function versionBadge(cwd) {
  return {
    name: "version-badge",
    transformIndexHtml() {
      const label = JSON.stringify(versionLabel(cwd));
      return [
        {
          tag: "script",
          injectTo: "body",
          children: `(() => {
  const badge = document.createElement("div");
  badge.textContent = ${label} + (location.search ? " · " + location.search : "");
  badge.style.cssText = "position:fixed;left:4px;bottom:4px;z-index:2147483647;pointer-events:none;" +
    "font:10px/1.3 ui-monospace,monospace;padding:2px 5px;border-radius:3px;" +
    "background:rgba(0,0,0,0.7);color:#fff;max-width:calc(100vw - 8px);overflow-wrap:anywhere;";
  document.body.appendChild(badge);
})();`
        }
      ];
    }
  };
}
