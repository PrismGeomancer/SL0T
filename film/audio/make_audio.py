#!/usr/bin/env python3
"""Procedural sound for the SL0T launch film (no samples, no network): hum, ratchet ticks tied to the reel
schedule, lever, bulb pop, bell, coins, pad. Writes film/audio/mix.wav (44.1 kHz stereo, 16 bit).
The reel schedule below is a line-for-line port of the one in film/index.html, so ticks land on the real reel motion."""
import math, random, struct, wave, sys, os

SR = 44100
DUR = 20.0
N = int(SR * DUR)
L = [0.0] * N
R = [0.0] * N
rnd = random.Random(7)

def put(start, sig, gain=1.0, pan=0.0):
    i0 = int(start * SR)
    gl = gain * math.cos((pan + 1) * math.pi / 4)
    gr = gain * math.sin((pan + 1) * math.pi / 4)
    for k, v in enumerate(sig):
        i = i0 + k
        if i < 0: continue
        if i >= N: break
        L[i] += v * gl
        R[i] += v * gr

def env_exp(n, tau):
    return [math.exp(-k / (SR * tau)) for k in range(n)]

def sine(freq, dur, phase=0.0):
    n = int(dur * SR)
    return [math.sin(2 * math.pi * freq * k / SR + phase) for k in range(n)]

def noise(dur):
    return [rnd.uniform(-1, 1) for _ in range(int(dur * SR))]

def lowpass(x, fc):
    a = 1 - math.exp(-2 * math.pi * fc / SR)
    y = []; s = 0.0
    for v in x:
        s += a * (v - s); y.append(s)
    return y

def highpass(x, fc):
    lp = lowpass(x, fc)
    return [v - l for v, l in zip(x, lp)]

def mul(a, b):
    return [x * y for x, y in zip(a, b)]

def fade(x, a=0.005, b=0.01):
    n = len(x); na = int(a * SR); nb = int(b * SR)
    for k in range(min(na, n)): x[k] *= k / na
    for k in range(min(nb, n)): x[n - 1 - k] *= k / nb
    return x

# ------------------------------------------------------------------ reel schedule (port of index.html)
Nn = 8; STEP = 2 * math.pi / Nn; TAU = 2 * math.pi
def angle_for(idx): return (idx + 0.5) * STEP
def decel(k):
    c1 = 1.25; c3 = c1 + 1
    return 1 + c3 * (k - 1) ** 3 + c1 * (k - 1) ** 2
V = 15.0; RAMP = 0.3
def spin_disp(u):
    if u <= 0: return 0.0
    if u < RAMP: return V * u * u / (2 * RAMP)
    return V * RAMP / 2 + V * (u - RAMP)
PULL1, PULL2 = 0.98, 13.62
START = [0, 2, 1]
STOP1 = [(7.30, .70, 0), (7.70, .70, 2), (8.10, .75, 1)]
STOP2 = [(14.45, .60, 0), (14.85, .65, 0), (15.25, .75, 0)]
def plan(i):
    A0 = angle_for(START[i])
    t1, d1, x1 = STOP1[i]; th1 = A0 + spin_disp(t1 - PULL1)
    m1 = round((th1 + V * d1 / 4.25 - angle_for(x1)) / TAU); T1 = angle_for(x1) + TAU * m1
    t2, d2, x2 = STOP2[i]; th2 = T1 + spin_disp(t2 - PULL2)
    m2 = round((th2 + V * d2 / 4.25 - angle_for(x2)) / TAU); T2 = angle_for(x2) + TAU * m2
    return dict(A0=A0, th1=th1, T1=T1, th2=th2, T2=T2, s1=(t1, d1), s2=(t2, d2))
PL = [plan(i) for i in range(3)]
def theta(i, t):
    p = PL[i]
    if t < PULL1: return p['A0']
    if t < p['s1'][0]: return p['A0'] + spin_disp(t - PULL1)
    if t < p['s1'][0] + p['s1'][1]: return p['th1'] + (p['T1'] - p['th1']) * decel((t - p['s1'][0]) / p['s1'][1])
    if t < PULL2: return p['T1']
    if t < p['s2'][0]: return p['T1'] + spin_disp(t - PULL2)
    if t < p['s2'][0] + p['s2'][1]: return p['th2'] + (p['T2'] - p['th2']) * decel((t - p['s2'][0]) / p['s2'][1])
    return p['T2']

