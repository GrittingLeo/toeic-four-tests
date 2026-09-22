"""Cut 216 standalone question/group clips from the supplied original recordings."""
from pathlib import Path
import json
import math
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tmp/asr-deps'))
import av

index_path = ROOT / 'web/data/audio.json'
index = json.loads(index_path.read_text(encoding='utf8'))
for test, data in index.items():
    for number, cue in data['groups'].items():
        relative = f'media/clips/test{test}/q{int(number):03}.mp3'
        target = ROOT / 'web' / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        source = av.open(f'E:/BaiduNetdiskDownload/Actual Test {test}.mp3')
        input_stream = source.streams.audio[0]
        source.seek(int(max(0, cue['start'] - 1) / input_stream.time_base), stream=input_stream)
        output = av.open(str(target), 'w')
        stream = output.add_stream('libmp3lame', rate=44100)
        stream.bit_rate = 64000
        stream.layout = 'mono'
        resampler = av.AudioResampler(format='fltp', layout='mono', rate=44100)
        samples = 0
        for frame in source.decode(audio=0):
            time = float(frame.time)
            if time >= cue['end']:
                break
            left = max(0, math.ceil((cue['start'] - time) * frame.sample_rate))
            right = min(frame.samples, math.ceil((cue['end'] - time) * frame.sample_rate))
            if right <= left:
                continue
            # MP3 decoding is planar floating point; preserve the source channels.
            chunk = av.AudioFrame.from_ndarray(frame.to_ndarray()[:, left:right].copy(), format=frame.format.name, layout=frame.layout.name)
            chunk.sample_rate = frame.sample_rate
            for converted in resampler.resample(chunk):
                converted.pts = samples
                samples += converted.samples
                for packet in stream.encode(converted):
                    output.mux(packet)
        for converted in resampler.resample(None):
            converted.pts = samples
            samples += converted.samples
            for packet in stream.encode(converted):
                output.mux(packet)
        for packet in stream.encode(None):
            output.mux(packet)
        output.close()
        source.close()
        actual = samples / 44100
        assert abs(actual - (cue['end'] - cue['start'])) < .15, (test, number, actual, cue)
        cue['src'] = relative
        cue['duration'] = round(actual, 3)
    print(f'Test {test}: {len(data["groups"])} clips encoded and duration-checked', flush=True)
index_path.write_text(json.dumps(index, separators=(',', ':')), encoding='utf8')
