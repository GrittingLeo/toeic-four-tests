import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { POS_LABELS } from '../web/vocabulary.js';

const words = JSON.parse(readFileSync(new URL('../web/data/vocabulary.json', import.meta.url), 'utf8'));
const annotations = JSON.parse(readFileSync(new URL('../tools/vocabulary-pos.json', import.meta.url), 'utf8'));

test('every glossary entry has explicit reviewed POS labels matching its term', () => {
  assert.equal(words.length, 1041);
  assert.equal(new Set(words.map(w=>w.id)).size, words.length);
  for (const word of words) {
    assert(word.pos.length > 0, word.term);
    assert.equal(new Set(word.pos).size, word.pos.length, word.term);
    assert(word.pos.every(pos=>POS_LABELS[pos]), word.term);
    assert.deepEqual(word.pos, annotations[word.term].pos, word.term);
    assert.equal(word.posNote, annotations[word.term].note, word.term);
  }
});

test('labels follow listed meanings and distinguish multi-POS words and phrases', () => {
  for (const [term, pos] of Object.entries({
    need: ['n','v'], water: ['v'], property: ['n'], current: ['adj'],
    previously: ['adv'], via: ['prep'], refund: ['n','v'],
    'look forward to': ['verbPhrase'], 'cover letter': ['nounPhrase'],
    'due to': ['prepPhrase'], 'fully furnished': ['adjPhrase'],
  })) assert.deepEqual(words.find(w=>w.term===term).pos, pos, term);
});
