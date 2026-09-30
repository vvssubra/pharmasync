"""Synthesises the 60 s, 120 BPM showreel score (music.wav). Every hit is placed on
the same beat grid the animation cuts to. Requires numpy."""
import numpy as np, wave
SR = 44100; DUR = 60.0; N = int(SR * DUR); BEAT = 0.5
rng = np.random.default_rng(3)
L = np.zeros(N); R = np.zeros(N)

def add(sig, t0, gain=1.0, pan=0.0):
    i = int(t0 * SR)
    if i >= N: return
    sig = sig[: N - i]
    L[i:i + len(sig)] += sig * gain * np.sqrt(0.5 * (1 - pan))
    R[i:i + len(sig)] += sig * gain * np.sqrt(0.5 * (1 + pan))

def tt(d): return np.arange(int(d * SR)) / SR

def lowpass(x, fc):
    X = np.fft.rfft(x); f = np.fft.rfftfreq(len(x), 1 / SR)
    return np.fft.irfft(X / np.sqrt(1 + (f / fc) ** 4), len(x))

def highpass(x, fc):
    X = np.fft.rfft(x); f = np.fft.rfftfreq(len(x), 1 / SR)
    return np.fft.irfft(X * (1 - 1 / np.sqrt(1 + (f / fc) ** 4)), len(x))

def kick(d=0.45):
    t = tt(d); f = 45 + 110 * np.exp(-t * 28)
    ph = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(ph) * np.exp(-t * 7) + 0.3 * np.exp(-t * 300) * rng.standard_normal(len(t))

def clap(d=0.25):
    t = tt(d); n = highpass(rng.standard_normal(len(t)), 1200)
    env = np.exp(-t * 22) * (1 + 0.6 * (np.sin(2 * np.pi * 90 * t) > 0) * (t < .03))
    return n * env * 0.5 + np.sin(2 * np.pi * 190 * t) * np.exp(-t * 30) * 0.3

def hat(d=0.06, open_=False):
    t = tt(0.22 if open_ else d); n = highpass(rng.standard_normal(len(t)), 7000)
    return n * np.exp(-t * (14 if open_ else 70))

def blip(freq, d=0.12):
    t = tt(d); return np.sin(2 * np.pi * freq * t) * np.exp(-t * 30)

def boom(d=2.2):
    t = tt(d); f = 32 + 60 * np.exp(-t * 6)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 2.2) + lowpass(rng.standard_normal(len(t)), 900) * np.exp(-t * 5) * 0.5

def riser(d):
    t = tt(d); u = t / d
    n = rng.standard_normal(len(t))
    lo, hi = lowpass(n, 600), highpass(n, 2500)
    return (lo * (1 - u) + hi * u) * u ** 2.2 * 0.6

def whoosh(d=0.6):
    t = tt(d); u = t / d
    return lowpass(rng.standard_normal(len(t)), 2500) * np.sin(np.pi * u) ** 2 * 0.5

def saw(freq, d, harm=10, detune=0.0):
    t = tt(d); out = np.zeros(len(t))
    for k in range(1, harm + 1):
        out += np.sin(2 * np.pi * k * freq * (1 + detune) * t) / k
    return out

def note(n): return 440 * 2 ** ((n - 69) / 12)

# ---- harmony: Am  F  C  G  (one chord per 2 s bar) ----
PROG = [(45, [57, 60, 64]), (41, [57, 60, 65]), (48, [55, 60, 64]), (43, [55, 59, 62])]
def chord_at(bar): return PROG[bar % 4]

# ---- sidechain envelope from kick times ----
kicks = []
for b in np.arange(0, 60, BEAT):
    if 2.0 <= b < 5.5: kicks.append(b)            # word hits
    elif 6.0 <= b < 58.5 and not (41.0 <= b < 42.0): kicks.append(b)
duck = np.ones(N)
for k in kicks:
    i = int(k * SR); t = tt(0.35); env = 1 - 0.75 * np.exp(-t * 14)
    duck[i:i + len(t)] = np.minimum(duck[i:i + len(t)], env[: N - i])

# ---- drone / pad ----
pad = np.zeros(N)
for bar in range(30):
    t0 = bar * 2.0
    root, ch = chord_at(bar)
    seg = np.zeros(int(2.0 * SR))
    for n_ in ch:
        for dt in (-0.004, 0.0, 0.005):
            seg += saw(note(n_), 2.0, harm=6, detune=dt)
    env = np.minimum(1, tt(2.0) / 0.25) * np.minimum(1, (2.0 - tt(2.0)) / 0.25)
    seg *= env
    gain = 0.018 if t0 < 6 else 0.03
    i = int(t0 * SR); pad[i:i + len(seg)] += seg[: N - i] * gain
