// When the page being run was published, shown in the corner so "am I testing
// the build I just pushed?" is answerable at a glance. GitHub Pages serves with
// Cache-Control: max-age=600, so for ten minutes after a deploy a reload can
// still be running the previous build, and there is otherwise nothing on screen
// that says so.
//
// document.lastModified comes from the document's own Last-Modified header, so
// it needs no maintenance - but it describes the document. Modules are cached
// under their own URLs and could in principle be a different age.
export function showBuildStamp() {
  const element = document.getElementById("build-stamp");
  if (!element) return;

  const built = new Date(document.lastModified);
  const day = built.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const time = built.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  element.textContent = `build ${day} ${time}`;
}
