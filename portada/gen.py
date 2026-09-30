import math
RED='#D62839'; INK='#141B24'; BLUE='#2A5BD7'; GREEN='#12855C'
F="font-family=\"'DejaVu Sans Condensed','DejaVu Sans',Arial,sans-serif\" font-weight=\"800\""
def coin(x,y,r,col,rot=0,uid=''):
    # moneda con la equipación hasta el canto: aro dorado fino + camiseta de rayas del color del equipo
    return f'''<g transform="translate({x} {y})">
<ellipse cx="{r*.10}" cy="{r*.14}" rx="{r}" ry="{r}" fill="rgba(20,27,36,.22)"/>
<circle r="{r}" fill="#D8B255" stroke="#8E6C1E" stroke-width="{r*.04}"/>
<clipPath id="c{uid}"><circle r="{r*.93}"/></clipPath>
<g clip-path="url(#c{uid})" transform="rotate({rot})"><rect x="{-r}" y="{-r}" width="{2*r}" height="{2*r}" fill="{col}"/>
{''.join(f'<rect x="{-r+i*r*.4}" y="{-r}" width="{r*.2}" height="{2*r}" fill="rgba(255,255,255,.88)"/>' for i in range(0,6))}
<circle r="{r*.36}" fill="#F2F5F9" stroke="{INK}" stroke-width="{r*.03}"/></g>
<circle r="{r*.93}" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="{r*.03}"/>
</g>'''
def ball(x,y,r):
    return f'''<g transform="translate({x} {y})"><ellipse cx="{r*.1}" cy="{r*.15}" rx="{r}" ry="{r}" fill="rgba(20,27,36,.25)"/>
<circle r="{r}" fill="#C98354" stroke="#6E3B1B" stroke-width="{r*.06}"/><circle r="{r*.78}" fill="none" stroke="#6E3B1B" stroke-width="{r*.04}" opacity=".5"/>
<text y="{r*.22}" text-anchor="middle" font-size="{r*.62}" fill="#4A2810" {F}>5c</text></g>'''
def traba(x,y,ang,L=420):
    # media traba de madera de colgar la ropa, usada como palo de hockey
    return f'''<g transform="translate({x} {y}) rotate({ang})"><rect x="0" y="-20" width="{L}" height="40" rx="8" fill="rgba(20,27,36,.2)" transform="translate(6 10)"/>
<rect x="0" y="-18" width="{L}" height="36" rx="8" fill="#DDBB86" stroke="#8A6236" stroke-width="3"/>
<rect x="{L*.42}" y="-18" width="12" height="36" fill="rgba(110,70,30,.65)"/>
<path d="M{L*.42+20} -18 q30 18 0 36" fill="none" stroke="#8A6236" stroke-width="3" opacity=".6"/>
<path d="M14 -6 H{L*.4}" stroke="#B48F5A" stroke-width="3" opacity=".6"/></g>'''
def pitch_lines(x0,y0,x1,y1,w=6):
    cx=(x0+x1)/2; cy=(y0+y1)/2; W=x1-x0; H=y1-y0
    a=W*.56; ah=H*.17; s=W*.26; sh=H*.065
    return f'''<g fill="none" stroke="{RED}" stroke-width="{w}" stroke-linejoin="round">
<rect x="{x0}" y="{y0}" width="{W}" height="{H}"/><line x1="{x0}" y1="{cy}" x2="{x1}" y2="{cy}"/><circle cx="{cx}" cy="{cy}" r="{W*.14}"/>
<rect x="{cx-a/2}" y="{y0}" width="{a}" height="{ah}"/><rect x="{cx-s/2}" y="{y0}" width="{s}" height="{sh}"/>
<rect x="{cx-a/2}" y="{y1-ah}" width="{a}" height="{ah}"/><rect x="{cx-s/2}" y="{y1-sh}" width="{s}" height="{sh}"/>
<path d="M{cx-W*.14} {y0+ah} a{W*.14} {W*.14} 0 0 0 {W*.28} 0"/><path d="M{cx-W*.14} {y1-ah} a{W*.14} {W*.14} 0 0 1 {W*.28} 0"/>
<path d="M{x0} {y0+30} a30 30 0 0 0 30 -30"/><path d="M{x1} {y0+30} a30 30 0 0 1 -30 -30"/><path d="M{x0} {y1-30} a30 30 0 0 1 30 30"/><path d="M{x1} {y1-30} a30 30 0 0 0 -30 30"/></g>
<rect x="{cx-W*.17}" y="{y0-44}" width="{W*.34}" height="44" fill="none" stroke="{RED}" stroke-width="{w}"/><rect x="{cx-W*.17}" y="{y1}" width="{W*.34}" height="44" fill="none" stroke="{RED}" stroke-width="{w}"/>'''
def paper(extra=''):
    return f'''<rect width="1080" height="1920" fill="#FBFBF8"/><filter id="g"><feTurbulence baseFrequency=".9" numOctaves="2" seed="4"/><feColorMatrix values="0 0 0 0 .3  0 0 0 0 .3  0 0 0 0 .3  0 0 0 .05 0"/></filter><rect width="1080" height="1920" filter="url(#g)"/>{extra}'''
