// The selects above each linked-carousel page: how each carousel responds
// while it is the one following, and each carousel's contrast policy. They
// exist so the combinations can be tried against each other rather than
// reasoned about.
//
// Both of those are constants of a real implementation, not runtime options -
// this page's pairing wants one setting and keeps it. The selects are how the
// setting was chosen; they go once it is.
export function attachDemoControls(link, carousels) {
  document.querySelectorAll("[data-link-follower]").forEach((select) => {
    select.addEventListener("change", () => {
      link.setResponse(carousels[select.dataset.linkFollower], select.value);
    });
  });

  document.querySelectorAll("[data-contrast-for]").forEach((select) => {
    select.addEventListener("change", () => {
      carousels[select.dataset.contrastFor].setContrastRemoval(select.value);
    });
  });
}
