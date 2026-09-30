import { parseDemoName } from './parseDemoName';

test('parseDemoName', () => {
  expect(parseDemoName('?demo=map-icon')).toBe('map-icon');
  // 大小写与首尾空白归一
  expect(parseDemoName('?demo=%20Map-Icon%20')).toBe('map-icon');
  // 与其他查询参数共存时不干扰
  expect(parseDemoName('?utm_source=x&demo=map-icon')).toBe('map-icon');
  // 未指定 / 空值 → ''
  expect(parseDemoName('?other=1')).toBe('');
  expect(parseDemoName('?demo=')).toBe('');
  expect(parseDemoName('')).toBe('');
});