# ------------------------------------------------------------------ voices
def click(freq=2400, tau=0.004, dur=0.03):
    n = int(dur * SR)
    x = noise(dur)
    x = highpass(x, 900)
    e = env_exp(n, tau)
    body = [math.sin(2 * math.pi * freq * k / SR) for k in range(n)]
    return [(a * 0.7 + b * 0.5) * c for a, b, c in zip(x, body, e)]

def thunk(f0=95, f1=42, dur=0.35, grit=0.25):
    n = int(dur * SR); out = []; ph = 0.0
    for k in range(n):
        f = f1 + (f0 - f1) * math.exp(-k / (SR * 0.05))
        ph += 2 * math.pi * f / SR
        out.append(math.sin(ph) * math.exp(-k / (SR * dur / 3.2)) + grit * rnd.uniform(-1, 1) * math.exp(-k / (SR * 0.012)))
    return fade(out, 0.001, 0.02)

def clank(dur=0.5):
    n = int(dur * SR); out = [0.0] * n
    for f, a in [(612, 1), (1033, .8), (1779, .6), (2713, .4), (3911, .25)]:
        for k in range(n):
            out[k] += a * math.sin(2 * math.pi * f * (1 + rnd.uniform(-.002, .002)) * k / SR) * math.exp(-k / (SR * 0.11))
    return [v * 0.25 for v in out]

def whoosh(dur=0.5, f_from=300, f_to=4200, up=True):
    n = int(dur * SR); x = noise(dur); out = []; s = 0.0
    for k in range(n):
        u = k / n
        fc = f_from + (f_to - f_from) * (u if up else 1 - u)
        a = 1 - math.exp(-2 * math.pi * fc / SR)
        s += a * (x[k] - s)
        env = math.sin(math.pi * u) ** 1.5
        out.append(s * env * 2.2)
    return out

def bell(freq, dur=1.6, bright=1.0):
    n = int(dur * SR); out = [0.0] * n
    for ratio, a, tau in [(1, 1, .9), (2.0, .55, .5), (2.76, .5, .35), (4.07, .35 * bright, .22), (5.4, .22 * bright, .15)]:
        f = freq * ratio
        for k in range(n):
            out[k] += a * math.sin(2 * math.pi * f * k / SR) * math.exp(-k / (SR * tau))
    return fade([v * 0.35 for v in out], 0.001, 0.05)

def pluck(freq, dur=0.22):
    n = int(dur * SR)
    return fade([(math.sin(2 * math.pi * freq * k / SR) * .7 + math.sin(2 * math.pi * freq * 2 * k / SR) * .2) * math.exp(-k / (SR * 0.06)) for k in range(n)], 0.001, 0.02)

def pad(freqs, dur, atk=1.0, rel=1.2, vib=0.0):
    n = int(dur * SR); out = [0.0] * n
    for f in freqs:
        for det in (-0.6, 0.0, 0.7):
            ff = f * (1 + det / 100)
            ph = rnd.uniform(0, 6.28)
            for k in range(n):
                out[k] += math.sin(2 * math.pi * ff * k / SR + ph + vib * math.sin(k / SR * 4.3))
    na, nr = int(atk * SR), int(rel * SR)
    for k in range(n):
        g = min(1.0, k / max(1, na)) * min(1.0, (n - k) / max(1, nr))
        out[k] *= g / (len(freqs) * 3)
    return out

# ------------------------------------------------------------------ bed: floor hum + neon buzz
def hum(t0, t1, gain, f=55.0, buzz=0.0):
    dur = t1 - t0; n = int(dur * SR)
    out = []
    for k in range(n):
        t = k / SR
        v = math.sin(2 * math.pi * f * t) * 0.8 + math.sin(2 * math.pi * f * 2 * t + 1) * 0.35 + math.sin(2 * math.pi * f * 3 * t) * 0.1
        if buzz: v += buzz * (math.sin(2 * math.pi * 120 * t) * 0.5 + math.sin(2 * math.pi * 240 * t) * 0.25 + 0.15 * rnd.uniform(-1, 1))
        out.append(v)
    return fade(out, 0.4, 0.4)

put(0.0, hum(0.0, 8.86, 1, 55, 0.0), 0.10)
put(8.86, hum(8.86, 13.4, 1, 48, 0.0), 0.08)
put(13.4, hum(13.4, 17.6, 1, 55, 0.0), 0.11)
put(17.6, hum(17.6, 20.0, 1, 55, 0.35), 0.10)

