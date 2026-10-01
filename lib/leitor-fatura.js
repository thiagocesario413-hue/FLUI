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
  function montarLinhas(paginas, limEsp, umaColuna){
    var saida=[], esc=null; limEsp=limEsp||0.12;
    if(paginas.some(function(p){ return p.itens.length && p.itens[0].fr; })) esc=escalaDasLetras(paginas);
    /* as faturas tem duas colunas; a divisao e a posicao do cabecalho "DATA" da coluna da direita (os valores da esquerda passam do meio da pagina) */
    var divisao=null;
    paginas.forEach(function(p){
      var xs=(p.itens.length && p.itens[0].fr ? palavrasFr(p.itens, esc) : p.itens).filter(function(i){ return /^DATA\b/.test((i.t||'').trim()); }).map(function(i){ return i.x; });
      if(xs.length>=2){ var mx=Math.max.apply(null,xs), mn=Math.min.apply(null,xs); if(mx-mn>p.largura*0.25){ var d=mx-4; if(divisao===null || d<divisao) divisao=d; } }
    });
    paginas.forEach(function(p){
      var meio=umaColuna ? Infinity : (divisao!==null?divisao:p.largura/2), cols=[[],[]], fr=p.itens.length && p.itens[0].fr;
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

  /* ===== 1.10.0: rotulos tolerantes e PERFIS de banco =====
     Os rotulos de cada banco ficam num perfil (dados, abaixo). Na comparacao, espacos (inclusive no meio das palavras: o PDF.js
     as vezes parte "Lan çamentos"), acentos e maiusculas nao importam; ":" e "." podem faltar.
     Titulo de secao: o rotulo no comeco da linha E a linha sem valor no fim (para nao confundir com o subtotal da secao). */
  var ACENTOS={a:'aàáâãä',e:'eéêë',i:'iíîï',o:'oóôõö',u:'uúûü',c:'cç',n:'nñ'};
  function rotuloRe(rot){
    var out='';
    for(var i=0;i<rot.length;i++){
      var ch=rot.charAt(i); if(/\s/.test(ch)) continue;
      var cls;
      if(/[A-Za-zÀ-ÿ]/.test(ch)){ var b=semAcentoMin(ch), g=ACENTOS[b]||b; cls='['+g+g.toUpperCase()+']'; }
      else if(ch===':' || ch==='.') cls='\\'+ch+'?';
      else cls=ch.replace(/[\\^$*+?()[\]{}|\/-]/g,'\\$&');
      out+=(out?'\\s*':'')+cls;
    }
    return out;
  }
  var cacheRe={};
  function reRotulo(rot, comValor){ var k=(comValor?'v|':'t|')+(typeof rot==='string'?rot:rot.join('§'));
    if(!cacheRe[k]){ var base=typeof rot==='string'?rotuloRe(rot):rotuloRe(rot[0])+rot[1];
      cacheRe[k]=new RegExp(ICONE+base+(comValor?'\\s*(?:R\\$\\s*)?('+VAL+')$':'')); }
    return cacheRe[k]; }
  /* valor no fim de uma linha que comeca com o rotulo */
  function valorRot(rot, linha){ var m=reRotulo(rot,true).exec(linha); return m?centavos(m[1]):null; }
  var RE_VALOR_FIM=new RegExp(VAL+'$');
  /* titulo de secao: comeca com o rotulo e nao termina com valor */
  function secaoRot(rot, linha){ return reRotulo(rot,false).test(linha) && !RE_VALOR_FIM.test(linha); }
  function algumRot(lista, linha){ for(var i=0;i<lista.length;i++){ if(reRotulo(lista[i],false).test(linha)) return true; } return false; }

  /* ---- Perfil do Itau (rotulos como aparecem na fatura). Rotulo com parte variavel: [texto, regex do resto] ---- */
  var PERFIL_ITAU={
    id:'itau', banco:'Itaú',
    reconhecer:['lancamentoscomprasesaques','totaldestafatura'], marca:'itau',
    vencimento:'Vencimento:',
    totalFatura:'Total desta fatura', lancAtuais:'Lançamentos atuais', saldo:'Saldo financiado',
    encargos:['Encargos','\\s*\\(Financiamento[^)]*\\)'],
    secPagamentos:'Pagamentos efetuados', secCompras:'Lançamentos: compras e saques', secInter:'Lançamentos internacionais',
    secServicos:'Lançamentos: produtos e serviços', nomeServicos:'Produtos e serviços', secFuturas:'Compras parceladas - próximas faturas',
    fim:['Limites de crédito','Encargos cobrados'], totalLanc:'Total dos lançamentos atuais', ignorar:['DATA ESTABELECIMENTO','continua'],
    subtotal:['Lançamentos no cartão','(?:\\s*\\(final \\d{4}\\))?'], subServicos:'Lançamentos: produtos e serviços',
    interSemIof:'Total transações inter. em', iof:'Repasse de IOF em', interTotal:'Total lançamentos inter. em', proxima:'Próxima fatura'
  };
  var PERFIS=[PERFIL_ITAU];

  function lerPerfil(linhas, P){
    var r={banco:P.banco, perfil:P.id, vencimento:null, totalFatura:null, saldoFinanciado:0, encargos:0, lancAtuaisResumo:null, totalLancamentos:null,
      portadores:[], proximaFatura:null, futuras:[], erros:[]};
    var modo='', port=null, ultimo=null;
    /* vencimento: rotulo tolerante em qualquer ponto da linha, seguido da data */
    var reVenc=new RegExp(rotuloRe(P.vencimento)+'\\s*(\\d{2})\\/(\\d{2})\\/(\\d{4})');
    function portadorAtual(nome){
      var p=null; for(var i=0;i<r.portadores.length;i++){ if(r.portadores[i].nome===nome){ p=r.portadores[i]; break; } }
      if(!p){ p={nome:nome, compras:[], subtotal:null, internacionais:[], iof:0, subtotalInter:null}; r.portadores.push(p); }
      return p;
    }
    linhas.forEach(function(l){
      var m, v;
      /* estorno com o sinal separado do valor ("- 9,99", modelo antigo): junta o sinal ao numero */
      l=l.replace(/\s-\s+(\d{1,3}(?:\.\d{3})*,\d{2})$/,' -$1');
      if(r.vencimento===null && (m=reVenc.exec(l))) r.vencimento=m[3]+'-'+m[2]+'-'+m[1];
      if(r.totalFatura===null && (v=valorRot(P.totalFatura,l))!==null){ r.totalFatura=v; return; }
      if(r.lancAtuaisResumo===null && (v=valorRot(P.lancAtuais,l))!==null){ r.lancAtuaisResumo=v; return; }
      if((v=valorRot(P.saldo,l))!==null){ r.saldoFinanciado=v; return; }
      /* encargos do mes no resumo ("Encargos (Financiamento + moratório)", fatura 07/2026): fazem parte do total da fatura */
      if((v=valorRot(P.encargos,l))!==null){ r.encargos=v; return; }
      if(secaoRot(P.secPagamentos,l)){ modo='pag'; return; }
      if(secaoRot(P.secCompras,l)){ modo='compras'; ultimo=null; return; }
      if(secaoRot(P.secInter,l)){ modo='inter'; port=null; ultimo=null; return; }
      /* secao de cobrancas do proprio banco (seguros, servicos), com subtotal proprio: vira um bloco "Produtos e serviços" (fatura 07/2026) */
      if(secaoRot(P.secServicos,l)){ modo='servicos'; port=portadorAtual(P.nomeServicos); ultimo=null; return; }
      if(secaoRot(P.secFuturas,l)){ modo='futuras'; return; }
      if(algumRot(P.fim,l)){ modo='fim'; return; }
      if((v=valorRot(P.totalLanc,l))!==null){ r.totalLancamentos=v; modo='fim'; return; }
      if(algumRot(P.ignorar,l)) return;

      if(modo==='servicos'){
        if((v=valorRot(P.subServicos,l))!==null){ port.subtotal=v; ultimo=null; return; }
        if((m=RE_ITEM.exec(l))){ var ds=m[2], ps=null, mps=RE_PARC.exec(ds); if(mps){ ps=mps[1]+'/'+mps[2]; ds=ds.slice(0,mps.index+mps[0].length-5).trim(); }
          ultimo={data:m[1], descricao:ds, parcela:ps, valor:centavos(m[3]), detalhe:''}; port.compras.push(ultimo); return; }
        if(ultimo && !ultimo.detalhe && !/^DATA /.test(l)){ ultimo.detalhe=l; }
        return;
      }
      if(modo==='compras' || modo==='inter'){
        /* a linha logo abaixo de uma compra (categoria e cidade) e o detalhe dela, mesmo em maiusculas: so depois disso pode ser o nome de um portador */
        if(modo==='compras' && ultimo && !ultimo.detalhe && !RE_ITEM.test(l) && valorRot(P.subtotal,l)===null){ ultimo.detalhe=l; return; }
        if(ehPortador(l)){ port=portadorAtual(l); ultimo=null; return; }
        if(modo==='compras'){
          if((v=valorRot(P.subtotal,l))!==null){ if(port) port.subtotal=v; ultimo=null; return; }
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
        if((v=valorRot(P.interSemIof,l))!==null){ if(port) port.totalInterSemIof=v; return; }
        if((v=valorRot(P.iof,l))!==null){ if(port) port.iof=v; return; }
        if((v=valorRot(P.interTotal,l))!==null){ if(port) port.subtotalInter=v; return; }
        if((m=RE_ITEM.exec(l))){
          if(!port){ r.erros.push('Compra internacional antes do nome do portador: '+m[1]); return; }
          ultimo={data:m[1], descricao:m[2], parcela:null, valor:centavos(m[3]), detalhe:''};
          port.internacionais.push(ultimo); return;
        }
        if(ultimo){ ultimo.detalhe=(ultimo.detalhe?ultimo.detalhe+' · ':'')+l; }
        return;
      }
      if(modo==='futuras'){
        if((v=valorRot(P.proxima,l))!==null){ r.proximaFatura=v; return; }
        if((m=RE_ITEM.exec(l))){ var d2=m[2], p2=null, mp2=RE_PARC.exec(d2); if(mp2){ p2=mp2[1]+'/'+mp2[2]; d2=d2.slice(0,mp2.index+mp2[0].length-5).trim(); } r.futuras.push({data:m[1], descricao:d2, parcela:p2, valor:centavos(m[3])}); }
      }
    });
    conferir(r);
    return r;
  }
  function lerItau(linhas){ return lerPerfil(linhas, PERFIL_ITAU); }

  /* ---- 1.10.0: candidata com valores remontados ----
     Valor partido por espacos no fim da linha ("1.23 4,56", "###, ##"): junta os pedacos numericos do fim quando o resultado
     e um valor valido (fica com o mais longo). So vira candidata: a conferencia de somas decide se ela vale. */
  var RE_VAL_INTEIRO=new RegExp('^'+VAL+'$');
  function remontarValores(linhas){
    return linhas.map(function(l){
      var t=l.split(' '), k=t.length; while(k>0 && /^[-\d.,]+$/.test(t[k-1])) k--;
      for(var a=k;a<t.length-1;a++){ var junto=t.slice(a).join(''); if(RE_VAL_INTEIRO.test(junto)) return t.slice(0,a).concat([junto]).join(' '); }
      return l;
    });
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

  /* ===== 1.10.0: leitor GENERICO (experimental) =====
     Para faturas que nao sao de um banco conhecido. Procura linhas "data + descricao + valor", o vencimento e os totais por
     palavras-chave; ignora pagamentos, saldo anterior e a lista de parcelas futuras. So aceita quando a soma das compras e
     IGUAL a um total impresso e rotulado (total dos lancamentos, ou total da fatura, ou total da fatura com saldo anterior e
     pagamento). Se nao fechar, nada e gravado (a revisao manual pode ajudar). */
  var MESES_G={jan:'01',fev:'02',mar:'03',abr:'04',mai:'05',jun:'06',jul:'07',ago:'08',set:'09',out:'10',nov:'11',dez:'12'};
  var BANCOS_G=[['nubank','Nubank'],['nu pagamentos','Nubank'],['banco inter','Inter'],['inter&co','Inter'],['c6 bank','C6 Bank'],['c6bank','C6 Bank'],
    ['bradesco','Bradesco'],['santander','Santander'],['caixa economica','Caixa'],['banco do brasil','Banco do Brasil'],['ourocard','Banco do Brasil'],
    ['sicredi','Sicredi'],['sicoob','Sicoob'],['picpay','PicPay'],['mercado pago','Mercado Pago'],['btg pactual','BTG Pactual'],['banco pan','Pan'],
    ['will bank','Will Bank'],['porto seguro','Porto Seguro'],['credicard','Credicard'],['banrisul','Banrisul'],['safra','Safra'],['digio','Digio'],
    ['neon pagamentos','Neon'],['xp investimentos','XP'],['itau','Itaú']];
  var DATA_G='(\\d{2})[\\/.](\\d{2})(?:[\\/.](\\d{2,4}))?|(\\d{1,2})\\s?(?:de\\s)?(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[a-zç]*\\.?(?:\\s?(?:de\\s)?\\d{4})?';
  var VAL_G='(-\\s?)?(?:R\\$\\s?)?(-\\s?)?(\\d{1,3}(?:\\.\\d{3})*,\\d{2})(\\s?(?:-|CR|C|D))?';
  var RE_ITEM_G=new RegExp('^(?:'+DATA_G+')\\s+(.*?)\\s+'+VAL_G+'$','i');
  var RE_VAL_FIM_G=new RegExp('\\s'+VAL_G+'$','i');
  var RE_EXCLUI_G=/\b(pagamentos?|pagto|pgto|saldo\s+anterior|fatura\s+anterior|total|subtotal|cr[eé]dito\s+de\s+pagamento|limite)\b/i;
  var RE_FUTURAS_G=/(pr[oó]xim[ao]s?\s+faturas?|lan[cç]amentos\s+futuros|parcelas?\s+futuras|faturas\s+futuras|compras\s+parceladas\s*[-–:]?\s*pr[oó]xim)/i;
  var RE_SECAO_COMPRAS_G=/^(lan[cç]amentos|compras|transa[cç][oõ]es|despesas|movimenta[cç][oõ]es|extrato|detalhamento)/i;
  var RE_ENCARGO_SEM_DATA_G=/^(iof|repasse\s+de\s+iof|anuidade|juros|encargos|multa|tarifa)\b/i;
  var TOT_FATURA_G=/(total\s+(da|desta)\s+fatura|valor\s+total(\s+da\s+fatura)?|total\s+a\s+pagar|pagamento\s+total|valor\s+da\s+fatura)/i;
  var TOT_LANC_G=/(total\s+(de|das|dos)\s+(compras|lan[cç]amentos|despesas|transa[cç][oõ]es)|lan[cç]amentos\s+atuais|total\s+geral|total\s+do\s+per[ií]odo|lan[cç]amentos\s+do\s+per[ií]odo)/i;
  var SALDO_G=/(saldo\s+anterior|fatura\s+anterior|saldo\s+financiado|saldo\s+em\s+aberto)/i;
  var PAG_G=/\b(pagamentos?|pagto|pgto)\b/i;
  function valorG(m, base){ var neg=!!(m[base]||m[base+1]) || /^(-|CR|C)$/i.test(String(m[base+3]||'').trim()); var c=centavos(m[base+2]); return neg?-c:c; }
  function dataG(m){ if(m[1]) return m[1]+'/'+m[2]; var mes=MESES_G[String(m[5]).toLowerCase().slice(0,3)]; return ('0'+m[4]).slice(-2)+'/'+mes; }
  function bancoG(linhas){
    var txt=' '+semAcentoMin(linhas.slice(0,80).join(' '))+' ', melhor=null, pos=Infinity;
    BANCOS_G.forEach(function(b){ var i=txt.indexOf(b[0]); if(i>=0 && i<pos){ pos=i; melhor=b[1]; } });
    return melhor;
  }
  function vencimentoG(linhas){
    var re=new RegExp('(vencimento|vence\\s+em|pagar\\s+at[eé]|data\\s+de\\s+vencimento)[^0-9]{0,12}(\\d{2})[\\/.](\\d{2})[\\/.](\\d{2,4})','i');
    var reExt=new RegExp('(vencimento|vence\\s+em|pagar\\s+at[eé])[^0-9]{0,12}(\\d{1,2})\\s?(?:de\\s)?(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[a-zç]*\\.?\\s?(?:de\\s)?(\\d{4})','i');
    for(var i=0;i<linhas.length;i++){
      var l=linhas[i]+(linhas[i+1]?' '+linhas[i+1]:''), m;
      if((m=re.exec(l))){ var a=m[4].length===2?'20'+m[4]:m[4]; return a+'-'+m[3]+'-'+m[2]; }
      if((m=reExt.exec(l))) return m[4]+'-'+MESES_G[m[3].toLowerCase().slice(0,3)]+'-'+('0'+m[2]).slice(-2);
    }
    return null;
  }
  function lerGenerico(linhas){
    var r={banco:bancoG(linhas)||'Cartão', perfil:'generico', experimental:true, vencimento:vencimentoG(linhas), totalFatura:null, saldoFinanciado:0, encargos:0,
      lancAtuaisResumo:null, totalLancamentos:null, portadores:[], proximaFatura:null, futuras:[], erros:[]};
    var compras=[], semData=[], TF=[], TL=[], SA=[], PG=[], futuras=false, ultimo=null;
    linhas.forEach(function(l){
      l=l.replace(/\s+/g,' ').trim(); var m, mv=RE_VAL_FIM_G.exec(l);
      if(!mv){ /* titulo de secao */
        if(RE_FUTURAS_G.test(l)){ futuras=true; ultimo=null; return; }
        if(RE_SECAO_COMPRAS_G.test(l)){ futuras=false; ultimo=null; return; }
        if(ultimo && !ultimo.detalhe && l.length<=60 && !/^data\b/i.test(l)) ultimo.detalhe=l;
        return;
      }
      var antes=l.slice(0,mv.index), v=valorG(mv,1);
      if((m=RE_ITEM_G.exec(l))){
        var desc=m[6];
        if(futuras || RE_EXCLUI_G.test(desc)){ ultimo=null; return; }
        var parc=null, mp=/(?:\s|^)(\d{1,2})\s?(?:\/|de)\s?(\d{1,2})$/i.exec(desc);
        if(mp && +mp[1]>=1 && +mp[1]<=+mp[2] && +mp[2]>1 && +mp[2]<=99){ parc=('0'+mp[1]).slice(-2)+'/'+('0'+mp[2]).slice(-2); desc=desc.slice(0,mp.index).trim(); }
        ultimo={data:dataG(m), descricao:desc, parcela:parc, valor:valorG(m,7), detalhe:''}; compras.push(ultimo); return;
      }
      ultimo=null;
      if(futuras) return;
      if(SALDO_G.test(antes)) SA.push(v);
      else if(TOT_FATURA_G.test(antes)) TF.push(v);
      else if(TOT_LANC_G.test(antes)) TL.push(v);
      else if(PAG_G.test(antes)) PG.push(Math.abs(v));
      else if(RE_ENCARGO_SEM_DATA_G.test(antes.trim()) && v!==0) semData.push({data:'', descricao:antes.trim(), parcela:null, valor:v, detalhe:''});
    });
    var S=soma(compras), Sx=S+soma(semData), regra=null, totalFat=TF.length?TF[0]:null;
    function tentar(soma, extra){
      for(var i=0;i<TL.length;i++) if(TL[i]===soma) return {lanc:soma, regra:'total dos lançamentos', extra:extra};
      for(i=0;i<TF.length;i++) if(TF[i]===soma) return {lanc:soma, regra:'total da fatura', fat:TF[i], extra:extra};
      for(i=0;i<TF.length;i++) for(var a=0;a<SA.length;a++) for(var p=0;p<=PG.length;p++){ var pg=p<PG.length?PG[p]:0; if(soma+SA[a]-pg===TF[i] && SA[a]!==0) return {lanc:soma, regra:'total da fatura com saldo anterior', fat:TF[i], extra:extra}; }
      return null;
    }
    var ok=tentar(S,false) || (semData.length ? tentar(Sx,true) : null), fatNaoFecha=false;
    /* o total da fatura escolhido tem de fechar com os lancamentos: igual, ou a diferenca e um saldo anterior (menos um pagamento) impresso */
    function fecha(fat, lanc){ var d=fat-lanc; if(d===0) return true;
      for(var a=0;a<SA.length;a++){ if(SA[a]===d) return true; for(var p=0;p<PG.length;p++) if(SA[a]-PG[p]===d) return true; } return false; }
    if(ok){
      if(ok.extra) compras=compras.concat(semData);
      if(ok.fat!=null) totalFat=ok.fat;
      else { totalFat=null; for(var t=0;t<TF.length;t++){ if(fecha(TF[t], ok.lanc)){ totalFat=TF[t]; break; } } if(totalFat===null && TF.length) fatNaoFecha=true; }
      r.totalLancamentos=ok.lanc; r.regra=ok.regra;
    } else if(TL.length) r.totalLancamentos=TL[0];
    r.totalFatura=totalFat;
    if(r.totalFatura!=null && r.totalLancamentos!=null) r.saldoFinanciado=r.totalFatura-r.totalLancamentos;   /* saldo anterior menos pagamento (pode ser 0) */
    if(compras.length) r.portadores=[{nome:'Compras', compras:compras, subtotal:ok?ok.lanc:null, internacionais:[], iof:0, subtotalInter:null}];
    var e=r.erros;
    if(!compras.length) e.push('Leitura genérica: não encontrei linhas de compra (data, descrição e valor).');
    if(!r.vencimento) e.push('Leitura genérica: não encontrei a data de vencimento.');
    if(fatNaoFecha) e.push('Leitura genérica: as compras batem com o total dos lançamentos ('+brl(r.totalLancamentos)+'), mas o total da fatura não fecha com ele.');
    else if(r.totalFatura==null) e.push('Leitura genérica: não encontrei o total da fatura.');
    if(compras.length && !ok) e.push('Leitura genérica: as compras somam '+brl(S)+(semData.length?' ('+brl(Sx)+' com '+semData.length+' encargo(s) sem data)':'')+', mas não encontrei esse valor entre os totais impressos na fatura'+(TF.concat(TL).length?' (achei: '+TF.concat(TL).map(brl).join(', ')+')':'')+'.');
    r.somaConferida=ok?ok.lanc:S;
    r.ok=e.length===0;
    return r;
  }

  /* reconhece o perfil pelo texto todo sem espacos, acentos, maiusculas e ":" (tolerante a palavras partidas) */
  function reconhecerPerfil(linhas){
    var txt=semAcentoMin(linhas.join(' ')).replace(/[\s:]/g,'');
    for(var i=0;i<PERFIS.length;i++){ var P=PERFIS[i]; if(txt.indexOf(P.marca)>=0 && P.reconhecer.every(function(x){ return txt.indexOf(x)>=0; })) return P; }
    return null;
  }
  function reconhecer(linhas){ var P=reconhecerPerfil(linhas); return P?P.id:null; }
  /* 1.10.0: varias candidatas para o mesmo texto; vale a primeira cuja conferencia fecha (com o total impresso e rotulado) */
  function ler(paginas){
    var linhas=montarLinhas(paginas), P=reconhecerPerfil(linhas);
    if(!P){
      /* 1.10.0: banco desconhecido -> leitor generico (experimental), com e sem divisao em duas colunas, e com valores remontados */
      var cands=[linhas, montarLinhas(paginas, null, true)], melhor=null;
      for(var i=0;i<cands.length;i++){
        var vs=[cands[i], remontarValores(cands[i])];
        for(var j=0;j<vs.length;j++){ if(j===1 && vs[1].join('\n')===vs[0].join('\n')) continue;
          var rg=lerGenerico(vs[j]); if(rg.ok) return rg;
          if(rg.portadores.length && (!melhor || rg.erros.length<melhor.erros.length)) melhor=rg; }
      }
      if(melhor) return melhor;
      return {ok:false, banco:null, erros:['Não reconheci o modelo desta fatura: não achei compras com data e valor. Você pode lançar a fatura à mão.'], portadores:[]};
    }
    var r1=lerPerfil(linhas, P); if(r1.ok) return r1;
    var l2=remontarValores(linhas);
    if(l2.join('\n')!==linhas.join('\n')){ var r2=lerPerfil(l2, P); r2.candidata='valores remontados'; if(r2.ok) return r2;
      /* nenhuma fechou: mostra os erros da leitura que chegou mais perto (menos erros) */
      if(r2.erros.length<r1.erros.length) return r2; }
    return r1;
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

  var api={ler:ler, montarLinhas:montarLinhas, lerItau:lerItau, lerPerfil:lerPerfil, remontarValores:remontarValores, PERFIS:PERFIS, lerGenerico:lerGenerico, centavos:centavos, brl:brl, fragmentosDaPagina:fragmentosDaPagina, diagnostico:diagnostico, mascarar:mascarar};
  if(typeof module!=='undefined' && module.exports) module.exports=api; else raiz.FLUI_LEITOR_FATURA=api;
})(typeof window!=='undefined'?window:this);
