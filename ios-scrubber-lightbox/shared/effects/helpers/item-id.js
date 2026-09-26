// Ids for items, unique across every effect on the page. Each effect hangs
// generated rules off its items by id (`[data-item-id="N"]`), so two effects
// on one page counting from 0 on their own would each match the other's
// items too - the fade effect's rule for its item 0 taking over the iOS
// strip's item 0, say.
let next = 0;

export function nextItemId() {
  return String(next++);
}
