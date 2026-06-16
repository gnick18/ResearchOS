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
 dict(key="lean", name="Mode 1 · Lean", short="Lean", color="#1D9E75", tint="#E1F5EE", dark="#0F6E56",
      tag="Charge as little as we can and still keep the lights on.",
      phil="There's no profit motive here. The whole point is to take the cost barrier out from under academics. It's a better notebook than anything on the market, priced at roughly what it costs us to run. Even if we only ever serve people in Wisconsin, this still works.",
      solo_floor=1, lab_flat=5, dept_flat=10, smk=3, lmk=2.75, dmk=2.5),
 dict(key="fund", name="Mode 2 · Fund the labs", short="Fund the labs", color="#BA7517", tint="#FAEEDA", dark="#854F0B",
      tag="Enough margin to actually fund our labs.",
      phil="Still way below market, but priced so that at real scale, hundreds to thousands of paying users, it throws off tens to hundreds of thousands a year. That money goes straight back into Grant's and Emile's labs. A tool that pays for the science it serves.",
      solo_floor=3, lab_flat=12, dept_flat=25, smk=5, lmk=4.5, dmk=4),
 dict(key="prem", name="Mode 3 · Premium", short="Premium", color="#7F77DD", tint="#EEEDFE", dark="#3C3489",
      tag="Real profit, still nowhere near a private company.",
      phil="Same idea as GitHub Enterprise. We charge a real premium for the value and pour the profit back into the labs. Even here a seat is a small slice of what it replaces. LabArchives alone runs $27.50 per user a month. Better product, much cheaper, and we never price like a private company.",
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
def net_paid(m,paid): return paid*blended(m)-fixed(paid/conv)
def total_est(paid): return int(round((paid/conv)/1000.0)*1000)
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
    aid=f"ra-{m['key']}"
    s=[f'<svg viewBox="0 0 {w} {h}" width="100%" style="max-width:{w}px">']
    s.append(f'<defs><marker id="{aid}" markerWidth="9" markerHeight="9" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="#E24B4A"/></marker></defs>')
    # zero line
    zy=Y(0); s.append(f'<line x1="{padL}" y1="{zy:.1f}" x2="{w-padR}" y2="{zy:.1f}" stroke="{BX}" stroke-dasharray="3 3"/>')
    # profit zone shade (right of break-even, above zero)
    bx=X(be_paid)
    s.append(f'<rect x="{bx:.1f}" y="{padT}" width="{w-padR-bx:.1f}" height="{zy-padT:.1f}" fill="{color}" opacity="0.08"/>')
    # net curve
    d="M "+" L ".join(f"{X(pd):.1f} {Y(v):.1f}" for pd,v in pts)
    s.append(f'<path d="{d}" fill="none" stroke="{color}" stroke-width="2.5"/>')
    # red annotation: that dip is a provider-tier cost step-up (so Emile knows)
    ap=1250; av=net(m, ap/conv); ax=X(ap); ay=Y(av)
    s.append(f'<circle cx="{ax:.1f}" cy="{ay:.1f}" r="3" fill="#E24B4A"/>')
    s.append(f'<line x1="{ax:.1f}" y1="{ay-30:.1f}" x2="{ax:.1f}" y2="{ay-6:.1f}" stroke="#E24B4A" stroke-width="1.5" marker-end="url(#{aid})"/>')
    s.append(f'<text x="{ax:.1f}" y="{ay-46:.1f}" font-size="11" fill="#A32D2D" font-weight="500" text-anchor="middle">infra cost steps up here</text>')
    s.append(f'<text x="{ax:.1f}" y="{ay-34:.1f}" font-size="10.5" fill="#A32D2D" text-anchor="middle">(we cross a provider free tier)</text>')
    # break-even marker
    s.append(f'<line x1="{bx:.1f}" y1="{padT}" x2="{bx:.1f}" y2="{h-padB}" stroke="{color}" stroke-width="1.5" stroke-dasharray="4 3"/>')
    s.append(f'<text x="{bx+6:.1f}" y="{padT+14}" font-size="12" fill="{DK}" font-weight="500">break even ~{int(round(be_paid/10)*10):,} paid</text>')
    # axes labels
    for pd in (0,500,1000,1500,2000,2500):
        s.append(f'<text x="{X(pd):.1f}" y="{h-12}" font-size="11" fill="{MUT}" text-anchor="middle">{pd:,}</text>')
    s.append(f'<text x="{padL}" y="{Y(ymax)-2:.1f}" font-size="11" fill="{MUT}">${ymax:,.0f}/mo</text>')
    s.append(f'<text x="{padL}" y="{zy-3:.1f}" font-size="11" fill="{MUT}">$0</text>')
    s.append(f'<text x="{w/2:.0f}" y="{h-1}" font-size="11" fill="{MUT}" text-anchor="middle">paid customers</text>')
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

def fixed_costs_card():
    # Same flat overhead in every mode (these don't change with pricing). Sourced
    # from the model: INFRA_FIXED_MONTHLY (~$37) + DEFAULT_OPERATING_COSTS.
    items=[
      ("Claude Max (ops, dev, marketing)", 200.00, "#534AB7"),
      ("Infrastructure (Cloudflare, Vercel, domains, Apple/LLC fees)", 37.04, "#378ADD"),
      ("Software + monitoring", 20.00, "#1D9E75"),
      ("Tax software (DIY filing)", 3.33, "#BA7517"),
      ("LLC phone (Tello, pay-per-use)", 1.25, "#888780"),
    ]
    tot=sum(v for _,v,_ in items)
    bar=['<svg viewBox="0 0 820 24" width="100%" style="max-width:820px">']
    x=0
    for lab,v,c in items:
        bw=820*v/tot; bar.append(f'<rect x="{x:.1f}" y="0" width="{bw:.1f}" height="22" fill="{c}"/>'); x+=bw
    bar.append('</svg>')
    leg=['<div style="display:flex;flex-wrap:wrap;gap:9px 20px;margin-top:11px;font-size:13px;color:#444">']
    for lab,v,c in items:
        leg.append(f'<span style="display:flex;align-items:center;gap:7px"><span style="width:11px;height:11px;border-radius:2px;background:{c}"></span>{esc(lab)} &nbsp;<b>{money(v)}</b>/mo ({v/tot*100:.0f}%)</span>')
    leg.append('</div>')
    return ('<div class="card"><h2>Monthly fixed costs</h2>'
            f'<p class="phil">About <b>{money(tot)}/mo</b>, the same in every mode (fixed costs don\'t change with pricing). This is the flat overhead we cover before any profit. One permanent Claude Max that co-runs the company is the bulk of it; everything else is small. It grows only slightly with scale as we cross provider free tiers.</p>'
            + "".join(bar) + "".join(leg) + '</div>')

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

parts.append('<h1>ResearchOS pricing: three modes</h1>')
parts.append('<p class="sub">It\'s the same product and the same structure underneath. A small base fee plus usage at a markup, AI metered near cost, storage at cost. The only things that change between the three modes are the <b>base fee</b> and how much we mark up <b>usage</b>. We measure everything by <b>paid customers</b>, because free users cost us almost nothing: a one-time ~$0.25 each and no cloud usage that scales. So the real question for each mode is how many paying labs and researchers it takes to work. In all three, a seat still costs a fraction of what the tools it replaces cost.</p>')

# shared assumptions key (same for every mode)
parts.append('<div class="card"><h2>Assumptions (same across all three modes)</h2>'
 '<ul style="margin:8px 0 0;padding-left:20px;font-size:14px;color:#444;line-height:1.85">'
 '<li><b>Paid-customer mix:</b> 40% solo &middot; 40% lab seats &middot; 20% dept seats</li>'
 '<li>~6 active seats per lab, ~5 labs per department</li>'
 '<li>Typical usage ~0.2M relay writes per seat per month</li>'
 '<li>AI metered at 1.4&times; (solo/lab) / 2&times; (dept), constant in every mode. Storage at cost, constant.</li>'
 '<li>Free users cost ~$0 (a one-time ~$0.25, no cloud usage that scales), so we count <b>paid customers</b>, not signups.</li>'
 '<li>For the total-signup estimates only: roughly 5% of signups convert to paid (so ~2,500 paid &approx; 50k signups).</li>'
 '</ul></div>')

# summary table
parts.append('<div class="card"><h2>At a glance</h2><table class="cmp"><tr><th>Mode</th><th class="n">Typical seat / mo</th><th class="n">Break-even (paid)</th><th class="n">Net @ 2,500 paid</th><th class="n">Net @ 5,000 paid</th></tr>')
for m in MODES:
    s,l,d=seats_net(m); be=break_even(m)
    parts.append(f'<tr><td><b style="color:{m["dark"]}">{esc(m["short"])}</b></td>'
                 f'<td class="n">${l:.2f}–${d:.2f}</td><td class="n">~{int(round(be*conv/10)*10):,}</td>'
                 f'<td class="n">{money(net_paid(m,2500))}/mo</td><td class="n">{money(net_paid(m,5000))}/mo</td></tr>')
parts.append('</table><p class="note">2,500 paid customers is roughly 50k signups; 5,000 paid is roughly 100k. Annualized, that\'s about $43k/yr for Lean, $110k for Fund the labs, and $217k for Premium at 2,500 paid, and roughly double those at 5,000. For reference, LabArchives by itself runs $27.50/user/mo ($330/yr), and the bundle ResearchOS replaces costs far more.</p></div>')

# fixed-costs breakdown (same in every mode)
parts.append(fixed_costs_card())

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
    for L,V in [("Break-even", f'~{int(round(be*conv/10)*10):,} paid'),
                ("Net @ 2,500 paid", f'{money(net_paid(m,2500))}/mo'),
                ("Net @ 5,000 paid", f'{money(net_paid(m,5000))}/mo'),
                ("Annual @ 2,500 paid", f'{money(net_paid(m,2500)*12)}/yr')]:
        parts.append(f'<div class="kpi"><div class="l">{L}</div><div class="v" style="color:{m["dark"]}">{V}</div></div>')
    parts.append('</div>')
    # Plot 1: time to $5 (solo)
    parts.append('<h3>1 &nbsp;·&nbsp; How long a solo researcher takes to reach a $5 charge</h3>')
    rows=[]
    for w,lab2 in [(0.05,"Light"),(0.2,"Typical"),(0.5,"Heavy")]:
        mo=solo_months_to5(m,w); rows.append((lab2,mo,fmt_mo(mo)))
    parts.append(hbars(rows, max(r[1] for r in rows), "mo", m["color"]))
    parts.append('<p class="note">The lower the base and markup, the longer it takes a user to even owe us $5. Labs and depts pay their flat fee monthly. We bill every 6 months and only run a card once the balance clears $5.</p>')
    # Plot 2: break-even
    parts.append('<h3>2 &nbsp;·&nbsp; Profit vs. number of paid customers</h3>')
    parts.append(line_be(m, m["color"]))
    parts.append(f'<p class="note">Crosses into profit at ~{int(round(be*conv/10)*10):,} paid customers (~{int(round(be/1000.0)*1000):,} signups at 5%). Everything to the right of the dashed line is profit that funds the labs. The small red dip is where our infra cost steps up as we cross a provider free tier (Vercel/Resend/Upstash); it is tiny and the line keeps climbing right through it.</p>')
    # Plot 3: composition
    parts.append('<h3>3 &nbsp;·&nbsp; Where the revenue comes from (at 2,500 paid customers)</h3>')
    parts.append(comp_bar(m))
    parts.append('<p class="note">The base and flat fees carry most of it. The usage markup is the fairness knob, so heavy users pay a bit more. AI stays tiny on purpose, never the money-maker.</p>')
    parts.append('</div>')

# closing
parts.append('<div class="card"><h2>The thesis</h2><p class="phil">Every mode runs on the same idea. A better product than anything out there, at a price far below the stack of tools it replaces. The modes only differ in how hard we push. Keep the lights on, fund the labs, or build a real engine for them. Even Premium prices a seat below a single existing tool. We\'re academics first, always.</p>'
 '<p class="note">Methodology, beyond the assumptions key up top: AI margin is over our $0.153/M measured cost, with about 30% of paid users buying it. Stripe is 2.9% + $0.30, amortized over 6-month billing. Fixed operating cost is about $260/mo, growing modestly as we cross provider tiers. Real per-user usage is the biggest thing beta will tell us, so treat these as honest estimates, not measurements.</p></div>')

parts.append('</div></body></html>')

out="docs/proposals/2026-06-16-pricing-modes.html"
open(out,"w").write("".join(parts))
print("wrote",out, "bytes", len("".join(parts)))