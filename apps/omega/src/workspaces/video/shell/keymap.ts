// Keyboard presets for the shortcuts editor: Premiere Pro (Delta's defaults),
// Final Cut Pro and DaVinci Resolve. Pure logic, unit-tested; no DOM.
// OWNED BY THE SHELL PACKAGE.
//
// Each preset entry names a common command by the ids packages are likely to
// register (first registered id wins) with a label pattern as a fallback, so
// presets keep working as packages add or rename actions.

export type PresetId = 'premiere' | 'fcp' | 'resolve';

export const PRESETS: { id: PresetId; name: string; hint: string }[] = [
  { id: 'premiere', name: 'Premiere Pro (default)', hint: "Delta's built-in layout" },
  { id: 'fcp', name: 'Final Cut Pro', hint: 'Blade B, Select A, Insert W, Overwrite D' },
  { id: 'resolve', name: 'DaVinci Resolve', hint: 'Blade B, Select A, Insert F9, Overwrite F10' },
];

export interface PresetCommand {
  name: string;
  ids: string[];
  label?: RegExp;
  /** Keys per preset. Missing = keep the action's default keys, minus any
   *  key the preset gives to another command. */
  fcp?: string[];
  resolve?: string[];
}

export const PRESET_COMMANDS: PresetCommand[] = [
  // tools
  { name: 'Selection tool', ids: ['timeline.tool.select', 'timeline.toolSelect', 'tool.select'], label: /^selection tool$|^select tool$/i, fcp: ['A'], resolve: ['A'] },
  { name: 'Razor / blade tool', ids: ['timeline.tool.razor', 'timeline.toolRazor', 'tool.razor'], label: /^(razor|blade)( tool)?$/i, fcp: ['B'], resolve: ['B'] },
  { name: 'Ripple edit tool', ids: ['timeline.tool.ripple', 'timeline.toolRipple', 'tool.ripple'], label: /^ripple( edit)? tool$/i, resolve: ['T'] },
  { name: 'Roll edit tool', ids: ['timeline.tool.roll', 'timeline.toolRoll', 'tool.roll'], label: /^roll( edit)? tool$/i },
  { name: 'Track select forward tool', ids: ['timeline.tool.trackForward', 'timeline.toolTrackForward', 'tool.trackForward'], label: /^track select/i },
  { name: 'Rate stretch tool', ids: ['timeline.tool.rate', 'timeline.toolRate', 'tool.rate'], label: /^rate stretch/i },
  { name: 'Slip tool', ids: ['timeline.tool.slip', 'timeline.toolSlip', 'tool.slip'], label: /^slip tool$/i },
  { name: 'Slide tool', ids: ['timeline.tool.slide', 'timeline.toolSlide', 'tool.slide'], label: /^slide tool$/i },
  { name: 'Hand tool', ids: ['timeline.tool.hand', 'timeline.toolHand', 'tool.hand'], label: /^hand tool$/i, fcp: ['H'], resolve: ['H'] },
  { name: 'Zoom tool', ids: ['timeline.tool.zoom', 'timeline.toolZoom', 'tool.zoom'], label: /^zoom tool$/i, fcp: ['Z'] },
  { name: 'Pen tool', ids: ['timeline.tool.pen', 'timeline.toolPen', 'tool.pen'], label: /^pen tool$/i },
  { name: 'Type tool', ids: ['timeline.tool.text', 'timeline.toolText', 'tool.text'], label: /^(type|text) tool$/i },

  // editing
  { name: 'Split at playhead', ids: ['timeline.split', 'timeline.addEdit', 'edit.split'], label: /^(split|add edit|razor)( clip)?( at playhead)?$/i, fcp: ['Mod+B'], resolve: ['Mod+B', 'Mod+\\'] },
  { name: 'Split all tracks', ids: ['timeline.splitAll', 'timeline.addEditAll'], label: /(split|add edit).*(all tracks)/i, fcp: ['Mod+Shift+B'], resolve: ['Mod+Shift+\\'] },
  { name: 'Ripple delete', ids: ['timeline.rippleDelete', 'edit.rippleDelete'], label: /^ripple delete/i, fcp: ['Backspace', 'Delete'], resolve: ['Delete', 'Shift+Backspace'] },
  { name: 'Delete (leave gap)', ids: ['timeline.delete', 'timeline.lift', 'edit.delete'], label: /^(delete|clear)( selected)?( clips?)?$/i, fcp: ['Shift+Backspace', 'Shift+Delete'], resolve: ['Backspace'] },
  { name: 'Insert edit', ids: ['timeline.insert', 'viewer.insert', 'edit.insert'], label: /^insert( edit)?$/i, fcp: ['W'], resolve: ['F9'] },
  { name: 'Overwrite edit', ids: ['timeline.overwrite', 'viewer.overwrite', 'edit.overwrite'], label: /^overwrite( edit)?$/i, fcp: ['D'], resolve: ['F10'] },
  { name: 'Append at end', ids: ['timeline.append', 'viewer.append', 'media.append'], label: /^append/i, fcp: ['E'], resolve: ['Shift+F12'] },
  { name: 'Lift', ids: ['timeline.liftRange', 'timeline.lift'], label: /^lift$/i },
  { name: 'Extract', ids: ['timeline.extract'], label: /^extract$/i },
  { name: 'Trim start to playhead', ids: ['timeline.trimStart', 'timeline.rippleTrimPrev', 'timeline.trimPrevToPlayhead'], label: /trim (start|previous edit|head).*playhead/i, fcp: ['Alt+['], resolve: ['Shift+['] },
  { name: 'Trim end to playhead', ids: ['timeline.trimEnd', 'timeline.rippleTrimNext', 'timeline.trimNextToPlayhead'], label: /trim (end|next edit|tail).*playhead/i, fcp: ['Alt+]'], resolve: ['Shift+]'] },
  { name: 'Nudge left', ids: ['timeline.nudgeLeft', 'timeline.nudge.left'], label: /^nudge.*(left|back|earlier)/i, fcp: [','], resolve: [','] },
  { name: 'Nudge right', ids: ['timeline.nudgeRight', 'timeline.nudge.right'], label: /^nudge.*(right|forward|later)/i, fcp: ['.'], resolve: ['.'] },
  { name: 'Enable / disable clip', ids: ['timeline.toggleEnabled', 'timeline.enable', 'timeline.toggleClipEnabled'], label: /^(enable|disable)/i, fcp: ['V'], resolve: ['D'] },
  { name: 'Add default transition', ids: ['timeline.addTransition', 'timeline.defaultTransition', 'timeline.applyDefaultTransition'], label: /default (video )?transition/i, fcp: ['Mod+T'], resolve: ['Mod+T'] },
  { name: 'Speed / duration', ids: ['timeline.speedDialog', 'timeline.speed', 'timeline.speedDuration'], label: /^speed/i, fcp: ['Mod+R'], resolve: ['R'] },
  { name: 'Nest / compound clip', ids: ['timeline.nest'], label: /^nest/i, fcp: ['Alt+G'] },
  { name: 'Snapping', ids: ['timeline.toggleSnapping', 'timeline.snapping', 'timeline.snap'], label: /snapping/i, fcp: ['N'], resolve: ['N'] },
  { name: 'Linked selection', ids: ['timeline.toggleLinkedSelection', 'timeline.linkedSelection'], label: /linked selection/i, resolve: ['Mod+Shift+L'] },
  { name: 'Zoom in', ids: ['timeline.zoomIn'], label: /^zoom in/i, fcp: ['Mod+='], resolve: ['Mod+='] },
  { name: 'Zoom out', ids: ['timeline.zoomOut'], label: /^zoom out/i, fcp: ['Mod+-'], resolve: ['Mod+-'] },
  { name: 'Zoom to fit', ids: ['timeline.zoomFit', 'timeline.zoomToFit'], label: /zoom to (fit|sequence)/i, fcp: ['Shift+Z'], resolve: ['Shift+Z'] },
  { name: 'Add marker', ids: ['timeline.addMarker', 'timeline.marker.add', 'viewer.addMarker'], label: /^add marker$/i, fcp: ['M'], resolve: ['M'] },
  { name: 'Next marker', ids: ['timeline.nextMarker', 'viewer.nextMarker'], label: /^(go to )?next marker/i, fcp: ["Mod+'"], resolve: ['Shift+ArrowDown'] },
  { name: 'Previous marker', ids: ['timeline.prevMarker', 'viewer.prevMarker'], label: /^(go to )?prev(ious)? marker/i, fcp: ['Mod+;'], resolve: ['Shift+ArrowUp'] },

  // playback & marking
  { name: 'Mark in', ids: ['viewer.markIn', 'viewer.in'], label: /^mark in$/i },
  { name: 'Mark out', ids: ['viewer.markOut', 'viewer.out'], label: /^mark out$/i },
  { name: 'Clear in and out', ids: ['viewer.clearInOut', 'viewer.clearMarks'], label: /^clear in (and|&) out/i, fcp: ['Alt+X'], resolve: ['Alt+X'] },
  { name: 'Loop playback', ids: ['viewer.loop', 'viewer.toggleLoop'], label: /^loop/i, fcp: ['Mod+L'], resolve: ['Mod+/'] },
  { name: 'Match frame', ids: ['viewer.matchFrame', 'timeline.matchFrame'], label: /^match frame/i, fcp: ['Shift+F'], resolve: ['F'] },
  { name: 'Fullscreen viewer', ids: ['viewer.fullscreen', 'viewer.toggleFullscreen'], label: /full ?screen/i, fcp: ['Mod+Shift+F'], resolve: ['Mod+F'] },

  // project
  { name: 'Export', ids: ['deliver.quickExport', 'deliver.export'], label: /^export( media)?(…)?$/i, fcp: ['Mod+E'] },
  { name: 'Import media', ids: ['media.import'], label: /^import( media)?(…)?$/i },
];

