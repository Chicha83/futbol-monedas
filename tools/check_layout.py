"""Comprueba que ningún elemento flotante tapa los medidores de abajo (Potencia/Efecto/Contacto) ni que estos se salgan de la pantalla.
Uso: python3 tools/check_layout.py   (con `python3 -m http.server 8770` y el servidor local en marcha)"""
import asyncio,random,sys
from playwright.async_api import async_playwright
ROOT=__file__.rsplit('/tools/',1)[0]
async def main():
    s=open(ROOT+'/index.html').read()
    s=s.replace("const LOCKEY='fmon-loc';","window.__d=x=>eval(x);const LOCKEY='fmon-loc';",1)
    open(ROOT+'/_t.html','w').write(s)
    bad=[]
    try:
        async with async_playwright() as p:
            b=await p.chromium.launch()
            for vp in [(390,780),(393,690),(360,640),(360,560),(412,915)]:
                pg=await (await b.new_context(viewport={'width':vp[0],'height':vp[1]})).new_page()
                await pg.goto('http://localhost:8770/_t.html?srv=ws://localhost:8787'); await pg.wait_for_timeout(700)
                await pg.click('#wtnew'); await pg.fill('#wname','Ly%d'%random.randint(100,999)); await pg.fill('#wpin','1234'); await pg.fill('#wpin2','1234'); await pg.click('#wgo'); await pg.wait_for_timeout(700)
                await pg.click('#wloc'); await pg.click('#tmclose'); await pg.wait_for_timeout(500)
                for name,code in [('apuntar',"beginAim()"),('colocar',"turn=0;pm={m:null};beginPlace()"),('banda',"turn=1;coins[2].x=90;coins[2].y=400;pm={m:'bdef'};beginPlace()"),('puerta',"turn=0;coins[2].x=360;coins[2].y=174;pm={m:'gkdef',y:90};beginPlace()")]:
                    await pg.evaluate("__d(%r)"%code); await pg.wait_for_timeout(250)
                    r=await pg.evaluate("""()=>{const m=document.querySelector('.meters').getBoundingClientRect();const out=[];
                      if(m.width<50||m.height<10)out.push('medidores ocultos o sin tamaño');
                      if(m.bottom>innerHeight+1)out.push('medidores fuera de la pantalla');
                      for(const e of document.querySelectorAll('body *')){const c=getComputedStyle(e);if(c.position!=='fixed'||e.hidden||c.display==='none'||c.visibility==='hidden')continue;
                        if(e.closest('.tut,.wel'))continue;const q=e.getBoundingClientRect();if(q.width<2||q.height<2)continue;
                        if(q.left<m.right&&q.right>m.left&&q.top<m.bottom&&q.bottom>m.top)out.push('tapa los medidores: #'+e.id);}
                      return out;}""")
                    for x in r: bad.append('%dx%d %s: %s'%(vp[0],vp[1],name,x))
            await b.close()
    finally:
        import os; os.remove(ROOT+'/_t.html')
    print('\n'.join(bad) if bad else 'Diseño correcto: los medidores de abajo no se tapan.'); sys.exit(1 if bad else 0)
asyncio.run(main())
