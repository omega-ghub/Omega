import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirName, expandTemplate, extensionFor, isoDate, joinPath, numberedVariant, outputBaseName, outputPath, sanitizeFileName, sequenceFrameName, stripExtension, uniquePath } from './naming';
import { codecsForContainer, searchPresets, BUILTIN_PRESETS } from './presets';

const ctx = { project: 'Trailer', sequence: 'Main Edit', preset: 'YouTube 1080p', format: '', date: new Date(2026, 9, 2) };

test('tokens expand', () => {
  assert.equal(expandTemplate('{project}_{sequence}_{preset}_{date}', ctx), 'Trailer_Main Edit_YouTube 1080p_2026-10-02');
  assert.equal(isoDate(new Date(2026, 0, 5)), '2026-01-05');
  // unknown tokens stay literal
  assert.equal(expandTemplate('{sequence} {nope}', ctx), 'Main Edit {nope}');
});

test('an empty token drops its separator', () => {
  assert.equal(expandTemplate('{sequence} - {format}', ctx), 'Main Edit');
  assert.equal(expandTemplate('{format}_{sequence}', ctx), 'Main Edit');
  assert.equal(expandTemplate('{sequence}_{format}_{preset}', ctx), 'Main Edit_YouTube 1080p');
  assert.equal(expandTemplate('{sequence} - {format}', { ...ctx, format: 'Vertical' }), 'Main Edit - Vertical');
});

test('file names are sanitized for every OS', () => {
  assert.equal(sanitizeFileName('Reel 9:16 / v2?'), 'Reel 9x16 - v2-');
  assert.equal(sanitizeFileName('a\u0001b'), 'ab');
  assert.equal(sanitizeFileName('  name.  '), 'name');
  assert.equal(sanitizeFileName(''), 'Export');
  assert.equal(sanitizeFileName('CON'), 'CON_');
  assert.ok(!/[<>:"/\\|?*]/.test(sanitizeFileName('a<b>c:d"e/f\\g|h?i*j')));
});

test('multi-format names are suffixed unless {format} is used', () => {
  assert.equal(outputBaseName('{sequence}', { ...ctx, format: 'Vertical 9:16' }, { multiFormat: true }), 'Main Edit_Vertical 9x16');
  assert.equal(outputBaseName('{sequence}', ctx, { multiFormat: true }), 'Main Edit');
  assert.equal(outputBaseName('{sequence} [{format}]', { ...ctx, format: 'Square' }, { multiFormat: true }), 'Main Edit [Square]');
  assert.equal(outputBaseName('{sequence}', { ...ctx, format: 'Square' }, { multiFormat: false }), 'Main Edit');
});

test('extensions and paths', () => {
  assert.equal(extensionFor({ kind: 'video', container: 'mp4' }), 'mp4');
  assert.equal(extensionFor({ kind: 'handoff', container: 'chapters' }), 'txt');
  assert.equal(extensionFor({ kind: 'imageSequence', container: 'png' }), '');
  assert.equal(outputPath('/out', 'Clip', { kind: 'video', container: 'mov' }), '/out/Clip.mov');
  assert.equal(outputPath('/out/', 'Frames', { kind: 'imageSequence', container: 'png' }), '/out/Frames');
  assert.equal(joinPath('C:\\Users\\me\\Videos', 'a.mp4'), 'C:\\Users\\me\\Videos\\a.mp4');
  assert.equal(dirName('/a/b/c.mp4'), '/a/b');
  assert.equal(stripExtension('/a/b.c/d.mp4'), '/a/b.c/d');
  assert.equal(stripExtension('/a/b.c/d'), '/a/b.c/d');
});

test('numbered variants avoid collisions', async () => {
  assert.equal(numberedVariant('/x/a.mp4', 1), '/x/a.mp4');
  assert.equal(numberedVariant('/x/a.mp4', 3), '/x/a 3.mp4');
  assert.equal(numberedVariant('/x/frames', 2), '/x/frames 2');
  const taken = new Set(['/x/a.mp4', '/x/a 2.mp4']);
  assert.equal(await uniquePath('/x/a.mp4', (p) => taken.has(p)), '/x/a 3.mp4');
});

test('image sequence frame names are zero-padded', () => {
  assert.equal(sequenceFrameName('shot', 7, 100), 'shot_000007.png');
  assert.equal(sequenceFrameName('shot', 7, 12_000_000), 'shot_00000007.png');
});

test('preset search and container codec filtering', () => {
  assert.ok(searchPresets(BUILTIN_PRESETS, 'youtube').length >= 4);
  assert.deepEqual(searchPresets(BUILTIN_PRESETS, 'reels ig').map((p) => p.id), []);
  assert.ok(searchPresets(BUILTIN_PRESETS, 'instagram reels').some((p) => p.id === 'ig-reels'));
  assert.deepEqual(codecsForContainer(['avc', 'hevc', 'vp9'], ['vp9', 'av1']), ['vp9', 'av1']);
  assert.deepEqual(codecsForContainer(['avc', 'hevc', 'av1', 'vp9'], ['avc', 'hevc', 'av1', 'vp9'], 'hevc'), ['hevc', 'avc', 'av1', 'vp9']);
});