# ------------------------------------------------------------------ lever, whips
def lever(t_down, g=1.0):
    put(t_down - 0.16, whoosh(0.18, 200, 900), 0.18 * g)      # anticipation creak (air)
    put(t_down + 0.16, thunk(110, 46, 0.4), 0.9 * g)
    put(t_down + 0.16, clank(0.5), 0.6 * g, 0.2)
    put(t_down + 0.4, clank(0.3), 0.18 * g, -0.2)             # spring back

lever(0.9)
lever(13.5)
put(1.0, whoosh(0.55, 250, 5200), 0.55)      # hook whip
put(13.62, whoosh(0.5, 250, 5200), 0.55)

# ------------------------------------------------------------------ ratchet ticks tied to reel motion
def ticks(i, t0, t1, gain, pan):
    dt = 0.0005; prev = int(math.floor(theta(i, t0) / STEP)); t = t0 + dt
    last = -1
    while t < t1:
        c = int(math.floor(theta(i, t) / STEP))
        if c != prev:
            if t - last > 0.012:   # a whirr, not a buzz: skip ticks closer than 12 ms
                put(t, click(2200 + 300 * i + rnd.uniform(-120, 120), 0.003), gain * (0.8 + 0.4 * rnd.random()), pan)
                last = t
            prev = c
        t += dt

for i, pan in enumerate([-0.35, 0.0, 0.35]):
    ticks(i, PULL1, 9.0, 0.16, pan)
    ticks(i, PULL2, 16.2, 0.16, pan)

# reel stops
for t, g, pan in [(8.0, .55, -.3), (8.4, .55, 0), (8.85, .7, .3), (15.05, .6, -.3), (15.5, .6, 0), (16.0, .8, .3)]:
    put(t, thunk(150, 70, 0.22, 0.4), g, pan)

# ------------------------------------------------------------------ MISS: pop, power sag, buzzer, slam
put(8.86, click(4200, 0.006, 0.08), 0.9)
put(8.86, thunk(210, 60, 0.5, 0.5), 0.55)
def buzz_down(dur=0.7):
    n = int(dur * SR); out = []; ph = 0.0
    for k in range(n):
        f = 140 - 70 * (k / n)
        ph += 2 * math.pi * f / SR
        saw = ((ph / (2 * math.pi)) % 1.0) * 2 - 1
        out.append(saw * math.exp(-k / (SR * 0.45)))
    return lowpass(out, 900)
put(8.9, buzz_down(), 0.5)
put(8.9 + 0.1, thunk(70, 34, 0.7, 0.15), 0.8)       # MISS slam sub

# ------------------------------------------------------------------ UI: cards, counters, press
put(3.4, whoosh(0.35, 400, 5000), 0.45)
put(10.73, whoosh(0.35, 400, 5000, up=False), 0.45)
for k in range(24):                                  # countdown ticks, slowing
    t = 3.5 + 0.12 * k ** 1.18
    if t < 7.3: put(t, click(3000, 0.002, 0.02), 0.09, 0.3)
for k in range(10):                                  # rematch amount steps 0.1 -> 0.2
    put(11.6 + 0.03 * k, click(3400 + 70 * k, 0.002, 0.02), 0.11, -0.3)
put(13.23, click(1900, 0.006, 0.05), 0.5, -0.2)      # mouse press
put(13.23, thunk(260, 150, 0.1, 0.1), 0.2, -0.2)

# words
for t in [0.17, 0.31, 0.47]:
    put(t, click(1500, 0.01, 0.05), 0.2)
for t in [2.0, 2.18, 2.38]:
    put(t, click(1700, 0.01, 0.05), 0.16)
for t in [9.9, 10.05, 10.2]:
    put(t, click(1500, 0.01, 0.05), 0.18)
for t in [18.53, 18.63, 18.73, 18.87, 19.0]:
    put(t, click(1450, 0.012, 0.05), 0.18)

# ------------------------------------------------------------------ HIT
put(15.96, [0.0] * 10, 0)
put(16.0, thunk(80, 30, 1.2, 0.2), 1.0)
put(16.0, highpass(noise(1.2), 3000), 0.0)
cym = [v * math.exp(-k / (SR * 0.5)) for k, v in enumerate(highpass(noise(1.4), 4000))]
put(16.0, cym, 0.22)
for k, f in enumerate([880, 1318.5, 1760, 2637]):
    put(16.02 + 0.06 * k, bell(f, 1.8), 0.34, -0.3 + 0.2 * k)
