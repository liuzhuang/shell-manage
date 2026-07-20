import assert from 'node:assert/strict'
import test from 'node:test'
import { timeseriesPointsFromProbe } from './dashboard-timeseries'

test('时序数据只使用真实解析结果', () => {
  assert.deepEqual(timeseriesPointsFromProbe({ points: [['10:00', 3.5], ['10:01', 4.2]] }, ''), [
    { label: '10:00', value: 3.5 },
    { label: '10:01', value: 4.2 }
  ])
  assert.deepEqual(timeseriesPointsFromProbe('10:02 5.1\ninvalid', ''), [{ label: '10:02', value: 5.1 }])
  assert.deepEqual(timeseriesPointsFromProbe([{ timestamp: 171234, value: 6.2 }], ''), [{ label: '171234', value: 6.2 }])
  assert.deepEqual(timeseriesPointsFromProbe(null, 'not-a-number'), [])
})
