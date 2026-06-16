#!/usr/bin/env python3
import math, html as H

# ---- constants (constant across all modes) ----
relay=1.50; ai_cost=0.153; mpl=6; lpd=5; dseats=mpl*lpd; conv=0.05
adopt=0.3; ai_i=adopt*(0.28-ai_cost); ai_d=adopt*(0.40-ai_cost)
def stripe_mo(g): return (2*0.30+0.029*g*12)/12
def fixed(u):
    f=260
    for t,a in [(1500,20),(12500,10),(25000,70),(67000,40),(150000,60)]:
        if u>=t: f+=a
    return f

MODES=[
 dict(key="lean", name="Mode 1 — Lean / Benevolent", color="#1D9E75", tint="#E1F5EE", dark="#0F6E56",
      tag="Charge as little as we can and still survive.",
      phil="No profit motive. The point is to rip out the cost barrier for academics: a better notebook than anything on the market, at a price that is basically just keeping the lights on. If we only ever serve Wisconsin, this still works.",
      solo_floor=1, lab_flat=5, dept_flat=10, smk=3, lmk=2.75, dmk=2.5),
 dict(key="fund", name="Mode 2 — Fund-the-labs", color="#BA7517", tint="#FAEEDA", dark="#854F0B",
      tag="Enough margin to actually fund our labs and projects.",
      phil="Still far below market, but priced so that at real scale (hundreds to thousands of paying users) it throws off tens to hundreds of thousands a year, money that goes straight back into Grant's and Emile's labs. A service that pays for the science it serves.",
      solo_floor=3, lab_flat=12, dept_flat=25, smk=5, lmk=4.5, dmk=4),
 dict(key="prem", name="Mode 3 — Premium (academic)", color="#7F77DD", tint="#EEEDFE", dark="#3C3489",
      tag="Real profit, still nowhere near what a private company charges.",
      phil="GitHub-Enterprise logic: we charge a genuine premium for the value, and reinvest the profit into the labs. Even here a seat is a small fraction of the tools it replaces (LabArchives alone is $27.50/user/mo). Better product, dramatically cheaper. We never price like a private company.",
      solo_floor=6, lab_flat=25, dept_flat=50, smk=8, lmk=7, dmk=6),
]

def seats_net(m,w=0.2):
    g=m["solo_floor"]+w*relay*m["smk"]; solo=g-w*relay-stripe_mo(g)+ai_i
    gL=m["lab_flat"]+mpl*w*relay*m["lmk"]; lab=(gL-mpl*w*relay-stripe_mo(gL)+mpl*ai_i)/mpl
    gD=m["dept_flat"]*lpd+dseats*w*relay*m["dmk"]; dept=(gD-dseats*w*relay-stripe_mo(gD)+dseats*ai_d)/dseats
    return solo,lab,dept
def blended(m,w=0.2):
    s,l,d=seats_net(m,w); return 0.4*s+0.4*l+0.2*d
def break_even(m):
    bn=blended(m)
    for U in range(100,4000000,100):
        if U*conv*bn>=fixed(U): return U
    return None
def net(m,U): return U*conv*blended(m)-fixed(U)
def solo_months_to5(m,w):
    bill=m["solo_floor"]+w*relay*m["smk"]; return 5.0/bill
def composition(m,U=50000):
    paid=U*conv
    base=(0.4*m["solo_floor"]+0.4*(m["lab_flat"]/mpl)+0.2*(m["dept_flat"]*lpd/dseats))*paid
    w=0.2
    act=(0.4*w*relay*(m["smk"]-1)+0.4*w*relay*(m["lmk"]-1)+0.2*w*relay*(m["dmk"]-1))*paid
    ai=(0.4*ai_i+0.4*ai_i+0.2*ai_d)*paid
    return base,act,ai

# ---------- SVG chart helpers ----------
MUT="#5F5E5A"; DK="#2C2C2A"; TRK="#F1EFE8"; GRD="#E5E3DB"; BX="#D3D1C7"
def esc(s): return H.escape(str(s))

