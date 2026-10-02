import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decimalsOf, evalNumberInput, formatNumber, parseHexColor, roundTo, toHexColor } from './util';

test('decimalsOf', () => {
  assert.equal(decimalsOf(1), 0);
  assert.equal(decimalsOf(0.1), 1);
  assert.equal(decimalsOf(0.01), 2);
  assert.equal(decimalsOf(0.005), 3);
  assert.equal(decimalsOf(10), 0);
});

test('formatNumber and roundTo', () => {
  assert.equal(formatNumber(-0.0001, 1), '0.0');
  assert.equal(formatNumber(12.345, 2), '12.35');
  assert.equal(roundTo(0.1 + 0.2, 4), 0.3);
});

test('evalNumberInput: numbers, arithmetic and relative operators', () => {
  assert.equal(evalNumberInput('12.5', 0), 12.5);
  assert.equal(evalNumberInput('12,5', 0), 12.5);
  assert.equal(evalNumberInput('-3', 10), -3);
  assert.equal(evalNumberInput('1/4', 0), 0.25);
  assert.equal(evalNumberInput('(2+3)*4', 0), 20);
  assert.equal(evalNumberInput('2+3*4', 0), 14);
  assert.equal(evalNumberInput('*2', 10), 20);
  assert.equal(evalNumberInput('/4', 10), 2.5);
  assert.equal(evalNumberInput('+=5', 10), 15);
  assert.equal(evalNumberInput('-=5', 10), 5);
  assert.equal(evalNumberInput('50%', 0), 50);
  assert.equal(evalNumberInput('90°', 0), 90);
  assert.equal(evalNumberInput('abc', 0), null);
  assert.equal(evalNumberInput('', 0), null);
  assert.equal(evalNumberInput('2+', 0), null);
});

test('hex colors', () => {
  assert.deepEqual(parseHexColor('#FFF'), { rgb: '#ffffff', a: 1 });
  assert.deepEqual(parseHexColor('00ff0080'), { rgb: '#00ff00', a: 128 / 255 });
  assert.equal(parseHexColor('#12345'), null);
  assert.equal(parseHexColor('zzz'), null);
  assert.equal(toHexColor('#ff0000', 1), '#ff0000');
  assert.equal(toHexColor('#ff0000', 0.5), '#ff000080');
  assert.equal(toHexColor('#ff0000', 1, true), '#ff0000ff');
});