put(16.0, bell(440, 2.4, 0.4), 0.3)
# coin clinks fall away after the fountain
t = 16.1
while t < 18.6:
    f = rnd.choice([2900, 3600, 4300, 5100])
    put(t, bell(f, 0.35, 1.0), 0.08 + 0.08 * math.exp(-(t - 16) / 1.1), rnd.uniform(-.7, .7))
    t += rnd.uniform(0.04, 0.16) * (1 + (t - 16) * 0.5)

# ------------------------------------------------------------------ music: pad + pulse + sparkle
A2, E3, A3, C4, E4, G4, B3 = 110.0, 164.81, 220.0, 261.63, 329.63, 392.0, 246.94
put(0.2, pad([A2, E3, A3], 3.3, 2.2, 0.4), 0.16)                    # hook: low Am swell
def pulse(t0, t1, rate, notes, gain):
    t = t0; i = 0
    while t < t1:
        f = notes[i % len(notes)]
        put(t, pluck(f, 0.18), gain * (0.65 + 0.35 * ((i % 4) == 0)), -0.4 if i % 2 else 0.4)
        t += 1.0 / rate; i += 1
pulse(3.4, 7.3, 8.0, [220, 261.63, 329.63, 392, 329.63, 261.63, 196, 261.63], 0.13)   # proof 1: the clock runs
put(3.4, pad([A2, E3, A3, C4], 4.1, 0.6, 0.9), 0.14)
put(7.3, pad([A2, E3, 233.08], 1.6, 0.3, 0.6), 0.14)                  # slowing, a half-step off
# sag after the miss: bare, a little sad
put(9.3, pad([73.4, 110.0, 130.8], 3.8, 1.2, 1.0, vib=0.3), 0.12)
# rematch: pad opens up, heartbeat
put(10.8, pad([A2, 220, 329.63], 2.7, 1.0, 0.3), 0.12)
for k in range(14):
    t = 10.9 + k * (0.52 - 0.012 * k)
    if t < 13.3:
        put(t, thunk(75, 42, 0.18, 0.05), 0.35)
        put(t + 0.17, thunk(70, 42, 0.14, 0.05), 0.2)
# second pull: arps accelerate into the landing
pulse(14.45, 16.0, 10.0, [261.63, 329.63, 392, 523.25, 392, 329.63], 0.12)
put(13.8, pad([A2, E3, A3, C4], 2.2, 1.2, 0.1), 0.12)
# the resolve: C major, warm, then thinner
put(16.0, pad([130.81, 196.0, 261.63, 329.63, 392.0, 493.88], 4.0, 0.05, 2.2), 0.20)
put(17.9, pad([261.63, 392.0, 523.25], 2.1, 0.4, 1.4), 0.10)
# end: lights stay on (last bell, small)
put(19.0, bell(1046.5, 1.0, 0.5), 0.14, 0.1)

# ------------------------------------------------------------------ accents on the cuts that matter
for t, g in [(3.4, .55), (7.73, .3), (9.07, .35), (10.73, .55), (13.33, .5), (17.6, .6)]:
    put(t, thunk(120, 52, 0.28, 0.2), g)
    put(t, click(2600, 0.004, 0.04), g * 0.5)
put(17.6, bell(523.25, 1.6, 0.4), 0.22)

# ------------------------------------------------------------------ master
peak = max(max(abs(v) for v in L), max(abs(v) for v in R))
target = 0.89
scale = target / peak if peak > 0 else 1.0
# soft limiter-ish: tanh knee, then trim
out = []
for i in range(N):
    l = math.tanh(L[i] * scale * 1.15) / math.tanh(1.15)
    r = math.tanh(R[i] * scale * 1.15) / math.tanh(1.15)
    # last 0.4 s fade (film ends in motion, sound leaves with it)
    tt = i / SR
    f = 1.0 if tt < DUR - 0.4 else max(0.0, (DUR - tt) / 0.4)
    for d0, d1 in [(8.70, 8.85), (15.84, 15.995)]:
        if d0 - 0.03 <= tt < d1:
            f *= 0.18 if tt >= d0 else 1 - 0.82 * (tt - (d0 - 0.03)) / 0.03
    out.append(int(max(-1, min(1, l * f)) * 32000)); out.append(int(max(-1, min(1, r * f)) * 32000))
path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'mix.wav')
with wave.open(path, 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes(struct.pack('<' + 'h' * len(out), *out))
print('wrote', path, 'peak(pre)=%.3f' % peak)
