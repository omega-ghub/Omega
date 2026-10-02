// Caption files. OWNED BY THE CAPTIONS PACKAGE.
import type { CaptionCue } from '../../state/types';

export function parseCaptions(_text: string, _format: 'srt' | 'vtt'): CaptionCue[] {
  throw new Error('parseCaptions is not implemented yet');
}
export function writeSrt(_cues: CaptionCue[]): string {
  throw new Error('writeSrt is not implemented yet');
}
export function writeVtt(_cues: CaptionCue[]): string {
  throw new Error('writeVtt is not implemented yet');
}