def hbars(rows, maxv, unit, color, w=620, rowh=30, lab_w=130, val_w=92):
    # rows: list of (label, value, display)
    h=len(rows)*rowh+10
    p=[f'<svg viewBox="0 0 {w} {h}" width="100%" style="max-width:{w}px">']
    bx0=lab_w; bxw=w-lab_w-val_w
    for i,(lab,val,disp) in enumerate(rows):
        y=i*rowh+8; cy=y+11
        p.append(f'<text x="{lab_w-10}" y="{cy+4}" font-size="12.5" fill="{MUT}" text-anchor="end">{esc(lab)}</text>')
        p.append(f'<rect x="{bx0}" y="{y}" width="{bxw}" height="20" rx="5" fill="{TRK}"/>')
        bw=max(3, bxw*min(1,val/maxv))
        p.append(f'<rect x="{bx0}" y="{y}" width="{bw:.1f}" height="20" rx="5" fill="{color}"/>')
        p.append(f'<text x="{w-val_w+8}" y="{cy+4}" font-size="12.5" fill="{DK}" font-weight="500">{esc(disp)}</text>')
    p.append('</svg>'); return "".join(p)

def line_be(m, color, w=620, h=240):
    paid_max=2500; padL=64; padR=16; padT=14; padB=34
    W=w-padL-padR; Hh=h-padT-padB
    pts=[(p, net(m, p/conv)) for p in range(0,paid_max+1,50)]
    ys=[v for _,v in pts]; ymin=min(ys+[0]); ymax=max(ys+[1])
    def X(pd): return padL+W*pd/paid_max
    def Y(v): return padT+Hh*(1-(v-ymin)/(ymax-ymin))
    be=break_even(m); be_paid=be*conv
    s=[f'<svg viewBox="0 0 {w} {h}" width="100%" style="max-width:{w}px">']
    # zero line
    zy=Y(0); s.append(f'<line x1="{padL}" y1="{zy:.1f}" x2="{w-padR}" y2="{zy:.1f}" stroke="{BX}" stroke-dasharray="3 3"/>')
    # profit zone shade (right of break-even, above zero)
    bx=X(be_paid)
    s.append(f'<rect x="{bx:.1f}" y="{padT}" width="{w-padR-bx:.1f}" height="{zy-padT:.1f}" fill="{color}" opacity="0.08"/>')
    # net curve
    d="M "+" L ".join(f"{X(pd):.1f} {Y(v):.1f}" for pd,v in pts)
    s.append(f'<path d="{d}" fill="none" stroke="{color}" stroke-width="2.5"/>')
    # break-even marker
    s.append(f'<line x1="{bx:.1f}" y1="{padT}" x2="{bx:.1f}" y2="{h-padB}" stroke="{color}" stroke-width="1.5" stroke-dasharray="4 3"/>')
    s.append(f'<text x="{bx+6:.1f}" y="{padT+14}" font-size="12" fill="{DK}" font-weight="500">break even ~{int(round(be_paid/10)*10):,} paying</text>')
    # axes labels
    for pd in (0,500,1000,1500,2000,2500):
        s.append(f'<text x="{X(pd):.1f}" y="{h-12}" font-size="11" fill="{MUT}" text-anchor="middle">{pd:,}</text>')
    s.append(f'<text x="{padL}" y="{Y(ymax)-2:.1f}" font-size="11" fill="{MUT}">${ymax:,.0f}/mo</text>')
    s.append(f'<text x="{padL}" y="{zy-3:.1f}" font-size="11" fill="{MUT}">$0</text>')
    s.append(f'<text x="{w/2:.0f}" y="{h-1}" font-size="11" fill="{MUT}" text-anchor="middle">paying users</text>')
    s.append('</svg>'); return "".join(s)

def comp_bar(m, w=620):
    base,act,ai=composition(m); tot=base+act+ai
    segs=[("Base + flat fees",base,"#378ADD"),("Activity markup",act,"#1D9E75"),("AI margin",ai,"#7F77DD")]
    s=[f'<svg viewBox="0 0 {w} 46" width="100%" style="max-width:{w}px">']
    x=0
    for lab,v,c in segs:
        bw=(w)*v/tot; s.append(f'<rect x="{x:.1f}" y="0" width="{bw:.1f}" height="22" fill="{c}"/>'); x+=bw
    s.append('</svg>')
    leg=['<div style="display:flex;flex-wrap:wrap;gap:14px;margin-top:8px;font-size:13px;color:#5F5E5A">']
    for lab,v,c in segs:
        leg.append(f'<span style="display:flex;align-items:center;gap:6px"><span style="width:11px;height:11px;border-radius:2px;background:{c}"></span>{lab} ${v:,.0f}/mo ({v/tot*100:.0f}%)</span>')
    leg.append('</div>')
    return "".join(s)+"".join(leg)