pad = lowpass(pad, 1800)
# intro drone (sub A)
t = tt(6.0); drone = np.sin(2 * np.pi * 55 * t) * np.minimum(1, t / 1.5) * 0.25
pad[: len(drone)] += drone

# ---- bass: 8th notes, from 6 s ----
bass = np.zeros(N)
for bar in range(3, 29):
    root, _ = chord_at(bar)
    for e in range(8):
        t0 = bar * 2.0 + e * 0.25
        if 41.0 <= t0 < 42.0: continue
        oct_ = 12 if e in (3, 7) else 0
        s = saw(note(root - 12 + oct_), 0.23, harm=8)
        s *= np.exp(-tt(0.23) * 6) * np.minimum(1, tt(0.23) / 0.005)
        i = int(t0 * SR); bass[i:i + len(s)] += s[: N - i] * 0.22
bass = lowpass(bass, 700)

# ---- arp (plucks) in the later half for lift ----
arp = np.zeros(N)
for bar in range(8, 28):
    root, ch = chord_at(bar)
    seq = ch + [ch[0] + 12]
    for e in range(8):
        t0 = bar * 2.0 + e * 0.25
        if 41.0 <= t0 < 42.0: continue
        f = note(seq[e % 4] + 12)
        s = saw(f, 0.2, harm=5) * np.exp(-tt(0.2) * 18)
        i = int(t0 * SR); arp[i:i + len(s)] += s[: N - i] * (0.05 if bar < 17 else 0.07)
arp = lowpass(arp, 3500)

mus = pad * duck + bass * duck + arp * duck
L += mus; R += mus
# stereo width on arp
add(arp * duck * 0.3, 0.012, 1.0, 0.8)

# ---- drums ----
for k in kicks: add(kick(), k, 0.9)
for b in np.arange(16.0, 58.5, BEAT):
    if 41.0 <= b < 42.0: continue
    beat_idx = int(round(b / BEAT))
    if beat_idx % 2 == 1: add(clap(), b, 0.55)
for b in np.arange(10.0, 58.5, BEAT / 2):
    if 41.0 <= b < 42.0: continue
    off = int(round(b / (BEAT / 2))) % 2 == 1
    add(hat(open_=off and b >= 24), b, 0.12 if off else 0.06, pan=0.3 if off else -0.3)
# word hits in the cold open
for i, b in enumerate(np.arange(2.0, 5.5, BEAT)):
    add(blip(note(81 + (i % 2) * 7)), b, 0.25)
add(blip(note(69), .25), 0.5, 0.15); add(blip(note(76), .25), 1.0, 0.15)

# ---- risers, impacts, whooshes at cuts ----
cuts = [6.0, 10.0, 16.0, 24.0, 34.0, 42.0, 50.0, 56.0]
for c in cuts:
    add(riser(1.0 if c not in (6.0, 42.0, 50.0) else 2.0), c - (1.0 if c not in (6.0, 42.0, 50.0) else 2.0), 0.5)
for c in (6.0, 42.0, 50.0, 56.0): add(boom(), c, 0.8)
for c in (10.0, 16.0, 24.0, 34.0, 56.0): add(whoosh(), c - 0.3, 0.9)
add(boom(1.2), 27.5, 0.5)            # APPROVED stamp
add(whoosh(1.0), 40.9, 1.0)          # zoom through
add(clap(), 27.5, 0.6)
# final hit + tail
add(boom(3.0), 58.5, 0.9)
t = tt(1.5)
for n_ in (57, 64, 69, 72):
    add(np.sin(2 * np.pi * note(n_) * t) * np.exp(-t * 2.2) * 0.08, 58.5, 1.0)

# ---- simple reverb send ----
ir_t = tt(1.6); ir = rng.standard_normal(len(ir_t)) * np.exp(-ir_t * 3.2); ir /= np.sqrt(np.sum(ir ** 2))
def conv(x):
    n = len(x) + len(ir) - 1; nf = 1 << (n - 1).bit_length()
    return np.fft.irfft(np.fft.rfft(x, nf) * np.fft.rfft(ir, nf), nf)[: len(x)]
L += conv(L) * 0.18; R += conv(R) * 0.18

# ---- master ----
fade = np.ones(N); fi = int(59.4 * SR); fade[fi:] = np.linspace(1, 0, N - fi)
L *= fade; R *= fade
peak = max(np.abs(L).max(), np.abs(R).max())
L, R = L / peak * 1.4, R / peak * 1.4
L, R = np.tanh(L) / np.tanh(1.4), np.tanh(R) / np.tanh(1.4)
out = (np.stack([L, R], 1) * 0.89 * 32767).astype('<i2')
with wave.open('build/music.wav', 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(out.tobytes())
print('wrote build/music.wav')
