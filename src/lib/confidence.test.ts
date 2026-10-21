import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tierFor, LIVE_MAX_DAYS, MAX_AGE_DAYS } from './confidence'

const NOW = Date.parse('2026-10-21T12:00:00Z')
const daysAgo = (d: number) => new Date(NOW - d * 24 * 60 * 60 * 1000).toISOString()

test('scanned within 7 days is live', () => {
  assert.equal(tierFor('baskt', daysAgo(0), NOW), 'live')
  assert.equal(tierFor('openfoodfacts', daysAgo(LIVE_MAX_DAYS), NOW), 'live')
})

test('scanned 8–30 days ago is recent', () => {
  assert.equal(tierFor('baskt', daysAgo(LIVE_MAX_DAYS + 0.01), NOW), 'recent')
  assert.equal(tierFor('baskt', daysAgo(MAX_AGE_DAYS), NOW), 'recent')
})

test('non-scanned sources are estimated whatever their age (within 30 days)', () => {
  assert.equal(tierFor('agent_web_search', daysAgo(0), NOW), 'estimated')
  assert.equal(tierFor('estimated', daysAgo(20), NOW), 'estimated')
  assert.equal(tierFor('crowd', daysAgo(1), NOW), 'estimated')
})

test('anything older than 30 days is not shown', () => {
  assert.equal(tierFor('baskt', daysAgo(MAX_AGE_DAYS + 0.01), NOW), null)
  assert.equal(tierFor('agent_web_search', daysAgo(45), NOW), null)
})

test('the 2026-10-21 Sugar case: a 30-day-old scanned price is no longer Live', () => {
  assert.equal(tierFor('baskt', '2026-09-21T00:00:00Z', NOW), null)
})

test('an unparseable date is not shown', () => {
  assert.equal(tierFor('baskt', 'not a date', NOW), null)
})
