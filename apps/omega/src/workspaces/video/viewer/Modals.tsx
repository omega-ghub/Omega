// The viewer package's dialogs. The viewer works without modal dialogs today
// (export frame goes straight to the save dialog, timecode entry is inline),
// so nothing renders; the component exists so the shell can mount every
// package's Modals the same way.
export function Modals() {
  return null;
}
