"""Junta os quadros gravados nos tempos reais com a narração (−14 LUFS) e gera evolucao.mp4."""
import json, sys, subprocess, pathlib
W = pathlib.Path(sys.argv[1]); m = json.loads((W / "frames_evo.json").read_text())
t0, R, fr = m["t0"] / 1000, m["R"], m["frames"]
tempos = [((ts - t0) * R, n) for n, ts in fr]
tempos = [(max(0.0, t), n) for t, n in tempos if t > -0.5]
total = json.loads((W / "evolucao.html").read_text().split("const FILME = ", 1)[1].split(";\n", 1)[0])["total"]
lin = []
for i, (t, n) in enumerate(tempos):
    fim = tempos[i + 1][0] if i + 1 < len(tempos) else total
    if fim > total: fim = total
    if fim - t <= 0: continue
    lin += [f"file 'frames_evo/{n}'", f"duration {fim - t:.4f}"]
    if fim >= total: break
lin.append(lin[-2])
(W / "lista_evo.txt").write_text("\n".join(lin) + "\n")
subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(W / "lista_evo.txt"),
    "-i", str(W / "narracao_evo.wav"), "-vf", "fps=30,format=yuv420p", "-c:v", "libx264", "-preset", "slow", "-crf", "18",
    "-af", "loudnorm=I=-14:TP=-1.5:LRA=11", "-ar", "48000", "-c:a", "aac", "-b:a", "192k",
    "-t", f"{total:.3f}", "-movflags", "+faststart", str(W / "evolucao.mp4")], check=True)
print("ok", total)