def title(y,size=210,col=INK,anchor='middle',x=540,sub=True):
    t=f'<text x="{x}" y="{y}" text-anchor="{anchor}" font-size="{size}" fill="{col}" {F} letter-spacing="3">FÚTBOL</text><text x="{x}" y="{y+size*.95}" text-anchor="{anchor}" font-size="{size}" fill="{RED}" {F} letter-spacing="3">MONEDAS</text>'
    return t
def svg(body): return f'<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920">{body}</svg>'

# A — Mesa de papel: golpe de traba
A=paper(f'''
{pitch_lines(110,540,970,1740,5)}
{title(290,170)}
<text x="540" y="560" text-anchor="middle" font-size="0" {F}></text>
{coin(380,1420,120,BLUE,10,'a')}{traba(120,1560,-28,400)}
<path d="M520 1330 Q640 1180 730 1000" fill="none" stroke="{INK}" stroke-width="9" stroke-dasharray="4 26" stroke-linecap="round"/>
{ball(560,1300,62)}{coin(700,980,120,GREEN,-20,'b')}
<text x="540" y="1860" text-anchor="middle" font-size="44" fill="#546171" {F} letter-spacing="8">TOCA PARA EMPEZAR</text>''')

# B — Cenital: campo completo con jugada
B=paper(f'''
{pitch_lines(120,330,960,1660,6)}
<rect x="200" y="690" width="680" height="340" rx="30" fill="#FBFBF8" stroke="#D62839" stroke-width="6"/>
{title(850,118)}
{coin(330,1250,105,BLUE,0,'a')}{coin(760,520,105,GREEN,30,'b')}{ball(560,1120,55)}
<path d="M560 1070 Q540 850 600 660" fill="none" stroke="{INK}" stroke-width="8" stroke-dasharray="3 24" stroke-linecap="round" opacity="0"/>
<text x="540" y="1840" text-anchor="middle" font-size="44" fill="#546171" {F} letter-spacing="8">TOCA PARA EMPEZAR</text>''')

# C — Duelo: dos monedas frente a frente
C=paper(f'''
<g stroke="#DCE2E9" stroke-width="2">{''.join(f'<line x1="0" y1="{y}" x2="1080" y2="{y}"/>' for y in range(60,1920,60))}{''.join(f'<line x1="{x}" y1="0" x2="{x}" y2="1920"/>' for x in range(60,1080,60))}</g>
<rect x="0" y="981" width="1080" height="8" fill="{RED}"/><circle cx="540" cy="985" r="210" fill="none" stroke="{RED}" stroke-width="8"/>
{title(200,170)}
{coin(540,660,200,GREEN,180,'b')}{coin(540,1310,200,BLUE,0,'a')}{ball(540,985,58)}
<text x="540" y="1840" text-anchor="middle" font-size="44" fill="#546171" {F} letter-spacing="8">TOCA PARA EMPEZAR</text>''')

# D — Golazo: balón hacia la portería, trazo de traba
D=paper(f'''
{pitch_lines(150,130,930,1040,6)}
<g stroke="{RED}" stroke-width="3" opacity=".55">{''.join(f'<line x1="{x}" y1="86" x2="{x}" y2="130"/>' for x in range(380,710,24))}{''.join(f'<line x1="380" y1="{y}" x2="700" y2="{y}"/>' for y in range(86,130,14))}</g>
<path d="M300 1590 C 360 1300 760 1150 540 330" fill="none" stroke="{INK}" stroke-width="10" stroke-dasharray="4 28" stroke-linecap="round"/>
{ball(540,300,54)}
<g transform="rotate(-7 540 1300)">{title(1250,160)}</g>
{coin(300,1590,135,BLUE,0,'a')}{traba(40,1700,-35,430)}
{coin(860,1560,90,GREEN,0,'b')}
<text x="540" y="1860" text-anchor="middle" font-size="44" fill="#546171" {F} letter-spacing="8">TOCA PARA EMPEZAR</text>''')

for n,s in zip('ABCD',(A,B,C,D)): open(f'opcion_{n}.svg','w').write(svg(s))