# ---------- build HTML ----------
def money(x): return f"${x:,.0f}"
def fmt_mo(months):
    if months>=12: return f"{months/12:.1f} yr"
    if months>=1: return f"{months:.1f} mo"
    d=months*30.44
    if d>=7: return f"{round(d/7)} wk"
    return f"{max(1,round(d))} days"

parts=[]
parts.append('''<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>ResearchOS pricing modes</title>
<style>
*{box-sizing:border-box}
body{margin:0;background:#faf9f6;color:#2C2C2A;font-family:-apple-system,Helvetica,Arial,sans-serif;line-height:1.6}
.wrap{max-width:880px;margin:0 auto;padding:40px 28px 80px}
h1{font-size:30px;font-weight:600;margin:0 0 6px}
h2{font-size:22px;font-weight:600;margin:0}
h3{font-size:15px;font-weight:600;color:#5F5E5A;margin:26px 0 8px;text-transform:none}
.sub{color:#5F5E5A;font-size:16px;margin:0 0 28px}
.card{background:#fff;border:1px solid #eceae3;border-radius:16px;padding:26px 28px;margin:22px 0}
.tag{font-size:15px;font-weight:500;margin:2px 0 0}
.phil{font-size:14.5px;color:#444;margin:10px 0 4px}
.pricing{display:flex;flex-wrap:wrap;gap:10px;margin:14px 0 6px}
.pill{font-size:13px;padding:5px 12px;border-radius:20px}
.kpis{display:flex;flex-wrap:wrap;gap:10px;margin:16px 0}
.kpi{background:#f6f5f0;border-radius:10px;padding:10px 14px;min-width:120px}
.kpi .l{font-size:12px;color:#5F5E5A}
.kpi .v{font-size:20px;font-weight:600}
table.cmp{width:100%;border-collapse:collapse;font-size:14px;margin-top:10px}
table.cmp th,table.cmp td{text-align:left;padding:9px 10px;border-bottom:1px solid #eceae3}
table.cmp th{color:#5F5E5A;font-weight:500}
table.cmp td.n{text-align:right;font-variant-numeric:tabular-nums}
.note{font-size:13px;color:#6b6a64}
.foot{font-size:13px;color:#6b6a64;border-top:1px solid #eceae3;margin-top:30px;padding-top:18px}
</style></head><body><div class="wrap">''')

parts.append('<h1>ResearchOS — three pricing modes</h1>')
parts.append('<p class="sub">Same product, same locked structure (a small base fee + usage at a markup, AI metered at near-cost, storage at cost). The only knobs that change between modes are the <b>base fee</b> and the <b>usage markup</b>. Three philosophies to choose from, depending on how ambitious we want to be. In every mode a seat costs a small fraction of the tools it replaces.</p>')

# summary table
parts.append('<div class="card"><h2>At a glance</h2><table class="cmp"><tr><th>Mode</th><th class="n">Typical seat / mo</th><th class="n">Break-even (paying)</th><th class="n">Net @ 50k users</th><th class="n">Net @ 100k users</th></tr>')
for m in MODES:
    s,l,d=seats_net(m); be=break_even(m)
    parts.append(f'<tr><td><b style="color:{m["dark"]}">{m["name"].split("—")[1].strip()}</b></td>'
                 f'<td class="n">${l:.2f}–${d:.2f}</td><td class="n">~{int(round(be*conv/10)*10):,}</td>'
                 f'<td class="n">{money(net(m,50000))}/mo</td><td class="n">{money(net(m,100000))}/mo</td></tr>')
parts.append('</table><p class="note">Annualized: Lean ~$43k/yr → Fund-labs ~$110k/yr → Premium ~$217k/yr at 50k users; roughly double those at 100k. Assumes 5% of users pay, a 40/40/20 solo/lab/dept split, ~6 seats/lab, typical usage. Reference: LabArchives alone is ~$27.50/user/mo ($330/yr); the bundle ResearchOS replaces is far more.</p></div>')

