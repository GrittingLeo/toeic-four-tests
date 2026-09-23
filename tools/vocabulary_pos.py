"""Apply reviewed, term-keyed POS annotations without changing glossary IDs/text."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VALID_POS = {'n', 'v', 'adj', 'adv', 'prep', 'nounPhrase', 'verbPhrase',
             'adjPhrase', 'advPhrase', 'prepPhrase', 'conjPhrase', 'expression'}


def annotate_vocabulary(words):
    annotations = json.loads((ROOT / 'tools/vocabulary-pos.json').read_text(encoding='utf8'))
    for word in words:
        annotation = annotations.get(word['term'])
        if not annotation or not annotation['pos'] or not set(annotation['pos']) <= VALID_POS:
            raise ValueError(f'Missing/invalid reviewed part of speech: {word["term"]}')
        word['pos'] = annotation['pos']
        if annotation.get('note'):
            word['posNote'] = annotation['note']
    return words


if __name__ == '__main__':
    path = ROOT / 'web/data/vocabulary.json'
    words = annotate_vocabulary(json.loads(path.read_text(encoding='utf8')))
    path.write_text(json.dumps(words, ensure_ascii=False, separators=(',', ':')), encoding='utf8')
    print(f'Annotated {len(words)} glossary entries; original IDs and meanings preserved.')
