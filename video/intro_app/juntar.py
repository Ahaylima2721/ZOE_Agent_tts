"""Junta os quadros gravados nos tempos reais do vídeo com a narração -> build/zoe_apresentacao.mp4 (1080x1920, 30 fps, -14 LUFS)."""
import json, pathlib, subprocess
B = pathlib.Path(__file__).parent / "build"
j = json.loads((B / "frames.json").read_text())
t0, R = j["t0"] / 1000, j["R"]
total = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(B / "narracao.wav")],
                             capture_output=True, text=True).stdout)
qs = [(n, (ts - t0) * R) for n, ts in j["frames"]]
qs = [q for q in qs if q[1] >= -0.5]
linhas = []
for k, (n, t) in enumerate(qs):
    fim = qs[k + 1][1] if k + 1 < len(qs) else total
    t = max(t, 0)
    if fim <= t:
        continue
    linhas += [f"file 'frames/{n}'", f"duration {fim - t:.4f}"]
linhas.append(f"file 'frames/{qs[-1][0]}'")
(B / "lista.txt").write_text("\n".join(linhas))
out = B / "zoe_apresentacao.mp4"
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(B / "lista.txt"),
                "-i", str(B / "narracao.wav"),
                "-vf", "fps=30,scale=1080:1920,format=yuv420p", "-c:v", "libx264", "-preset", "medium", "-crf", "19",
                "-af", "loudnorm=I=-14:TP=-1.5:LRA=11", "-c:a", "aac", "-b:a", "160k", "-ar", "48000",
                "-t", f"{total:.3f}", "-movflags", "+faststart", str(out)], check=True)
print(out, round(total, 1), "s")