export interface ActionInfo {
  id: string;
  label: string;
  keys: string[];
}

/** Finds the registered action a preset command refers to. */
export function resolveCommand(cmd: PresetCommand, actions: ActionInfo[]): ActionInfo | undefined {
  for (const id of cmd.ids) {
    const a = actions.find((x) => x.id === id);
    if (a) return a;
  }
  if (cmd.label) return actions.find((a) => cmd.label!.test(a.label.trim()));
  return undefined;
}

/**
 * The complete override map a preset produces from the actions' defaults.
 * Premiere = no overrides. Other presets set their keys on the commands they
 * know and remove those keys from any other action so nothing conflicts.
 */
export function presetOverrides(preset: PresetId, actions: ActionInfo[]): Record<string, string[]> {
  if (preset === 'premiere') return {};
  const assigned = new Map<string, string[]>();
  for (const cmd of PRESET_COMMANDS) {
    const keys = cmd[preset];
    if (!keys) continue;
    const a = resolveCommand(cmd, actions);
    if (!a || assigned.has(a.id)) continue;
    assigned.set(a.id, keys);
  }
  const taken = new Set([...assigned.values()].flat());
  const out: Record<string, string[]> = {};
  for (const a of actions) {
    const next = assigned.get(a.id) ?? a.keys.filter((k) => !taken.has(k));
    if (next.length !== a.keys.length || next.some((k, i) => k !== a.keys[i])) out[a.id] = next;
  }
  return out;
}

/** Actions (other than `except`) currently bound to `key`. */
export function conflictsFor(key: string, except: string, bindings: { id: string; keys: string[] }[]): string[] {
  return bindings.filter((b) => b.id !== except && b.keys.includes(key)).map((b) => b.id);
}

/** True for a key event that is only a modifier (wait for the real key). */
export function isModifierOnly(key: string): boolean {
  return ['Control', 'Shift', 'Alt', 'Meta', 'OS', 'CapsLock', 'Fn'].includes(key);
}
