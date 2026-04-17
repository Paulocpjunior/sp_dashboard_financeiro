const { google } = require('googleapis');

async function getToken() {
  const auth = new google.auth.GoogleAuth({ scopes: ['https://www.googleapis.com/auth/datastore'] });
  const token = await (await auth.getClient()).getAccessToken();
  return token.token;
}

const PAGAS = {
  'wix-inv-0004058': '2026-04-05',
  'wix-inv-0004059': '2026-04-05',
  'wix-inv-0004060': '2026-04-05',
  'wix-inv-0004065': '2026-03-26',
  'wix-inv-0004066': '2026-03-27',
};

const invoices = [
  {id:'wix-inv-0004059',client:'REALITY COM IMPORTACAO E EXPORTACAO LTDA',valorOriginal:8220,date:'2026-03-26',dueDate:'2026-03-26',description:'Fatura Wix #0004059',wixInvoiceNumber:'0004059'},
  {id:'wix-inv-0004060',client:'KROYA IMPORTADORA E DISTRIBUIDORA COMERCIAL LTDA',valorOriginal:3650,date:'2026-03-26',dueDate:'2026-03-26',description:'Fatura Wix #0004060',wixInvoiceNumber:'0004060'},
  {id:'wix-inv-0004061',client:'PRONTO SOCORRO INDUSTRIA E COMERCIO DE VIDROS LTDA',valorOriginal:600,date:'2026-03-26',dueDate:'2026-04-05',description:'Fatura Wix #0004061',wixInvoiceNumber:'0004061'},
  {id:'wix-inv-0004062',client:'PRONTO SOCORRO INDUSTRIA E COMERCIO DE VIDROS LTDA',valorOriginal:2990,date:'2026-03-26',dueDate:'2026-04-05',description:'Fatura Wix #0004062',wixInvoiceNumber:'0004062'},
  {id:'wix-inv-0004063',client:'FORTYMIL INDUSTRIA DE PLASTICOS LTDA MATRIZ',valorOriginal:4930,date:'2026-03-26',dueDate:'2026-04-15',description:'Fatura Wix #0004063',wixInvoiceNumber:'0004063'},
  {id:'wix-inv-0004064',client:'PLASTIMIL INDUSTRIA E COMERCIO DE PLASTICOS LTDA',valorOriginal:2170,date:'2026-03-26',dueDate:'2026-04-15',description:'Fatura Wix #0004064',wixInvoiceNumber:'0004064'},
  {id:'wix-inv-0004065',client:'SEA LINE LOGISTICA LTDA',valorOriginal:100,date:'2026-03-26',dueDate:'2026-03-26',description:'Fatura Wix #0004065',wixInvoiceNumber:'0004065'},
  {id:'wix-inv-0004066',client:'IVAN INACIO DA SILVA APOIO ADMINISTRATIVO',valorOriginal:300,date:'2026-03-27',dueDate:'2026-03-27',description:'Fatura Wix #0004066',wixInvoiceNumber:'0004066'},
  {id:'wix-inv-0004058',client:'GOLDLOG ARMAZENS GERAIS E LOGISTICA LTDA',valorOriginal:2610,date:'2026-03-26',dueDate:'2026-03-26',description:'Fatura Wix #0004058',wixInvoiceNumber:'0004058'},
  {id:'wix-inv-0004057',client:'ZYX INFORMATICA LTDA',valorOriginal:1600,date:'2026-03-26',dueDate:'2026-03-26',description:'Fatura Wix #0004057',wixInvoiceNumber:'0004057'},
  {id:'wix-inv-0004056',client:'J.N. VINATEX COMERCIO DE TECIDOS LTDA MATRIZ',valorOriginal:26650,date:'2026-03-26',dueDate:'2026-04-05',description:'Fatura Wix #0004056',wixInvoiceNumber:'0004056'},
  {id:'wix-inv-0004055',client:'VINATEX DISTRIBUIDORA DE TECIDOS LTDA',valorOriginal:2420,date:'2026-03-26',dueDate:'2026-04-05',description:'Fatura Wix #0004055',wixInvoiceNumber:'0004055'},
  {id:'wix-inv-0004054',client:'SEA LINE LOGISTICA LTDA',valorOriginal:4110,date:'2026-03-26',dueDate:'2026-04-05',description:'Fatura Wix #0004054',wixInvoiceNumber:'0004054'},
  {id:'wix-inv-0004053',client:'CLUDE CLUBE DE DESCONTOS LTDA',valorOriginal:300,date:'2026-03-24',dueDate:'2026-03-24',description:'Fatura Wix #0004053',wixInvoiceNumber:'0004053'},
  {id:'wix-inv-0004052',client:'JEN PARTICIPACOES LTDA',valorOriginal:1500,date:'2026-03-20',dueDate:'2026-03-20',description:'Fatura Wix #0004052',wixInvoiceNumber:'0004052'},
  {id:'wix-inv-0004051',client:'FLAVIA DA SILVA CHAVES',valorOriginal:1500,date:'2026-03-20',dueDate:'2026-03-20',description:'Fatura Wix #0004051',wixInvoiceNumber:'0004051'},
  {id:'wix-inv-0004050',client:'RISCOFER TINTAS',valorOriginal:2500,date:'2026-03-20',dueDate:'2026-03-20',description:'Fatura Wix #0004050',wixInvoiceNumber:'0004050'},
  {id:'wix-inv-0004049',client:'CADEIRAS GENNARO FERRANTE LTDA',valorOriginal:500,date:'2026-03-20',dueDate:'2026-03-20',description:'Fatura Wix #0004049',wixInvoiceNumber:'0004049'},
  {id:'wix-inv-0004048',client:'STREET FOODS COMERCIO DE ALIMENTOS LTDA',valorOriginal:300,date:'2026-03-19',dueDate:'2026-03-19',description:'Fatura Wix #0004048',wixInvoiceNumber:'0004048'},
  {id:'wix-inv-0004047',client:'J V C SILVA PROJETOS DE INOVACAO E TECNOLOGIA LTDA',valorOriginal:1750,date:'2026-03-17',dueDate:'2026-03-17',description:'Fatura Wix #0004047',wixInvoiceNumber:'0004047'},
  {id:'wix-inv-0004046',client:'R2 CONSULTORIA E SERVICOS EMPRESARIAIS LTDA',valorOriginal:1500,date:'2026-03-16',dueDate:'2026-03-16',description:'Fatura Wix #0004046',wixInvoiceNumber:'0004046'},
  {id:'wix-inv-0004045',client:'SEA LINE LOGISTICA LTDA',valorOriginal:2000,date:'2026-03-16',dueDate:'2026-03-16',description:'Fatura Wix #0004045',wixInvoiceNumber:'0004045'},
  {id:'wix-inv-0004044',client:'OPPORTUNITY LOGISTICA E TRANSPORTES EIRELI',valorOriginal:2500,date:'2026-03-16',dueDate:'2026-03-16',description:'Fatura Wix #0004044',wixInvoiceNumber:'0004044'},
  {id:'wix-inv-0004043',client:'CASA DA CRIANCA BETINHO LAR ESPIRITA PARA EXCEPCIONAIS',valorOriginal:4650,date:'2026-03-13',dueDate:'2026-03-13',description:'Fatura Wix #0004043',wixInvoiceNumber:'0004043'},
  {id:'wix-inv-0004042',client:'LUCIANA GANDOLFO',valorOriginal:1000,date:'2026-03-12',dueDate:'2026-03-12',description:'Fatura Wix #0004042',wixInvoiceNumber:'0004042'},
  {id:'wix-inv-0004041',client:'DAXX SOLUTIONS LTDA',valorOriginal:300,date:'2026-03-11',dueDate:'2026-03-11',description:'Fatura Wix #0004041',wixInvoiceNumber:'0004041'},
  {id:'wix-inv-0004040',client:'BETA AGRONEGOCIOS LTDA GRUPO ACAST',valorOriginal:4414.06,date:'2026-03-10',dueDate:'2026-03-10',description:'Fatura Wix #0004040',wixInvoiceNumber:'0004040'},
  {id:'wix-inv-0004039',client:'RICARDO CAETANO FONSECA',valorOriginal:500,date:'2026-03-09',dueDate:'2026-03-09',description:'Fatura Wix #0004039',wixInvoiceNumber:'0004039'},
  {id:'wix-inv-0004038',client:'AVACY DISTRIBUIDORA E COMERCIO DE CALCADOS LTDA',valorOriginal:2652,date:'2026-03-09',dueDate:'2026-03-09',description:'Fatura Wix #0004038',wixInvoiceNumber:'0004038'},
  {id:'wix-inv-0004037',client:'GS ODONTOLOGIA LTDA',valorOriginal:2200,date:'2026-03-05',dueDate:'2026-03-05',description:'Fatura Wix #0004037',wixInvoiceNumber:'0004037'},
  {id:'wix-inv-0004036',client:'VANESSA SOARES CANDIDO DE SOUZA MELO',valorOriginal:1000,date:'2026-03-04',dueDate:'2026-03-04',description:'Fatura Wix #0004036',wixInvoiceNumber:'0004036'},
  {id:'wix-inv-0004034',client:'SERPOL CONSTRUCOES E SERVICOS LTDA',valorOriginal:1900,date:'2026-03-03',dueDate:'2026-03-03',description:'Fatura Wix #0004034',wixInvoiceNumber:'0004034'},
  {id:'wix-inv-0004033',client:'RALIFE ENGENHARIA LTDA',valorOriginal:300,date:'2026-03-03',dueDate:'2026-03-03',description:'Fatura Wix #0004033',wixInvoiceNumber:'0004033'},
  {id:'wix-inv-0004032',client:'ELS COMERCIO DE BANANAS LTDA',valorOriginal:2200,date:'2026-03-03',dueDate:'2026-03-03',description:'Fatura Wix #0004032',wixInvoiceNumber:'0004032'},
  {id:'wix-inv-0004031',client:'IRB ORION GROUP LTDA',valorOriginal:3000,date:'2026-03-02',dueDate:'2026-03-02',description:'Fatura Wix #0004031',wixInvoiceNumber:'0004031'},
  {id:'wix-inv-0004030',client:'PETROS EVENTOS POUSADA E ECOTURISMO LTDA',valorOriginal:500,date:'2026-03-02',dueDate:'2026-03-02',description:'Fatura Wix #0004030',wixInvoiceNumber:'0004030'},
  {id:'wix-inv-0004029',client:'KROYA IMPORTADORA E DISTRIBUIDORA COMERCIAL LTDA',valorOriginal:3300,date:'2026-02-27',dueDate:'2026-02-27',description:'Fatura Wix #0004029',wixInvoiceNumber:'0004029'},
  {id:'wix-inv-0004028',client:'REALITY COM IMPORTACAO E EXPORTACAO LTDA',valorOriginal:7870,date:'2026-02-27',dueDate:'2026-02-27',description:'Fatura Wix #0004028',wixInvoiceNumber:'0004028'},
  {id:'wix-inv-0004027',client:'PRONTO SOCORRO INDUSTRIA E COMERCIO DE VIDROS LTDA',valorOriginal:3750,date:'2026-02-27',dueDate:'2026-02-27',description:'Fatura Wix #0004027',wixInvoiceNumber:'0004027'},
  {id:'wix-inv-0004026',client:'J.N. VINATEX COMERCIO DE TECIDOS LTDA MATRIZ',valorOriginal:26100,date:'2026-02-27',dueDate:'2026-02-27',description:'Fatura Wix #0004026',wixInvoiceNumber:'0004026'},
  {id:'wix-inv-0004025',client:'GOLDLOG ARMAZENS GERAIS E LOGISTICA LTDA',valorOriginal:2260,date:'2026-02-27',dueDate:'2026-02-27',description:'Fatura Wix #0004025',wixInvoiceNumber:'0004025'},
  {id:'wix-inv-0004024',client:'ZYX INFORMATICA LTDA',valorOriginal:1450,date:'2026-02-27',dueDate:'2026-02-27',description:'Fatura Wix #0004024',wixInvoiceNumber:'0004024'},
  {id:'wix-inv-0004023',client:'PRONTO SOCORRO INDUSTRIA E COMERCIO DE VIDROS',valorOriginal:2990,date:'2026-02-27',dueDate:'2026-02-27',description:'Fatura Wix #0004023',wixInvoiceNumber:'0004023'},
  {id:'wix-inv-0004022',client:'VINATEX DISTRIBUIDORA DE TECIDOS LTDA',valorOriginal:2420,date:'2026-02-27',dueDate:'2026-02-27',description:'Fatura Wix #0004022',wixInvoiceNumber:'0004022'},
  {id:'wix-inv-0004021',client:'PRONTO SOCORRO INDUSTRIA E COMERCIO DE VIDROS LTDA',valorOriginal:600,date:'2026-02-27',dueDate:'2026-02-27',description:'Fatura Wix #0004021',wixInvoiceNumber:'0004021'},
  {id:'wix-inv-0004020',client:'SEA LINE LOGISTICA LTDA',valorOriginal:3960,date:'2026-02-27',dueDate:'2026-02-27',description:'Fatura Wix #0004020',wixInvoiceNumber:'0004020'},
  {id:'wix-inv-0004019',client:'DISTRIBUIDORA DE BANAS ELS LTDA',valorOriginal:2200,date:'2026-02-27',dueDate:'2026-02-27',description:'Fatura Wix #0004019',wixInvoiceNumber:'0004019'},
  {id:'wix-inv-0004018',client:'HIGI MULHER COMERCIO LTDA',valorOriginal:2200,date:'2026-02-26',dueDate:'2026-02-26',description:'Fatura Wix #0004018',wixInvoiceNumber:'0004018'},
  {id:'wix-inv-0004017',client:'CENTRO MEDICO PEDIATRICO KAWAI KODOMO',valorOriginal:600,date:'2026-02-24',dueDate:'2026-02-24',description:'Fatura Wix #0004017',wixInvoiceNumber:'0004017'},
  {id:'wix-inv-0004016',client:'STUDIO ORALE ODONTOLOGIA EIRELI',valorOriginal:600,date:'2026-02-24',dueDate:'2026-02-24',description:'Fatura Wix #0004016',wixInvoiceNumber:'0004016'},
  {id:'wix-inv-0004015',client:'MONICA MOROMIZATO ENDOCRINOLOGIA',valorOriginal:600,date:'2026-02-24',dueDate:'2026-02-24',description:'Fatura Wix #0004015',wixInvoiceNumber:'0004015'},
  {id:'wix-inv-0004014',client:'SEOFT SERVICOS ESPECIALIZADOS EM OFTALMOLOGIA',valorOriginal:600,date:'2026-02-24',dueDate:'2026-02-24',description:'Fatura Wix #0004014',wixInvoiceNumber:'0004014'},
  {id:'wix-inv-0004012',client:'SPA SAUDE SISTEMA DE PROMOCAO ASSISTENCIAL',valorOriginal:600,date:'2026-02-24',dueDate:'2026-02-24',description:'Fatura Wix #0004012',wixInvoiceNumber:'0004012'},
  {id:'wix-inv-0004011',client:'VTR BIOTECH LTDA',valorOriginal:1500,date:'2026-02-25',dueDate:'2026-02-25',description:'Fatura Wix #0004011',wixInvoiceNumber:'0004011'},
  {id:'wix-inv-0004010',client:'COMUNIDADE EVANGELICA SARA NOSSA TERRA DO AMAZONAS',valorOriginal:125,date:'2026-02-25',dueDate:'2026-02-25',description:'Fatura Wix #0004010',wixInvoiceNumber:'0004010'},
  {id:'wix-inv-0004009',client:'RRC CAMBIO EXCHANGE LTDA',valorOriginal:500,date:'2026-02-25',dueDate:'2026-02-25',description:'Fatura Wix #0004009',wixInvoiceNumber:'0004009'},
  {id:'wix-inv-0004008',client:'ARNAUT DISTRIBUIDORA DE PRODUTOS ALIMENTICIOS LTDA',valorOriginal:1684.98,date:'2026-02-25',dueDate:'2026-02-25',description:'Fatura Wix #0004008',wixInvoiceNumber:'0004008'},
  {id:'wix-inv-0004007',client:'GMX COMERCIAL DE UNIFORMES EIRELI',valorOriginal:350,date:'2026-02-24',dueDate:'2026-02-24',description:'Fatura Wix #0004007',wixInvoiceNumber:'0004007'},
  {id:'wix-inv-0004006',client:'SERPOL CONSTRUCOES E SERVICOS LTDA',valorOriginal:4800,date:'2026-02-24',dueDate:'2026-02-24',description:'Fatura Wix #0004006',wixInvoiceNumber:'0004006'},
  {id:'wix-inv-0004004',client:'FRN PARTICIPACOES LTDA',valorOriginal:1500,date:'2026-02-24',dueDate:'2026-02-24',description:'Fatura Wix #0004004',wixInvoiceNumber:'0004004'},
  {id:'wix-inv-0004003',client:'VINCENZO GUERRA BANANAS LTDA MATRIZ',valorOriginal:2200,date:'2026-02-23',dueDate:'2026-02-23',description:'Fatura Wix #0004003',wixInvoiceNumber:'0004003'},
  {id:'wix-inv-0004002',client:'BMTV PARTICIPACOES',valorOriginal:1500,date:'2026-02-20',dueDate:'2026-02-20',description:'Fatura Wix #0004002',wixInvoiceNumber:'0004002'},
  {id:'wix-inv-0004000',client:'VTR BIOTECH LTDA',valorOriginal:2800,date:'2026-02-12',dueDate:'2026-02-12',description:'Fatura Wix #0004000',wixInvoiceNumber:'0004000'},
  {id:'wix-inv-0003999',client:'DAXX SOLUTIONS LTDA',valorOriginal:2200,date:'2026-02-10',dueDate:'2026-02-10',description:'Fatura Wix #0003999',wixInvoiceNumber:'0003999'},
  {id:'wix-inv-0003998',client:'CHRISTIAN FAMILY INSTITUICAO DE PAGAMENTO SA',valorOriginal:3000,date:'2026-02-10',dueDate:'2026-02-10',description:'Fatura Wix #0003998',wixInvoiceNumber:'0003998'},
  {id:'wix-inv-0003997',client:'BOLA N AGUA ACADEMIA LTDA',valorOriginal:300,date:'2026-02-06',dueDate:'2026-02-06',description:'Fatura Wix #0003997',wixInvoiceNumber:'0003997'},
  {id:'wix-inv-0003996',client:'FRN PARTICIPACOES LTDA',valorOriginal:575,date:'2026-02-05',dueDate:'2026-02-05',description:'Fatura Wix #0003996',wixInvoiceNumber:'0003996'},
  {id:'wix-inv-0003995',client:'AZ PARTICIPACOES LTDA',valorOriginal:1500,date:'2026-02-05',dueDate:'2026-02-05',description:'Fatura Wix #0003995',wixInvoiceNumber:'0003995'},
  {id:'wix-inv-0003994',client:'SJZ PARTICIPACOES LTDA',valorOriginal:1500,date:'2026-02-05',dueDate:'2026-02-05',description:'Fatura Wix #0003994',wixInvoiceNumber:'0003994'},
  {id:'wix-inv-0003993',client:'COMUNIDADE EVANGELICA SARA NOSSA TERRA EXTREMO SUL',valorOriginal:300,date:'2026-02-05',dueDate:'2026-02-05',description:'Fatura Wix #0003993',wixInvoiceNumber:'0003993'},
  {id:'wix-inv-0003992',client:'J.N. VINATEX COMERCIO DE TECIDOS LTDA',valorOriginal:1500,date:'2026-02-05',dueDate:'2026-02-05',description:'Fatura Wix #0003992',wixInvoiceNumber:'0003992'},
  {id:'wix-inv-0003991',client:'SUSANNE SOFIA SCHUMACHER SCHIRATO',valorOriginal:3000,date:'2026-02-04',dueDate:'2026-02-04',description:'Fatura Wix #0003991',wixInvoiceNumber:'0003991'},
  {id:'wix-inv-0003990',client:'ADRIANA ELISABETH SANTOS DO NASCIMENTO',valorOriginal:500,date:'2026-02-03',dueDate:'2026-02-03',description:'Fatura Wix #0003990',wixInvoiceNumber:'0003990'},
  {id:'wix-inv-0003989',client:'LIA PAULA NASCIMENTO LOMBADO',valorOriginal:500,date:'2026-02-03',dueDate:'2026-02-03',description:'Fatura Wix #0003989',wixInvoiceNumber:'0003989'},
  {id:'wix-inv-0003988',client:'OSWALDO PEREIRA DO NASCIMENTO',valorOriginal:500,date:'2026-02-03',dueDate:'2026-02-03',description:'Fatura Wix #0003988',wixInvoiceNumber:'0003988'},
  {id:'wix-inv-0003987',client:'EDITH ORTIZ DOS SANTOS',valorOriginal:500,date:'2026-02-03',dueDate:'2026-02-03',description:'Fatura Wix #0003987',wixInvoiceNumber:'0003987'},
  {id:'wix-inv-0003986',client:'WALDESA MOTOMERCANTIL LTDA',valorOriginal:300,date:'2026-02-02',dueDate:'2026-02-02',description:'Fatura Wix #0003986',wixInvoiceNumber:'0003986'},
  {id:'wix-inv-0003985',client:'PROTOTYPE INSTITUICAO DE PAGAMENTOS SA',valorOriginal:300,date:'2026-02-02',dueDate:'2026-02-02',description:'Fatura Wix #0003985',wixInvoiceNumber:'0003985'},
  {id:'wix-inv-0003984',client:'RENDAPE PARTICIPACOES LTDA',valorOriginal:2200,date:'2026-01-30',dueDate:'2026-01-30',description:'Fatura Wix #0003984',wixInvoiceNumber:'0003984'},
  {id:'wix-inv-0003983',client:'MCADOFFICES COMERCIO DE MOVEIS',valorOriginal:2500,date:'2026-01-30',dueDate:'2026-01-30',description:'Fatura Wix #0003983',wixInvoiceNumber:'0003983'},
  {id:'wix-inv-0003981',client:'MARCELO ARNAUT',valorOriginal:3369.96,date:'2026-01-29',dueDate:'2026-01-29',description:'Fatura Wix #0003981',wixInvoiceNumber:'0003981'},
  {id:'wix-inv-0003980',client:'WILLIAM LIMA CABRAL',valorOriginal:5000,date:'2026-01-29',dueDate:'2026-01-29',description:'Fatura Wix #0003980',wixInvoiceNumber:'0003980'},
  {id:'wix-inv-0003979',client:'SERPOL CONSTRUCOES E SERVICOS LTDA',valorOriginal:3800,date:'2026-01-29',dueDate:'2026-01-29',description:'Fatura Wix #0003979',wixInvoiceNumber:'0003979'},
  {id:'wix-inv-0003978',client:'EDUCATI',valorOriginal:500,date:'2026-01-28',dueDate:'2026-01-28',description:'Fatura Wix #0003978',wixInvoiceNumber:'0003978'},
  {id:'wix-inv-0003977',client:'CONSTRUCTO ENGENHARIA E CONSTRUCAO LTDA',valorOriginal:3000,date:'2026-01-28',dueDate:'2026-01-28',description:'Fatura Wix #0003977',wixInvoiceNumber:'0003977'},
  {id:'wix-inv-0003976',client:'RISCOFER TINTAS',valorOriginal:1750,date:'2026-01-28',dueDate:'2026-01-28',description:'Fatura Wix #0003976',wixInvoiceNumber:'0003976'},
  {id:'wix-inv-0003975',client:'SJZ PARTICIPACOES LTDA',valorOriginal:575,date:'2026-01-26',dueDate:'2026-01-26',description:'Fatura Wix #0003975',wixInvoiceNumber:'0003975'},
  {id:'wix-inv-0003974',client:'KROYA IMPORTADORA E DISTRIBUIDORA COMERCIAL LTDA',valorOriginal:3300,date:'2026-01-21',dueDate:'2026-01-21',description:'Fatura Wix #0003974',wixInvoiceNumber:'0003974'},
  {id:'wix-inv-0003952',client:'CASA DA CRIANCA BETINHO LAR ESPIRITA PARA EXCEPCIONAIS',valorOriginal:500,date:'2026-01-07',dueDate:'2026-01-07',description:'Fatura Wix #0003952',wixInvoiceNumber:'0003952'},
  {id:'wix-inv-0003948',client:'COMUNIDADE EVANGELICA SARA NOSSA TERRA DA FREGUESIA',valorOriginal:250,date:'2026-01-05',dueDate:'2026-01-05',description:'Fatura Wix #0003948',wixInvoiceNumber:'0003948'},
];

