// Media-browser glyphs not in the shared set (same monoline family).
import { IconBase, type IconProps } from '../../../ui/Icons';

const folder = <path d="M3.5 7.5a2 2 0 0 1 2-2h3.7a1.5 1.5 0 0 1 1.1.5l1.6 1.8h6.6a2 2 0 0 1 2 2v7.7a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />;

export const MdIcons = {
  FolderPlus: (p: IconProps) => (
    <IconBase {...p}>
      {folder}
      <path d="M12 10.5v5M9.5 13h5" />
    </IconBase>
  ),
  FolderOpen: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M3.5 17.5V7.5a2 2 0 0 1 2-2h3.7a1.5 1.5 0 0 1 1.1.5l1.6 1.8h5.6a2 2 0 0 1 2 2v1" />
      <path d="M3.5 17.5l2.3-6a1.5 1.5 0 0 1 1.4-1h13a1 1 0 0 1 .94 1.33l-2 5.6a2 2 0 0 1-1.88 1.32H5.5a2 2 0 0 1-2-1.25z" />
    </IconBase>
  ),
  /** Thin offline glyph (broken chain). */
  Offline: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M15.5 13l3.2-3.2a3.9 3.9 0 0 0-5.5-5.5L10 7.5" />
      <path d="M8.5 11l-3.2 3.2a3.9 3.9 0 0 0 5.5 5.5L14 16.5" />
      <path d="M4 4l16 16" />
    </IconBase>
  ),
  DropIn: (p: IconProps) => (
    <IconBase {...p}>
      <rect x="3.5" y="3.5" width="17" height="17" rx="2.5" strokeDasharray="2.6 2.6" />
      <path d="M12 7.5v7.5M8.8 11.8L12 15l3.2-3.2" />
    </IconBase>
  ),
};
