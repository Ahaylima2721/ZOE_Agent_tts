"""Pega o WAV que o audio.synthesize salvou e converte para mono 24 kHz em audio/<nome>.wav."""
import json, os, re, subprocess, sys
src, nome = sys.argv[1], sys.argv[2]
arr = json.load(open(src))
wav = next(re.search(r"saved to (\S+\.wav)", x["text"]).group(1) for x in arr if "saved to" in x["text"])
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "audio", nome + ".wav")
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", wav, "-ac", "1", "-ar", "24000", "-sample_fmt", "s16", out], check=True)
dur = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", out], capture_output=True, text=True).stdout.strip()
print(nome, "ok", round(float(dur), 2), "s")
