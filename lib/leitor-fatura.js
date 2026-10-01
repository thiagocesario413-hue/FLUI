/* ===== Leitor de fatura de cartao em PDF (FLUI) =====
   Recebe o texto de cada pagina (extraido pelo PDF.js, com a posicao de cada trecho) e devolve as compras e os totais.
   Roda 100% no aparelho: nao usa rede. Hoje reconhece o layout da fatura do Itau.
   Valores sao tratados em CENTAVOS (inteiros) para as somas baterem exatamente.
   Uso no app: window.FLUI_LEITOR_FATURA.ler(paginas) ; no Node (testes): require(...).ler(paginas)
   paginas = [{largura: numero, itens: [{t: texto, x: numero, y: numero}]}]
   1.9.1: se a fatura nao for reconhecida, o app tenta de novo com os pedacos de fragmentosDaPagina (ver abaixo). */
(function(raiz){
  var VAL='-?\\d{1,3}(?:\\.\\d{3})*,\\d{2}';
  var RE_ITEM=new RegExp('^(\\d{2}/\\d{2})\\s+(.*?)\\s+('+VAL+')$');
  /* parcela no fim da descricao; aceita colada numa letra ("LOJA03/10", modelo antigo da fatura) */
  var RE_PARC=/(?:\s|[A-Za-zÀ-ú*])(\d{2})\/(\d{2})$/;
  function centavos(s){ var neg=s.charAt(0)==='-'; var n=parseInt(s.replace(/[-.,]/g,''),10); return neg?-n:n; }
  /* os icones da lateral da fatura (S, L, P, =) as vezes grudam no inicio da linha: sao ignorados */
  var ICONE='^(?:[A-Z=+]\\s+)?';
  function valorApos(rotulo, linha){ var m=new RegExp(ICONE+rotulo+'\\s*(?:R\\$\\s*)?('+VAL+')$').exec(linha); return m?centavos(m[1]):null; }
  var SUBTOTAL='Lançamentos no cartão(?:\\s*\\(final \\d{4}\\))?';
  function comeca(rotulo, linha){ return new RegExp(ICONE+rotulo).test(linha); }

  /* monta as linhas de texto: cada pagina tem duas colunas; le a coluna da esquerda e depois a da direita, de cima para baixo */
  function montarLinhas(paginas, limEsp){
    var saida=[], esc=null; limEsp=limEsp||0.12;
    if(paginas.some(function(p){ return p.itens.length && p.itens[0].fr; })) esc=escalaDasLetras(paginas);
    /* as faturas tem duas colunas; a divisao e a posicao do cabecalho "DATA" da coluna da direita (os valores da esquerda passam do meio da pagina) */
    var divisao=null;
    paginas.forEach(function(p){
      var xs=(p.itens.length && p.itens[0].fr ? palavrasFr(p.itens, esc) : p.itens).filter(function(i){ return /^DATA\b/.test((i.t||'').trim()); }).map(function(i){ return i.x; });
      if(xs.length>=2){ var mx=Math.max.apply(null,xs), mn=Math.min.apply(null,xs); if(mx-mn>p.largura*0.25){ var d=mx-4; if(divisao===null || d<divisao) divisao=d; } }
    });
    paginas.forEach(function(p){
      var meio=(divisao!==null?divisao:p.largura/2), cols=[[],[]], fr=p.itens.length && p.itens[0].fr;
      p.itens.forEach(function(it){ if(it.t && it.t.trim()) cols[it.x<meio?0:1].push(it); });
      cols.forEach(function(c){
        var linhas=[];
        c.forEach(function(it){
          var l=null; for(var i=0;i<linhas.length;i++){ if(Math.abs(linhas[i].y-it.y)<=2.5){ l=linhas[i]; break; } }
          if(!l){ l={y:it.y, itens:[]}; linhas.push(l); }
          l.itens.push(it);
        });
        linhas.sort(function(a,b){ return b.y-a.y; });
        linhas.forEach(function(l){
          /* junta os pedacos: sem espaco quando estao colados (o PDF.js separa letras acentuadas), com espaco quando ha distancia */
          var its=l.itens.sort(function(a,b){ return a.x-b.x; }), txt='', escL=esc;
          if(fr){ /* o fator pode mudar de um trecho para outro (titulos): com pedacos suficientes, vale o fator da propria linha */
            var am={}; for(var j=1;j<its.length;j++){ var a=its[j-1], b=its[j]; if(a.w>=2 && a.f===b.f && !b.sep){ var r=(b.x-a.x)/a.w; if(r>0.8 && r<2) (am[a.f]=am[a.f]||[]).push(r); } }
            escL={fonte:{}}; Object.keys(esc.fonte).forEach(function(f){ escL.fonte[f]=esc.fonte[f]; });
            if(esc.partido) Object.keys(am).forEach(function(f){ var k=fatorConfiavel(am[f]); if(k!==null) escL.fonte[f]=k; });
          }
          its.forEach(function(i,n){ if(n>0){ var ant=its[n-1];
            /* pedacos da segunda forma: espaco quando o PDF tinha um espaco entre eles, ou quando a distancia, medida com a largura
               real das letras, passa de metade do tamanho da letra */
            if(fr) txt+=(i.sep || i.x-fimReal(ant,escL) > limEsp*(ant.h||8))?' ':'';
            else { var fim=ant.x+(ant.w||0); txt+=((ant.w==null || i.x-fim>1.2)?' ':''); } }
            txt+=i.t; });
          txt=txt.replace(/\s+/g,' ').trim();
          if(txt) saida.push(txt);
        });
      });
    });
    return saida;
  }

  /* o modelo antigo traz o final do cartao: "NOME SOBRENOME (final 1234)"; cada cartao fica como um portador separado */
  function ehPortador(l){ var n=l.replace(/\s*\(final \d{4}\)$/,''); return n.length>=5 && / /.test(n) && /^[A-ZÀ-Ý][A-ZÀ-Ý .'-]+$/.test(n) && !/^DATA /.test(n); }

  function lerItau(linhas){
    var r={banco:'Itaú', vencimento:null, totalFatura:null, saldoFinanciado:0, encargos:0, lancAtuaisResumo:null, totalLancamentos:null,
      portadores:[], proximaFatura:null, futuras:[], erros:[]};
    var modo='', port=null, ultimo=null, inter=null;
    function portadorAtual(nome){
      var p=null; for(var i=0;i<r.portadores.length;i++){ if(r.portadores[i].nome===nome){ p=r.portadores[i]; break; } }
      if(!p){ p={nome:nome, compras:[], subtotal:null, internacionais:[], iof:0, subtotalInter:null}; r.portadores.push(p); }
      return p;
    }
    linhas.forEach(function(l){
      var m, v;
      /* estorno com o sinal separado do valor ("- 9,99", modelo antigo): junta o sinal ao numero */
      l=l.replace(/\s-\s+(\d{1,3}(?:\.\d{3})*,\d{2})$/,' -$1');
      if(r.vencimento===null && (m=/Vencimento:\s*(\d{2})\/(\d{2})\/(\d{4})/.exec(l))) r.vencimento=m[3]+'-'+m[2]+'-'+m[1];
      if(r.totalFatura===null && (v=valorApos('Total desta fatura',l))!==null){ r.totalFatura=v; return; }
      if(r.lancAtuaisResumo===null && (v=valorApos('Lançamentos atuais',l))!==null){ r.lancAtuaisResumo=v; return; }
      if((v=valorApos('Saldo financiado',l))!==null){ r.saldoFinanciado=v; return; }
      /* encargos do mes no resumo ("Encargos (Financiamento + moratório)", fatura 07/2026): fazem parte do total da fatura */
      if((v=valorApos('Encargos\\s*\\(Financiamento[^)]*\\)',l))!==null){ r.encargos=v; return; }
      if(comeca('Pagamentos efetuados',l)){ modo='pag'; return; }
      if(comeca('Lançamentos: compras e saques',l)){ modo='compras'; ultimo=null; return; }
      if(comeca('Lançamentos internacionais',l)){ modo='inter'; port=null; ultimo=null; return; }
      /* secao de cobrancas do proprio banco (seguros, servicos), com subtotal proprio: vira um bloco "Produtos e serviços" (fatura 07/2026) */
      if(comeca('Lançamentos:\\s*produtos e serviços',l)){ modo='servicos'; port=portadorAtual('Produtos e serviços'); ultimo=null; return; }
      if(comeca('Compras parceladas - próximas faturas',l)){ modo='futuras'; return; }
      if(/^(Limites de crédito|Encargos cobrados)/.test(l)){ modo='fim'; return; }
      if((v=valorApos('Total dos lançamentos atuais',l))!==null){ r.totalLancamentos=v; modo='fim'; return; }
      if(/^DATA ESTABELECIMENTO/.test(l) || /^continua/.test(l)) return;

      if(modo==='servicos'){
        if((v=valorApos('Lançamentos:?\\s*produtos e serviços',l))!==null){ port.subtotal=v; ultimo=null; return; }
        if((m=RE_ITEM.exec(l))){ var ds=m[2], ps=null, mps=RE_PARC.exec(ds); if(mps){ ps=mps[1]+'/'+mps[2]; ds=ds.slice(0,mps.index+mps[0].length-5).trim(); }
          ultimo={data:m[1], descricao:ds, parcela:ps, valor:centavos(m[3]), detalhe:''}; port.compras.push(ultimo); return; }
        if(ultimo && !ultimo.detalhe && !/^DATA /.test(l)){ ultimo.detalhe=l; }
        return;
      }
      if(modo==='compras' || modo==='inter'){
        /* a linha logo abaixo de uma compra (categoria e cidade) e o detalhe dela, mesmo em maiusculas: so depois disso pode ser o nome de um portador */
        if(modo==='compras' && ultimo && !ultimo.detalhe && !RE_ITEM.test(l) && valorApos(SUBTOTAL,l)===null){ ultimo.detalhe=l; return; }
        if(ehPortador(l)){ port=portadorAtual(l); ultimo=null; return; }
        if(modo==='compras'){
          if((v=valorApos(SUBTOTAL,l))!==null){ if(port) port.subtotal=v; ultimo=null; return; }
          if((m=RE_ITEM.exec(l))){
            if(!port){ r.erros.push('Compra antes do nome do portador: '+m[1]); return; }
            var desc=m[2], parcela=null, mp=RE_PARC.exec(desc);
            if(mp){ parcela=mp[1]+'/'+mp[2]; desc=desc.slice(0,mp.index+mp[0].length-5).trim(); }
            ultimo={data:m[1], descricao:desc, parcela:parcela, valor:centavos(m[3]), detalhe:''};
            port.compras.push(ultimo); return;
          }
          if(ultimo && !ultimo.detalhe){ ultimo.detalhe=l; return; }
          return;
        }
        /* internacionais */
        if((v=valorApos('Total transações inter\\. em',l))!==null){ if(port) port.totalInterSemIof=v; return; }
        if((v=valorApos('Repasse\\s*de\\s*IOF\\s*em',l))!==null){ if(port) port.iof=v; return; }
        if((v=valorApos('Total lançamentos inter\\. em',l))!==null){ if(port) port.subtotalInter=v; return; }
        if((m=RE_ITEM.exec(l))){
          if(!port){ r.erros.push('Compra internacional antes do nome do portador: '+m[1]); return; }
          ultimo={data:m[1], descricao:m[2], parcela:null, valor:centavos(m[3]), detalhe:''};
          port.internacionais.push(ultimo); return;
        }
        if(ultimo){ ultimo.detalhe=(ultimo.detalhe?ultimo.detalhe+' · ':'')+l; }
        return;
      }
      if(modo==='futuras'){
        if((v=valorApos('Próxima fatura',l))!==null){ r.proximaFatura=v; return; }
        if((m=RE_ITEM.exec(l))){ var d2=m[2], p2=null, mp2=RE_PARC.exec(d2); if(mp2){ p2=mp2[1]+'/'+mp2[2]; d2=d2.slice(0,mp2.index+mp2[0].length-5).trim(); } r.futuras.push({data:m[1], descricao:d2, parcela:p2, valor:centavos(m[3])}); }
      }
    });
    conferir(r);
    return r;
  }

  function soma(lista){ return lista.reduce(function(s,i){ return s+i.valor; },0); }
  function brl(c){ var neg=c<0; c=Math.abs(c); var s=String(Math.floor(c/100)).replace(/\B(?=(\d{3})+(?!\d))/g,'.')+','+String(c%100).padStart(2,'0'); return (neg?'-':'')+'R$ '+s; }
  function conferir(r){
    var e=r.erros;
    if(!r.vencimento) e.push('Não encontrei a data de vencimento.');
    if(r.totalFatura===null) e.push('Não encontrei o total da fatura.');
    if(r.totalLancamentos===null) e.push('Não encontrei o "Total dos lançamentos atuais".');
    if(!r.portadores.length) e.push('Não encontrei nenhuma compra.');
    var geral=0;
    r.portadores.forEach(function(p){
      if(p.compras.length){
        var s=soma(p.compras);
        if(p.subtotal===null) e.push('Não encontrei o subtotal das compras de '+p.nome+'.');
        else if(s!==p.subtotal) e.push('As compras de '+p.nome+' somam '+brl(s)+', mas a fatura informa '+brl(p.subtotal)+'.');
        geral+= (p.subtotal!==null ? p.subtotal : s);
      }
      if(p.internacionais.length){
        var si=soma(p.internacionais)+(p.iof||0);
        if(p.subtotalInter===null) e.push('Não encontrei o total internacional de '+p.nome+'.');
        else if(si!==p.subtotalInter) e.push('As compras internacionais de '+p.nome+' (com IOF) somam '+brl(si)+', mas a fatura informa '+brl(p.subtotalInter)+'.');
        geral+= (p.subtotalInter!==null ? p.subtotalInter : si);
      }
    });
    if(r.totalLancamentos!==null && geral!==r.totalLancamentos) e.push('A soma de todas as compras dá '+brl(geral)+', mas o total dos lançamentos atuais é '+brl(r.totalLancamentos)+'.');
    if(r.lancAtuaisResumo!==null && r.totalLancamentos!==null && r.lancAtuaisResumo!==r.totalLancamentos) e.push('O resumo da primeira página ('+brl(r.lancAtuaisResumo)+') não bate com o total dos lançamentos ('+brl(r.totalLancamentos)+').');
    if(r.totalFatura!==null && r.totalLancamentos!==null && r.totalLancamentos+r.saldoFinanciado+r.encargos!==r.totalFatura) e.push('Lançamentos ('+brl(r.totalLancamentos)+') mais saldo anterior ('+brl(r.saldoFinanciado)+')'+(r.encargos?' e encargos ('+brl(r.encargos)+')':'')+' não dão o total da fatura ('+brl(r.totalFatura)+').');
    r.somaConferida=geral;
    r.ok=e.length===0;
  }

  /* ---- Segunda forma de extrair o texto (1.9.1) ----
     Alguns PDFs (ex.: fatura do Itau de 08/2026) gravam cada pedaco de palavra numa posicao propria e declaram larguras de letra
     menores que as reais; o PDF.js entao poe espacos no meio das palavras ("ES TAB ELE CIMENTO"). Aqui o texto e remontado a
     partir da lista de comandos da pagina (page.getOperatorList()): cada comando de texto vira um pedaco com posicao e largura.
     Funcao pura: recebe fnArray, argsArray e a tabela OPS do PDF.js. */
  function mulM(a,b){ return [a[0]*b[0]+a[1]*b[2], a[0]*b[1]+a[1]*b[3], a[2]*b[0]+a[3]*b[2], a[2]*b[1]+a[3]*b[3], a[4]*b[0]+a[5]*b[2]+b[4], a[4]*b[1]+a[5]*b[3]+b[5]]; }
  function fragmentosDaPagina(fnArray, argsArray, OPS){
    var ctm=[1,0,0,1,0,0], pilha=[], tm=[1,0,0,1,0,0], tlm=[1,0,0,1,0,0], fs=10, fonte='', hs=1, cs=0, ws=0, lead=0, saida=[];
    function mover(tx,ty){ tlm=mulM([1,0,0,1,tx,ty], tlm); tm=tlm.slice(); }
    function mostrar(glifos){
      var run=null, sep=false;
      function fechar(){ if(run && run.t.trim()){ var fim=mulM(run.tmFim,ctm); run.w=Math.hypot(fim[4]-run.x, fim[5]-run.y); delete run.tmFim; saida.push(run); } run=null; }
      glifos.forEach(function(g){
        if(typeof g==='number'){ var d=-g/1000*fs*hs; if(-g/1000>0.15 && run){ fechar(); sep=true; } tm=mulM([1,0,0,1,d,0], tm); return; }
        if(!g) return;
        var esp=g.isSpace || g.unicode===' ' || !String(g.unicode||'').trim(), adv=((g.width||0)/1000*fs + cs + (esp?ws:0))*hs;
        if(esp){ if(run){ fechar(); sep=true; } }
        else {
          if(!run){ var p=mulM(tm,ctm), e=Math.hypot(p[0],p[1])||1; run={t:'', x:p[4], y:p[5], h:fs*Math.hypot(p[2],p[3]), fr:1, f:fonte+'@'+(Math.round(fs*100)/100), e:e, gl:[], sep:sep}; sep=false; }
          run.t+=(g.unicode||''); run.gl.push([g.unicode||'', adv*run.e]);
        }
        tm=mulM([1,0,0,1,adv,0], tm);
        if(run) run.tmFim=tm.slice();
      });
      fechar();
    }
    for(var i=0;i<fnArray.length;i++){
      var f=fnArray[i], a=argsArray[i]||[];
      if(f===OPS.save) pilha.push(ctm.slice());
      else if(f===OPS.restore){ if(pilha.length) ctm=pilha.pop(); }
      else if(f===OPS.transform) ctm=mulM(a, ctm);
      else if(f===OPS.paintFormXObjectBegin){ pilha.push(ctm.slice()); if(a[0]) ctm=mulM(a[0], ctm); }
      else if(f===OPS.paintFormXObjectEnd){ if(pilha.length) ctm=pilha.pop(); }
      else if(f===OPS.beginText){ tm=[1,0,0,1,0,0]; tlm=[1,0,0,1,0,0]; }
      else if(f===OPS.setTextMatrix){ tlm=[a[0],a[1],a[2],a[3],a[4],a[5]]; tm=tlm.slice(); }
      else if(f===OPS.moveText) mover(a[0],a[1]);
      else if(f===OPS.setLeadingMoveText){ lead=-a[1]; mover(a[0],a[1]); }
      else if(f===OPS.nextLine) mover(0,-lead);
      else if(f===OPS.setLeading) lead=a[0];
      else if(f===OPS.setFont){ fonte=String(a[0]); fs=a[1]; }
      else if(f===OPS.setCharSpacing) cs=a[0];
      else if(f===OPS.setWordSpacing) ws=a[0];
      else if(f===OPS.setHScale) hs=a[0]/100;
      else if(f===OPS.showText || f===OPS.showSpacedText) mostrar(a[0]||[]);
      else if(f===OPS.nextLineShowText){ mover(0,-lead); mostrar(a[0]||[]); }
      else if(f===OPS.nextLineSetSpacingShowText){ ws=a[0]; cs=a[1]; mover(0,-lead); mostrar(a[2]||[]); }
    }
    return saida;
  }
  /* fator real de largura de cada fonte, aprendido no proprio documento: entre pedacos vizinhos da mesma linha e da mesma fonte,
     (distancia ate o proximo / largura declarada). Entre pedacos da mesma palavra o fator e constante; quando ha um espaco ele
     fica maior. Por isso vale o percentil 30 (e nao a media), so com pedacos de pelo menos 3 pt (o arredondamento pesa menos).
     Fonte com poucas amostras usa 1 (largura declarada). */
  function quartil(v,q){ v.sort(function(a,b){ return a-b; }); return v[Math.floor(v.length*q)]; }
  /* so aceita o fator quando pelo menos metade dos pares concorda com ele (+-5%): e o sinal de palavra partida em pedacos.
     Em PDF normal os pedacos ja sao palavras, a distancia inclui o espaco e varia muito: ai o fator fica 1 */
  function fatorConfiavel(v){
    if(v.length<3) return null;
    var k=quartil(v,0.3), perto=v.filter(function(r){ return Math.abs(r-k)<=k*0.05; }).length;
    return (perto>=v.length*0.5 && k<=1.4) ? Math.max(1,k) : 1;
  }
  /* o documento esta "partido" quando a mediana de letras por pedaco e no maximo 3 (na fatura de 08/2026 e ~2; em PDF normal os
     pedacos sao palavras inteiras). So entao a correcao de escala e usada; senao o fator e sempre 1 */
  function documentoPartido(paginas){
    var n=[]; paginas.forEach(function(p){ p.itens.forEach(function(it){ if(it.fr && it.gl) n.push(it.gl.length); }); });
    return n.length>=50 && quartil(n,0.5)<=3;
  }
  function escalaDasLetras(paginas){
    var am={};
    if(!documentoPartido(paginas)) return {fonte:{}, partido:false};
    paginas.forEach(function(p){
      var por={};
      p.itens.forEach(function(it){ if(it.fr){ var k=Math.round(it.y*2); (por[k]=por[k]||[]).push(it); } });
      Object.keys(por).forEach(function(k){ var l=por[k].sort(function(a,b){ return a.x-b.x; });
        for(var i=1;i<l.length;i++){ var a=l[i-1], b=l[i];
          if(a.w>=3 && a.f===b.f && !b.sep && b.x>a.x){ var r=(b.x-a.x)/a.w; if(r>0.8 && r<2) (am[a.f]=am[a.f]||[]).push(r); } } });
    });
    var fonte={};
    Object.keys(am).forEach(function(f){ if(am[f].length>=10) fonte[f]=fatorConfiavel(am[f]); });
    return {fonte:fonte, partido:true};
  }
  function fimReal(it, esc){ return it.x+it.w*(esc.fonte[it.f]||1); }
  /* junta os pedacos vizinhos (mesma linha, sem distancia) em palavras: usado so para achar o cabecalho "DATA" das colunas */
  function palavrasFr(itens, esc){
    var l=itens.filter(function(i){ return i.t && i.t.trim(); }).slice().sort(function(a,b){ return (Math.round(b.y*2)-Math.round(a.y*2)) || (a.x-b.x); }), out=[], cur=null;
    l.forEach(function(i){
      if(cur && Math.round(cur.y*2)===Math.round(i.y*2) && !i.sep && i.x>=cur.ult.x && i.x-fimReal(cur.ult,esc) <= 0.12*(i.h||8)){ cur.t+=i.t; cur.ult=i; }
      else { cur={t:i.t, x:i.x, y:i.y, ult:i}; out.push(cur); }
    });
    return out;
  }

  function reconhecer(linhas){
    var txt=linhas.join('\n');
    if(/itau|itaú/i.test(txt) && /Lançamentos: compras e saques/.test(txt) && /Total desta fatura/.test(txt)) return 'itau';
    return null;
  }
  function ler(paginas){
    var linhas=montarLinhas(paginas), banco=reconhecer(linhas);
    if(banco==='itau') return lerItau(linhas);
    return {ok:false, banco:null, erros:['Não reconheci o modelo desta fatura. Hoje o FLUI lê a fatura do cartão Itaú. Você pode lançar a fatura à mão.'], portadores:[]};
  }
  /* ---- Diagnostico mascarado (1.9.3): mostra a ESTRUTURA da fatura sem nomes, lojas nem valores ----
     Digitos viram "#"; palavras que nao sao termos comuns de fatura viram o tamanho delas (W7 = palavra de 7 letras comecando
     em maiuscula, w5 = em minuscula). O usuario copia e envia para correcao; nada sai do aparelho sozinho. */
  var TERMOS=('lancamentos lancamento compras compra saques saque total totais desta fatura faturas anterior atuais atual pagamento pagamentos '+
    'efetuado efetuados data estabelecimento valor valores em r$ us$ usd brl iof repasse de do da dos das no na nos nas e a o as os ao cartao cartoes '+
    'final internacionais internacional transacoes transacao inter dolar conversao proxima proximas proximo parceladas parcelada parcela parcelas '+
    'limite limites credito debito saldo financiado vencimento vence encargos continua juros minimo resumo previsao fechamento utilizado disponivel '+
    'anuidade estorno estornos automatico mes outros para com sem por ate sua seu titular adicional portador produtos servicos produto servico '+
    'financiamento moratorio').split(' ');
  var TERMOS_SET={}; TERMOS.forEach(function(t){ TERMOS_SET[t]=1; });
  function semAcentoMin(s){ var t=String(s).toLowerCase(); try{ t=t.normalize('NFD').replace(/[̀-ͯ]/g,''); }catch(e){} return t; }
  function mascarar(linha){
    return String(linha).replace(/\d/g,'#').replace(/[A-Za-zÀ-ÿ$]+/g, function(w){
      if(TERMOS_SET[semAcentoMin(w)]) return w;
      return (/^[A-ZÀ-Þ]/.test(w)?'W':'w')+w.length;
    });
  }
  /* leituras = [{nome:'forma 1', paginas:[...]}, ...]; r = resultado do ler(); extra = texto livre (versao do app) */
  function diagnostico(leituras, r, extra){
    var out=['DIAGNOSTICO DA FATURA (FLUI) - sem nomes, lojas nem valores'];
    if(extra) out.push(extra);
    out.push('Reconhecida como: '+(r && r.banco ? r.banco : 'nao reconhecida')+' | conferencia: '+(r && r.ok ? 'OK' : 'falhou'));
    if(r){
      out.push('Vencimento achado: '+(r.vencimento?'sim':'nao')+' | total da fatura: '+(r.totalFatura!=null?'sim':'nao')+' | total dos lancamentos: '+(r.totalLancamentos!=null?'sim':'nao')+' | encargos: '+(r.encargos?'sim':'nao'));
      (r.portadores||[]).forEach(function(p,i){ out.push('Bloco '+(i+1)+': compras='+p.compras.length+' internacionais='+p.internacionais.length+' subtotal='+(p.subtotal!=null?'sim':'nao')+' parceladas='+p.compras.filter(function(c){ return c.parcela; }).length); });
      (r.erros||[]).forEach(function(e){ out.push('ERRO: '+mascarar(e)); });
    }
    (leituras||[]).forEach(function(l){
      if(!l || !l.paginas) return;
      var ls=montarLinhas(l.paginas);
      out.push(''); out.push('=== '+l.nome+': '+l.paginas.length+' paginas, '+ls.length+' linhas ===');
      ls.slice(0,500).forEach(function(x,i){ out.push(('   '+(i+1)).slice(-4)+': '+mascarar(x).slice(0,140)); });
      if(ls.length>500) out.push('... (+'+(ls.length-500)+' linhas)');
    });
    return out.join('\n');
  }

  var api={ler:ler, montarLinhas:montarLinhas, lerItau:lerItau, centavos:centavos, brl:brl, fragmentosDaPagina:fragmentosDaPagina, diagnostico:diagnostico, mascarar:mascarar};
  if(typeof module!=='undefined' && module.exports) module.exports=api; else raiz.FLUI_LEITOR_FATURA=api;
})(typeof window!=='undefined'?window:this);