async function run() {
  const token = await getToken();
  let ok = 0, err = 0;
  for (const inv of invoices) {
    const isPaga = !!PAGAS[inv.id];
    const status = isPaga ? 'Paga' : 'Pendente';
    const paymentDate = PAGAS[inv.id] || '';
    const fields = {
      source:           {stringValue:'wix'},
      movement:         {stringValue:'Entrada'},
      type:             {stringValue:'Entrada de Caixa / Contas a Receber'},
      status:           {stringValue:status},
      client:           {stringValue:inv.client},
      description:      {stringValue:inv.description},
      date:             {stringValue:inv.date},
      dueDate:          {stringValue:inv.dueDate},
      paymentDate:      {stringValue:paymentDate},
      valorOriginal:    {doubleValue:inv.valorOriginal},
      valueReceived:    {doubleValue:isPaga ? inv.valorOriginal : 0},
      valuePaid:        {doubleValue:0},
      wixInvoiceNumber: {stringValue:inv.wixInvoiceNumber},
      updatedAt:        {stringValue:new Date().toISOString()},
    };
    const mask = Object.keys(fields).map(k => `updateMask.fieldPaths=${k}`).join('&');
    const url = `https://firestore.googleapis.com/v1/projects/gen-lang-client-0888019226/databases/(default)/documents/transactions/${inv.id}?${mask}`;
    try {
      const resp = await fetch(url, {
        method:'PATCH',
        headers:{'Authorization':`Bearer ${token}`,'Content-Type':'application/json'},
        body:JSON.stringify({fields})
      });
      if (resp.ok) { ok++; console.log(`OK: ${inv.id} | ${status} | R$${inv.valorOriginal}`); }
      else { err++; console.log(`ERRO: ${inv.id} | ${await resp.text()}`); }
    } catch(e) { err++; console.log(`ERRO: ${inv.id} | ${e.message}`); }
    await new Promise(r => setTimeout(r, 100));
  }
  console.log(`\nTotal: ${ok} OK, ${err} erros`);
}

run().catch(console.error);
