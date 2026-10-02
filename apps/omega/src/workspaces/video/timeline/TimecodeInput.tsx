// A timecode text field: shows SMPTE timecode, accepts what editors type
// ("1:00", "+12", "250", "01:00:10:12") via parseTimecode.
import { useEffect, useState } from 'react';
import { formatTimecode, parseTimecode } from '../../../engine/time';

export function TimecodeInput({
  value,
  fps,
  dropFrame,
  startTimecode = 0,
  onChange,
  min = 0,
  testId,
  className = '',
}: {
  value: number;
  fps: number;
  dropFrame: boolean;
  startTimecode?: number;
  onChange: (seconds: number) => void;
  min?: number;
  testId?: string;
  className?: string;
}) {
  const shown = formatTimecode(value, fps, dropFrame, startTimecode);
  const [text, setText] = useState(shown);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setText(shown);
  }, [shown, editing]);
  const commit = () => {
    setEditing(false);
    const t = parseTimecode(text, fps, value, startTimecode, dropFrame);
    if (t === null || !Number.isFinite(t)) {
      setText(shown);
      return;
    }
    onChange(Math.max(min, t));
  };
  return (
    <input
      className={`tl-input tl-input--tc ${className}`}
      value={text}
      spellCheck={false}
      data-testid={testId}
      onFocus={(e) => {
        setEditing(true);
        e.currentTarget.select();
      }}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
          (e.target as HTMLInputElement).blur();
        } else if (e.key === 'Escape') {
          setText(shown);
          setEditing(false);
          (e.target as HTMLInputElement).blur();
          e.stopPropagation();
        }
      }}
    />
  );
}
