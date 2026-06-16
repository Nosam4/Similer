import wordBankData from './wordBank.json'
import everydayWords from '../../word-packs/everyday.txt?raw'
import foodWords from '../../word-packs/food.txt?raw'
import legalWords from '../../word-packs/legal.txt?raw'
import partyWords from '../../word-packs/party.txt?raw'
import sportsWords from '../../word-packs/sports.txt?raw'

export const DEFAULT_WORD_PACK_ID = 'default'

function parseWordList(text) {
  return [
    ...new Set(
      text
        .split(/\r?\n/)
        .map((word) => word.trim().toLowerCase())
        .filter((word) => word && !word.startsWith('#')),
    ),
  ]
}

export const WORD_PACKS = [
  {
    id: DEFAULT_WORD_PACK_ID,
    name: 'Default',
    description: 'Original Similer test bank.',
    words: wordBankData.words,
  },
  {
    id: 'everyday',
    name: 'Everyday',
    description: 'Familiar objects, places, people, and routines.',
    words: parseWordList(everydayWords),
  },
  {
    id: 'party',
    name: 'Party',
    description: 'Social, silly, music, snacks, and game-night words.',
    words: parseWordList(partyWords),
  },
  {
    id: 'legal',
    name: 'Legal',
    description: 'Courtroom, contract, and law-adjacent words.',
    words: parseWordList(legalWords),
  },
  {
    id: 'sports',
    name: 'Sports',
    description: 'Teams, equipment, rules, arenas, and competition.',
    words: parseWordList(sportsWords),
  },
  {
    id: 'food',
    name: 'Food',
    description: 'Ingredients, meals, snacks, drinks, and flavors.',
    words: parseWordList(foodWords),
  },
]

export function getWordPackById(packId) {
  return WORD_PACKS.find((pack) => pack.id === packId) ?? WORD_PACKS[0]
}
