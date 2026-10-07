// Public surface of the effects package: its panels, and (as a side effect of
// importing this module) registration of its actions. OWNED BY THE PACKAGE.
import { registerActions } from '../actions';
import { useEditor } from '../../../state/store';
import { applyFavorite, copyClipEffects, pasteClipEffects, removeAllEffects, selectedVideoClips } from './ops';

export { EffectStack } from './EffectStack';
export { EffectsBrowser } from './EffectsBrowser';

// Mod+Alt+V is owned by the timeline (Paste Attributes), so pasting effects has no default key.
registerActions([
  ...[1, 2, 3].map((n) => ({
    id: `effects.applyFavorite${n}`,
    label: `Apply favorite effect ${n}`,
    group: 'Clip',
    hint: 'Adds your nth starred effect or transition (Effects browser) to the selected clips',
    run: () => void applyFavorite(n),
  })),
  {
    id: 'effects.removeAll',
    label: 'Remove all effects from selected clips',
    group: 'Clip',
    enabled: () => selectedVideoClips().some((c) => c.effects.length > 0),
    run: () => void removeAllEffects(),
  },
  {
    id: 'effects.copy',
    label: 'Copy effects',
    group: 'Clip',
    hint: 'Copies every effect of the first selected clip',
    enabled: () => selectedVideoClips().some((c) => c.effects.length > 0),
    run: () => {
      const c = selectedVideoClips()[0];
      if (c) copyClipEffects(c.id);
    },
  },
  {
    id: 'effects.paste',
    label: 'Paste effects',
    group: 'Clip',
    hint: 'Pastes copied effects (with keyframes) onto the selected clips',
    enabled: () => !!useEditor.getState().project,
    run: () => void pasteClipEffects(),
  },
]);
