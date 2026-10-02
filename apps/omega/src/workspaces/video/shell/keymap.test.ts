import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conflictsFor, presetOverrides, resolveCommand, PRESET_COMMANDS } from './keymap';

const ACTIONS = [
  { id: 'timeline.tool.select', label: 'Selection tool', keys: ['V'] },
  { id: 'timeline.tool.trackForward', label: 'Track select forward tool', keys: ['A'] },
  { id: 'timeline.tool.ripple', label: 'Ripple edit tool', keys: ['B'] },
  { id: 'timeline.tool.razor', label: 'Razor tool', keys: ['C'] },
  { id: 'timeline.split', label: 'Split at playhead', keys: ['Mod+K'] },
  { id: 'viewer.playPause', label: 'Play / pause', keys: ['Space'] },
  { id: 'custom.thing', label: 'Something using D', keys: ['D'] },
];

test('premiere preset clears every override', () => {
  assert.deepEqual(presetOverrides('premiere', ACTIONS), {});
});

test('final cut preset: blade on B, select on A, conflicts removed', () => {
  const o = presetOverrides('fcp', ACTIONS);
  assert.deepEqual(o['timeline.tool.razor'], ['B']);
  assert.deepEqual(o['timeline.tool.select'], ['A']);
  assert.deepEqual(o['timeline.split'], ['Mod+B']);
  // FCP has no ripple tool key: ripple loses B, track-forward loses A
  assert.deepEqual(o['timeline.tool.ripple'], []);
  assert.deepEqual(o['timeline.tool.trackForward'], []);
  // untouched actions keep their defaults (no override entry)
  assert.equal(o['viewer.playPause'], undefined);
});

test('presets never leave a key on two actions', () => {
  for (const preset of ['fcp', 'resolve'] as const) {
    const o = presetOverrides(preset, ACTIONS);
    const eff = ACTIONS.map((a) => ({ id: a.id, keys: o[a.id] ?? a.keys }));
    const seen = new Map<string, string>();
    for (const b of eff)
      for (const k of b.keys) {
        assert.ok(!seen.has(k), `${preset}: ${k} on ${seen.get(k)} and ${b.id}`);
        seen.set(k, b.id);
      }
  }
});

test('commands resolve by label when ids differ', () => {
  const cmd = PRESET_COMMANDS.find((c) => c.name === 'Ripple delete')!;
  const a = resolveCommand(cmd, [{ id: 'tl.rd', label: 'Ripple delete', keys: ['Shift+Delete'] }]);
  assert.equal(a?.id, 'tl.rd');
});

test('conflict detection', () => {
  assert.deepEqual(conflictsFor('C', 'timeline.split', ACTIONS), ['timeline.tool.razor']);
  assert.deepEqual(conflictsFor('Mod+K', 'timeline.split', ACTIONS), []);
});
