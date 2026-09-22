"""Restore Part 1/2 options verbatim from the book's extracted transcripts."""
import json
import re
from pathlib import Path


def listening_options(extra, number):
    markers = list(re.finditer(r'[（(]\s*([ABCD])\s*[）)]', extra))
    expected = list('ABCD' if number <= 6 else 'ABC')
    assert [m[1] for m in markers] == expected, (number, 'option markers')
    options = []
    for i, marker in enumerate(markers):
        end = markers[i + 1].start() if i + 1 < len(markers) else len(extra)
        text = re.sub(r'\s+', ' ', extra[marker.end():end]).strip()
        assert len(text) > 3 and not re.search(r'[\u4e00-\u9fff]', text), (number, text)
        options.append({'key': marker[1], 'text': text})
    return options


if __name__ == '__main__':
    root = Path(__file__).resolve().parents[1]
    for test in range(1, 5):
        path = root / f'web/data/test{test}.json'
        bank = json.loads(path.read_text(encoding='utf8'))
        for question in bank['questions'][:31]:
            question['options'] = listening_options(question['extra'], question['number'])
        path.write_text(json.dumps(bank, ensure_ascii=False, separators=(',', ':')), encoding='utf8')
        print(f'Test {test}: 31 listening questions restored from book transcripts')
