import assert from 'node:assert/strict'
import test from 'node:test'

import { en, zh } from '../src/client/locales.js'

const AFFILIATION_KEYS = [
  'affiliation.action',
  'affiliation.blocked',
  'affiliation.title',
  'affiliation.searchPlaceholder',
  'affiliation.topLevel',
  'affiliation.unavailable',
  'affiliation.empty',
  'affiliation.attachedTo',
  'affiliation.saved',
  'affiliation.expand',
  'affiliation.collapse',
  'affiliation.childCount',
]

function placeholders(value) {
  return [...value.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]).sort()
}

test('English and Chinese dictionaries expose the same keys and placeholders', () => {
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort())
  for (const key of Object.keys(zh)) {
    assert.equal(typeof zh[key], 'string')
    assert.equal(typeof en[key], 'string')
    assert.ok(zh[key].length > 0)
    assert.ok(en[key].length > 0)
    assert.deepEqual(placeholders(en[key]), placeholders(zh[key]), key)
  }
})

test('English UI copy contains no Chinese characters', () => {
  for (const [key, value] of Object.entries(en)) {
    assert.doesNotMatch(value, /[\p{Script=Han}]/u, key)
  }
})

test('locale dictionaries expose the complete affiliation interface', () => {
  for (const key of AFFILIATION_KEYS) {
    assert.equal(typeof zh[key], 'string', `missing Chinese ${key}`)
    assert.equal(typeof en[key], 'string', `missing English ${key}`)
  }
  assert.deepEqual(placeholders(zh['affiliation.attachedTo']), ['name'])
  assert.deepEqual(placeholders(zh['affiliation.expand']), ['count', 'name'])
  assert.deepEqual(placeholders(zh['affiliation.collapse']), ['count', 'name'])
  assert.deepEqual(placeholders(zh['affiliation.childCount']), ['count'])
})
