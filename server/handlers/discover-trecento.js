const { createClient } = require("@supabase/supabase-js");

const CANDIDATES = [
"Giotto di Bondone","Duccio di Buoninsegna","Cimabue","Simone Martini","Ambrogio Lorenzetti","Pietro Lorenzetti",
"Pietro Cavallini","Maso di Banco","Bernardo Daddi","Taddeo Gaddi","Agnolo Gaddi","Altichiero da Zevio","Giusto de' Menabuoi",
"Spinello Aretino","Vitale da Bologna","Gentile da Fabriano","Lorenzo Monaco","Michelino da Besozzo","Paolo Veneziano","Stefano Fiorentino",
"Lippo Memmi","Barna da Siena","Bartolo di Fredi","Taddeo di Bartolo","Andrea di Bonaiuto","Jacopo del Casentino","Giovanni da Milano",
"Niccolò di Pietro Gerini","Nardo di Cione","Jacopo di Cione","Giovanni Baronzio","Barnaba da Modena","Andrea di Bartolo","Luca di Tommè",
"Lippo di Vanni","Paolo di Giovanni Fei","Naddo Ceccarelli","Cecco di Pietro","Jacopo di Mino del Pellicciaio","Andrea Vanni",
"Francesco di Vannuccio","Niccolò di Buonaccorso","Bartolomeo Bulgarini","Sano di Matteo","Giovanni d'Asciano","Martino di Bartolomeo",
"Pace di Bartolo","Giacomo di Mino","Giovanni di Paolo","Gregorio di Cecco","Priamo della Quercia","Antonio Veneziano","Jacopo d'Avanzi",
"Puccio Capanna","Giottino","Matteo Giovannetti","Simone dei Crocifissi","Simone da Cusighe","Ottaviano da Faenza","Stefano da Ferrara",
"Guglielmo da Forlì","Andrea da Bologna","Cristoforo da Bologna","Giovanni Bonsi","Lippo di Benivieni","Pacino di Buonaguida",
"Giovanni Bonini","Buonamico Buffalmacco","Montano d'Arezzo","Cristoforo di Bindoccio","Meo da Siena","Ugolino di Nerio",
"Segna di Bonaventura","Niccolò di Segna","Francesco di Segna","Giovanni di Bartolomeo Cristiani","Tommaso del Mazza","Tommaso da Modena",
"Guglielmo Veneziano","Catarino Veneziano","Donato Veneziano","Stefano da Verona","Pisanello","Anovelo da Imbonate","Cola Petruccioli",
"Ottaviano Nelli","Gherardo Starnina","Lorenzo di Bicci","Mariotto di Nardo","Bicci di Lorenzo","Rossello di Jacopo Franchi","Lippo d'Andrea",
"Battista di Biagio Sanguigni","Master of the Dominican Effigies","Master of the Orcagnesque Polyptychs","Master of the Corsi Crucifix",
"Master of the Straus Madonna","Master of Saint Cecilia","Master of Badia a Isola","Master of Città di Castello","Master of San Torpè",
"Master of the Assisi Choirbooks","Master of the Blue Crucifixes","Master of the Franciscan Crucifixes","Master of the Magdalen",
"Master of the Codex of Saint George","Master of the Bambino Vispo","Master of 1416","Master of Marradi","Master of Offida",
"Expressionist Master of Santa Chiara","Master of the Fogg Pietà","Master of 1310","Master of the Ovile Madonna","Master of Panzano",
"Master of Crevole","Master of the Palazzo Venezia","Master of the Ashmolean Predella","Master of San Quirico","Master of Tressa",
"Master of the Augustinian Legend","Master of the Life of Saint Benedict","Master of the Rinuccini Chapel","Master of Saint Verdiana",
"Master of the Osservanza","Master of 1338","Master of the San Giusto Altarpiece","Master of the Cesi Crucifix","Master of Tolentino",
"Master of the Trevi Triptych","Master of the Volterra Annunciation","Master of the Lucca Cross","Master of the Figline Polyptych",
"Master of the Arezzo Polyptych","Master of the Cortona Triptych","Master of the Gubbio Altarpiece"
];

function norm(s){
  return String(s||"")
    .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .toLowerCase()
    .replace(/[’']/g,"'")
    .replace(/\bst\.?\b/g,"saint")
    .replace(/\b(master|maestro)\s+of\s+(the\s+)?/g,"master ")
    .replace(/[^a-z0-9]+/g," ")
    .replace(/\s+/g," ")
    .trim();
}

module.exports=async function handler(req,res){
  try{
    const offset=Math.max(0,Number(req.query?.offset||0));
    const limit=Math.min(20,Math.max(1,Number(req.query?.limit||10)));
    const slice=CANDIDATES.slice(offset,offset+limit);

    const url=process.env.SUPABASE_URL;
    const key=process.env.SUPABASE_SECRET_KEY;
    let existing=[];
    if(url&&key){
      const supabase=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
      const {data}=await supabase.from("artists")
        .select("id,canonical_name,ulan_id,layout_year,region,review_status");
      existing=data||[];
    }

    const byNorm=new Map();
    for(const a of existing){
      const keyName=norm(a.canonical_name);
      if(!byNorm.has(keyName)) byNorm.set(keyName,[]);
      byNorm.get(keyName).push(a);
    }

    const rows=[];
    for(const name of slice){
      const matches=byNorm.get(norm(name))||[];
      const exact=matches.length===1?matches[0]:null;
      rows.push({
        name,
        existing:exact ? {
          id:exact.id,
          canonical_name:exact.canonical_name,
          ulan_id:exact.ulan_id,
          layout_year:exact.layout_year,
          region:exact.region,
          review_status:exact.review_status
        } : null
      });
    }

    res.status(200).json({
      reportOnly:true,total:CANDIDATES.length,offset,limit,
      done:offset+slice.length>=CANDIDATES.length,
      nextOffset:offset+slice.length,
      candidates:rows
    });
  }catch(e){
    res.status(500).json({error:e.message||String(e)});
  }
};