for m in MODES:
    s,l,d=seats_net(m); be=break_even(m); bn=blended(m)
    parts.append(f'<div class="card" style="border-top:3px solid {m["color"]}">')
    parts.append(f'<h2 style="color:{m["dark"]}">{esc(m["name"])}</h2>')
    parts.append(f'<p class="tag" style="color:{m["dark"]}">{esc(m["tag"])}</p>')
    parts.append(f'<p class="phil">{esc(m["phil"])}</p>')
    parts.append('<div class="pricing">')
    for lab2,txt in [("Solo",f'${m["solo_floor"]}/mo floor + {m["smk"]}× usage'),
                     ("Lab",f'${m["lab_flat"]} flat + {m["lmk"]}× usage'),
                     ("Dept",f'${m["dept_flat"]}/lab + {m["dmk"]}× usage')]:
        parts.append(f'<span class="pill" style="background:{m["tint"]};color:{m["dark"]}"><b>{lab2}</b> &nbsp;{txt}</span>')
    parts.append('</div>')
    # KPIs
    parts.append('<div class="kpis">')
    for L,V in [("Break-even", f'~{int(round(be*conv/10)*10):,} paying'),
                ("Net @ 50k", f'{money(net(m,50000))}/mo'),
                ("Net @ 100k", f'{money(net(m,100000))}/mo'),
                ("Annual @ 50k", f'{money(net(m,50000)*12)}/yr')]:
        parts.append(f'<div class="kpi"><div class="l">{L}</div><div class="v" style="color:{m["dark"]}">{V}</div></div>')
    parts.append('</div>')
    # Plot 1: time to $5 (solo)
    parts.append('<h3>1 &nbsp;·&nbsp; How long a solo researcher takes to reach a $5 charge</h3>')
    rows=[]
    for w,lab2 in [(0.05,"Light"),(0.2,"Typical"),(0.5,"Heavy")]:
        mo=solo_months_to5(m,w); rows.append((lab2,mo,fmt_mo(mo)))
    parts.append(hbars(rows, max(r[1] for r in rows), "mo", m["color"]))
    parts.append('<p class="note">Lower base + markup = it takes longer to even owe us $5. Labs and depts are billed their flat fee monthly. (6-month billing cycle; we only run a card once the balance clears $5.)</p>')
    # Plot 2: break-even
    parts.append('<h3>2 &nbsp;·&nbsp; Profit vs. number of paying users</h3>')
    parts.append(line_be(m, m["color"]))
    parts.append(f'<p class="note">Crosses into profit at ~{int(round(be*conv/10)*10):,} paying users (~{be:,} total at 5% conversion). Everything to the right of the dashed line is profit that funds the labs.</p>')
    # Plot 3: composition
    parts.append('<h3>3 &nbsp;·&nbsp; Where the revenue comes from (at 50k users)</h3>')
    parts.append(comp_bar(m))
    parts.append('<p class="note">The base + flat fees carry most of it; the usage markup is the fairness lever (heavy users pay a bit more); AI is deliberately a rounding error, never the money-maker.</p>')
    parts.append('</div>')

# closing
parts.append('<div class="card"><h2>The thesis</h2><p class="phil">In all three modes the philosophy is identical: a better product than anything on the market, at a price that is dramatically cheaper than the stack of tools it replaces. The modes only differ in ambition — keep the lights on, fund the labs, or build a real profit engine for the labs. Even the Premium mode prices a seat below what a single existing tool costs. Academics first, always.</p>'
 '<p class="note">Assumptions held constant across modes: 5% of users convert to paid; 40/40/20 solo/lab/dept mix; ~6 seats/lab, 5 labs/dept; "typical" usage ≈ 0.2M relay writes/seat/mo; AI metered at 1.4× (solo/lab) / 2× (dept) over our $0.153/M cost, ~30% of paid users buy it; storage at ~1.15× cost (no margin); Stripe 2.9% + $0.30 amortized over 6-month billing; fixed operating cost ~$260/mo growing modestly with provider tiers. Real per-user usage is the #1 thing beta will tell us; these are honest estimates, not measurements.</p></div>')

parts.append('</div></body></html>')

out="docs/proposals/2026-06-16-pricing-modes.html"
open(out,"w").write("".join(parts))
print("wrote",out, "bytes", len("".join(parts)))