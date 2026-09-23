// Loads the scroll-timeline polyfill (vendor/scroll-timeline.js) in browsers
// without native scroll-driven animations, and does nothing anywhere else.
//
// A classic, parser-blocking script, placed after the page's stylesheets and
// ahead of its entry module. Everything below has to have happened before
// the first carousel starts an animation: the polyfill only takes over an
// animation from its animationstart event, and only once it has already read
// every declaration that animation refers to.
//
// The polyfill reads declarations by parsing stylesheet text itself, since
// the browser drops the properties it is there to interpret. A <style> is
// parsed the moment the polyfill finds it, but a <link> is fetch()ed again
// and parsed whenever that fetch returns - in a bundled build, after the
// carousels have started their animations, so the view-timeline and
// scroll-timeline names in the linked sheets were never known in time and
// no animation was taken over. So each linked sheet is swapped for a <style>
// holding the same text first, read synchronously so it is in place before
// the polyfill starts.
//
// The polyfill itself is written into the document rather than appended: a
// written script blocks the parser, so it runs before any module script does,
// wherever the build puts that module script (Vite moves it into <head>). An
// appended one only runs once it has downloaded - after the entry module,
// if that was quicker.
//
// The polyfill patches CSS.supports to report animation-timeline as
// supported, which is deliberate - it keeps feature queries in the page's
// own CSS from skipping the declarations it exists to interpret - and
// nothing after this point asks that question.
if (!CSS.supports("animation-timeline: --works")) {
  for (const link of document.querySelectorAll('link[rel="stylesheet"]')) {
    const request = new XMLHttpRequest();
    request.open("GET", link.href, false);
    // What a <link> itself asks for. Vite's dev server answers a .css request
    // that doesn't ask for it with the JS module behind `import "x.css"`.
    request.setRequestHeader("Accept", "text/css");
    request.send();
    const style = document.createElement("style");
    style.textContent = request.responseText;
    link.replaceWith(style);
  }

  const polyfillSrc = new URL("vendor/scroll-timeline.js", document.currentScript.src);
  document.write(`<script src="${polyfillSrc}"><\/script>`);
}
