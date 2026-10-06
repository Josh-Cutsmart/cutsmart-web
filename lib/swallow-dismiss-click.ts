// A press outside an open dropdown / menu / popover should only close it — never also act on whatever
// is underneath (open the project row it landed on, close the pop-up behind, press a button…).
//
// Call this from a dropdown's outside-press handler (a `pointerdown` listener) at the moment it closes
// because of that press: the click that the same press goes on to produce is swallowed before anything
// else sees it. It stays armed only until that click, the next press, or a second — so a press that
// turns into a scroll (no click follows) can't swallow a later, unrelated tap.
export function swallowNextClick(): void {
  if (typeof document === "undefined") return;
  let timer = 0;
  const disarm = () => {
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("pointerdown", onNextPress, true);
    window.clearTimeout(timer);
  };
  const onClick = (event: Event) => {
    event.stopPropagation();
    event.preventDefault();
    disarm();
  };
  // Registered after the current press has finished dispatching, so it only ever sees the next one.
  const onNextPress = () => disarm();
  document.addEventListener("click", onClick, true);
  window.setTimeout(() => document.addEventListener("pointerdown", onNextPress, true), 0);
  timer = window.setTimeout(disarm, 1000);
}
