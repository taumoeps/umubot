import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatServing, formatShelfLife } from './essentialsClient'

test('storage life reads naturally', () => {
  assert.equal(formatShelfLife(2), '2 days')
  assert.equal(formatShelfLife(1), '1 day')
  assert.equal(formatShelfLife(21), '~3 weeks')
  assert.equal(formatShelfLife(180), '~6 months')
  assert.equal(formatShelfLife(730), '~2 years')
  assert.equal(formatShelfLife(540), '~1.5 years')
  assert.equal(formatShelfLife(null), null)
})

test('cost per serving with its portion', () => {
  assert.equal(formatServing({ servingCents: 20 }, '75 g dry'), '≈$0.20 per serving (75 g dry)')
  assert.equal(formatServing({ servingCents: 184 }, null), '≈$1.84 per serving')
  assert.equal(formatServing({ servingCents: null }, '75 g'), null)
  assert.equal(formatServing({ servingCents: 0 }, '1 g (a pinch)'), 'under 1¢ per serving (1 g (a pinch))')
})
